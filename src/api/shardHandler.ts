import os from "node:os";
import { ActivityType, ChannelType, type Guild, type PresenceStatusData } from "discord.js";
import type { Lavamusic } from "../structures/index";
import { getSupportedLanguages } from "../structures/I18n";
import logger from "../structures/Logger";
import { getLogs, installLogBuffer } from "./logbuffer";
import { PanelError, type PanelReply, type PanelRequest } from "./protocol";

type Handler = (client: Lavamusic, args: Record<string, any>) => Promise<unknown> | unknown;

/** Quien "pide" las canciones desde el panel. Usa el id del bot para que Discord muestre una mención válida. */
const panelRequester = (client: Lavamusic) => ({ id: client.user?.id ?? "0", username: "Panel web", avatar: null });

/* ------------------------------------------------------------------ helpers */

const clampInt = (v: unknown, min: number, max: number, name: string): number => {
	const n = Number(v);
	if (!Number.isFinite(n)) throw new PanelError(`"${name}" debe ser un número`);
	return Math.max(min, Math.min(max, Math.round(n)));
};

function getGuild(client: Lavamusic, guildId: unknown): Guild | null {
	if (typeof guildId !== "string" || !/^\d{5,25}$/.test(guildId)) throw new PanelError("guildId inválido");
	return client.guilds.cache.get(guildId) ?? null;
}

function needPlayer(client: Lavamusic, guildId: string): any {
	const player = (client.manager as any).getPlayer(guildId);
	if (!player) throw new PanelError("No hay un reproductor activo en este servidor.", 409);
	return player;
}

function trackJson(t: any) {
	if (!t?.info) return null;
	const r = t.requester ?? {};
	return {
		title: String(t.info.title ?? "Desconocido"),
		author: String(t.info.author ?? ""),
		uri: t.info.uri ?? null,
		artwork: t.info.artworkUrl ?? null,
		duration: Number(t.info.duration) || 0,
		isStream: !!t.info.isStream,
		source: t.info.sourceName ?? null,
		requester: r.username ?? null,
		auto: !!t.pluginInfo?.clientData?.fromAutoplay,
	};
}

function filtersJson(player: any) {
	const fm = player.filterManager;
	const f = fm?.filters ?? {};
	const eq: { band: number; gain: number }[] = fm?.equalizer ?? [];
	const eqGain = (b: number) => eq.find((x) => x.band === b)?.gain ?? 0;
	let bass = "off";
	if (eqGain(0) >= 0.28) bass = "high";
	else if (eqGain(0) >= 0.18) bass = "medium";
	else if (eqGain(0) > 0.05) bass = "low";
	return {
		nightcore: !!f.nightcore,
		rotation: !!f.rotation,
		karaoke: !!f.karaoke,
		tremolo: !!f.tremolo,
		vibrato: !!f.vibrato,
		lowpass: !!f.lowPass,
		bassboost: bass,
		speed: fm?.speed ?? f.timescale?.speed ?? 1,
		pitch: fm?.pitch ?? f.timescale?.pitch ?? 1,
		rate: fm?.rate ?? f.timescale?.rate ?? 1,
	};
}

function playerJson(client: Lavamusic, guild: Guild, player: any) {
	const q = player.queue;
	const voice = player.voiceChannelId ? guild.channels.cache.get(player.voiceChannelId) : null;
	const tracks: any[] = q.tracks ?? [];
	const total = (q.current?.info?.duration ?? 0) + tracks.reduce((a, t) => a + (t.info?.duration || 0), 0);
	return {
		connected: !!player.connected,
		voiceChannelId: player.voiceChannelId ?? null,
		voiceChannelName: voice?.name ?? null,
		textChannelId: player.textChannelId ?? null,
		playing: !!player.playing,
		paused: !!player.paused,
		volume: Number(player.volume) || 0,
		repeat: player.repeatMode ?? "off",
		autoplay: !!player.get?.("autoplay"),
		fairplay: !!player.get?.("fairplay"),
		position: Math.max(0, Number(player.position) || 0),
		serverTime: Date.now(),
		current: trackJson(q.current),
		queue: tracks.slice(0, 300).map(trackJson),
		queueTotal: tracks.length,
		queueDuration: total,
		previousCount: q.previous?.length ?? 0,
		filters: filtersJson(player),
	};
}

