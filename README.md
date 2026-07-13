# Creator Research MCP

Servidor MCP (TypeScript) que trae datos de contenido — YouTube, TikTok, Instagram,
Twitter/X, LinkedIn, artículos, PDFs — para que el LLM cliente (ChatGPT, Claude) analice
qué contenido funciona, qué patrones se repiten y cómo convertir eso en cursos, guiones o
estrategia.

Compatible con **cualquier cliente MCP**: Claude Desktop / Claude Code (stdio),
ChatGPT y clientes remotos (Streamable HTTP).

## Modo único: client-reasoning

El servidor **trae datos, nunca analiza**. Cero IA propia, cero Ollama, cero worker.

```
list_videos(canal)          →  estadísticas + outlierScore + tags (yt-dlp o YouTube Data API)
get_transcript(url)         →  metadatos + subtítulos/caption (yt-dlp/FxTwitter/scraping)
get_comments(url)           →  comentarios públicos de YouTube
       ↓
El LLM cliente (ChatGPT/Claude) analiza el texto en la conversación
       ↓
save_analysis(url, facets)  →  queda persistido, consultable y comparable
```

Esto es intencional: existió en su momento un pipeline con worker + Ollama para analizar
en lote — se eliminó del repo por completo (ver [`docs/arquitectura.md`](docs/arquitectura.md)
para el diseño histórico). El servidor no necesita RAM/CPU/GPU para IA: solo trae datos.

## Instalación

**Requisitos**: Node ≥ 20, `yt-dlp` en el PATH (`brew install yt-dlp` / `apt install yt-dlp`).
Cada persona corre **su propia copia**, con **sus propias credenciales** — no hay ningún
servidor compartido ni datos que se centralicen en ningún lado.

### Opción 1 — npx (recomendada, sin clonar nada)

```json
{
  "mcpServers": {
    "creator-research": {
      "command": "npx",
      "args": ["-y", "creator-research-mcp"]
    }
  }
}
```

Pegá esto en la config de Claude Desktop/Code. La base de datos SQLite se crea sola en
`~/.creator-research/`. Todas las credenciales son opcionales (ver [`.env.example`](.env.example))
— si querés usar `YOUTUBE_API_KEY`, exportala antes de abrir el cliente MCP, o corré el modo
HTTP (abajo) que carga un `.env` automáticamente.

```bash
npx creator-research-mcp http   # modo HTTP :3333, para ChatGPT vía túnel
```

### Opción 2 — clonar el repo (para desarrollar o contribuir)

```bash
git clone https://github.com/CleanCod3Systems/creator-research-mcp.git
cd creator-research-mcp
pnpm install
cp .env.example .env   # completá tus credenciales (todas opcionales)
pnpm build
pnpm mcp:stdio        # stdio (Claude Desktop/Code, Cursor)
pnpm mcp:http         # HTTP :3333 (ChatGPT vía Cloudflare Tunnel)
```

El binario carga `.env` automáticamente al arrancar (con `dotenv`) — no hace falta exportar
nada a mano. `.env` nunca se sube al repo (gitignored); `.env.example` documenta cada variable.

### Conectar a Claude Desktop

`claude_desktop_config.json` (si clonaste el repo en vez de usar npx):

```json
{
  "mcpServers": {
    "creator-research": {
      "command": "pnpm",
      "args": ["--dir", "/ruta/al/repo", "mcp:stdio"]
    }
  }
}
```

Probá el tool `capabilities` — debe listar providers y limitaciones.

### Conectar a ChatGPT

Los conectores MCP de ChatGPT requieren **plan Plus/Pro** y un servidor remoto HTTPS:

```bash
# 1. Servidor HTTP con token de seguridad
MCP_AUTH_TOKEN=$(openssl rand -hex 16) pnpm mcp:http     # anotá el token

# 2. Túnel HTTPS gratis
brew install cloudflared
cloudflared tunnel --url http://localhost:3333
# → te da https://algo-random.trycloudflare.com
```

En ChatGPT: **Settings → Apps & Connectors → Advanced settings → Developer mode** →
_Create connector_ → URL: `https://algo-random.trycloudflare.com/mcp?key=TU_TOKEN`.

