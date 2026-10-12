/**
 * Kasper Music — sistema de embeds.
 *
 * Todas las tarjetas visuales del bot (reproduciendo, añadida a la cola, cola, errores...)
 * se construyen aquí para que el diseño sea consistente y fácil de cambiar.
 * Soporta español e inglés; cualquier otro idioma usa inglés.
 */
import { EmbedBuilder } from "discord.js";
import type { Player, Track } from "lavalink-client";
import config from "../config";

type Lang = "es" | "en";

const TEXT = {
	es: {
		nowPlaying: "Reproduciendo ahora",
		next: "Siguiente",
		searching: "Buscando",
		searchingHint: "Esto solo tarda unos segundos…",
		helpTitle: "Centro de ayuda",
		helpIntro: "Tu bot de música con estilo. Usa los comandos con `/` o con el prefijo `{prefix}`.",
		helpTip: "Escribe {prefix}help <comando> para ver los detalles de uno.",
		commands: "comandos",
		paused: "En pausa",
		artist: "Artista",
		duration: "Duración",
		requestedBy: "Pedido por",
		upNext: "En cola",
		volume: "Volumen",
		loop: "Repetición",
		loopOff: "Desactivada",
		loopTrack: "Canción",
		loopQueue: "Cola",
		live: "EN VIVO",
		songs: "canciones",
		song: "canción",
		addedToQueue: "Añadida a la cola",
		startingNow: "Empezando a reproducir",
		addedPlaylist: "Playlist añadida",
		position: "Posición",
		playsIn: "Suena en",
		playingNow: "Suena ahora",
		tracks: "Canciones",
		totalDuration: "Duración total",
		queue: "Cola de reproducción",
		queueEmpty: "No hay más canciones en la cola. Usa `/play` para añadir música.",
		page: "Página",
		moreInQueue: "más en la cola",
		queueEnded: "La cola terminó",
		queueEndedDesc: "No quedan más canciones. Usa `/play` para seguir con la música 🎶",
		noMusic: "No hay música reproduciéndose ahora mismo.",
		noResults: "No encontré resultados para esa búsqueda. Prueba con otro título o un enlace.",
		error: "Algo salió mal",
		listeningTo: "Escuchando",
		latency: "Latencia",
		bot: "Bot",
		api: "Discord API",
	},
	en: {
		nowPlaying: "Now playing",
		next: "Up next",
		searching: "Searching",
		searchingHint: "This only takes a few seconds…",
		helpTitle: "Help center",
		helpIntro: "Your stylish music bot. Use commands with `/` or the `{prefix}` prefix.",
		helpTip: "Type {prefix}help <command> to see details for one.",
		commands: "commands",
		paused: "Paused",
		artist: "Artist",
		duration: "Duration",
		requestedBy: "Requested by",
		upNext: "In queue",
		volume: "Volume",
		loop: "Loop",
		loopOff: "Off",
		loopTrack: "Track",
		loopQueue: "Queue",
		live: "LIVE",
		songs: "songs",
		song: "song",
		addedToQueue: "Added to queue",
		startingNow: "Starting playback",
		addedPlaylist: "Playlist added",
		position: "Position",
		playsIn: "Plays in",
		playingNow: "Playing now",
		tracks: "Tracks",
		totalDuration: "Total duration",
		queue: "Queue",
		queueEmpty: "There are no more songs in the queue. Use `/play` to add some music.",
		page: "Page",
		moreInQueue: "more in queue",
		queueEnded: "Queue finished",
		queueEndedDesc: "No more songs left. Use `/play` to keep the music going 🎶",
		noMusic: "Nothing is playing right now.",
		noResults: "I couldn't find results for that search. Try another title or a link.",
		error: "Something went wrong",
		listeningTo: "Listening to",
		latency: "Latency",
		bot: "Bot",
		api: "Discord API",
	},
} as const;

export function langOf(locale?: string): Lang {
	const l = (locale ?? "").toLowerCase();
	return l.startsWith("es") || l.includes("spanish") ? "es" : "en";
}

export function tx(locale?: string) {
	return TEXT[langOf(locale)];
}

const SOURCE_LABEL: Record<string, string> = {
	youtube: "YouTube",
	youtubemusic: "YouTube Music",
	soundcloud: "SoundCloud",
	spotify: "Spotify",
	applemusic: "Apple Music",
	deezer: "Deezer",
	jiosaavn: "JioSaavn",
	bandcamp: "Bandcamp",
	twitch: "Twitch",
	vimeo: "Vimeo",
	http: "Web",
	local: "Archivo",
};