function guildSummary(client: Lavamusic, g: Guild) {
	const p: any = (client.manager as any).getPlayer(g.id);
	return {
		id: g.id,
		name: g.name,
		icon: g.iconURL({ size: 64, extension: "png" }),
		members: g.memberCount,
		shard: g.shardId,
		player: p
			? {
					connected: !!p.connected,
					playing: !!p.playing,
					paused: !!p.paused,
					title: p.queue?.current?.info?.title ?? null,
					queue: p.queue?.tracks?.length ?? 0,
				}
			: null,
	};
}

/**
 * Canal donde el bot publica "Reproduciendo ahora". Orden:
 * elegido en el panel → PANEL_TEXT_CHANNEL → canal del reproductor → canal /setup → canal 24/7 →
 * un canal llamado música/music/bot/comandos. Nunca el canal de avisos del sistema (despedidas, etc.).
 */
async function pickTextChannel(client: Lavamusic, guild: Guild, preferred?: string): Promise<string | undefined> {
	const me = guild.members.me;
	const ok = (id?: string | null) => {
		if (!id) return false;
		const c = guild.channels.cache.get(id);
		if (!c || (c.type !== ChannelType.GuildText && c.type !== ChannelType.GuildAnnouncement)) return false;
		return !me || c.permissionsFor(me)?.has(["ViewChannel", "SendMessages"]) === true;
	};
	if (ok(preferred)) return preferred;
	if (ok(process.env.PANEL_TEXT_CHANNEL)) return process.env.PANEL_TEXT_CHANNEL;
	const fromPlayer = (client.manager as any).getPlayer(guild.id)?.textChannelId;
	if (ok(fromPlayer)) return fromPlayer;
	const setup: any = await client.db.getSetup(guild.id).catch(() => null);
	if (ok(setup?.textId)) return setup.textId;
	const stay: any = await client.db.get_247(guild.id).catch(() => null);
	const stayRow = Array.isArray(stay) ? stay[0] : stay;
	if (ok(stayRow?.textId)) return stayRow.textId;
	return guild.channels.cache.find((c) => ok(c.id) && /m[uú]sica|music|comandos|bot/i.test(c.name))?.id;
}

async function ensurePlayer(client: Lavamusic, guild: Guild, voiceChannelId?: string, textChannelId?: string) {
	const manager: any = client.manager;
	let player = manager.getPlayer(guild.id);
	if (!player) {
		const vc = voiceChannelId ? guild.channels.cache.get(voiceChannelId) : null;
		if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
			throw new PanelError("Elige un canal de voz para que el bot entre.", 400);
		}
		const me = guild.members.me;
		if (me && !vc.permissionsFor(me)?.has(["Connect", "Speak"])) {
			throw new PanelError("El bot no tiene permisos de Conectar/Hablar en ese canal.", 403);
		}
		player = manager.createPlayer({
			guildId: guild.id,
			voiceChannelId: vc.id,
			textChannelId: await pickTextChannel(client, guild, textChannelId),
			selfMute: false,
			selfDeaf: true,
			vcRegion: (vc as any).rtcRegion ?? undefined,
			volume: await client.db.getDefaultVolume(guild.id).catch(() => 100),
		});
	}
	if (!player.connected) {
		try {
			await player.connect();
		} catch (e) {
			throw new PanelError((e as Error).message || "No se pudo conectar al canal de voz.", 502);
		}
	}
	return player;
}

const BASS: Record<string, { band: number; gain: number }[]> = {
	low: [
		{ band: 0, gain: 0.1 },
		{ band: 1, gain: 0.08 },
		{ band: 2, gain: 0.05 },
	],
	medium: [
		{ band: 0, gain: 0.2 },
		{ band: 1, gain: 0.15 },
		{ band: 2, gain: 0.1 },
		{ band: 3, gain: 0.05 },
	],
	high: [
		{ band: 0, gain: 0.3 },
		{ band: 1, gain: 0.25 },
		{ band: 2, gain: 0.2 },
		{ band: 3, gain: 0.1 },
		{ band: 4, gain: 0.05 },
	],
};

