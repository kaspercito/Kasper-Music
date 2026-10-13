# Panel web de Kasper Music

Controla el bot desde el navegador: reproducir, pausar, saltar, cola (arrastrar para reordenar), volumen, filtros, ajustes por servidor (prefijo, idioma, DJ, 24/7), presencia del bot, registro de la consola y reinicio.

## Cómo funciona
- El bot abre una API HTTP protegida con contraseña (`src/api/`). Corre en el mismo dyno de Heroku.
- El panel (`panel/`) son archivos estáticos. Lo sirve el propio bot en `https://TU-APP.herokuapp.com/` **y** puedes publicarlo en GitHub Pages.

## 1) Heroku (obligatorio)
Heroku solo envía tráfico web a procesos `web`, así que el bot pasó de `worker` a `web` (`heroku.yml` y `Procfile` ya están cambiados).

```bash
heroku config:set PANEL_PASSWORD="una-contraseña-larga-de-12+-caracteres" -a TU-APP
heroku stack:set container -a TU-APP        # si aún no lo tenías
git push heroku main
heroku ps:scale worker=0 web=1 -a TU-APP    # apaga el worker viejo, enciende web
```

Abre `https://TU-APP.herokuapp.com/` e inicia sesión.

> **Importante:** los dynos *Eco* se duermen tras 30 min sin visitas web, y el bot se apagaría. Usa un dyno **Basic** (o superior), que no se duerme.

## 2) GitHub Pages (opcional)
1. En el repo: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: crea `PANEL_API_URL` = `https://TU-APP.herokuapp.com`.
3. Haz push: el workflow `Publicar panel en GitHub Pages` publica `panel/`.
4. En Heroku permite ese origen (sin barra final ni ruta):
   ```bash
   heroku config:set PANEL_ORIGIN="https://TUUSUARIO.github.io" -a TU-APP
   ```
Si no defines `PANEL_API_URL`, el login te pedirá la dirección del bot.

## Variables
| Variable | Para qué |
|---|---|
| `PANEL_PASSWORD` | Contraseña de acceso. Sin ella el panel queda desactivado. |
| `PANEL_ORIGIN` | Orígenes permitidos (CORS), separados por coma. Solo para Pages. |
| `PANEL_SECRET` | Opcional, refuerza la firma de sesiones. |

## Seguridad
- Contraseña comparada en tiempo constante, 8 intentos por 10 min por IP, sesiones firmadas de 12 h.
- CORS cerrado salvo `PANEL_ORIGIN`; el panel nunca inserta HTML de terceros (títulos de canciones van como texto).
- Usa siempre HTTPS (Heroku y Pages ya lo dan).

## Desarrollo local
`PANEL_PASSWORD=prueba-1234567 PORT=3000 bun run dev` → http://localhost:3000

## Spotify
Puedes usar `k!play` con enlaces de canciones, **playlists y álbumes** de Spotify. El audio sale de YouTube (se busca cada canción justo antes de sonar). Sin credenciales se leen hasta 100 canciones de listas públicas; para listas más largas crea una app en https://developer.spotify.com/dashboard y define `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` en Heroku.

## Acceso de invitado (para tu comunidad)
Además de tu contraseña de administrador, puedes dar otra a tus usuarios. El invitado **no ve**: resumen del bot, registro, ajustes, presencia, reinicio ni otros servidores. Solo ve los servidores y puede hacer lo que tú permitas.

| Variable | Qué hace |
|---|---|
| `PANEL_GUEST_PASSWORD` | Contraseña de invitado (distinta a la de admin). Sin ella no hay acceso de invitado. |
| `PANEL_GUEST_GUILDS` | IDs de servidores permitidos, separados por coma. Vacío = todos donde está el bot. |
| `PANEL_GUEST_PERMS` | `play` (buscar y añadir), `control` (pausa, saltar, volumen, repetir), `queue` (quitar, mover, vaciar, mezclar, detener), `filters` (filtros de audio), `voice` (unir, mover y desconectar al bot de canales de voz). Por defecto: **todos**, es decir, lo mismo que un miembro puede hacer con el bot en Discord. El volumen del invitado se limita a 100 % y hay un máximo de 40 acciones por minuto por IP. |

Ejemplo: `PANEL_GUEST_PASSWORD=musica2026`, `PANEL_GUEST_GUILDS=123456789012345678`, `PANEL_GUEST_PERMS=play,control`.
Entran por la misma dirección del panel; según la contraseña que escriban, ven una versión u otra.

### Invitado sin contraseña
Define `PANEL_GUEST_OPEN=true` (y obligatoriamente `PANEL_GUEST_GUILDS`). La pantalla de entrada mostrará **Entrar como invitado** sin pedir nada. Enlace directo: `https://TUUSUARIO.github.io/REPO/#invitado` entra solo. Cualquiera con el enlace podrá usarlo, así que si hay abuso, quita permisos (por ejemplo `play,control`).

## ¿En qué canal publica el bot "Reproduciendo ahora"?
Cuando pones música desde el panel, el bot usa (en este orden): `PANEL_TEXT_CHANNEL` → el canal del reproductor actual → el canal de `/setup` → el canal de 24/7 → un canal cuyo nombre contenga música, music, comandos o bot. Para fijarlo, copia el ID del canal en Discord (Modo desarrollador → clic derecho en el canal → *Copiar ID*) y ponlo en `PANEL_TEXT_CHANNEL` en Heroku.