export function formatMs(ms: number): string {
	if (!ms || ms < 0 || Number.isNaN(ms)) return "0:00";
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Barra de progreso: ▬▬▬🔘▬▬▬▬▬ */
export function progressLine(position: number, duration: number, size = 16): string {
	if (!duration || duration <= 0) return "▬".repeat(size);
	const ratio = Math.max(0, Math.min(1, position / duration));
	const knob = Math.min(size - 1, Math.floor(ratio * size));
	let out = "";
	for (let i = 0; i < size; i++) out += i === knob ? "🔘" : "▬";
	return out;
}

function requesterId(track: Track | null | undefined): string | null {
	const r = track?.requester as any;
	if (!r) return null;
	if (typeof r === "string") return r;
	return typeof r.id === "string" ? r.id : null;
}

export function requesterMention(track: Track | null | undefined): string {
	const id = requesterId(track);
	return id ? `<@${id}>` : "—";
}

function sourceOf(track: Track): { label: string; icon?: string } {
	const key = String(track.info.sourceName ?? "").toLowerCase();
	return { label: SOURCE_LABEL[key] ?? (key ? key : "Kasper"), icon: (config.icons as any)[key] };
}

function loopLabel(mode: string | undefined, locale?: string): string {
	const T = tx(locale);
	if (mode === "track") return `🔂 ${T.loopTrack}`;
	if (mode === "queue") return `🔁 ${T.loopQueue}`;
	return T.loopOff;
}

function volumeBar(volume: number): string {
	const v = Math.max(0, Math.min(100, volume));
	const filled = Math.round((v / 100) * 5);
	return `${"▰".repeat(filled)}${"▱".repeat(5 - filled)} ${volume}%`;
}

function nextLabel(player: Player): string {
	const nxt = player.queue.tracks[0];
	if (!nxt) return "—";
	const title = clip(nxt.info.title ?? "—", 32);
	return nxt.info.uri ? `[${title}](${nxt.info.uri})` : title;
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface NowPlayingOptions {
	/** Texto de estado mostrado en el pie (p. ej. "Pausado por @user"). */
	status?: string;
	/** Posición actual en ms. Por defecto, la del reproductor. */
	position?: number;
	/** Idioma del servidor. */
	locale?: string;
	/** Avatar del bot para el pie. */
	botAvatar?: string;
}

/** Tarjeta principal "Reproduciendo ahora". */
export function nowPlayingEmbed(
	player: Player,
	track: Track,
	opts: NowPlayingOptions = {},
): EmbedBuilder {
	const T = tx(opts.locale);
	const info = track.info;
	const src = sourceOf(track);
	const isLive = !!info.isStream;
	const pos = opts.position ?? player.position ?? 0;
	const dur = info.duration ?? 0;
	const paused = !!player.paused;

	const bar = isLive
		? `🔴 **${T.live}**`
		: `\`${formatMs(pos)}\` ${progressLine(pos, dur)} \`${formatMs(dur)}\``;

	const embed = new EmbedBuilder()
		.setColor(paused ? config.color.paused : config.color.brand)
		.setAuthor({
			name: paused ? `⏸  ${T.paused}` : `🎶  ${T.nowPlaying}`,
			iconURL: src.icon,
		})
		.setTitle(clip(info.title ?? "—", 250))
		.setDescription(
			`${info.author ? `🎤 **${clip(info.author, 100)}**\n\n` : ""}${bar}`,
		)
		.addFields(
			{
				name: `⏱ ${T.duration}`,
				value: isLive ? T.live : formatMs(dur),
				inline: true,
			},
			{ name: `🙋 ${T.requestedBy}`, value: requesterMention(track), inline: true },
			{ name: `📻 ${T.upNext}`, value: String(player.queue.tracks.length), inline: true },
			{ name: `🔊 ${T.volume}`, value: volumeBar(player.volume ?? 100), inline: true },
			{ name: `🔁 ${T.loop}`, value: loopLabel(player.repeatMode, opts.locale), inline: true },
			{ name: `⏭ ${T.next}`, value: nextLabel(player), inline: true },
		)
		.setFooter({
			text: opts.status ? `${opts.status}  •  ${src.label}` : `Kasper Music  •  ${src.label}`,
			iconURL: opts.botAvatar,
		});

	if (info.uri) embed.setURL(info.uri);
	if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);
	return embed;
}

/** Tarjeta "Añadida a la cola" para una canción. */
export function trackAddedEmbed(
	track: Track,
	opts: { locale?: string; position: number; etaMs: number; playingNow: boolean },
): EmbedBuilder {
	const T = tx(opts.locale);
	const info = track.info;
	const src = sourceOf(track);
	const embed = new EmbedBuilder()
		.setColor(config.color.success)
		.setAuthor({
			name: opts.playingNow ? `▶️  ${T.startingNow}` : `✅  ${T.addedToQueue}`,
			iconURL: src.icon,
		})
		.setTitle(clip(info.title ?? "—", 250))
		.addFields(
			{ name: `🎤 ${T.artist}`, value: clip(info.author || "—", 100), inline: true },
			{
				name: `⏱ ${T.duration}`,
				value: info.isStream ? T.live : formatMs(info.duration ?? 0),
				inline: true,
			},
			{
				name: `📍 ${T.position}`,
				value: opts.playingNow
					? `**${T.playingNow}**`
					: `#${opts.position}  •  ${T.playsIn} ~${formatMs(opts.etaMs)}`,
				inline: true,
			},
		)
		.setFooter({ text: `${T.requestedBy} ${requesterName(track)}  •  ${src.label}` });
	if (info.uri) embed.setURL(info.uri);
	if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);
	return embed;
}