/** Los toggles de filtros del bot invierten el estado: aquí se fija el valor pedido. */
async function setToggle(player: any, key: string, want: boolean) {
	const fm = player.filterManager;
	const map: Record<string, [string, string]> = {
		nightcore: ["nightcore", "toggleNightcore"],
		rotation: ["rotation", "toggleRotation"],
		karaoke: ["karaoke", "toggleKaraoke"],
		tremolo: ["tremolo", "toggleTremolo"],
		vibrato: ["vibrato", "toggleVibrato"],
		lowpass: ["lowPass", "toggleLowPass"],
	};
	const [stateKey, fn] = map[key];
	if (!!fm.filters?.[stateKey] !== want) await fm[fn]();
}

/* ------------------------------------------------------------------ actions */

const handlers: Record<string, Handler> = {
	stats(client) {
		const manager: any = client.manager;
		let players = 0;
		let playing = 0;
		for (const p of manager.players?.values?.() ?? []) {
			players++;
			if (p.playing) playing++;
		}
		const mem = process.memoryUsage();
		return {
			shard: client.shard?.ids?.[0] ?? 0,
			ready: client.isReady(),
			ping: client.ws.ping,
			guilds: client.guilds.cache.size,
			users: client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0),
			players,
			playing,
			rss: mem.rss,
			heap: mem.heapUsed,
			uptime: client.uptime ?? 0,
			bot: client.user
				? {
						id: client.user.id,
						tag: client.user.tag,
						name: client.user.username,
						avatar: client.user.displayAvatarURL({ size: 128, extension: "png" }),
					}
				: null,
			backend: manager.node?.id === "local" ? "local" : "lavalink",
			status: client.user?.presence?.status ?? "online",
			activity: client.user?.presence?.activities?.[0]?.name ?? null,
			sysMemTotal: os.totalmem(),
			sysMemFree: os.freemem(),
			languages: getSupportedLanguages(),
		};
	},

	guilds(client) {
		return [...client.guilds.cache.values()]
			.map((g) => guildSummary(client, g))
			.sort((a, b) => Number(!!b.player?.playing) - Number(!!a.player?.playing) || a.name.localeCompare(b.name));
	},

	async guild(client, { guildId }) {
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const player: any = (client.manager as any).getPlayer(g.id);
		const voice = [...g.channels.cache.values()]
			.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
			.sort((a, b) => ((a as any).position ?? 0) - ((b as any).position ?? 0))
			.map((c) => ({ id: c.id, name: c.name, members: (c as any).members?.size ?? 0 }));
		const text = [...g.channels.cache.values()]
			.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
			.sort((a, b) => ((a as any).position ?? 0) - ((b as any).position ?? 0))
			.map((c) => ({ id: c.id, name: c.name }));

		const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
			try {
				return await fn();
			} catch {
				return fallback;
			}
		};
		const [prefix, language, defaultVolume, dj, roles, stay] = await Promise.all([
			safe(() => client.db.getPrefix(g.id), client.env.PREFIX),
			safe(() => client.db.getLanguage(g.id), client.env.DEFAULT_LANGUAGE),
			safe(() => client.db.getDefaultVolume(g.id), 100),
			safe(() => client.db.getDj(g.id), null as any),
			safe(() => client.db.getRoles(g.id), [] as any[]),
			safe(() => client.db.get_247(g.id), null as any),
		]);
		const stayRow: any = Array.isArray(stay) ? stay[0] : stay;

		return {
			...guildSummary(client, g),
			voiceChannels: voice,
			textChannels: text,
			settings: {
				prefix,
				language,
				defaultVolume,
				dj: !!dj?.mode,
				roles: (roles ?? []).map((r: any) => ({
					id: r.roleId,
					name: g.roles.cache.get(r.roleId)?.name ?? r.roleId,
				})),
				stay: stayRow ? { voiceId: stayRow.voiceId, textId: stayRow.textId } : null,
				guildRoles: [...g.roles.cache.values()]
					.filter((r) => r.id !== g.id && !r.managed)
					.sort((a, b) => b.position - a.position)
					.map((r) => ({ id: r.id, name: r.name })),
			},
			player: player ? playerJson(client, g, player) : null,
		};
	},

	/** Estado ligero del reproductor (para el refresco continuo). */
	async state(client, { guildId }) {
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const player: any = (client.manager as any).getPlayer(g.id);
		return { player: player ? playerJson(client, g, player) : null };
	},

	async search(client, { query, source }) {
		const q = String(query ?? "").trim();
		if (!q) throw new PanelError("Escribe algo para buscar.");
		if (q.length > 300) throw new PanelError("La búsqueda es demasiado larga.");
		const res: any = await (client.manager as any).search(
			source === "soundcloud" ? { query: q, source: "soundcloud" } : { query: q },
			panelRequester(client),
		);
		if (res?.loadType === "error") throw new PanelError(res.exception?.message || "Error al buscar.", 502);
		return {
			loadType: res?.loadType ?? "empty",
			playlist: res?.playlist?.name ?? null,
			tracks: (res?.tracks ?? []).slice(0, 12).map(trackJson),
		};
	},

	async play(client, { guildId, query, voiceChannelId, textChannelId, next, source }) {
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const q = String(query ?? "").trim();
		if (!q) throw new PanelError("Escribe una canción o un enlace.");
		if (q.length > 500) throw new PanelError("La consulta es demasiado larga.");

		const player = await ensurePlayer(client, g, voiceChannelId, textChannelId);
		const res: any = await player.search(source === "soundcloud" ? { query: q, source: "soundcloud" } : { query: q }, panelRequester(client));
		if (!res || res.loadType === "error") throw new PanelError(res?.exception?.message || "No se pudo cargar.", 502);
		if (!res.tracks?.length) throw new PanelError("Sin resultados.", 404);

		const wasIdle = !player.playing && !player.queue.current && player.queue.tracks.length === 0;
		const toAdd = res.loadType === "playlist" ? res.tracks : res.tracks[0];
		if (next && !wasIdle) {
			await player.queue.add(toAdd, 0);
		} else {
			await player.queue.add(toAdd);
		}
		if (player.get?.("fairplay") && !next) {
			const { applyFairPlayToQueue } = await import("../utils/functions/player");
			await applyFairPlayToQueue(player);
		}
		if (!player.playing && !player.paused && (player.queue.tracks.length > 0 || player.queue.current)) {
			await player.play({ paused: false });
		}
		return {
			added: res.loadType === "playlist" ? res.tracks.length : 1,
			title: res.loadType === "playlist" ? (res.playlist?.name ?? "Playlist") : res.tracks[0].info.title,
			playlist: res.loadType === "playlist",
		};
	},

	async control(client, args) {
		const { guildId, op } = args;
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const manager: any = client.manager;

		if (op === "join") {
			const p = await ensurePlayer(client, g, args.voiceChannelId, args.textChannelId);
			return { player: playerJson(client, g, p) };
		}
		const player = needPlayer(client, g.id);

		switch (op) {
			case "pause":
				await player.pause();
				break;
			case "resume":
				await player.resume();
				break;
			case "toggle":
				if (player.paused) await player.resume();
				else await player.pause();
				break;
			case "skip":
				if (!player.queue.current && !player.queue.tracks.length) throw new PanelError("No hay nada que saltar.", 409);
				await player.skip();
				break;
			case "skipto": {
				const i = clampInt(args.index, 1, player.queue.tracks.length, "index");
				if (!player.queue.tracks.length) throw new PanelError("La cola está vacía.", 409);
				await player.skip(i);
				break;
			}
			case "previous": {
				const prev = player.queue.previous?.[0];
				if (!prev) throw new PanelError("No hay una canción anterior.", 409);
				await player.play({ track: prev });
				break;
			}
			case "stop":
				await player.stopPlaying(true, false);
				break;
			case "seek": {
				if (!player.queue.current) throw new PanelError("No hay nada sonando.", 409);
				if (player.queue.current.info?.isSeekable === false) throw new PanelError("Esta pista no permite adelantar.", 409);
				await player.seek(clampInt(args.ms, 0, 86_400_000, "ms"));
				break;
			}
			case "volume":
				await player.setVolume(clampInt(args.value, 0, 200, "value"));
				break;
			case "loop": {
				const mode = String(args.mode);
				if (!["off", "track", "queue"].includes(mode)) throw new PanelError("Modo de repetición inválido.");
				await player.setRepeatMode(mode);
				break;
			}
			case "shuffle":
				if (player.queue.tracks.length < 2) throw new PanelError("Necesitas al menos 2 canciones en la cola.", 409);
				await player.queue.shuffle();
				break;
			case "autoplay":
				player.set("autoplay", !!args.enabled);
				break;
			case "fairplay":
				player.set("fairplay", !!args.enabled);
				break;
			case "clear":
				await player.queue.splice(0, player.queue.tracks.length);
				break;
			case "remove": {
				const i = clampInt(args.index, 1, Math.max(1, player.queue.tracks.length), "index") - 1;
				if (i >= player.queue.tracks.length) throw new PanelError("Esa posición no existe.", 404);
				await player.queue.splice(i, 1);
				break;
			}
			case "move": {
				const len = player.queue.tracks.length;
				const from = clampInt(args.from, 1, Math.max(1, len), "from") - 1;
				const to = clampInt(args.to, 1, Math.max(1, len), "to") - 1;
				if (from >= len) throw new PanelError("Esa posición no existe.", 404);
				const [t] = await player.queue.splice(from, 1);
				await player.queue.splice(to, 0, t);
				break;
			}
			case "leave":
				await player.destroy();
				return { player: null };
			case "move-voice": {
				const vc = g.channels.cache.get(String(args.voiceChannelId));
				if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice))
					throw new PanelError("Canal de voz inválido.");
				player.voiceChannelId = vc.id;
				await player.connect?.();
				break;
			}
			default:
				throw new PanelError(`Operación desconocida: ${String(op)}`);
		}
		// pequeña espera para que los cambios (p. ej. skip) se reflejen en el estado devuelto
		await new Promise((r) => setTimeout(r, 60));
		return { player: manager.getPlayer(g.id) ? playerJson(client, g, manager.getPlayer(g.id)) : null };
	},

	async filter(client, { guildId, name, value }) {
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const player = needPlayer(client, g.id);
		const fm = player.filterManager;
		if (!fm) throw new PanelError("Los filtros no están disponibles.", 501);

		switch (name) {
			case "reset":
				await fm.resetFilters?.();
				await fm.clearEQ?.();
				break;
			case "bassboost": {
				if (value === "off") await fm.clearEQ();
				else if (BASS[value]) await fm.setEQ(BASS[value]);
				else throw new PanelError("Nivel de bass inválido.");
				break;
			}
			case "speed":
				await fm.setSpeed(Math.max(0.5, Math.min(2, Number(value) || 1)));
				break;
			case "pitch":
				await fm.setPitch(Math.max(0.5, Math.min(2, Number(value) || 1)));
				break;
			case "rate":
				await fm.setRate(Math.max(0.5, Math.min(2, Number(value) || 1)));
				break;
			case "nightcore":
			case "rotation":
			case "karaoke":
			case "tremolo":
			case "vibrato":
			case "lowpass":
				await setToggle(player, name, !!value);
				break;
			default:
				throw new PanelError("Filtro desconocido.");
		}
		await new Promise((r) => setTimeout(r, 120));
		return { filters: filtersJson(player) };
	},

	async settings(client, args) {
		const g = getGuild(client, args.guildId);
		if (!g) return { skip: true };
		const db = client.db;

		if (typeof args.prefix === "string") {
			const p = args.prefix.trim();
			if (!p || p.length > 3 || /\s/.test(p)) throw new PanelError("El prefijo debe tener de 1 a 3 caracteres sin espacios.");
			await db.setPrefix(g.id, p);
		}
		if (typeof args.language === "string") {
			if (!getSupportedLanguages().includes(args.language)) throw new PanelError("Idioma no soportado.");
			await db.updateLanguage(g.id, args.language);
		}
		if (args.defaultVolume !== undefined) {
			await db.setDefaultVolume(g.id, clampInt(args.defaultVolume, 1, 100, "defaultVolume"));
		}
		if (typeof args.dj === "boolean") await db.setDj(g.id, args.dj);
		if (typeof args.addRole === "string") {
			if (!g.roles.cache.has(args.addRole)) throw new PanelError("Rol no encontrado.", 404);
			await db.addRole(g.id, args.addRole);
		}
		if (typeof args.removeRole === "string") await db.removeRole(g.id, args.removeRole);

		if (typeof args.stay === "boolean") {
			if (!args.stay) {
				await db.delete_247(g.id);
			} else {
				const vc = g.channels.cache.get(String(args.voiceChannelId));
				if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice))
					throw new PanelError("Elige el canal de voz para el modo 24/7.");
				const textId = await pickTextChannel(client, g, args.textChannelId);
				if (!textId) throw new PanelError("No hay un canal de texto donde el bot pueda escribir.");
				await db.set_247(g.id, textId, vc.id);
				await ensurePlayer(client, g, vc.id, textId);
			}
		}
		return { ok: true };
	},

	async presence(client, { status, activity, type }) {
		const allowed = ["online", "idle", "dnd", "invisible"];
		if (!allowed.includes(status)) throw new PanelError("Estado inválido.");
		const text = String(activity ?? "").trim().slice(0, 120);
		const types: Record<string, ActivityType> = {
			playing: ActivityType.Playing,
			listening: ActivityType.Listening,
			watching: ActivityType.Watching,
			competing: ActivityType.Competing,
		};
		if (text && !(type in types)) throw new PanelError("Tipo de actividad inválido.");
		client.user?.setPresence({
			status: status as PresenceStatusData,
			activities: text ? [{ name: text, type: types[type] }] : [],
		});
		return { ok: true };
	},

	async leaveGuild(client, { guildId }) {
		const g = getGuild(client, guildId);
		if (!g) return { skip: true };
		const name = g.name;
		await (client.manager as any).getPlayer(g.id)?.destroy?.();
		await g.leave();
		return { left: name };
	},

	async deploy(client) {
		await client.syncCommands();
		return { ok: true };
	},

	logs(client, { limit }) {
		return getLogs(Number(limit) || 200).map((l) => ({ ...l, proc: `shard-${client.shard?.ids?.[0] ?? 0}` }));
	},
};

