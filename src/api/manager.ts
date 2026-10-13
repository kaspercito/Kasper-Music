import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Shard, ShardingManager } from "discord.js";
import logger from "../structures/Logger";
import { getLogs, installLogBuffer } from "./logbuffer";
import type { PanelReply, PanelRequest } from "./protocol";
import { runPanelAction } from "./shardHandler";

/* ------------------------------------------------------------------ config */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
};

/* ------------------------------------------------------------------ RPC a las shards */

class ShardRpc {
	private pending = new Map<
		string,
		{ replies: PanelReply[]; expected: number; done: (r: PanelReply[]) => void; first: boolean }
	>();

	/** manager = null -> un solo proceso: se llama al cliente directamente (getClient). */
	constructor(
		private manager: ShardingManager | null,
		private getClient?: () => any,
	) {
		manager?.on("shardCreate", (shard) => {
			shard.on("message", (m: any) => this.onMessage(m));
		});
	}

	private onMessage(m: any) {
		if (!m || m.__panelReply !== true) return;
		const p = this.pending.get(m.id);
		if (!p) return;
		p.replies.push(m as PanelReply);
		if (p.first && !m.skip) return p.done(p.replies);
		if (p.replies.length >= p.expected) p.done(p.replies);
	}

	private readyShards(): Shard[] {
		return this.manager ? [...this.manager.shards.values()].filter((s) => s.ready && s.process) : [];
	}

	/** mode: "all" = todas las shards · "guild" = la que tenga el servidor · "any" = una sola. */
	public async call(
		action: string,
		args: Record<string, any>,
		mode: "all" | "guild" | "any",
		timeout = 20_000,
	): Promise<PanelReply[]> {
		if (!this.manager) {
			const client = this.getClient?.();
			if (!client?.isReady?.()) throw new HttpError(503, "El bot todavía está iniciando. Intenta en unos segundos.");
			const r = await runPanelAction(client, { __panel: true, id: "local", action, args });
			return [{ __panelReply: true, id: "local", shard: 0, ...r }];
		}
		let targets = this.readyShards();
		if (!targets.length) throw new HttpError(503, "El bot todavía está iniciando. Intenta en unos segundos.");
		if (mode === "any") targets = [targets[0]];

		const id = randomUUID();
		const req: PanelRequest = { __panel: true, id, action, args };

		return await new Promise<PanelReply[]>((resolvePromise) => {
			const finish = (r: PanelReply[]) => {
				clearTimeout(timer);
				this.pending.delete(id);
				resolvePromise(r);
			};
			const timer = setTimeout(() => {
				const p = this.pending.get(id);
				finish(p?.replies ?? []);
			}, timeout);
			this.pending.set(id, { replies: [], expected: targets.length, done: finish, first: mode === "guild" });
			for (const s of targets) {
				s.send(req).catch((e) => {
					this.onMessage({ __panelReply: true, id, shard: s.id, ok: false, error: String(e?.message ?? e), status: 502 });
				});
			}
		});
	}

	/** Una respuesta única (servidor concreto o shard cualquiera). */
	public async one(action: string, args: Record<string, any>, mode: "guild" | "any", timeout?: number): Promise<any> {
		const replies = await this.call(action, args, mode, timeout);
		const hit = replies.find((r) => !r.skip);
		if (!hit) {
			if (!replies.length) throw new HttpError(504, "El bot tardó demasiado en responder.");
			throw new HttpError(404, "Servidor no encontrado (el bot ya no está en él).");
		}
		if (!hit.ok) throw new HttpError(hit.status ?? 500, hit.error ?? "Error");
		return hit.data;
	}

	public async all(action: string, args: Record<string, any> = {}, timeout?: number): Promise<any[]> {
		const replies = await this.call(action, args, "all", timeout);
		const bad = replies.find((r) => r.ok === false);
		if (bad && replies.every((r) => r.ok === false)) throw new HttpError(bad.status ?? 500, bad.error ?? "Error");
		return replies.filter((r) => r.ok).map((r) => r.data);
	}
}

/* ------------------------------------------------------------------ servidor */