function requesterName(track: Track): string {
	const r = track.requester as any;
	return r?.username ?? r?.tag ?? "—";
}

/** Tarjeta "Playlist añadida". */
export function playlistAddedEmbed(
	tracks: Track[],
	opts: { locale?: string; name?: string | null; url?: string | null },
): EmbedBuilder {
	const T = tx(opts.locale);
	const total = tracks.reduce((a, b) => a + (b.info.duration ?? 0), 0);
	const first = tracks[0];
	const preview = tracks
		.slice(0, 5)
		.map((tr, i) => `\`${i + 1}.\` ${clip(tr.info.title ?? "—", 60)}`)
		.join("\n");
	const more = tracks.length > 5 ? `\n*…+${tracks.length - 5} ${T.moreInQueue}*` : "";
	const embed = new EmbedBuilder()
		.setColor(config.color.success)
		.setAuthor({ name: `📚  ${T.addedPlaylist}` })
		.setTitle(clip(opts.name || first?.info.title || "Playlist", 250))
		.setDescription(`${preview}${more}`)
		.addFields(
			{ name: `🎵 ${T.tracks}`, value: String(tracks.length), inline: true },
			{ name: `⏱ ${T.totalDuration}`, value: formatMs(total), inline: true },
		)
		.setFooter({ text: `${T.requestedBy} ${first ? requesterName(first) : "—"}` });
	if (opts.url) embed.setURL(opts.url);
	if (first?.info.artworkUrl) embed.setThumbnail(first.info.artworkUrl);
	return embed;
}

/** Páginas de la cola. Devuelve al menos una página. */
export function queuePages(
	player: Player,
	opts: { locale?: string; guildName?: string; guildIcon?: string | null; perPage?: number },
): EmbedBuilder[] {
	const T = tx(opts.locale);
	const perPage = opts.perPage ?? 10;
	const current = player.queue.current;
	const tracks = player.queue.tracks;
	const totalMs = tracks.reduce((a, b) => a + (b.info.duration ?? 0), 0);

	const header = current
		? `**${T.nowPlaying}**\n🎶 [${clip(current.info.title ?? "—", 70)}](${current.info.uri}) • \`${
				current.info.isStream ? T.live : formatMs(current.info.duration ?? 0)
			}\` • ${requesterMention(current)}\n\n`
		: "";

	const pageCount = Math.max(1, Math.ceil(tracks.length / perPage));
	const pages: EmbedBuilder[] = [];
	for (let p = 0; p < pageCount; p++) {
		const slice = tracks.slice(p * perPage, (p + 1) * perPage);
		const body = slice.length
			? slice
					.map((tr, i) => {
						const n = String(p * perPage + i + 1).padStart(2, "0");
						const d = tr.info.isStream ? T.live : formatMs(tr.info.duration ?? 0);
						return `\`${n}\` [${clip(tr.info.title ?? "—", 55)}](${tr.info.uri}) • \`${d}\` • ${requesterMention(tr)}`;
					})
					.join("\n")
			: `*${T.queueEmpty}*`;

		const embed = new EmbedBuilder()
			.setColor(config.color.brand)
			.setAuthor({
				name: `📜  ${T.queue}${opts.guildName ? ` — ${opts.guildName}` : ""}`,
				iconURL: opts.guildIcon ?? undefined,
			})
			.setDescription(`${header}**${T.upNext}**\n${body}`)
			.setFooter({
				text: `${T.page} ${p + 1}/${pageCount}  •  ${tracks.length} ${
					tracks.length === 1 ? T.song : T.songs
				}  •  ${formatMs(totalMs)}`,
			});
		if (current?.info.artworkUrl) embed.setThumbnail(current.info.artworkUrl);
		pages.push(embed);
	}
	return pages;
}

