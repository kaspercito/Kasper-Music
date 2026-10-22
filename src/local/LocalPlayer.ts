import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {
	AudioPlayerStatus,
	type AudioPlayer,
	type AudioResource,
	NoSubscriberBehavior,
	StreamType,
	type VoiceConnection,
	VoiceConnectionStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
} from "@discordjs/voice";
import logger from "../structures/Logger";
import { LocalFilterManager } from "./LocalFilters";
import { LocalQueue } from "./LocalQueue";
import type { LocalManager } from "./LocalManager";
import { FFMPEG, type LocalTrack, YTDLP, relatedTracks, resolveStream, ytdlpBaseArgs, ytdlpClientSets } from "./sources";

export type RepeatMode = "off" | "track" | "queue";

export interface LocalPlayerOptions {
	guildId: string;
	voiceChannelId: string;
	textChannelId?: string;
	selfDeaf?: boolean;
	selfMute?: boolean;
	vcRegion?: string;
	volume?: number;
}

/**
 * Reproductor sin Lavalink: @discordjs/voice + FFmpeg + yt-dlp.
 * Expone la misma API que el bot usa de `Player` en lavalink-client.
 */
export class LocalPlayer {
	public guildId: string;
	public voiceChannelId: string | null;
	public textChannelId: string | undefined;
	public options: LocalPlayerOptions;
	public queue: LocalQueue;
	public filterManager: LocalFilterManager;
	public repeatMode: RepeatMode = "off";
	public volume: number;
	public paused = false;
	public playing = false;
	public connected = false;
	public destroyed = false;

	private data = new Map<string, unknown>();
	private connection: VoiceConnection | null = null;
	private audio: AudioPlayer;
	private resource: AudioResource | null = null;
	private ffmpeg: any = null;
	private ytdlp: any = null;
	private seekOffset = 0;
	private generation = 0;
	private startedAt = 0;
	private ffmpegFailed = false;

	constructor(
		public manager: LocalManager,
		options: LocalPlayerOptions,
	) {
		this.options = options;
		this.guildId = options.guildId;
		this.voiceChannelId = options.voiceChannelId;
		this.textChannelId = options.textChannelId;
		this.volume = options.volume ?? 100;
		this.queue = new LocalQueue(25);
		this.filterManager = new LocalFilterManager(this);

		this.audio = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
		this.audio.on("stateChange", (oldS, newS) => {
			if (
				oldS.status !== AudioPlayerStatus.Idle &&
				newS.status === AudioPlayerStatus.Idle &&
				(oldS as any).resource === this.resource &&
				this.resource
			) {
				void this.onNaturalEnd();
			}
		});
		this.audio.on("error", (err) => logger.error(`[LOCAL] Error de audio en ${this.guildId}: ${err.message}`));
	}

	public get node() {
		return this.manager.node;
	}

	/** Posición actual en ms. */
	public get position(): number {
		if (!this.resource) return 0;
		return this.seekOffset + (this.resource.playbackDuration ?? 0);
	}

	public get<T = unknown>(key: string): T {
		return this.data.get(key) as T;
	}
	public set(key: string, value: unknown): this {
		this.data.set(key, value);
		return this;
	}

	// ---------------------------------------------------------------- voz

	public async connect(): Promise<this> {
		if (this.destroyed) throw new Error("El player ya fue destruido");
		if (!this.voiceChannelId) throw new Error("No hay canal de voz");
		const guild = this.manager.client.guilds.cache.get(this.guildId);
		if (!guild) throw new Error("Servidor no encontrado");

		if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
			if (this.connected) return this;
			this.connection.destroy();
		}

		const connection = joinVoiceChannel({
			channelId: this.voiceChannelId,
			guildId: this.guildId,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: this.options.selfDeaf ?? true,
			selfMute: this.options.selfMute ?? false,
		});
		this.connection = connection;

