# CleanCod3 Intelligence portable

Paquete local, gratuito y compartible. Cada persona ejecuta su propia copia y conserva su propia SQLite.

## Inicio

Requisitos: Docker Desktop instalado y unos minutos para la primera descarga de imágenes y del modelo Whisper.

Si ya tienes n8n/MCP/bridge ejecutándose fuera de Docker en los puertos 5678, 3333 o 3334, detenlos antes del primer `start` para evitar conflicto de puertos.

```bash
./cleancod3 start
```

Abrir:

- Dashboard: http://localhost:8080
- n8n: http://localhost:5678
- MCP: http://localhost:3333/mcp
- API: http://localhost:3333/api

El primer inicio crea `.env` y genera secretos locales. En n8n hay que abrir las credenciales y conectar Gemini si se desea usar el modelo. El workflow se importa automáticamente una sola vez.

## Flujo

```text
Dashboard → n8n → bridge → MCP creator-research → SQLite → dashboard
```

SQLite guarda creadores, perfiles, contenidos, descripción, audio transcrito, comentarios, métricas, evidencias, briefs, feedback y aprendizajes. Google Sheets no participa en el flujo. NotebookLM es opcional y solo puede leer documentos curados de Drive; no es la base ni “entrena” el sistema.

El bridge usa `yt-dlp`, `ffmpeg` y `faster-whisper` localmente. El modelo se conserva en un volumen Docker para no descargarlo cada vez.

## Comandos

```bash
./cleancod3 start
./cleancod3 stop
./cleancod3 status
./cleancod3 backup
./cleancod3 restore backups/cleancod3-YYYYMMDD-HHMMSS.tgz
./cleancod3 reset --yes
```

`backup` crea un archivo local en `backups/` con SQLite y `.env`. No compartir ese archivo: contiene datos y secretos personales. El paquete distribuible no incluye `data/`, `backups/`, credenciales, cookies ni tokens.

## Conectar cualquier LLM por MCP

- Claude Desktop/Code: usar el transporte `stdio` con una instalación local del paquete.
- ChatGPT: usar el endpoint remoto `/mcp` únicamente mediante un túnel HTTPS propio y el token de `.env`.
- Gemini u otro cliente compatible: usar MCP estándar; la URL local es `http://localhost:3333/mcp`.

No se expone ningún puerto a Internet: Docker publica solo en `127.0.0.1`. Para acceso remoto, cada usuario debe configurar su propio túnel y conservar `MCP_AUTH_TOKEN`.

## Variables

Ver `.env.example`. Las principales son `GEMINI_API_KEY`, `MCP_AUTH_TOKEN`, `YOUTUBE_API_KEY`, `WHISPER_MODEL`, `DATABASE_PATH` y `N8N_ENCRYPTION_KEY`. Las API keys son opcionales; el fallback local mantiene el mínimo de 10 briefs cuando hay evidencia suficiente.

## Compartir

Compartir el código, `docker-compose.yml`, `dashboard/`, `docker/`, `n8n/`, `scripts/`, `config/`, `.env.example` y `data/.gitkeep`.

No compartir `.env`, `data/`, `backups/`, volúmenes Docker, cookies, URLs privadas ni bases personales.
