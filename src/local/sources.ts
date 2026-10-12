/**
 * Fuentes de audio locales (sin Lavalink).
 *
 * - yt-dlp: busca y resuelve YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, etc.
 * - ffprobe: archivos directos (.mp3, adjuntos de Discord) y radios (Icecast/Shoutcast).
 */
import { spawn } from "node:child_process";
import { basename } from "node:path";

export const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export interface LocalTrackInfo {
	identifier: string;
	title: string;
	author: string;
	duration: number;
	artworkUrl: string | null;
	uri: string;
	sourceName: string;
	isStream: boolean;
	isSeekable: boolean;
	position: number;
	isrc: string | null;
}

export interface LocalTrack {
	encoded: string;
	info: LocalTrackInfo;
	pluginInfo: Record<string, any>;
	userData: Record<string, any>;
	requester?: any;
}

export interface ResolvedStream {
	/** Si es true, yt-dlp descarga el audio y lo pasa a FFmpeg por tubería (evita 403 de YouTube). */
	viaYtdlp?: boolean;
	url: string;
	headers: Record<string, string>;
	isLive: boolean;
}

function run(cmd: string, args: string[], timeoutMs = 45_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`${cmd} tardó demasiado (${timeoutMs}ms)`));
		}, timeoutMs);
		child.stdout.on("data", (d) => {
			out += d;
		});
		child.stderr.on("data", (d) => {
			err += d;
		});
		child.on("error", (e: any) => {
			clearTimeout(timer);
			reject(
				e?.code === "ENOENT"
					? new Error(`No se encontró "${cmd}". Instálalo o define su ruta en .env.`)
					: e,
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(out);
			else reject(new Error(err.trim().split("\n").pop() || `${cmd} salió con código ${code}`));
		});
	});
}

export function ytdlpBaseArgs(): string[] {
	const args = ["--ignore-config", "--no-warnings", "--no-cache-dir"];
	if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
	if (process.env.YTDLP_ARGS) args.push(...process.env.YTDLP_ARGS.split(" ").filter(Boolean));
	return args;
}

export function encodeTrack(info: LocalTrackInfo, pluginInfo: Record<string, any> = {}): string {
	return Buffer.from(JSON.stringify({ info, pluginInfo })).toString("base64");
}

export function decodeTrack(encoded: string): Omit<LocalTrack, "requester"> {
	const { info, pluginInfo } = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
	return { encoded, info, pluginInfo: pluginInfo ?? {}, userData: {} };
}

export function makeTrack(info: Partial<LocalTrackInfo> & { uri: string }): LocalTrack {
	const full: LocalTrackInfo = {
		identifier: info.identifier ?? info.uri,
		title: info.title || "Sin título",
		author: info.author || "Desconocido",
		duration: info.duration ?? 0,
		artworkUrl: info.artworkUrl ?? null,
		uri: info.uri,
		sourceName: info.sourceName ?? "http",
		isStream: info.isStream ?? false,
		isSeekable: info.isSeekable ?? !info.isStream,
		position: 0,
		isrc: info.isrc ?? null,
	};
	return { encoded: encodeTrack(full), info: full, pluginInfo: {}, userData: {} };
}

function sourceNameFrom(extractor?: string): string {
	const k = (extractor ?? "").toLowerCase();
	if (k.startsWith("youtube")) return "youtube";
	if (k.startsWith("soundcloud")) return "soundcloud";
	if (k === "generic" || k === "") return "http";
	return k;
}

function entryToTrack(e: any): LocalTrack | null {
	const source = sourceNameFrom(e.extractor_key ?? e.ie_key ?? e.extractor);
	const id: string = e.id ?? "";
	let uri: string = e.webpage_url ?? e.url ?? "";
	if (source === "youtube" && id) uri = `https://www.youtube.com/watch?v=${id}`;
	if (!uri) return null;
	const thumbs: any[] = e.thumbnails ?? [];
	const art =
		e.thumbnail ??
		thumbs[thumbs.length - 1]?.url ??
		(source === "youtube" && id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null);
	const live = e.is_live === true || e.live_status === "is_live";
	return makeTrack({
		identifier: id || uri,
		title: e.title,
		author: e.uploader ?? e.channel ?? e.artist ?? e.creator,
		duration: e.duration ? Math.round(e.duration * 1000) : 0,
		artworkUrl: art,
		uri,
		sourceName: source,
		isStream: live,
		isSeekable: !live,
	});
}

export type LoadResult = {
	loadType: "track" | "playlist" | "search" | "empty" | "error";
	tracks: LocalTrack[];
	playlist: { name: string; title: string; duration: number; uri?: string } | null;
	exception?: { message: string; severity: string };
};

const empty = (): LoadResult => ({ loadType: "empty", tracks: [], playlist: null });

export async function searchPrefix(prefix: "ytsearch" | "scsearch", query: string, limit = 10) {
	const out = await run(YTDLP, [
		...ytdlpBaseArgs(),
		"--flat-playlist",
		"-J",
		`${prefix}${limit}:${query}`,
	]);
	const json = JSON.parse(out);
	const tracks = (json.entries ?? [])
		.map((e: any) => entryToTrack({ ...e, extractor_key: e.ie_key ?? (prefix === "scsearch" ? "SoundCloud" : "Youtube") }))
		.filter(Boolean) as LocalTrack[];
	return tracks;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|wma|webm|mp4|mkv|mov)(\?|$)/i;

export function looksLikeDirectMedia(url: string): boolean {
	try {
		const u = new URL(url);
		return AUDIO_EXT.test(u.pathname + u.search) || u.hostname.endsWith("discordapp.com") || u.hostname.endsWith("discordapp.net");
	} catch {
		return false;
	}
}