export function startPanelServer(manager: ShardingManager | null, getClient?: () => any): void {
	const password = process.env.PANEL_PASSWORD?.trim() ?? "";
	const port = Number(process.env.PORT || process.env.PANEL_PORT || 0);

	// Sin puerto (desarrollo) y sin contraseña: el panel simplemente no se activa.
	if (!port && !password) return;
	const listenPort = port || 3000;

	installLogBuffer("manager");
	const rpc = new ShardRpc(manager, getClient);

	const secret = createHash("sha256")
		.update(`${process.env.PANEL_SECRET || ""}|${password}|${process.env.TOKEN || ""}`)
		.digest();
	const pwHash = createHash("sha256").update(password).digest();
	// Acceso de invitado: contraseña aparte, servidores limitados y permisos acotados.
	const guestPassword = process.env.PANEL_GUEST_PASSWORD?.trim() ?? "";
	const guestHash = guestPassword && guestPassword !== password ? createHash("sha256").update(guestPassword).digest() : null;
	const guestGuilds = (process.env.PANEL_GUEST_GUILDS ?? "").split(",").map((g) => g.trim()).filter(Boolean);
	const guestPerms = (process.env.PANEL_GUEST_PERMS ?? "play,control,queue,filters,voice").split(",").map((g) => g.trim().toLowerCase()).filter((g) => ["play", "control", "queue", "filters", "voice"].includes(g));
	// Modo abierto: cualquiera con el enlace entra como invitado SIN contraseña (exige limitar los servidores).
	const guestOpen = process.env.PANEL_GUEST_OPEN === "true" && guestGuilds.length > 0;
	if (process.env.PANEL_GUEST_OPEN === "true" && !guestGuilds.length) {
		logger.warn("[PANEL] PANEL_GUEST_OPEN ignorado: define PANEL_GUEST_GUILDS con los servidores que pueden verse.");
	}
	const guestEnabled = !!guestHash || guestOpen;
	const origins = (process.env.PANEL_ORIGIN ?? "")
		.split(",")
		.map((o) => o.trim().replace(/\/+$/, ""))
		.filter(Boolean);
	const panelDir = (() => {
		const candidates = [process.env.PANEL_DIR, join(process.cwd(), "panel"), join(process.cwd(), "..", "panel")];
		for (const c of candidates) if (c && existsSync(join(c, "index.html"))) return resolve(c);
		return null;
	})();
	const startedAt = Date.now();

	/* ---- auth ---- */
	const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");
	const makeToken = (role: "admin" | "guest") => {
		const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, n: randomUUID(), r: role })).toString("base64url");
		return `${payload}.${sign(payload)}`;
	};
	/** Devuelve el rol de la sesión, o null si el token no es válido. */
	const verifyToken = (token: string): "admin" | "guest" | null => {
		const [payload, mac] = token.split(".");
		if (!payload || !mac) return null;
		const a = Buffer.from(mac);
		const b = Buffer.from(sign(payload));
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
		try {
			const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
			if (!(d.exp > Date.now())) return null;
			if (d.r === "guest" && !guestEnabled) return null; // el acceso de invitado se desactivó
			return d.r === "guest" ? "guest" : "admin";
		} catch {
			return null;
		}
	};
	const permsFor = (role: "admin" | "guest") => (role === "admin" ? ["play", "control", "queue", "filters", "voice", "admin"] : guestPerms);

	// Límite de acciones del invitado (anti-spam): 40 por minuto por IP.
	const guestHits = new Map<string, { n: number; reset: number }>();
	setInterval(() => {
		const now = Date.now();
		for (const [k, v] of guestHits) if (v.reset < now) guestHits.delete(k);
	}, 60_000).unref();

	const attempts = new Map<string, { n: number; reset: number }>();
	setInterval(() => {
		const now = Date.now();
		for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
	}, 60_000).unref();

	const clientIp = (req: IncomingMessage) => {
		const xff = String(req.headers["x-forwarded-for"] ?? "");
		// El router de Heroku añade la IP real al final de la lista.
		return xff.split(",").pop()?.trim() || req.socket.remoteAddress || "unknown";
	};

	/* ---- helpers HTTP ---- */
	const corsHeaders = (req: IncomingMessage): Record<string, string> => {
		const origin = req.headers.origin;
		if (!origin) return {};
		const sameHost = (() => {
			try {
				return new URL(origin).host === req.headers.host;
			} catch {
				return false;
			}
		})();
		if (!sameHost && !origins.includes(origin.replace(/\/+$/, ""))) return {};
		return {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Headers": "Authorization, Content-Type",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Max-Age": "600",
			Vary: "Origin",
		};
	};

	const send = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
		const json = JSON.stringify(body);
		res.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			...corsHeaders(req),
		});
		res.end(json);
	};

	const readJson = (req: IncomingMessage): Promise<Record<string, any>> =>
		new Promise((ok, fail) => {
			let size = 0;
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => {
				size += c.length;
				if (size > MAX_BODY) {
					fail(new HttpError(413, "Cuerpo demasiado grande"));
					req.destroy();
					return;
				}
				chunks.push(c);
			});
			req.on("end", () => {
				if (!chunks.length) return ok({});
				try {
					const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					ok(v && typeof v === "object" && !Array.isArray(v) ? v : {});
				} catch {
					fail(new HttpError(400, "JSON inválido"));
				}
			});
			req.on("error", () => fail(new HttpError(400, "Solicitud inválida")));
		});

	/* ---- rutas de la API ---- */
	const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
		const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
		const method = req.method ?? "GET";

		if (method === "GET" && path === "/health") return send(req, res, 200, { ok: true, panel: true, configured: !!password, guestOpen });

		if (!password) throw new HttpError(503, "Panel desactivado: define la variable PANEL_PASSWORD en Heroku.");

		if (method === "POST" && path === "/login") {
			const ip = clientIp(req);
			const now = Date.now();
			const a = attempts.get(ip);
			if (a && a.reset > now && a.n >= LOGIN_MAX_ATTEMPTS) {
				res.setHeader("Retry-After", Math.ceil((a.reset - now) / 1000));
				throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");
			}
			const body = await readJson(req);
			if (body.guest === true && guestOpen) {
				return send(req, res, 200, { token: makeToken("guest"), expiresIn: TOKEN_TTL_MS, role: "guest", perms: permsFor("guest") });
			}
			const given = createHash("sha256").update(String(body.password ?? "")).digest();
			const role: "admin" | "guest" | null = timingSafeEqual(given, pwHash) ? "admin" : guestHash && timingSafeEqual(given, guestHash) ? "guest" : null;
			if (!role) {
				const cur = a && a.reset > now ? a : { n: 0, reset: now + LOGIN_WINDOW_MS };
				cur.n++;
				attempts.set(ip, cur);
				logger.warn(`[PANEL] Intento de acceso fallido desde ${ip}`);
				await new Promise((r) => setTimeout(r, 400));
				throw new HttpError(401, "Contraseña incorrecta.");
			}
			attempts.delete(ip);
			logger.info(`[PANEL] Sesión de ${role === "admin" ? "administrador" : "invitado"} iniciada desde ${ip}`);
			return send(req, res, 200, { token: makeToken(role), expiresIn: TOKEN_TTL_MS, role, perms: permsFor(role) });
		}

		// ---- a partir de aquí todo requiere token ----
		const auth = String(req.headers.authorization ?? "");
		const role = auth.startsWith("Bearer ") ? verifyToken(auth.slice(7)) : null;
		if (!role) throw new HttpError(401, "Sesión no válida o expirada.");
		const isAdmin = role === "admin";
		const perms = permsFor(role);
		const guildAllowed = (id: string) => isAdmin || !guestGuilds.length || guestGuilds.includes(id);
		const need = (perm: string) => {
			if (!perms.includes(perm)) throw new HttpError(403, "No tienes permiso para hacer esto.");
		};
		if (!isAdmin && method === "POST") {
			const ip = clientIp(req);
			const now = Date.now();
			const h = guestHits.get(ip);
			const cur = h && h.reset > now ? h : { n: 0, reset: now + 60_000 };
			cur.n++;
			guestHits.set(ip, cur);
			if (cur.n > 40) {
				res.setHeader("Retry-After", Math.ceil((cur.reset - now) / 1000));
				throw new HttpError(429, "Vas muy rápido. Espera un momento.");
			}
		}
		const adminOnly = () => {
			if (!isAdmin) throw new HttpError(403, "Solo el administrador puede hacer esto.");
		};

		if (method === "GET" && path === "/me") return send(req, res, 200, { role, perms });

		if (method === "GET" && path === "/overview") {
			adminOnly();
			const list = await rpc.all("stats");
			const sum = (k: string) => list.reduce((a, s) => a + (s[k] || 0), 0);
			const first = list[0] ?? {};
			return send(req, res, 200, {
				bot: first.bot ?? null,
				backend: first.backend ?? "local",
				status: first.status ?? "online",
				activity: first.activity ?? null,
				languages: first.languages ?? [],
				guilds: sum("guilds"),
				users: sum("users"),
				players: sum("players"),
				playing: sum("playing"),
				rss: sum("rss"),
				heap: sum("heap"),
				ping: list.length ? Math.round(list.reduce((a, s) => a + s.ping, 0) / list.length) : -1,
				uptime: Math.max(0, ...list.map((s) => s.uptime || 0)),
				shards: list.map((s) => ({ id: s.shard, ping: s.ping, guilds: s.guilds, ready: s.ready })),
				system: {
					runtime: typeof (globalThis as any).Bun !== "undefined" ? `Bun ${(globalThis as any).Bun.version}` : `Node ${process.version}`,
					platform: process.platform,
					memTotal: first.sysMemTotal ?? 0,
					memFree: first.sysMemFree ?? 0,
					managerUptime: Date.now() - startedAt,
				},
			});
		}

		if (method === "GET" && path === "/guilds") {
			const lists = await rpc.all("guilds");
			return send(req, res, 200, { guilds: lists.flat().filter((g: any) => guildAllowed(g.id)) });
		}

		if (method === "GET" && path === "/search") {
			need("play");
			const q = url.searchParams.get("q") ?? "";
			const source = url.searchParams.get("source") ?? undefined;
			return send(req, res, 200, await rpc.one("search", { query: q, source }, "any", 45_000));
		}

		if (method === "GET" && path === "/logs") {
			adminOnly();
			const limit = Math.min(500, Number(url.searchParams.get("limit")) || 200);
			const shardLogs = (await rpc.all("logs", { limit }).catch(() => [])).flat();
			const own = manager ? getLogs(limit) : []; // sin shards, los logs ya vienen del propio proceso
			const lines = [...own, ...shardLogs].sort((a, b) => a.t - b.t).slice(-limit);
			return send(req, res, 200, { lines });
		}

		if (method === "POST" && path === "/presence") {
			adminOnly();
			const body = await readJson(req);
			const replies = await rpc.call("presence", body, "all");
			const bad = replies.find((r) => r.ok === false);
			if (bad) throw new HttpError(bad.status ?? 400, bad.error ?? "Error");
			return send(req, res, 200, { ok: true });
		}

		if (method === "POST" && path === "/deploy") {
			adminOnly();
			return send(req, res, 200, await rpc.one("deploy", {}, "any", 60_000));
		}

		if (method === "POST" && path === "/restart") {
			adminOnly();
			logger.warn("[PANEL] Reinicio solicitado desde el panel.");
			send(req, res, 200, { ok: true });
			setTimeout(() => {
				for (const s of manager?.shards.values() ?? []) {
					try {
						s.kill();
					} catch {
						// ignorado
					}
				}
				process.exit(0); // Heroku reinicia el dyno automáticamente
			}, 600);
			return;
		}

		const m = path.match(/^\/guilds\/(\d{5,25})(?:\/([a-z-]+))?$/);
		if (m) {
			const [, guildId, sub] = m;
			if (!guildAllowed(guildId)) throw new HttpError(403, "No tienes acceso a este servidor.");
			if (method === "GET" && !sub) {
				const d = await rpc.one("guild", { guildId }, "guild");
				if (!isAdmin) {
					// El invitado no ve ajustes, roles ni canales de texto.
					d.settings = undefined;
					d.textChannels = undefined;
				}
				return send(req, res, 200, d);
			}
			if (method === "GET" && sub === "state") return send(req, res, 200, await rpc.one("state", { guildId }, "guild"));

			if (method === "POST") {
				const body = await readJson(req);
				const args = { ...body, guildId };
				if (!isAdmin) {
					const CONTROL = ["pause", "resume", "toggle", "skip", "previous", "seek", "volume", "loop", "autoplay"];
					const QUEUE = ["remove", "move", "skipto", "shuffle", "clear", "stop"];
					if (sub === "control") {
						const op = String(body.op);
						if (op === "volume") args.value = Math.min(100, Number(body.value) || 0); // los invitados no pasan de 100 %
						if (op === "join") need("play");
						else if (op === "leave" || op === "move-voice") need("voice");
						else if (CONTROL.includes(op)) need("control");
						else if (QUEUE.includes(op)) need("queue");
						else throw new HttpError(403, "No tienes permiso para hacer esto.");
					} else if (sub === "play") need("play");
					else if (sub === "filter") need("filters");
					else adminOnly();
				}
				const routes: Record<string, [string, number]> = {
					control: ["control", 30_000],
					play: ["play", 60_000],
					filter: ["filter", 15_000],
					settings: ["settings", 20_000],
					"leave-server": ["leaveGuild", 20_000],
				};
				const route = sub && routes[sub];
				if (route) return send(req, res, 200, await rpc.one(route[0], args, "guild", route[1]));
			}
		}

		throw new HttpError(404, "Ruta no encontrada");
	};

	/* ---- archivos estáticos (el propio panel) ---- */
	const serveStatic = (req: IncomingMessage, res: ServerResponse, url: URL) => {
		if (!panelDir) {
			res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
			return res.end("Kasper Music: API activa. (No se encontró la carpeta panel/.)");
		}
		let rel = decodeURIComponent(url.pathname);
		if (rel.endsWith("/")) rel += "index.html";
		const file = normalize(join(panelDir, rel));
		if (file !== panelDir && !file.startsWith(panelDir + sep)) {
			res.writeHead(403);
			return res.end("Forbidden");
		}
		let target = file;
		if (!existsSync(target) || !statSync(target).isFile()) target = join(panelDir, "index.html");
		const st = statSync(target);
		const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
		const headers: Record<string, string> = {
			"Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
			"Cache-Control": "no-cache",
			ETag: etag,
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
			"X-Frame-Options": "DENY",
			"Content-Security-Policy":
				"default-src 'self'; img-src 'self' https: data:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		};
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304, headers);
			return res.end();
		}
		res.writeHead(200, headers);
		res.end(req.method === "HEAD" ? undefined : readFileSync(target));
	};

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname === "/healthz") {
				res.writeHead(200, { "Content-Type": "text/plain" });
				return res.end("ok");
			}
			if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
				if (req.method === "OPTIONS") {
					res.writeHead(204, corsHeaders(req));
					return res.end();
				}
				return await handleApi(req, res, url);
			}
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405);
				return res.end();
			}
			serveStatic(req, res, url);
		} catch (e) {
			if (res.headersSent) return res.end();
			if (e instanceof HttpError) return send(req, res, e.status, { error: e.message });
			logger.error("[PANEL] Error en la API:", e);
			send(req, res, 500, { error: "Error interno" });
		}
	});
	server.requestTimeout = 90_000;
	server.keepAliveTimeout = 65_000;

	server.on("error", (e) => logger.error("[PANEL] No se pudo iniciar el servidor:", e));
	server.listen(listenPort, "0.0.0.0", () => {
		if (guestEnabled) logger.info(`[PANEL] Acceso de invitado activo${guestOpen ? " (abierto, sin contraseña)" : ""} (permisos: ${guestPerms.join(", ") || "solo ver"}; servidores: ${guestGuilds.length ? guestGuilds.join(", ") : "todos"})`);
		logger.start(`[PANEL] Escuchando en el puerto ${listenPort}${password ? "" : " (SIN contraseña: panel desactivado)"}`);
		if (password && password.length < 10) logger.warn("[PANEL] PANEL_PASSWORD es corta: usa 12+ caracteres.");
		if (!panelDir) logger.warn("[PANEL] No se encontró la carpeta panel/: solo se sirve la API.");
	});
}