export function queueEndEmbed(locale?: string): EmbedBuilder {
	const T = tx(locale);
	return new EmbedBuilder()
		.setColor(config.color.info)
		.setAuthor({ name: `🏁  ${T.queueEnded}` })
		.setDescription(T.queueEndedDesc);
}

/** Embeds de estado simples. */
export const ok = (text: string) =>
	new EmbedBuilder().setColor(config.color.success).setDescription(`✅  ${text}`);
export const fail = (text: string) =>
	new EmbedBuilder().setColor(config.color.error).setDescription(`❌  ${text}`);
export const warn = (text: string) =>
	new EmbedBuilder().setColor(config.color.warn).setDescription(`⚠️  ${text}`);
export const info = (text: string) =>
	new EmbedBuilder().setColor(config.color.info).setDescription(`ℹ️  ${text}`);

/** Estimación de ms hasta que suene una canción añadida al final de la cola. */
export function etaToEndOfQueue(player: Player): number {
	const current = player.queue.current;
	const remaining = current ? Math.max(0, (current.info.duration ?? 0) - (player.position ?? 0)) : 0;
	const queued = player.queue.tracks.reduce((a, b) => a + (b.info.duration ?? 0), 0);
	return remaining + queued;
}

/** Tarjeta de "Buscando…" mientras se resuelve la canción. */
export function loadingEmbed(query: string, locale?: string): EmbedBuilder {
	const T = tx(locale);
	const isUrl = /^https?:\/\//i.test(query);
	return new EmbedBuilder()
		.setColor(config.color.info)
		.setAuthor({ name: `🔎  ${T.searching}…` })
		.setDescription(`### ${isUrl ? "🔗" : "🎧"} ${clip(query, 150)}\n-# ⏳ ${T.searchingHint}`);
}

const CATEGORY_META: Record<string, { emoji: string; es: string; en: string }> = {
	music: { emoji: "🎵", es: "Música", en: "Music" },
	filters: { emoji: "🎛️", es: "Filtros", en: "Filters" },
	playlist: { emoji: "📚", es: "Playlists", en: "Playlists" },
	config: { emoji: "⚙️", es: "Configuración", en: "Settings" },
	info: { emoji: "ℹ️", es: "Información", en: "Info" },
};

/** Menú de ayuda: una sección por categoría. */
export function helpOverviewEmbed(opts: {
	locale?: string;
	prefix: string;
	botName: string;
	botAvatar?: string;
	categories: { name: string; commands: string[] }[];
}): EmbedBuilder {
	const T = tx(opts.locale);
	const lang = langOf(opts.locale);
	const total = opts.categories.reduce((a, c) => a + c.commands.length, 0);
	const embed = new EmbedBuilder()
		.setColor(config.color.brand)
		.setAuthor({ name: `${opts.botName} • ${T.helpTitle}`, iconURL: opts.botAvatar })
		.setDescription(`${T.helpIntro.replace("{prefix}", opts.prefix)}\n\u200b`)
		.setFooter({ text: `${total} ${T.commands}  •  ${T.helpTip.replace("{prefix}", opts.prefix)}` });
	if (opts.botAvatar) embed.setThumbnail(opts.botAvatar);
	for (const c of opts.categories) {
		const meta = CATEGORY_META[c.name];
		const label = meta ? meta[lang] : c.name;
		embed.addFields({
			name: `${meta?.emoji ?? "📁"} ${label}  ·  ${c.commands.length}`,
			value: c.commands.map((n) => `\`${n}\``).join("  "),
			inline: false,
		});
	}
	return embed;
}