/** Acciones que no pertenecen a un servidor concreto (el manager decide a qué shards llegan). */
export const GLOBAL_ACTIONS = new Set(["stats", "guilds", "search", "presence", "deploy", "logs"]);

/* ------------------------------------------------------------------ wiring */

/** Ejecuta una acción del panel contra un cliente (con o sin ShardingManager). */
export async function runPanelAction(client: Lavamusic, msg: PanelRequest): Promise<Partial<PanelReply>> {
	const handler = handlers[msg.action];
	if (!handler) return { ok: false, error: "Acción desconocida", status: 404 };
	if (!client.isReady()) return { skip: true };
	try {
		const data: any = await handler(client, msg.args ?? {});
		if (data && typeof data === "object" && data.skip === true) return { skip: true };
		return { ok: true, data };
	} catch (e) {
		if (e instanceof PanelError) return { ok: false, error: e.message, status: e.status };
		logger.error(`[PANEL] Error en "${msg.action}":`, e);
		return { ok: false, error: (e as Error)?.message || "Error interno", status: 500 };
	}
}

/** Registra el manejador IPC en el proceso de la shard. */
export function setupPanelShard(client: Lavamusic): void {
	installLogBuffer(`shard-${process.env.SHARDS ?? "0"}`);
	if (!process.send) return; // un solo proceso: el panel llama a runPanelAction directamente

	process.on("message", async (raw: any) => {
		if (!raw || raw.__panel !== true) return;
		const msg = raw as PanelRequest;
		const shard = client.shard?.ids?.[0] ?? 0;
		const r = await runPanelAction(client, msg);
		process.send?.({ __panelReply: true, id: msg.id, shard, ...r } satisfies PanelReply);
	});
}
