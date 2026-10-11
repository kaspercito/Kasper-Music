# Modo local (sin Lavalink)

El bot ahora puede reproducir **dentro del propio proceso** usando `@discordjs/voice` + FFmpeg + yt-dlp.
Los comandos, botones, cola, filtros, 24/7, playlists y autoplay siguen siendo los mismos.

## 1. Instalar lo que necesita
- **FFmpeg** y **yt-dlp** en el PATH (o rutas en `.env`).
  - Windows: `winget install yt-dlp.yt-dlp Gyan.FFmpeg`
  - Ubuntu/Azure: `sudo apt install ffmpeg` y
    `sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp`
  - Docker: el `Dockerfile` ya los instala.
- Dependencias de Node: `bun install` (se agregaron `@discordjs/voice`, `opusscript`, `libsodium-wrappers`, `@snazzah/davey`).

## 2. Configurar `.env`
```env
PLAYER_BACKEND=local     # local | lavalink | auto (auto = Lavalink solo si defines NODES)
# NODES=...              # ya NO es obligatorio
# Opcionales:
# YTDLP_PATH=/ruta/a/yt-dlp
# FFMPEG_PATH=/ruta/a/ffmpeg
# YTDLP_COOKIES=/ruta/cookies.txt   # si YouTube bloquea la IP del servidor
# YTDLP_ARGS=--js-runtimes node     # args extra para yt-dlp
```
Para volver a Lavalink: `PLAYER_BACKEND=lavalink` y tus `NODES`.

## 3. Qué puede reproducir
- Texto → busca en YouTube (o SoundCloud si `SEARCH_ENGINE=soundcloud`; también `scsearch:texto`).
- Enlaces de YouTube, SoundCloud, Bandcamp, Twitch, Vimeo y cientos más (los que soporte yt-dlp).
- Playlists de YouTube/SoundCloud, archivos directos (.mp3, .ogg...), adjuntos de Discord (`/playlocal`) y radios (Icecast/Shoutcast).
- Spotify: solo enlaces de **canciones** (se busca "artista título" en YouTube).

## 4. Diferencias con Lavalink
- Playlists guardadas con Lavalink no se pueden cargar en modo local (formato distinto); las nuevas sí.
- Letras: sin plugin de Lavalink, `/lyrics` depende de Genius (`GENIUS_API`).
- Filtros: se aplican con FFmpeg y reinician el stream un instante.
- Si YouTube da error "Sign in to confirm you're not a bot": usa cookies (`YTDLP_COOKIES`) y mantén yt-dlp actualizado (`yt-dlp -U`).

## Heroku
1. Settings → Buildpacks → agrega `heroku-community/apt` y déjalo **primero** (instala FFmpeg desde `Aptfile`).
2. Config Vars: `PLAYER_BACKEND=local`.
3. El `Procfile` usa `bin/start.sh`, que descarga yt-dlp en cada arranque.
4. Si YouTube bloquea la IP: `YTDLP_COOKIES` con un cookies.txt de una cuenta secundaria.
