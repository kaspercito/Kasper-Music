import { EventEmitter } from "node:events";
import os from "node:os";
import type { Client } from "discord.js";
import logger from "../structures/Logger";
import { requesterTransformer } from "../utils/functions/player";
import { LocalPlayer, type LocalPlayerOptions } from "./LocalPlayer";
import {
	type LoadResult,
	type LocalTrack,
	decodeTrack,
	loadUrl,
	searchPrefix,
	spotifyTrackQuery,
} from "./sources";

type SearchInput = string | { query: string; source?: string };

const URL_RE = /^https?:\/\//i;

function prefixFor(source?: string): "ytsearch" | "scsearch" {
	return source === "soundcloud" || source === "scsearch" ? "scsearch" : "ytsearch";
}

/** "Nodo" falso: permite que comandos como /lavalink, /playlist load y /lyrics sigan funcionando. */
export class LocalNode {
	public id = "local";
	public options = { id: "local", host: "local", port: 0, secure: false };
	public connected = true;
	private startedAt = Date.now();

	constructor(private manager: LocalManager) {}

	public get stats() {
		const total = os.totalmem();
		const free = os.freemem();
		const players = this.manager.players.size;
		let playing = 0;
		for (const p of this.manager.players.values()) if (p.playing) playing++;
		return {
			players,
			playingPlayers: playing,
			uptime: Date.now() - this.startedAt,
			memory: { free, used: process.memoryUsage().rss, allocated: total, reservable: total },
			cpu: { cores: os.cpus().length, systemLoad: Math.min(1, os.loadavg()[0] / os.cpus().length), lavalinkLoad: 0 },
		};
	}

	public search(query: SearchInput, requester: unknown, _throwOnEmpty?: boolean) {
		return this.manager.search(query, requester);
	}

	public decode = {
		singleTrack: async (encoded: string, requester?: unknown): Promise<LocalTrack> => {
			const t = decodeTrack(encoded) as LocalTrack;
			t.requester = requesterTransformer(requester);
			return t;
		},
		multipleTracks: async (encoded: string[], requester?: unknown): Promise<LocalTrack[]> => {
			const out: LocalTrack[] = [];
			for (const e of encoded) {
				try {
					const t = decodeTrack(e) as LocalTrack;
					t.requester = requesterTransformer(requester);
					out.push(t);
				} catch {
					// Canción guardada con el formato de Lavalink: no se puede decodificar sin Lavalink.
				}
			}
			return out;
		},
	};

	public lyrics = {
		get: async (_track?: unknown, _skip?: boolean) => null,
		getCurrent: async () => null,
	};
}

class LocalNodeManager extends EventEmitter {
	public nodes = new Map<string, LocalNode>();
	public leastUsedNodes(): LocalNode[] {
		return [...this.nodes.values()];
	}
}

/**
 * Reemplazo de LavalinkManager que reproduce el audio dentro del propio bot.
 * Emite los mismos eventos: trackStart, trackEnd, queueEnd, playerCreate, playerDestroy...
 */
export class LocalManager extends EventEmitter {
	public players = new Map<string, LocalPlayer>();
	public nodeManager = new LocalNodeManager();
	public node: LocalNode;
	public initiated = false;

	constructor(public client: Client & { env?: any }) {
		super();
		this.node = new LocalNode(this);
		this.nodeManager.nodes.set(this.node.id, this.node);
	}

	public async init(_user?: unknown) {
		if (this.initiated) return this;
		this.initiated = true;

		// Mantiene voiceChannelId al día si alguien mueve al bot de canal.
		this.client.on("voiceStateUpdate", (_old, state) => {
			if (state.id !== this.client.user?.id || !state.channelId) return;
			const p = this.players.get(state.guild.id);
			if (p) p.voiceChannelId = state.channelId;
		});

		logger.success("[LOCAL] Modo sin Lavalink activo (yt-dlp + FFmpeg + @discordjs/voice).");
		this.nodeManager.emit("connect", this.node);
		return this;
	}

	public sendRawData(_packet: unknown) {
		// Con @discordjs/voice los eventos de voz ya llegan por el adaptador del cliente.
	}

	public getPlayer(guildId: string) {
		return this.players.get(guildId);
	}

	public createPlayer(options: LocalPlayerOptions) {
		const existing = this.players.get(options.guildId);
		if (existing) return existing;
		const player = new LocalPlayer(this, options);
		this.players.set(options.guildId, player);
		this.emit("playerCreate", player);
		return player;
	}

	public async search(query: SearchInput, requester: unknown, source?: string) {
		const q = typeof query === "string" ? { query, source } : { query: query.query, source: query.source ?? source };
		const text = q.query.trim();
		let result: LoadResult;

		try {
			if (q.source === "local") {
				result = await loadUrl(text, true);
			} else if (URL_RE.test(text)) {
				const spotify = await spotifyTrackQuery(text).catch(() => null);
				if (spotify) {
					const tracks = await searchPrefix("ytsearch", spotify, 5);
					result = tracks.length ? { loadType: "search", tracks: tracks.slice(0, 1), playlist: null } : { loadType: "empty", tracks: [], playlist: null };
				} else if (/open\.spotify\.com|music\.apple\.com|deezer\.com/.test(text)) {
					result = {
						loadType: "error",
						tracks: [],
						playlist: null,
						exception: { message: "Solo se admiten enlaces de canciones de Spotify en modo local.", severity: "common" },
					};
				} else {
					result = await loadUrl(text);
				}
			} else {
				const m = text.match(/^(ytsearch|scsearch)\d*:(.*)$/i);
				const prefix = m ? (m[1].toLowerCase() as "ytsearch" | "scsearch") : prefixFor(q.source);
				const tracks = await searchPrefix(prefix, (m ? m[2] : text).trim(), 10);
				result = tracks.length
					? { loadType: "search", tracks, playlist: null }
					: { loadType: "empty", tracks: [], playlist: null };
			}
		} catch (e) {
			logger.error(`[LOCAL] Error buscando "${text}": ${(e as Error).message}`);
			result = {
				loadType: "error",
				tracks: [],
				playlist: null,
				exception: { message: (e as Error).message, severity: "fault" },
			};
		}

		const req = requesterTransformer(requester);
		for (const t of result.tracks) t.requester = req;
		return { ...result, pluginInfo: {} };
	}
}