Notas: sin `MCP_AUTH_TOKEN` cualquiera con la URL usa tu servidor. La URL de trycloudflare
**cambia en cada ejecución** y Cloudflare puede matarla sin aviso; para una URL fija, usá un
tunnel con nombre (gratis con cuenta de Cloudflare) o Tailscale Funnel.

## YOUTUBE_API_KEY (opcional, gratis, recomendado)

Sin ella, `list_videos` funciona igual vía `yt-dlp` (vistas ok, sin likes exactos, a veces
con `null`). Con una key gratuita de la [YouTube Data API v3](https://console.cloud.google.com/apis/credentials):

- `list_videos` trae likes exactos, tags SEO reales y sin nulls (1 unidad de cuota por
  lote de 50 videos — la cuota gratis de 10.000/día alcanza de sobra)
- se habilita `get_trending_videos` (qué está en tendencia ahora en YouTube por región/categoría)

```bash
export YOUTUBE_API_KEY="tu-key-acá"
```

## Tools disponibles

| Tool                      | Qué hace                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `capabilities`            | Providers habilitados, límites honestos y si `YOUTUBE_API_KEY` está activa                                                                       |
| `list_videos`             | Videos de un canal (YouTube/TikTok) con vistas, duración, outlier (mediana+MAD, no solo promedio) y tags. Guarda un snapshot histórico por video |
| `get_transcript`          | Texto + metadatos + engagement de una o varias URLs (`urls`, hasta 15 en batch) — video/tweet/post/artículo/PDF, paginado con `offset`           |
| `get_comments`            | Comentarios públicos de YouTube/Instagram — para detectar FAQs, críticas y contenido pedido                                                      |
| `get_video_heatmap`       | El "most replayed" de un video de YouTube: qué segundos rebobina más la audiencia                                                                |
| `get_trending_videos`     | Trending oficial de YouTube por región/categoría (requiere `YOUTUBE_API_KEY`)                                                                    |
| `get_metrics_history`     | Snapshots históricos de una URL + crecimiento real (viewsPerDay, engagementPerView) entre el primero y el último — necesita ≥2 mediciones        |
| `import_profile_snapshot` | Registra a mano followers/posts/likes/comments de un perfil sin listado automático (ej. Instagram) — alimenta el mismo historial de arriba       |
| `analyze_creator`         | Estadísticas deterministas de un canal: mediana de vistas/duración, cadencia de publicación, keywords, performance por formato, outliers         |
| `compare_creators`        | Compara 2-10 canales lado a lado con las mismas estadísticas — tags compartidos vs únicos                                                        |
| `save_analysis`           | Persiste el análisis hecho por el LLM cliente sobre un `get_transcript`                                                                          |
| `get_analysis`            | Documento por `analysisId` o `url` — `format: markdown\|json\|text`                                                                              |
| `search_knowledge`        | Busca en todas las facetas acumuladas: "¿qué videos enseñan Astro?"                                                                              |
| `compare`                 | Matriz determinista entre 2-10 análisis: compartido / parcial / único por fuente                                                                 |
| `generate_course`         | Esqueleto de curso desde N análisis: dedup de temas, orden por nivel                                                                             |
| `generate_roadmap`        | Roadmap por niveles desde el corpus, con diagrama Mermaid                                                                                        |
| `history`                 | Análisis recientes con estado                                                                                                                    |

Flujo típico: _"traeme los videos con más vistas de @canal, el transcript de los 3 mejores
y armame un guión de reel"_ → `list_videos` → `get_transcript` × 3 → el LLM analiza y arma
el guión → opcionalmente `save_analysis` para consultarlo después.

Variables útiles: `YTDLP_EXTRA_ARGS` (p. ej. `--cookies-from-browser chrome` para Instagram
con rate-limit), `YOUTUBE_API_KEY`, `MCP_AUTH_TOKEN`, `DATABASE_PATH`.

## Providers y limitaciones honestas

| Fuente                                        | Estado                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| YouTube, artículos web, PDF, archivos locales | ✅ estable                                                                         |
| TikTok                                        | ✅ estable (yt-dlp)                                                                |
| Instagram, Twitter/X                          | ⚠️ fragile — best-effort, puede romperse si la plataforma cambia                   |
| LinkedIn                                      | ⚠️ fragile — solo posts/artículos públicos; con authwall no hay extracción posible |

- **Instagram**: no hay forma de listar un perfil completo — es una limitación de `yt-dlp`
  mismo (`instagram:user (CURRENTLY BROKEN)`, con o sin cookies), no de este servidor. Pasá
  URLs de posts/reels puntuales con `get_transcript` (acepta `urls` en batch), o registrá
  followers/likes/comments a mano con `import_profile_snapshot` si querés medir crecimiento
  en el tiempo. Nunca se extraen cookies del navegador ni se intenta saltear el login.
- **Twitter/X**: solo tweets públicos individuales (vía FxTwitter); perfiles y replies
  fuera de alcance.
- El tool `capabilities` expone todo esto en runtime para que el LLM cliente nunca
  prometa lo que el servidor no puede hacer.

## Publicar una nueva versión (mantenedor)

El workflow `.github/workflows/release.yml` ya hace todo: al pushear un tag `v*`, compila,
testea, y publica los 4 paquetes del workspace a npm (pnpm reemplaza `workspace:*` por las
versiones reales automáticamente).

```bash
# 1. bump de versión en los 4 package.json (core/db/providers/mcp-server) al mismo número
# 2. commit + push a main
git tag v0.1.0 && git push --tags
```

Requiere el secret `NPM_TOKEN` (Settings → Secrets → Actions del repo en GitHub) con un
[token de automation de npm](https://www.npmjs.com/settings/~/tokens). El workflow `ci.yml`
corre build/typecheck/lint/test en cada push/PR a `main`, sin necesidad de ningún secret.

## Arquitectura

- `packages/core` — dominio puro (Zod) + puertos (interfaces). Sin I/O.
- `packages/db` — Drizzle + SQLite (WAL).
- `packages/providers` — un adapter por plataforma (YouTube, TikTok, Instagram, Twitter, LinkedIn, web, PDF).
- `apps/mcp-server` — tools MCP activos. Dual transport (stdio/HTTP).

Detalle completo (histórico, documento de diseño original) en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Seguridad

- **`.env` nunca se sube al repo** (está en `.gitignore`). Contiene tu `MCP_AUTH_TOKEN` y
  `YOUTUBE_API_KEY` reales — cloná `.env.example` y completá tus propias credenciales, nunca
  compartas tu `.env` ni lo pegues en un issue/PR.
- **Generá `MCP_AUTH_TOKEN` con `openssl rand -hex 32`** (o más largo). La comparación en
  `http.ts` es en tiempo constante (`crypto.timingSafeEqual`) para no filtrar el token por
  timing. Si corrés el servidor sin este token, cualquiera con la URL del túnel puede usarlo
  — el propio servidor te avisa esto por stderr al arrancar.
- **`filePath` en `get_transcript`/`analyze` lee archivos del disco donde corre el servidor**
  (`.md`/`.txt`/audio/video), sin sandboxing por diseño (es la vía de fallback para contenido
  local). Si exponés el servidor en modo HTTP con un túnel público, **cualquier cliente MCP
  conectado puede pedir cualquier archivo con esas extensiones que el proceso pueda leer**. No
  corras esto en una máquina con archivos sensibles en `.md`/`.txt` accesibles al usuario del
  proceso, o restringí el acceso a nivel de red/túnel.
- **Sin llamados con `shell: true`**: toda invocación a `yt-dlp`/`ffmpeg` usa `execFile` con
  argumentos como array (no interpolación de string), lo que descarta inyección de comandos
  aunque una URL contenga metacaracteres de shell.
- **`data/*.db`** (SQLite) queda 100% local y gitignored — ahí se acumula tu historial real de
  búsquedas/análisis. No lo subas a ningún lado si contiene datos que preferís mantener privados.
- Antes de hacer público este repo: corré `git log -p -- .env` (si en algún momento hubo un
  commit con `.env` incluido) y, si aparece algo, seguí la guía de GitHub para purgar secretos
  del historial — borrar el archivo en un commit nuevo NO alcanza, queda en el historial.