/** Archivos directos y radios: se leen con ffprobe. */
export async function probeDirect(url: string, sourceName = "http"): Promise<LocalTrack> {
	const out = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", url], 20_000);
	const j = JSON.parse(out);
	const tags = { ...(j.format?.tags ?? {}) } as Record<string, string>;
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(tags)) lower[k.toLowerCase()] = v;
	const seconds = Number.parseFloat(j.format?.duration ?? "");
	const isStream = !Number.isFinite(seconds) || seconds <= 0;
	let name = lower.title || lower["icy-name"];
	if (!name) {
		try {
			name = decodeURIComponent(basename(new URL(url).pathname)) || url;
		} catch {
			name = url;
		}
	}
	return makeTrack({
		identifier: url,
		title: name,
		author: lower.artist || lower["icy-name"] || (isStream ? "Radio" : "Archivo"),
		duration: isStream ? 0 : Math.round(seconds * 1000),
		uri: url,
		sourceName: isStream ? "radio" : sourceName,
		isStream,
		isSeekable: !isStream,
	});
}

/** Resuelve una URL (video, playlist, archivo o radio). */
export async function loadUrl(url: string, forceDirect = false): Promise<LoadResult> {
	if (forceDirect || looksLikeDirectMedia(url)) {
		try {
			return { loadType: "track", tracks: [await probeDirect(url, forceDirect ? "local" : "http")], playlist: null };
		} catch (e) {
			if (forceDirect) return { loadType: "error", tracks: [], playlist: null, exception: { message: (e as Error).message, severity: "common" } };
		}
	}
	const isPlaylistUrl = /[?&]list=/.test(url) && /\/playlist\?/.test(url);
	const isSetUrl = /soundcloud\.com\/[^/]+\/sets\//.test(url) || /bandcamp\.com\/album\//.test(url);
	try {
		const args = [...ytdlpBaseArgs(), "-J"];
		if (isPlaylistUrl || isSetUrl) args.push("--flat-playlist");
		else args.push("--no-playlist");
		args.push(url);
		const json = JSON.parse(await run(YTDLP, args, 60_000));
		if (json._type === "playlist" && Array.isArray(json.entries)) {
			const tracks = json.entries
				.map((e: any) => entryToTrack({ ...e, extractor_key: e.ie_key ?? json.extractor_key }))
				.filter(Boolean) as LocalTrack[];
			if (!tracks.length) return empty();
			return {
				loadType: "playlist",
				tracks,
				playlist: {
					name: json.title ?? "Playlist",
					title: json.title ?? "Playlist",
					duration: tracks.reduce((a, t) => a + t.info.duration, 0),
					uri: url,
				},
			};
		}
		const t = entryToTrack({ ...json, webpage_url: json.webpage_url ?? url });
		return t ? { loadType: "track", tracks: [t], playlist: null } : empty();
	} catch (ytErr) {
		// Último recurso: puede ser una radio o un stream directo que yt-dlp no entiende.
		try {
			return { loadType: "track", tracks: [await probeDirect(url)], playlist: null };
		} catch {
			return { loadType: "error", tracks: [], playlist: null, exception: { message: (ytErr as Error).message, severity: "common" } };
		}
	}
}

/** Obtiene la URL real de audio justo antes de reproducir (las URLs de YouTube caducan). */
export async function resolveStream(track: LocalTrack): Promise<ResolvedStream> {
	const { sourceName, uri, isStream } = track.info;
	if (sourceName === "local" || sourceName === "radio" || (sourceName === "http" && looksLikeDirectMedia(uri))) {
		return { url: uri, headers: {}, isLive: isStream };
	}
	// YouTube devuelve 403 cuando FFmpeg descarga la URL directamente desde un servidor.
	// Por eso yt-dlp descarga el audio (con sus cabeceras/cookies) y FFmpeg solo lo decodifica.
	return { url: uri, headers: {}, isLive: isStream, viaYtdlp: true };
}

/** Canciones relacionadas para el autoplay. */
export async function relatedTracks(track: LocalTrack, limit = 5): Promise<LocalTrack[]> {
	const { sourceName, identifier, title, author } = track.info;
	try {
		if (sourceName === "youtube") {
			const json = JSON.parse(
				await run(YTDLP, [
					...ytdlpBaseArgs(),
					"--flat-playlist",
					"-J",
					"--playlist-items",
					`2-${limit + 6}`,
					`https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`,
				]),
			);
			const tracks = (json.entries ?? [])
				.map((e: any) => entryToTrack({ ...e, extractor_key: "Youtube" }))
				.filter((t: LocalTrack | null): t is LocalTrack => !!t && t.info.identifier !== identifier);
			if (tracks.length) return tracks.slice(0, limit);
		}
	} catch {
		// cae al respaldo de búsqueda
	}
	const found = await searchPrefix(sourceName === "soundcloud" ? "scsearch" : "ytsearch", `${author} ${title}`, limit + 3);
	return found.filter((t) => t.info.identifier !== identifier).slice(0, limit);
}

/** Enlaces de Spotify (solo canciones): se busca "artista título" en YouTube. */
export async function spotifyTrackQuery(url: string): Promise<string | null> {
	if (!/open\.spotify\.com\/(intl-[a-z]+\/)?track\//.test(url)) return null;
	const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
	const html = await res.text();
	const m = html.match(/<title>(.*?)<\/title>/i)?.[1];
	if (!m) return null;
	// "Canción - song and lyrics by Artista | Spotify"
	const parsed = m.match(/^(.*?)\s*-\s*(?:song|canción|canci&#x27;on)[^|]*?\bby\s+(.*?)\s*\|/i);
	if (parsed) return `${parsed[2]} ${parsed[1]}`.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
	return m.replace(/\|\s*Spotify.*$/i, "").trim();
}
