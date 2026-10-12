"use strict";
/* Kasper Music · panel. Sin dependencias. Todo el texto externo se inserta con textContent (nada de innerHTML). */
(() => {
  /* ------------------------------------------------------------ utilidades */
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
    prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
    stop: "M6 6h12v12H6z",
    shuffle: "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
    repeat: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
    repeat1: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z",
    vol: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z",
    x: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    list: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
    search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
    note: "M12 3v10.55A4 4 0 1014 17V7h4V3h-6z",
    autoplay: "M12 4V1L8 5l4 4V6a6 6 0 016 6c0 1-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm-6.76 1.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3a6 6 0 01-6-6c0-1 .25-1.97.7-2.8L5.24 5.74z",
  };
  const icon = (name) => {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", ICONS[name]);
    s.appendChild(p);
    return s;
  };
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else if (k in el && k !== "list") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const fmt = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
    return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
  };
  const fmtUp = (ms) => {
    const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60);
    return d ? `${d} d ${hr} h` : hr ? `${hr} h ${m % 60} min` : `${m} min`;
  };
  const fmtMB = (b) => `${Math.round(b / 1048576)} MB`;
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const setBg = (el, url) => { el.style.backgroundImage = safeUrl(url) ? `url("${url.replace(/"/g, "%22")}")` : ""; };
  const setPct = (input) => input.style.setProperty("--pct", `${((input.value - input.min) / (input.max - input.min)) * 100}%`);

  const toast = (msg, kind = "") => {
    const t = h("div", { class: `toast ${kind}`, text: msg });
    $("#toasts").append(t);
    setTimeout(() => t.remove(), kind === "err" ? 6000 : 3000);
  };

  /* ------------------------------------------------------------ estado + API */
  const S = {
    base: "", token: "", view: "home", guildId: null, tab: "player",
    overview: null, guilds: [], guild: null, pl: null, plAt: 0, dragging: false,
    guildFetchedAt: 0, rail: "", logsAuto: true, role: "admin", perms: [],
  };
  const LS = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  const guessBase = () => {
    const cfg = (window.KASPER_API || "").trim().replace(/\/+$/, "");
    if (cfg) return cfg;
    const saved = LS.get("kasper.api");
    if (saved) return saved;
    return /\.github\.io$/i.test(location.hostname) || location.protocol === "file:" ? "" : location.origin;
  };

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(S.base + "/api" + path, {
        method: opts.method || "GET",
        headers: { ...(S.token ? { Authorization: "Bearer " + S.token } : {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });
    } catch {
      setConn(false);
      throw new Error("No se pudo conectar con el bot. ¿Está encendido el dyno de Heroku?");
    }
    setConn(true);
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    if (res.status === 401 && S.token) { logout("Tu sesión expiró. Vuelve a entrar."); throw new Error("Sesión expirada"); }
    if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
    return data;
  }
  const can = (cat) => S.role === "admin" || S.perms.includes(cat);
  const act = async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast(okMsg, "ok"); return r; } catch (e) { toast(e.message, "err"); return null; }
  };

  function setConn(ok) {
    const d = $("#conn-dot"), l = $("#conn-label");
    if (!d) return;
    d.className = "dot " + (ok ? "ok" : "bad");
    l.textContent = ok ? "Conectado" : "Sin conexión";
  }

  /* ------------------------------------------------------------ login */
  function logout(msg) {
    S.token = "";
    LS.set("kasper.token", null);
    stopLoops();
    showLogin(msg);
  }

  function showLogin(msg) {
    const root = $("#app");
    root.replaceChildren();
    S.base = guessBase();
    const needsUrl = !S.base;
    const err = h("p", { class: "err", role: "alert", text: msg || "" });
    const pass = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true, id: "pw" });
    const url = h("input", { class: "input", type: "url", placeholder: "https://tu-app.herokuapp.com", value: S.base, id: "api-url" });
    const urlField = h("label", { class: "field", hidden: !needsUrl }, h("span", { text: "Dirección del bot (Heroku)" }), url);
    const btn = h("button", { class: "btn primary", type: "submit", text: "Entrar" });
    const guestBtn = h("button", { class: "btn", type: "button", hidden: true, text: "Entrar como invitado", onclick: () => guestLogin(err) });
    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        const base = url.value.trim().replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(base) && !S.base) { err.textContent = "Escribe la dirección completa del bot, con https://"; return; }
        if (base) S.base = base;
        btn.disabled = true; btn.textContent = "Entrando…";
        try {
          const r = await api("/login", { method: "POST", body: { password: pass.value } });
          S.token = r.token;
          LS.set("kasper.token", JSON.stringify({ t: r.token, exp: Date.now() + r.expiresIn - 60000 }));
          if (base && base !== location.origin) LS.set("kasper.api", base);
          startApp();
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false; btn.textContent = "Entrar";
          pass.select();
        }
      },
    },
      urlField,
      h("label", { class: "field" }, h("span", { text: "Contraseña del panel" }), pass),
      err, btn, guestBtn,
      needsUrl ? null : h("button", { class: "btn small", type: "button", text: "Usar otra dirección de bot", onclick: () => { urlField.hidden = false; url.focus(); } }),
    );
    root.append(h("main", { class: "login" }, h("div", { class: "login-card" },
      h("img", { class: "ghost", src: "favicon.svg", alt: "" }),
      h("h1", { text: "Kasper Music" }),
      h("p", { text: "Controla el bot desde el navegador: reproduce, ordena la cola y ajusta cada servidor." }),
      form)));
    (needsUrl ? url : pass).focus();
    if (S.base) fetch(S.base + "/api/health").then((r) => r.json()).then((d) => { if (d.guestOpen) { guestBtn.hidden = false; btn.textContent = "Entrar como administrador"; } }).catch(() => {});
  }

  async function guestLogin(err) {
    try {
      const r = await api("/login", { method: "POST", body: { guest: true } });
      S.token = r.token;
      LS.set("kasper.token", JSON.stringify({ t: r.token, exp: Date.now() + r.expiresIn - 60000 }));
      startApp();
      return true;
    } catch (ex) { if (err) err.textContent = ex.message; return false; }
  }

  /* ------------------------------------------------------------ shell */
  let loops = [];
  const stopLoops = () => { loops.forEach(clearInterval); loops = []; };

  async function startApp() {
    try {
      const me = await api("/me");
      S.role = me.role; S.perms = me.perms || [];
    } catch (e) { if (S.token) { toast(e.message, "err"); logout(); } return; }
    const root = $("#app");
    root.replaceChildren();
    const nav = S.role === "admin" ? [["home", "Resumen"], ["bot", "Bot"], ["logs", "Registro"]] : [["home", "Servidores"]];
    const navEl = h("nav", { class: "nav", "aria-label": "Secciones" }, nav.map(([id, label]) =>
      h("button", { "data-view": id, text: label, onclick: () => go(id) })));
    root.append(h("div", { class: "shell" },
      h("header", { class: "topbar" },
        h("div", { class: "brand" }, h("img", { src: "favicon.svg", alt: "" }), h("span", { text: "Kasper" })),
        navEl,
        h("div", { class: "conn" }, h("i", { class: "dot", id: "conn-dot" }), h("span", { id: "conn-label", text: "…" })),
        h("button", { class: "btn small", text: "Salir", onclick: () => logout() })),
      h("div", { class: "body" },
        h("aside", { class: "rail", "aria-label": "Servidores" },
          h("div", { class: "rail-search" }, h("input", { class: "input", type: "search", placeholder: "Buscar servidor…", "aria-label": "Buscar servidor", oninput: (e) => { S.rail = e.target.value.toLowerCase(); renderRail(); } })),
          h("div", { class: "rail-list", id: "rail" })),
        h("main", { class: "main", id: "main" }))));
    go("home");
    refreshGuilds();
    loops.push(setInterval(() => { if (!document.hidden) tick(); }, 2000));
    loops.push(setInterval(tickSeek, 500));
  }

  function go(view, guildId) {
    S.view = view;
    S.guildId = guildId || null;
    if (view === "guild") { S.guild = null; S.pl = null; S.tab = "player"; }
    document.querySelectorAll(".nav button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.view === view) || (b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    document.querySelectorAll(".nav button").forEach((b) => (b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    renderRail();
    const main = $("#main");
    main.replaceChildren();
    main.scrollTop = 0;
    if (view === "home") renderHome(main);
    else if (view === "bot" && S.role === "admin") renderBot(main);
    else if (view === "logs" && S.role === "admin") renderLogs(main);
    else if (view === "guild") openGuild(main, guildId);
  }

  let busyTick = false;
  async function tick() {
    if (busyTick) return;
    busyTick = true;
    try {
      const now = Date.now();
      if (S.view === "guild" && S.guildId) {
        const st = await api(`/guilds/${S.guildId}/state`);
        if (S.view === "guild") applyPlayer(st.player);
        if (S.tab === "settings" ? false : now - S.guildFetchedAt > 30000) loadGuildDetail(true);
      } else if (S.view === "home" && S.role === "admin") await loadOverview();
      else if (S.view === "logs") await loadLogs();
      if (now - (tick.lastGuilds || 0) > 6000) { tick.lastGuilds = now; await refreshGuilds(); }
    } catch (e) {
      if (S.view === "guild" && /no encontrado/i.test(e.message)) { toast("El bot ya no está en ese servidor.", "err"); go("home"); }
    } finally { busyTick = false; }
  }

  /* ------------------------------------------------------------ rail */
  async function refreshGuilds() {
    try { S.guilds = (await api("/guilds")).guilds; renderRail(); if (S.role !== "admin" && S.view === "home") paintGuestHome(); } catch { /* se reintenta */ }
  }
  function renderRail() {
    const rail = $("#rail");
    if (!rail) return;
    const list = S.guilds.filter((g) => g.name.toLowerCase().includes(S.rail));
    rail.replaceChildren(...list.map((g) => {
      const status = g.player ? (g.player.playing ? "Sonando: " + (g.player.title || "…") : g.player.paused ? "En pausa" : "En el canal de voz") : `${g.members} miembros`;
      return h("button", { class: "srv", "aria-current": String(S.guildId === g.id), onclick: () => go("guild", g.id) },
        h("span", { class: "av" }, safeUrl(g.icon) ? h("img", { src: g.icon, alt: "", loading: "lazy" }) : g.name.slice(0, 2).toUpperCase()),
        h("span", { style: "min-width:0" }, h("b", { text: g.name }), h("small", { text: status })),
        g.player && (g.player.playing || g.player.paused) ? h("span", { class: "eq" + (g.player.playing ? "" : " paused"), "aria-hidden": "true" }, h("i"), h("i"), h("i")) : null);
    }));
    if (!list.length) rail.append(h("p", { class: "empty", text: S.guilds.length ? "Sin resultados." : "El bot aún no está en ningún servidor." }));
  }

  /* ------------------------------------------------------------ resumen */
  let homeRefs = null;
  function renderGuestHome(main) {
    const box = h("div", { class: "live" });
    homeRefs = { guest: box };
    main.append(h("div", { class: "page" }, h("h2", { text: "Servidores" }),
      h("p", { class: "hint", text: "Elige un servidor para ver qué suena y pedir canciones." }), box));
    paintGuestHome();
  }
  function paintGuestHome() {
    if (!homeRefs?.guest) return;
    homeRefs.guest.replaceChildren(...(S.guilds.length ? S.guilds.map((g) =>
      h("button", { onclick: () => go("guild", g.id) },
        h("span", { class: "art" }, safeUrl(g.icon) ? h("img", { src: g.icon, alt: "", style: "width:100%;height:100%;object-fit:cover" }) : icon("note")),
        h("span", { style: "min-width:0" }, h("b", { text: g.name }), h("br"), h("small", { class: "hint", text: g.player?.title ? "Suena: " + g.player.title : `${g.members} miembros` })),
        g.player && (g.player.playing || g.player.paused) ? h("span", { class: "eq" + (g.player.playing ? "" : " paused") }, h("i"), h("i"), h("i")) : null)) :
      [h("p", { class: "empty", text: "No hay servidores disponibles." })]));
  }
  function renderHome(main) {
    if (S.role !== "admin") return renderGuestHome(main);
    homeRefs = { stats: h("dl", { class: "stats" }), bot: h("div", { class: "hero-bot" }), live: h("div", { class: "live" }), shards: h("tbody") };
    main.append(h("div", { class: "page" },
      h("section", { class: "panel" }, homeRefs.bot),
      homeRefs.stats,
      h("section", null, h("h3", { text: "Sonando ahora" }), homeRefs.live),
      h("section", { class: "panel" }, h("h3", { text: "Shards" }),
        h("table", null, h("thead", null, h("tr", null, ["Shard", "Estado", "Ping", "Servidores"].map((t) => h("th", { text: t })))), homeRefs.shards))));
    if (S.overview) paintHome();
    loadOverview();
  }
  async function loadOverview() {
    S.overview = await api("/overview");
    if (S.view === "home") paintHome();
  }
  function paintHome() {
    const o = S.overview, r = homeRefs;
    if (!o || !r) return;
    r.bot.replaceChildren(
      h("img", { src: o.bot?.avatar && safeUrl(o.bot.avatar) ? o.bot.avatar : "favicon.svg", alt: "" }),
      h("div", null, h("h2", { text: o.bot?.tag || "Kasper Music" }),
        h("div", { class: "row", style: "margin-top:6px" },
          h("span", { class: "pill", text: o.status === "online" ? "En línea" : o.status === "idle" ? "Ausente" : o.status === "dnd" ? "No molestar" : "Invisible" }),
          h("span", { class: "pill", text: o.backend === "local" ? "Audio local (yt-dlp + FFmpeg)" : "Lavalink" }),
          o.activity ? h("span", { class: "pill", text: "Actividad: " + o.activity }) : null)));
    const stat = (label, value, small) => h("div", { class: "stat" }, h("dt", { text: label }), h("dd", null, value, small ? h("small", { text: " " + small }) : null));
    r.stats.replaceChildren(
      stat("Servidores", String(o.guilds)), stat("Usuarios", o.users.toLocaleString("es")),
      stat("Reproduciendo", String(o.playing), `de ${o.players} conectados`),
      stat("Latencia", o.ping >= 0 ? `${o.ping}` : "—", "ms"), stat("Memoria del bot", fmtMB(o.rss)), stat("Tiempo activo", fmtUp(o.uptime)));
    r.shards.replaceChildren(...o.shards.map((s) => h("tr", null, h("td", { text: "#" + s.id }), h("td", { text: s.ready ? "Listo" : "Iniciando" }), h("td", { text: s.ping + " ms" }), h("td", { text: String(s.guilds) }))));
    const playing = S.guilds.filter((g) => g.player && (g.player.playing || g.player.paused));
    r.live.replaceChildren(...(playing.length ? playing.map((g) =>
      h("button", { onclick: () => go("guild", g.id) }, h("span", { class: "art" }, icon("note")),
        h("span", { style: "min-width:0" }, h("b", { text: g.player.title || "…" }), h("br"), h("small", { class: "hint", text: g.name })),
        h("span", { class: "eq" + (g.player.playing ? "" : " paused") }, h("i"), h("i"), h("i")))) :
      [h("p", { class: "empty", text: "Nadie está escuchando música ahora mismo. Elige un servidor a la izquierda para empezar." })]));
  }

  /* ------------------------------------------------------------ bot */
  function renderBot(main) {
    const o = S.overview;
    const status = h("select", { class: "input", id: "p-status" }, [["online", "En línea"], ["idle", "Ausente"], ["dnd", "No molestar"], ["invisible", "Invisible"]].map(([v, t]) => h("option", { value: v, text: t, selected: o?.status === v })));
    const type = h("select", { class: "input" }, [["listening", "Escuchando"], ["playing", "Jugando a"], ["watching", "Viendo"], ["competing", "Compitiendo en"]].map(([v, t]) => h("option", { value: v, text: t })));
    const text = h("input", { class: "input", maxLength: 120, placeholder: "p. ej. música en tu servidor", value: o?.activity || "" });
    main.append(h("div", { class: "page" }, h("h2", { text: "Bot" }),
      h("section", { class: "panel stack" }, h("h3", { text: "Presencia" }),
        h("div", { class: "cols" }, h("label", { class: "field" }, h("span", { text: "Estado" }), status), h("label", { class: "field" }, h("span", { text: "Tipo de actividad" }), type)),
        h("label", { class: "field" }, h("span", { text: "Texto de la actividad (déjalo vacío para quitarla)" }), text),
        h("div", null, h("button", { class: "btn primary", text: "Guardar presencia", onclick: () => act(() => api("/presence", { method: "POST", body: { status: status.value, type: type.value, activity: text.value } }), "Presencia actualizada") }))),
      h("section", { class: "panel stack" }, h("h3", { text: "Mantenimiento" }),
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Registrar comandos slash" }), h("small", { text: "Vuelve a publicar los comandos / en Discord. Puede tardar unos minutos en verse." })),
          h("button", { class: "btn", text: "Registrar", onclick: () => act(() => api("/deploy", { method: "POST" }), "Comandos registrados") })),
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Reiniciar el bot" }), h("small", { text: "Corta la música en todos los servidores. Heroku lo vuelve a encender solo (≈30 s)." })),
          h("button", { class: "btn danger", text: "Reiniciar", onclick: async () => { if (!confirm("¿Reiniciar el bot? Se cortará la música en todos los servidores.")) return; await act(() => api("/restart", { method: "POST" }), "Reiniciando… el panel se reconectará solo."); } })))));
    if (!o) loadOverview().then(() => { if (S.view === "bot") { $("#main").replaceChildren(); renderBot($("#main")); } }).catch(() => {});
  }

  /* ------------------------------------------------------------ logs */
  let logBox = null;
  function renderLogs(main) {
    logBox = h("div", { class: "logs", role: "log", tabindex: "0", "aria-label": "Registro del bot" });
    logBox.addEventListener("scroll", () => { S.logsAuto = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 30; });
    main.append(h("div", { class: "page" }, h("h2", { text: "Registro" }),
      h("p", { class: "hint", text: "Últimas líneas de la consola del bot (se actualiza solo). Si algo falla al reproducir, aparece aquí." }), logBox));
    loadLogs();
  }
  async function loadLogs() {
    const { lines } = await api("/logs?limit=300");
    if (S.view !== "logs" || !logBox) return;
    logBox.replaceChildren(...lines.map((l) => {
      const cls = /error|✖|fatal/i.test(l.line) ? "e" : /warn|⚠/i.test(l.line) ? "w" : "";
      return h("div", { class: cls }, h("span", { class: "t", text: new Date(l.t).toLocaleTimeString("es") + " " }), h("span", { class: "p", text: l.proc + " " }), l.line);
    }));
    if (!lines.length) logBox.append(h("p", { class: "empty", text: "Todavía no hay líneas." }));
    if (S.logsAuto) logBox.scrollTop = logBox.scrollHeight;
  }

  /* ------------------------------------------------------------ servidor */
  let G = null; // referencias del servidor abierto
  function openGuild(main, id) {
    const summary = S.guilds.find((g) => g.id === id);
    G = {};
    const tabs = [["player", "Reproductor"], ["queue", "Cola"], ["filters", "Filtros"], ["settings", "Ajustes"]]
      .filter(([k]) => (k === "filters" ? can("filters") : k === "settings" ? S.role === "admin" : true));
    G.tabButtons = tabs.map(([key, label]) => h("button", { role: "tab", "aria-selected": String(key === "player"), onclick: () => setTab(key), text: label, "data-tab": key }));
    G.head = h("div", { class: "g-head" },
      h("span", { class: "av" }, summary && safeUrl(summary.icon) ? h("img", { src: summary.icon, alt: "" }) : (summary?.name || "?").slice(0, 2).toUpperCase()),
      h("h2", { text: summary?.name || "Servidor" }));
    G.voice = h("select", { class: "input", "aria-label": "Canal de voz", style: "width:auto;min-width:180px" });
    G.joinBtn = h("button", { class: "btn", text: "Unir al canal", onclick: () => joinOrMove() });
    G.leaveBtn = h("button", { class: "btn danger", text: "Desconectar", onclick: () => ctl("leave") });
    if (can("voice")) G.head.append(G.voice, G.joinBtn, G.leaveBtn);
    else if (can("play")) G.head.append(G.voice); // el invitado solo elige canal si el bot aún no está conectado
    G.panes = { player: h("div", { class: "stack", role: "tabpanel" }), queue: h("div", { class: "stack", role: "tabpanel", hidden: true }), filters: h("div", { class: "stack", role: "tabpanel", hidden: true }), settings: h("div", { class: "stack", role: "tabpanel", hidden: true }) };
    main.append(h("div", { class: "page" }, G.head, h("div", { class: "tabs", role: "tablist" }, G.tabButtons), G.panes.player, G.panes.queue, G.panes.filters, G.panes.settings));
    buildPlayerPane(); buildQueuePane(); buildFiltersPane();
    if (S.role === "admin") G.panes.settings.append(h("p", { class: "empty", text: "Cargando…" }));
    loadGuildDetail(false);
    api(`/guilds/${id}/state`).then((st) => applyPlayer(st.player)).catch(() => {});
  }

  function setTab(key) {
    S.tab = key;
    G.tabButtons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === key)));
    for (const [k, el] of Object.entries(G.panes)) el.hidden = k !== key;
    if (key === "settings" && S.role === "admin") loadGuildDetail(false);
  }

  async function loadGuildDetail(quiet) {
    const id = S.guildId;
    try {
      const d = await api(`/guilds/${id}`);
      if (S.guildId !== id || !G) return;
      S.guild = d; S.guildFetchedAt = Date.now();
      G.head.querySelector("h2").textContent = d.name;
      fillVoiceSelect();
      if (S.role === "admin" && (!quiet || S.tab !== "settings")) buildSettings();
      applyPlayer(d.player);
    } catch (e) { if (!quiet) toast(e.message, "err"); }
  }

  function fillVoiceSelect() {
    const d = S.guild;
    if (!G.voice.isConnected && S.role !== "admin" && !can("play")) return;
    const cur = G.voice.value;
    const want = S.pl?.voiceChannelId || cur || [...d.voiceChannels].sort((a, b) => b.members - a.members)[0]?.id;
    G.voice.replaceChildren(...d.voiceChannels.map((c) => h("option", { value: c.id, selected: c.id === want, text: `🔊 ${c.name}${c.members ? ` (${c.members})` : ""}` })));
    if (!d.voiceChannels.length) G.voice.append(h("option", { text: "Sin canales de voz" }));
  }

  const ctl = (op, extra = {}) => act(async () => {
    const r = await api(`/guilds/${S.guildId}/control`, { method: "POST", body: { op, ...extra } });
    applyPlayer(r.player);
    return r;
  });
  const joinOrMove = () => (S.pl?.connected ? ctl("move-voice", { voiceChannelId: G.voice.value }) : ctl("join", { voiceChannelId: G.voice.value }));

  /* ---- reproductor ---- */
  function buildPlayerPane() {
    const R = (G.r = {});
    R.art = h("div", { class: "art" }, icon("note"));
    R.bg = h("div", { class: "np-bg", "aria-hidden": "true" });
    R.title = h("h3", { class: "np-title" });
    R.sub = h("p", { class: "np-sub" });
    R.cur = h("span", { text: "0:00" }); R.dur = h("span", { text: "0:00" });
    R.seek = h("input", { type: "range", min: 0, max: 1000, value: 0, "aria-label": "Posición" });
    R.seek.addEventListener("input", () => { S.dragging = true; setPct(R.seek); R.cur.textContent = fmt((R.seek.value / 1000) * (S.pl?.current?.duration || 0)); });
    R.seek.addEventListener("change", () => { S.dragging = false; const ms = Math.round((R.seek.value / 1000) * (S.pl?.current?.duration || 0)); ctl("seek", { ms }); });
    const tb = (name, label, fn, cls = "") => h("button", { class: "icon-btn " + cls, title: label, "aria-label": label, onclick: fn }, icon(name));
    R.shuffle = tb("shuffle", "Mezclar cola", () => ctl("shuffle"));
    R.prev = tb("prev", "Anterior", () => ctl("previous"));
    R.play = tb("play", "Reproducir o pausar", () => ctl("toggle"), "play");
    R.next = tb("next", "Siguiente", () => ctl("skip"));
    R.stop = tb("stop", "Detener y vaciar cola", () => ctl("stop"));
    R.loop = tb("repeat", "Repetir: desactivado", () => ctl("loop", { mode: { off: "queue", queue: "track", track: "off" }[S.pl?.repeat || "off"] }));
    R.auto = tb("autoplay", "Reproducción automática", () => ctl("autoplay", { enabled: !S.pl?.autoplay }));
    R.vol = h("input", { type: "range", min: 0, max: 200, value: 100, "aria-label": "Volumen" });
    R.volOut = h("output", { text: "100%" });
    const sendVol = debounce(() => ctl("volume", { value: Number(R.vol.value) }), 180);
    R.vol.addEventListener("input", () => { S.volTouch = Date.now(); setPct(R.vol); R.volOut.textContent = R.vol.value + "%"; sendVol(); });
    R.idle = h("div", { class: "np-in np-idle" }, h("div", null, h("h3", { text: "No hay nada sonando" }), h("p", { class: "hint", text: "Busca una canción abajo o pega un enlace de YouTube o SoundCloud." })));
    R.main = h("div", { class: "np-in" }, h("div", null, R.art),
      h("div", { class: "np-meta" }, h("div", null, R.title, R.sub),
        h("div", { class: "seek" }, R.cur, R.seek, R.dur),
        h("div", { class: "transport" }, R.shuffle, R.prev, R.play, R.next, R.stop, R.loop, R.auto,
          h("label", { class: "vol" }, icon("vol"), R.vol, R.volOut))));
    R.card = h("section", { class: "np" }, R.bg, R.idle, R.main);

    R.q = h("input", { class: "input grow", type: "search", placeholder: "Nombre de la canción o enlace…", "aria-label": "Buscar canción" });
    R.src = h("select", { class: "input", "aria-label": "Fuente", style: "width:auto" }, h("option", { value: "youtube", text: "YouTube" }), h("option", { value: "soundcloud", text: "SoundCloud" }));
    R.results = h("div", { class: "results" });
    R.searchBtn = h("button", { class: "btn primary", type: "submit" }, icon("search"), "Buscar");
    const form = h("form", { class: "row", onsubmit: async (e) => {
      e.preventDefault();
      const q = R.q.value.trim();
      if (!q) return;
      if (/^https?:\/\//i.test(q)) { await addTrack(q, false); R.q.value = ""; return; }
      R.searchBtn.disabled = true;
      R.results.replaceChildren(h("p", { class: "empty", text: "Buscando…" }));
      const r = await act(() => api(`/search?q=${encodeURIComponent(q)}&source=${R.src.value}`));
      R.searchBtn.disabled = false;
      if (!r) return R.results.replaceChildren();
      R.results.replaceChildren(...(r.tracks.length ? r.tracks.map((t) => trackRow(t, [
        ["add", "Añadir a la cola", () => addTrack(t.uri, false, t.title)],
        ["next", "Reproducir a continuación", () => addTrack(t.uri, true, t.title)],
      ])) : [h("p", { class: "empty", text: "Sin resultados. Prueba con otras palabras." })]));
    } }, R.q, R.src, R.searchBtn);
    G.panes.player.append(R.card);
    if (can("play")) G.panes.player.append(h("section", { class: "panel" }, h("h3", { text: "Añadir música" }), form, R.results));
  }

  async function addTrack(query, next, title) {
    const body = { query, next, voiceChannelId: G.voice.value };
    const r = await act(() => api(`/guilds/${S.guildId}/play`, { method: "POST", body }));
    if (!r) return;
    toast(`${r.playlist ? "Playlist añadida" : next ? "Sonará a continuación" : "Añadida a la cola"}: ${r.title || title}`, "ok");
    api(`/guilds/${S.guildId}/state`).then((st) => applyPlayer(st.player)).catch(() => {});
  }

  function trackRow(t, actions, extra) {
    const art = h("span", { class: "art" }, safeUrl(t.artwork) ? null : icon("note"));
    setBg(art, t.artwork);
    const sub = [t.author, t.isStream ? "En vivo" : fmt(t.duration), t.requester && t.requester !== "unknown" ? "pedida por " + t.requester : null].filter(Boolean).join(" · ");
    return h("div", { class: "track", ...(extra || {}) }, ...(extra?.lead ? [extra.lead] : []), art,
      h("div", { class: "t" }, h("b", { text: t.title }), h("small", { text: sub })),
      h("div", { class: "acts" }, actions.map(([ic, label, fn]) => h("button", { class: "icon-btn", title: label, "aria-label": label, onclick: fn }, icon(ic)))));
  }

  /* ---- cola ---- */
  function buildQueuePane() {
    G.q = { list: h("div", { class: "queue" }), info: h("p", { class: "hint" }) };
    G.q.tools = h("div", { class: "row" }, h("button", { class: "btn small", text: "Mezclar", onclick: () => ctl("shuffle") }), h("button", { class: "btn small danger", text: "Vaciar cola", onclick: () => ctl("clear") }));
    G.panes.queue.append(h("section", { class: "panel" },
      h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" }, h("h3", { style: "margin:0", text: "Próximas canciones" }),
        G.q.tools),
      G.q.info, G.q.list));
  }
  function paintQueue(pl) {
    const sig = JSON.stringify([pl?.queue?.map((t) => t.uri + t.title), pl?.queueTotal]);
    if (G.q.sig === sig) return;
    G.q.sig = sig;
    const q = pl?.queue || [];
    G.q.info.textContent = q.length ? `${pl.queueTotal} en cola · ${fmt(pl.queueDuration)} en total.${can("queue") ? " Arrastra para reordenar." : ""}` : "";
    G.q.list.replaceChildren(...(q.length ? q.map((t, i) => {
      const cq = can("queue");
      const row = trackRow(t, cq ? [["play", "Saltar a esta canción", () => ctl("skipto", { index: i + 1 })], ["x", "Quitar de la cola", () => ctl("remove", { index: i + 1 })]] : [],
        { draggable: cq, lead: h("span", { class: "n", text: String(i + 1) }) });
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; row.classList.add("drag"); });
      row.addEventListener("dragend", () => row.classList.remove("drag"));
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("over"); });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", (e) => { e.preventDefault(); row.classList.remove("over"); const from = Number(e.dataTransfer.getData("text/plain")); if (Number.isInteger(from) && from !== i) ctl("move", { from: from + 1, to: i + 1 }); });
      return row;
    }) : [h("p", { class: "empty", text: "La cola está vacía. Añade canciones desde la pestaña Reproductor." })]));
    if (q.length < (pl?.queueTotal || 0)) G.q.list.append(h("p", { class: "hint", text: `Mostrando las primeras ${q.length}.` }));
  }

  /* ---- filtros ---- */
  function buildFiltersPane() {
    const F = (G.f = { chips: {}, sliders: {} });
    const setF = (name, value) => act(async () => { const r = await api(`/guilds/${S.guildId}/filter`, { method: "POST", body: { name, value } }); if (S.pl) S.pl.filters = r.filters; paintFilters(r.filters); });
    const chip = (key, label, onclick) => (F.chips[key] = h("button", { class: "chip", "aria-pressed": "false", text: label, onclick }));
    const toggles = [["nightcore", "Nightcore"], ["rotation", "8D"], ["karaoke", "Karaoke"], ["tremolo", "Trémolo"], ["vibrato", "Vibrato"], ["lowpass", "Paso bajo"]];
    const bass = [["off", "Apagado"], ["low", "Suave"], ["medium", "Medio"], ["high", "Fuerte"]];
    const slider = (key, label) => {
      const out = h("output", { text: "1.00×" });
      const input = h("input", { type: "range", min: 0.5, max: 2, step: 0.05, value: 1, "aria-label": label });
      input.addEventListener("input", () => { setPct(input); out.textContent = Number(input.value).toFixed(2) + "×"; F.touch = Date.now(); });
      input.addEventListener("change", () => setF(key, Number(input.value)));
      F.sliders[key] = { input, out };
      return h("div", { class: "slider-row" }, h("span", { text: label }), input, out);
    };
    G.panes.filters.append(
      h("section", { class: "panel stack" }, h("h3", { text: "Bajos" }), h("div", { class: "chips" }, bass.map(([v, t]) => chip("bass-" + v, t, () => setF("bassboost", v))))),
      h("section", { class: "panel stack" }, h("h3", { text: "Efectos" }), h("div", { class: "chips" }, toggles.map(([k, t]) => chip(k, t, () => setF(k, F.chips[k].getAttribute("aria-pressed") !== "true"))))),
      h("section", { class: "panel stack" }, h("h3", { text: "Velocidad y tono" }), slider("speed", "Velocidad"), slider("pitch", "Tono"), slider("rate", "Ritmo")),
      h("div", null, h("button", { class: "btn", text: "Quitar todos los filtros", onclick: () => setF("reset") })),
      h("p", { class: "hint", text: "Al cambiar un filtro el tema se reinicia un instante en la misma posición." }));
  }
  function paintFilters(f) {
    if (!f || !G?.f) return;
    for (const k of ["nightcore", "rotation", "karaoke", "tremolo", "vibrato", "lowpass"]) G.f.chips[k].setAttribute("aria-pressed", String(!!f[k]));
    for (const b of ["off", "low", "medium", "high"]) G.f.chips["bass-" + b].setAttribute("aria-pressed", String(f.bassboost === b));
    if (Date.now() - (G.f.touch || 0) > 1500) for (const k of ["speed", "pitch", "rate"]) { const s = G.f.sliders[k]; s.input.value = f[k]; setPct(s.input); s.out.textContent = Number(f[k]).toFixed(2) + "×"; }
  }

  /* ---- estado del reproductor ---- */
  function applyPlayer(pl) {
    if (!G || S.view !== "guild") return;
    S.pl = pl; S.plAt = performance.now();
    const R = G.r, cur = pl?.current;
    const active = !!(pl && cur);
    R.idle.hidden = active; R.main.hidden = !active;
    R.card.classList.toggle("is-idle", !active);
    G.joinBtn.textContent = pl?.connected ? "Mover aquí" : "Unir al canal";
    G.leaveBtn.hidden = !pl;
    if (!can("voice")) G.voice.hidden = !!pl?.connected;
    const cc = can("control"), cq = can("queue");
    for (const b of [R.play, R.prev, R.next, R.loop, R.auto]) b.hidden = !cc;
    R.shuffle.hidden = !cq; R.stop.hidden = !cq;
    R.vol.disabled = !cc; R.seek.disabled = !cc || !!cur?.isStream;
    R.vol.closest(".vol").hidden = !cc;
    G.q.tools.hidden = !cq;
    if (pl?.voiceChannelId && !G.voice.matches(":focus")) G.voice.value = pl.voiceChannelId;
    if (active) {
      if (R.title.dataset.k !== cur.title + cur.uri) {
        R.title.dataset.k = cur.title + cur.uri;
        const link = safeUrl(cur.uri);
        R.title.replaceChildren(link ? h("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: cur.title }) : cur.title);
        R.sub.textContent = [cur.author, cur.requester && cur.requester !== "unknown" ? "pedida por " + cur.requester : null, cur.auto ? "automática" : null].filter(Boolean).join(" · ");
        setBg(R.art, cur.artwork); setBg(R.bg, cur.artwork);
        R.art.replaceChildren(...(safeUrl(cur.artwork) ? [] : [icon("note")]));
        R.dur.textContent = cur.isStream ? "En vivo" : fmt(cur.duration);
        }
      R.play.replaceChildren(icon(pl.paused ? "play" : "pause"));
      const pl2 = pl.paused ? "Reanudar" : "Pausar";
      R.play.title = pl2; R.play.setAttribute("aria-label", pl2);
    }
    if (pl) {
      const lb = { off: "Repetir: desactivado", queue: "Repetir: toda la cola", track: "Repetir: esta canción" }[pl.repeat];
      R.loop.replaceChildren(icon(pl.repeat === "track" ? "repeat1" : "repeat"));
      R.loop.title = lb; R.loop.setAttribute("aria-label", lb);
      R.loop.classList.toggle("on", pl.repeat !== "off");
      R.auto.classList.toggle("on", pl.autoplay);
      if (!R.vol.matches(":active") && Date.now() - (S.volTouch || 0) > 1200) { R.vol.value = pl.volume; R.volOut.textContent = pl.volume + "%"; setPct(R.vol); }
      paintFilters(pl.filters);
    }
    paintQueue(pl);
    tickSeek();
  }
  function tickSeek() {
    if (!G || !G.r || S.view !== "guild" || !S.pl?.current || S.dragging) return;
    const pl = S.pl, dur = pl.current.duration;
    let pos = pl.position;
    if (pl.playing && !pl.paused) pos += performance.now() - S.plAt;
    pos = Math.max(0, dur ? Math.min(pos, dur) : pos);
    G.r.cur.textContent = fmt(pos);
    if (!pl.current.isStream && dur) { G.r.seek.value = Math.round((pos / dur) * 1000); setPct(G.r.seek); }
  }

  /* ---- ajustes ---- */
  function buildSettings() {
    const d = S.guild, st = d.settings, pane = G.panes.settings;
    const prefix = h("input", { class: "input", value: st.prefix, maxLength: 3, "aria-label": "Prefijo", style: "width:90px" });
    const lang = h("select", { class: "input", "aria-label": "Idioma", style: "width:auto;min-width:160px" }, (S.overview?.languages?.length ? S.overview.languages : [st.language]).map((l) => h("option", { value: l, text: l, selected: l === st.language })));
    const vol = h("input", { type: "range", min: 1, max: 100, value: st.defaultVolume, "aria-label": "Volumen por defecto" });
    const volOut = h("output", { text: st.defaultVolume + "%" });
    setPct(vol);
    vol.addEventListener("input", () => { setPct(vol); volOut.textContent = vol.value + "%"; });
    vol.addEventListener("change", () => save({ defaultVolume: Number(vol.value) }, "Volumen por defecto guardado"));
    const save = (body, msg) => act(async () => { await api(`/guilds/${S.guildId}/settings`, { method: "POST", body }); await loadGuildDetail(false); }, msg);
    const sw = (checked, onchange) => h("label", { class: "switch" }, h("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }), h("i"));
    const roleSel = h("select", { class: "input", "aria-label": "Añadir rol DJ", style: "width:auto;min-width:160px" }, h("option", { value: "", text: "Añadir rol…" }), st.guildRoles.filter((r) => !st.roles.some((x) => x.id === r.id)).map((r) => h("option", { value: r.id, text: r.name })));
    roleSel.addEventListener("change", () => roleSel.value && save({ addRole: roleSel.value }, "Rol añadido"));
    const stayVoice = h("select", { class: "input", "aria-label": "Canal 24/7", style: "width:auto;min-width:160px" }, d.voiceChannels.map((c) => h("option", { value: c.id, text: "🔊 " + c.name, selected: c.id === st.stay?.voiceId })));
    pane.replaceChildren(
      h("section", { class: "panel" },
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Prefijo" }), h("small", { text: "Para comandos de texto como !play (1 a 3 caracteres)." })),
          h("div", { class: "row" }, prefix, h("button", { class: "btn", text: "Guardar", onclick: () => save({ prefix: prefix.value }, "Prefijo guardado") }))),
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Idioma" }), h("small", { text: "Idioma de los mensajes del bot en este servidor." })),
          h("div", { class: "row" }, lang, h("button", { class: "btn", text: "Guardar", onclick: () => save({ language: lang.value }, "Idioma guardado") }))),
        h("div", { class: "setting" }, h("div", { style: "flex:1" }, h("b", { text: "Volumen por defecto" }), h("small", { text: "Con el que entra el bot a un canal." })),
          h("div", { class: "row", style: "width:min(260px,100%);flex-wrap:nowrap" }, vol, volOut))),
      h("section", { class: "panel" },
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Modo DJ" }), h("small", { text: "Solo los roles DJ (y quienes administran) controlan la música." })), sw(st.dj, (v) => save({ dj: v }, v ? "Modo DJ activado" : "Modo DJ desactivado"))),
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Roles DJ" }), h("div", { class: "row", style: "margin-top:8px" },
          ...(st.roles.length ? st.roles.map((r) => h("span", { class: "tag" }, r.name, h("button", { "aria-label": "Quitar " + r.name, onclick: () => save({ removeRole: r.id }, "Rol quitado"), text: "×" }))) : [h("small", { text: "Ninguno" })]))), roleSel),
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Modo 24/7" }), h("small", { text: st.stay ? "El bot se queda en el canal aunque no haya música." : "Mantiene al bot conectado a un canal de voz." })),
          h("div", { class: "row" }, st.stay ? null : stayVoice, sw(!!st.stay, (v) => save(v ? { stay: true, voiceChannelId: stayVoice.value } : { stay: false }, v ? "Modo 24/7 activado" : "Modo 24/7 desactivado"))))),
      h("section", { class: "panel" },
        h("div", { class: "setting" }, h("div", null, h("b", { text: "Sacar al bot de este servidor" }), h("small", { text: "El bot abandona el servidor. Tendrás que volver a invitarlo." })),
          h("button", { class: "btn danger", text: "Salir del servidor", onclick: async () => { if (!confirm(`¿Sacar al bot de "${d.name}"?`)) return; const r = await act(() => api(`/guilds/${S.guildId}/leave-server`, { method: "POST" }), "El bot salió del servidor"); if (r) { await refreshGuilds(); go("home"); } } }))));
  }

  /* ------------------------------------------------------------ arranque */
  function boot() {
    S.base = guessBase();
    let saved = null;
    try { saved = JSON.parse(LS.get("kasper.token") || "null"); } catch { /* ignorado */ }
    if (saved && saved.t && saved.exp > Date.now() && S.base) { S.token = saved.t; startApp(); }
    else if (location.hash === "#invitado" && S.base) guestLogin().then((ok) => ok || showLogin());
    else showLogin();
  }
  document.addEventListener("keydown", (e) => {
    if (S.view !== "guild" || !G || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.code === "Space" && can("control")) { e.preventDefault(); ctl("toggle"); }
  });
  boot();
})();