		connection.on(VoiceConnectionStatus.Disconnected, async () => {
			if (this.destroyed || this.connection !== connection) return;
			try {
				// Si Discord lo movió de canal, se reconecta solo.
				await Promise.race([
					entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
					entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
				]);
			} catch {
				const old = this.voiceChannelId;
				if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
				this.connected = false;
				this.stopStream();
				this.manager.emit("playerDisconnect", this, old);
			}
		});
		connection.on("error", (e) => logger.error(`[LOCAL] Error de voz en ${this.guildId}: ${e.message}`));

		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
		} catch (e) {
			if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
			this.connection = null;
			throw new Error("No se pudo conectar al canal de voz (¿permisos de Conectar/Hablar?)");
		}
		connection.subscribe(this.audio);
		this.connected = true;
		return this;
	}

	public async disconnect(): Promise<this> {
		this.stopStream();
		if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
			this.connection.destroy();
		}
		this.connection = null;
		this.connected = false;
		return this;
	}

	public async destroy(reason = "PlayerDestroy", disconnect = true): Promise<this> {
		if (this.destroyed) return this;
		this.destroyed = true;
		this.stopStream();
		this.manager.emit("playerDestroy", this, reason);
		if (disconnect) await this.disconnect();
		this.manager.players.delete(this.guildId);
		return this;
	}

	// ------------------------------------------------------------ búsqueda

	public async search(query: string | { query: string; source?: any }, requester: unknown) {
		return this.manager.search(query, requester);
	}

	public async getLyrics(_track?: LocalTrack, _skipTrackSource?: boolean) {
		return null;
	}
	public async getCurrentLyrics(_skipTrackSource?: boolean) {
		return null;
	}
	public async moveNode(_nodeId: string) {
		return this;
	}

	// -------------------------------------------------------- reproducción

	public async play(opts: { track?: any; clientTrack?: LocalTrack; paused?: boolean; position?: number; volume?: number } = {}) {
		if (this.destroyed) return;
		if (opts.volume !== undefined) await this.setVolume(opts.volume);

		const explicit: LocalTrack | undefined =
			opts.clientTrack ?? (opts.track?.info ? (opts.track as LocalTrack) : undefined);

		if (explicit) {
			const prevIdx = this.queue.previous.indexOf(explicit);
			const old = this.queue.current;
			if (prevIdx >= 0) {
				// "Anterior": se vuelve atrás y la canción actual queda como la siguiente.
				this.queue.previous.splice(prevIdx, 1);
				if (old) this.queue.tracks.unshift(old);
			}
			this.queue.current = explicit;
		} else if (this.queue.current && this.resource) {
			// Ya hay algo sonando/pausado: solo se reanuda.
			if (opts.paused === false && this.paused) await this.resume();
			return;
		} else if (!this.queue.current) {
			this.queue.current = this.queue.tracks.shift() ?? null;
		}
		if (!this.queue.current) return;
		await this.startCurrent(opts.position ?? 0, opts.paused ?? false, true);
	}

	private async startCurrent(position: number, paused: boolean, announce: boolean) {
		const track = this.queue.current;
		if (!track) return;
		const gen = ++this.generation;
		this.stopStream(false);

		let stream: Awaited<ReturnType<typeof resolveStream>>;
		try {
			stream = await resolveStream(track);
		} catch (e) {
			if (gen !== this.generation) return;
			logger.error(`[LOCAL] No se pudo resolver "${track.info.title}": ${(e as Error).message}`);
			this.manager.emit("trackError", this, track, { message: (e as Error).message });
			return this.advance("loadFailed");
		}
		if (gen !== this.generation) return;

		const args = ["-hide_banner", "-loglevel", "error"];
		if (stream.viaYtdlp) {
			// la entrada llega por stdin desde yt-dlp
		} else if (/^https?:/i.test(stream.url)) {
			args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
			const headers = Object.entries(stream.headers)
				.map(([k, v]) => `${k}: ${v}\r\n`)
				.join("");
			if (headers) args.push("-headers", headers);
		}
		if (position > 0 && !stream.isLive) args.push("-ss", (position / 1000).toFixed(3));
		args.push("-i", stream.viaYtdlp ? "pipe:0" : stream.url, "-vn");
		const af = this.filterManager.toFfmpeg();
		if (af) args.push("-af", af);
		args.push("-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1");

		const ff = spawn(FFMPEG, args, { stdio: [stream.viaYtdlp ? "pipe" : "ignore", "pipe", "pipe"] });
		let stderr = "";
		if (stream.viaYtdlp) {
			// Prueba varios clientes de YouTube: si uno da 403 antes de entregar datos, pasa al siguiente.
			const isYoutube = /youtube\.com|youtu\.be/i.test(stream.url);
			const clients: (string | undefined)[] = isYoutube ? ytdlpClientSets() : [undefined];
			const startYtdlp = (idx: number) => {
				const yt = spawn(
					YTDLP,
					[
						...ytdlpBaseArgs(clients[idx]),
						"-q",
						"--no-progress",
						"-f",
						"bestaudio[ext=webm]/bestaudio/best",
						"--no-playlist",
						"--retries",
						"3",
						"-o",
						"-",
						stream.url,
					],
					{ stdio: ["ignore", "pipe", "pipe"] },
				);
				let ytErr = "";
				let gotData = false;
				yt.stderr.on("data", (d: Buffer) => {
					ytErr += d;
				});
				yt.on("error", (e: any) => logger.error(`[LOCAL] yt-dlp: ${e.message}`));
				yt.stdout.on("data", () => {
					gotData = true;
				});
				yt.on("close", (code: number | null) => {
					if (gen !== this.generation) return;
					const last = ytErr.trim().split("\n").pop();
					if (code && !gotData && idx + 1 < clients.length) {
						logger.warn(`[LOCAL] yt-dlp (cliente "${clients[idx]}") falló: ${last}. Probando "${clients[idx + 1]}"...`);
						startYtdlp(idx + 1);
						return;
					}
					if (code) logger.warn(`[LOCAL] yt-dlp terminó con código ${code}: ${last}`);
					else ff.stdin?.end();
				});
				yt.stdout.on("error", () => undefined);
				// end:false -> FFmpeg solo recibe EOF cuando ya no quedan intentos.
				yt.stdout.pipe(ff.stdin!, { end: false });
				this.ytdlp = yt;
			};
			ff.stdin?.on("error", () => undefined);
			ff.on("close", () => this.ytdlp?.kill("SIGKILL"));
			startYtdlp(0);
		}
		ff.stderr.on("data", (d) => {
			stderr += d;
		});
		ff.on("error", (e: any) => {
			logger.error(
				e?.code === "ENOENT" ? `[LOCAL] FFmpeg no está instalado ("${FFMPEG}")` : `[LOCAL] FFmpeg: ${e.message}`,
			);
		});
		ff.on("close", (code) => {
			if (code && code !== 255 && gen === this.generation) {
				this.ffmpegFailed = true;
				logger.warn(`[LOCAL] FFmpeg terminó con código ${code}: ${stderr.trim().split("\n").pop()}`);
			}
		});
		ff.stdout.on("error", () => undefined);
		this.ffmpeg = ff;
		this.ffmpegFailed = false;

		const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
		resource.volume?.setVolume(this.volume / 100);
		this.resource = resource;
		this.seekOffset = position;
		this.startedAt = Date.now();
		this.audio.play(resource);
		if (paused) this.audio.pause(true);
		this.paused = paused;
		this.playing = !paused;

		if (announce) this.manager.emit("trackStart", this, track, { type: "TrackStartEvent", track });
	}

	/** Detiene FFmpeg y el recurso actual sin disparar eventos de fin. */
	private stopStream(stopAudio = true) {
		this.resource = null;
		if (this.ytdlp) {
			this.ytdlp.kill("SIGKILL");
			this.ytdlp = null;
		}
		if (this.ffmpeg) {
			this.ffmpeg.kill("SIGKILL");
			this.ffmpeg = null;
		}
		if (stopAudio) this.audio.stop(true);
		this.playing = false;
	}

	/** Reinicia el stream en la posición actual (al cambiar filtros). */
	public async refreshStream() {
		if (!this.queue.current || !this.resource) return;
		await this.startCurrent(this.position, this.paused, false);
	}

	private async onNaturalEnd() {
		const failedEarly = this.ffmpegFailed && Date.now() - this.startedAt < 4_000;
		await this.advance(failedEarly ? "loadFailed" : "finished");
	}

	/**
	 * Pasa a la siguiente canción.
	 * reason: finished (terminó), skipped (skip manual), loadFailed (error al cargar).
	 */
	private async advance(reason: "finished" | "skipped" | "loadFailed") {
		const ended = this.queue.current;
		this.stopStream();
		this.playing = false;
		this.paused = false;

		if (ended) {
			if (reason === "finished" && this.repeatMode === "track") {
				this.manager.emit("trackEnd", this, ended, { type: "TrackEndEvent", track: ended, reason });
				await this.startCurrent(0, false, true);
				return;
			}
			this.queue.pushPrevious(ended);
			if (this.repeatMode === "queue" && reason !== "loadFailed") this.queue.tracks.push(ended);
			this.manager.emit("trackEnd", this, ended, { type: "TrackEndEvent", track: ended, reason });
		}
		if (this.destroyed) return;

		let next = this.queue.tracks.shift();
		if (!next && ended && this.get<boolean>("autoplay")) {
			try {
				const rel = await relatedTracks(ended, 5);
				const requester = (ended as any).requester;
				for (const t of rel) {
					t.requester = requester;
					t.pluginInfo.clientData = { fromAutoplay: true };
				}
				this.queue.tracks.push(...rel);
				next = this.queue.tracks.shift();
			} catch (e) {
				logger.warn(`[LOCAL] Autoplay falló: ${(e as Error).message}`);
			}
		}
		if (next) {
			this.queue.current = next;
			await this.startCurrent(0, false, true);
		} else {
			this.queue.current = null;
			this.manager.emit("queueEnd", this, ended, { type: "TrackEndEvent", track: ended, reason });
		}
	}

	public async skip(skipTo = 0) {
		if (skipTo > 0) this.queue.tracks.splice(0, skipTo - 1);
		if (!this.queue.current) {
			this.queue.current = this.queue.tracks.shift() ?? null;
			if (this.queue.current) await this.startCurrent(0, false, true);
			return this;
		}
		await this.advance("skipped");
		return this;
	}

	public async stopPlaying(clearQueue = true, _executeAutoplay = false) {
		const ended = this.queue.current;
		if (clearQueue) this.queue.tracks.length = 0;
		this.stopStream();
		this.playing = false;
		this.paused = false;
		this.queue.current = null;
		if (ended) {
			this.queue.pushPrevious(ended);
			this.manager.emit("trackEnd", this, ended, { type: "TrackEndEvent", track: ended, reason: "stopped" });
		}
		if (!this.queue.tracks.length) this.manager.emit("queueEnd", this, ended, { type: "TrackEndEvent", track: ended, reason: "stopped" });
		return this;
	}

	public async pause() {
		if (!this.resource || this.paused) return this;
		this.audio.pause(true);
		this.paused = true;
		this.playing = false;
		this.manager.emit("playerPaused", this);
		return this;
	}

	public async resume() {
		if (!this.resource || !this.paused) return this;
		this.audio.unpause();
		this.paused = false;
		this.playing = true;
		this.manager.emit("playerResumed", this);
		return this;
	}

	public async seek(positionMs: number) {
		const track = this.queue.current;
		if (!track || !track.info.isSeekable) return this;
		const dur = track.info.duration || Number.POSITIVE_INFINITY;
		await this.startCurrent(Math.max(0, Math.min(positionMs, dur - 500)), this.paused, false);
		return this;
	}

	public async setVolume(volume: number) {
		this.volume = Math.max(0, Math.min(1000, volume));
		this.resource?.volume?.setVolume(this.volume / 100);
		return this;
	}

	public async setRepeatMode(mode: RepeatMode) {
		this.repeatMode = mode;
		return this;
	}
}
