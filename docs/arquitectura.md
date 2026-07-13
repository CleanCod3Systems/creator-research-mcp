# Creator Research MCP — Documento de Arquitectura

**Versión:** 1.0 · **Fase:** Diseño (pre-código) · **Autor:** Arquitectura asistida · **Fecha:** 2026-07-12

---

## 0. Restricciones de realidad técnica (leer primero)

Este proyecto exige "solo herramientas gratuitas". La tabla siguiente separa lo posible, lo posible-con-condiciones y lo imposible. Todo el resto del documento está diseñado sobre estas restricciones — no sobre capacidades inventadas.

| Fuente / capacidad                           | Estado          | Detalle                                                                                                                                                         | Alternativa gratuita                                                                                                      |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| YouTube (video, subs, metadatos)             | ✅ Viable       | `yt-dlp` extrae metadatos, subtítulos auto/manuales, audio. Estable.                                                                                            | —                                                                                                                         |
| YouTube (comentarios)                        | ⚠️ Condicionado | `youtube-comment-downloader` (sin key, frágil) o YouTube Data API v3 (gratis, cuota 10k unidades/día, **requiere API key de Google**).                          | Ambas; la API es la recomendada.                                                                                          |
| YouTube (canal completo)                     | ✅ Viable       | `yt-dlp --flat-playlist` lista todo el canal sin descargar.                                                                                                     | —                                                                                                                         |
| Instagram Reels                              | ⚠️ Frágil       | Sin API pública gratuita. `yt-dlp`/`instaloader` funcionan para contenido público **con cookies de sesión**, se rompen seguido, riesgo ToS y bloqueo de cuenta. | Best-effort + **fallback a archivo local** (descargás el reel manualmente y lo subís como MP4).                           |
| TikTok                                       | ⚠️ Frágil       | `yt-dlp` descarga videos públicos razonablemente bien. Comentarios: solo APIs no oficiales inestables.                                                          | Video: yt-dlp best-effort. Comentarios: fuera de alcance v1.                                                              |
| Vimeo                                        | ✅ Viable       | `yt-dlp` soporta videos públicos. Privados/protegidos: no.                                                                                                      | Fallback archivo local.                                                                                                   |
| Twitter/X                                    | ⚠️ Parcial      | Video público descargable con `yt-dlp`. **Replies/threads requieren API paga.** Scraping con Playwright es posible pero frágil y contra ToS.                    | Solo video + texto del tweet. Replies fuera de alcance v1.                                                                |
| LinkedIn videos                              | ❌ No viable    | Cerrado tras login, anti-bot agresivo, sin extractor confiable.                                                                                                 | **Fallback obligatorio a archivo local.**                                                                                 |
| Páginas web / blogs / docs                   | ✅ Viable       | `trafilatura` (estático) + Playwright (JS-rendered).                                                                                                            | —                                                                                                                         |
| PDFs                                         | ✅ Viable       | `pypdf` / `pdfplumber` + OCR con `tesseract`/`PaddleOCR` para escaneados.                                                                                       | —                                                                                                                         |
| MP4 / archivos locales                       | ✅ Viable       | FFmpeg + Whisper local.                                                                                                                                         | —                                                                                                                         |
| Cursos en plataformas pagas (Udemy, Platzi…) | ❌ No viable    | Paywall + DRM. Extraerlos viola ToS y potencialmente ley.                                                                                                       | Solo cursos públicos (playlists YouTube) o material que el usuario posea y suba como archivo.                             |
| Transcripción                                | ✅ Viable       | `faster-whisper` local (CPU viable con modelo `small`/`medium`; GPU acelera).                                                                                   | —                                                                                                                         |
| OCR de frames                                | ✅ Viable       | FFmpeg (extracción de keyframes) + Tesseract o PaddleOCR.                                                                                                       | —                                                                                                                         |
| IA: OpenAI / Claude / DeepSeek               | 💰 Pago         | Son APIs pagas. Se implementan como adapters **opcionales**.                                                                                                    | **Ollama local** (llama3.1, qwen2.5, deepseek-r1 destilado) = camino 100% gratis. Gemini tiene free tier con rate limits. |
| MCP en Claude Desktop / Claude Code          | ✅ Viable       | stdio local, gratis.                                                                                                                                            | —                                                                                                                         |
| MCP en ChatGPT                               | ⚠️ Condicionado | Requiere conector remoto HTTPS (Streamable HTTP) y **plan ChatGPT Plus/Pro** con developer mode. El servidor sí puede exponerse gratis con Cloudflare Tunnel.   | Dual transport: stdio + HTTP.                                                                                             |
| Hosting DB                                   | ✅ Viable       | SQLite (default, cero infra) → PostgreSQL/Neon free tier si escala.                                                                                             | —                                                                                                                         |

**Principio de diseño derivado:** cada provider declara su nivel de confiabilidad (`stable | fragile | manual-only`) y el sistema degrada explícitamente: si la extracción automática falla, el tool responde con instrucciones de fallback (subir archivo), nunca con datos inventados.

---

## 1. Análisis del problema

### 1.1 Problema real

El contenido educativo técnico está fragmentado en formatos no consultables (video, audio, threads, PDFs). Un investigador de contenido (caso de uso primario: diseñar cursos propios evitando redundancia con creadores existentes) necesita:

1. **Ingesta**: convertir cualquier URL/archivo en texto + metadatos estructurados.
2. **Extracción**: destilar conocimiento tipificado (tecnologías, prácticas, arquitectura, temario…).
3. **Síntesis**: cruzar múltiples fuentes (comparar creadores, generar roadmaps, ensamblar cursos).
4. **Persistencia**: no reprocesar, poder consultar histórico, construir un grafo de conocimiento incremental.

### 1.2 Por qué un MCP y no un script

- El análisis es conversacional e iterativo: "analiza X" → "ahora compara con Y" → "genera roadmap". MCP da esa interfaz desde Claude/ChatGPT sin construir UI.
- El LLM del cliente (Claude/ChatGPT) puede razonar sobre los resultados; el servidor solo necesita entregar conocimiento estructurado y confiable.
- Separación limpia: **pipeline determinista** (descarga, transcripción, OCR) vive en el servidor; **razonamiento** puede vivir en el cliente o en el motor de IA configurado.

### 1.3 Tensión central del diseño

El pipeline (descargar + transcribir un video de 30 min) tarda **minutos**, pero MCP es request/response con timeouts cortos. La arquitectura resuelve esto con un **modelo de jobs asíncronos**: los tools de análisis encolan trabajo y devuelven `job_id`; tools de consulta (`get_analysis`, `history`) devuelven resultados cuando están listos. Es la decisión arquitectónica más importante del proyecto.

### 1.4 Fuera de alcance (v1)

- Contenido tras login/paywall (LinkedIn, cursos pagos, Instagram privado).
- Replies de Twitter/X y comentarios de TikTok.
- UI web propia (el cliente MCP es la UI).
- Análisis de video visual con modelos multimodales pesados (solo OCR de frames en v1).

---

## 2. Casos de uso

| ID    | Actor   | Caso de uso                         | Flujo resumido                                                                                      |
| ----- | ------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| UC-01 | Usuario | Analizar un video por URL           | URL → detección de provider → job de pipeline → análisis completo persistido                        |
| UC-02 | Usuario | Analizar un archivo local (MP4/PDF) | Ruta/upload → mismo pipeline sin etapa de descarga                                                  |
| UC-03 | Usuario | Analizar un canal/creador           | Listar videos (flat) → seleccionar N más relevantes → analizar en lote → perfil de creador agregado |
| UC-04 | Usuario | Extraer faceta específica           | Sobre un análisis existente: conclusiones, tecnologías, código, prácticas, glosario, preguntas…     |
| UC-05 | Usuario | Comparar 2–10 entidades             | Cargar análisis existentes → matriz comparativa por dimensiones → veredicto estructurado            |
| UC-06 | Usuario | Generar roadmap                     | Desde uno o varios análisis + dominio objetivo → grafo de prerequisitos → roadmap ordenado          |
| UC-07 | Usuario | Generar curso desde N videos        | Dedup semántico → orden por prerequisitos → módulos/capítulos/ejercicios/proyecto                   |
| UC-08 | Usuario | Analizar comentarios                | Descargar comentarios (YouTube) → clustering → FAQs, errores comunes, críticas, gaps                |
| UC-09 | Usuario | Consultar histórico                 | Buscar análisis previos por creador, tecnología, fecha, keyword                                     |
| UC-10 | Usuario | Detectar contenido redundante       | Antes de crear su curso: "¿quién ya enseña X y con qué profundidad?"                                |
| UC-11 | Sistema | Cache hit                           | URL ya analizada (hash) y dentro de TTL → devolver resultado sin reprocesar                         |
| UC-12 | Sistema | Degradación por provider frágil     | Instagram falla → respuesta con causa + instrucciones de fallback manual                            |
| UC-13 | Admin   | Cambiar motor de IA                 | Editar config → siguiente análisis usa Ollama/Gemini/etc. sin tocar código                          |
| UC-14 | Admin   | Agregar nuevo provider              | Nuevo paquete que implementa la interfaz `ContentProvider` → registro por config                    |

---

## 3. Requerimientos funcionales

**RF-01 Ingesta multi-fuente.** Aceptar URLs de YouTube, Vimeo, TikTok, Instagram, Twitter/X, páginas web, blogs, documentación y archivos locales (MP4, MP3, PDF, MD, TXT). LinkedIn: solo vía archivo local (ver §0).

**RF-02 Detección automática.** Clasificar la entrada (provider + tipo de contenido: video, canal, playlist, artículo, PDF, archivo) sin intervención del usuario, por patrón de URL y MIME/extension.

**RF-03 Pipeline de extracción.** Para video: metadatos → subtítulos oficiales → (si no hay) transcripción Whisper → keyframes → OCR → detección de código en pantalla → comentarios (si el provider lo permite). Para texto/PDF: extracción de texto → estructura → código embebido.

**RF-04 Análisis estructurado.** Producir un `AnalysisDocument` con facetas tipadas: resumen, conclusiones, tecnologías, frameworks, herramientas, código, buenas/malas prácticas, errores, arquitectura, nivel, temario, preguntas, conceptos, keywords, glosario.

**RF-05 Comparación.** Comparar 2–10 entidades (videos, canales, creadores, cursos, tecnologías) sobre dimensiones configurables, con matriz + síntesis.

**RF-06 Roadmaps.** Generar roadmaps de aprendizaje (frontend, backend, IA, DevOps, personalizado) desde análisis existentes, con grafo de prerequisitos.

**RF-07 Cursos.** Ensamblar N análisis en un curso: dedup semántico, orden por prerequisitos, módulos, capítulos, ejercicios, proyecto final.

**RF-08 Comentarios.** Analizar comentarios públicos (YouTube v1): FAQs, errores comunes, críticas, contenido faltante.

**RF-09 Multi-formato de salida.** Todo resultado disponible en JSON (canónico), Markdown (render) y texto plano (derivado).

**RF-10 Persistencia.** Guardar fuentes, creadores, canales, análisis, transcripciones, extracciones, comparaciones, cursos, roadmaps e historial.

**RF-11 Cache por hash.** No reprocesar contenido idéntico dentro del TTL configurado; invalidación por versión de pipeline.

**RF-12 Multi-motor de IA.** Interfaz común sobre Ollama (default gratuito), Gemini (free tier), OpenAI, Anthropic, DeepSeek (opcionales pagos), con fallback en cadena.

**RF-13 Jobs asíncronos.** Análisis largos se encolan; el usuario consulta estado y resultado (`job_status`, `get_analysis`).

**RF-14 Configuración externa.** Todo (motores, TTLs, rutas, providers habilitados, modelos, límites) en archivos de config + env vars. Cero hardcode.

**RF-15 Transparencia de capacidades.** Cada tool declara y comunica limitaciones del provider; ante fallo, respuesta explícita con alternativa (nunca inventar datos).

---

## 4. Requerimientos no funcionales

| Categoría          | Requerimiento                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arquitectura**   | Hexagonal (ports & adapters) + vertical slices por dominio. SOLID. DI por contenedor liviano.                                                                                      |
| **Modularidad**    | Providers, motores de IA y stages del pipeline como plugins registrables por config, sin tocar el core.                                                                            |
| **Rendimiento**    | Cache hit < 500 ms. Análisis de video de 20 min con subtítulos existentes < 2 min. Con Whisper `small` en CPU: aceptar 0.5–1× duración del audio.                                  |
| **Concurrencia**   | Worker pool configurable; máximo N descargas simultáneas por provider (rate limiting cortés).                                                                                      |
| **Confiabilidad**  | Jobs idempotentes y reanudables por stage (checkpoint tras cada etapa). Reintentos con backoff exponencial.                                                                        |
| **Observabilidad** | Logging estructurado (JSON) con `structlog`, métricas por stage (duración, éxito/fallo), trazas por `job_id`.                                                                      |
| **Portabilidad**   | Docker Compose para todo el stack. Sin dependencias de SO. Funciona offline (Ollama + SQLite).                                                                                     |
| **Calidad**        | Type hints estrictos (mypy strict), Ruff (lint+format), pytest con cobertura ≥ 80% en core, pre-commit, CI en GitHub Actions.                                                      |
| **Seguridad**      | Sin ejecución de código extraído. Sanitización de paths. Secrets solo por env. El transcript/comentarios se tratan como **datos no confiables** (nunca como instrucciones al LLM). |
| **Legalidad**      | Respetar robots.txt en scraping web genérico; providers frágiles claramente marcados; sin bypass de DRM/paywalls.                                                                  |
| **Costos**         | Camino default 100% gratuito y local. Servicios cloud (Neon, Gemini) opcionales y con free tier.                                                                                   |

---

## 5. Arquitectura completa

### 5.1 Decisión de stack

**Un solo lenguaje: Python 3.12.** Motivos: yt-dlp, faster-whisper, trafilatura, pdfplumber, PaddleOCR y el SDK oficial de MCP (FastMCP) son Python-nativos. Sumar Node/TypeScript duplicaría tooling sin aportar capacidades. TypeScript queda reservado para una eventual UI futura (§20).

| Capa                           | Elección                                                                                   | Alternativa contemplada               |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| MCP server                     | SDK oficial `mcp` (FastMCP), dual transport stdio + Streamable HTTP                        | —                                     |
| API interna / health           | FastAPI (mismo proceso del transporte HTTP)                                                | —                                     |
| Jobs                           | **v1:** cola en SQLite + worker asyncio (cero infra). **v2:** Redis + `arq` si escala.     | Celery (descartado: pesado para esto) |
| DB                             | **v1:** SQLite + SQLAlchemy 2 (async) + Alembic. **v2:** PostgreSQL/Neon con el mismo ORM. | —                                     |
| Embeddings (dedup/similaridad) | `sentence-transformers` local (all-MiniLM) + sqlite-vec                                    | pgvector en v2                        |
| Transcripción                  | faster-whisper                                                                             | whisper.cpp                           |
| Scraping dinámico              | Playwright                                                                                 | Puppeteer (descartado: Node)          |
| Contenedores                   | Docker + Compose (perfiles: `core`, `ollama`, `redis`)                                     | —                                     |

### 5.2 Estilo arquitectónico

**Hexagonal + pipeline de stages.**

```
                        ┌────────────────────────────────────────┐
   Claude Desktop ──────┤  ADAPTADORES DE ENTRADA                │
   Claude Code    stdio │  mcp/server.py (tools MCP)             │
   ChatGPT ── HTTPS ────┤  api/ (FastAPI: health, webhooks)      │
   (Cloudflare Tunnel)  └───────────────┬────────────────────────┘
                                        │ llama a
                        ┌───────────────▼────────────────────────┐
                        │  CAPA DE APLICACIÓN (use cases)        │
                        │  AnalyzeContent, CompareEntities,      │
                        │  GenerateCourse, GenerateRoadmap,      │
                        │  QueryHistory, ManageJobs              │
                        └───────────────┬────────────────────────┘
                                        │ usa puertos (interfaces)
        ┌───────────────────────────────▼───────────────────────────────┐
        │  DOMINIO (entidades + servicios puros, sin I/O)               │
        │  ContentItem · Analysis · Creator · Course · Roadmap ·        │
        │  Comparison · KnowledgeFacet · PrerequisiteGraph              │
        └───────────────────────────────┬───────────────────────────────┘
                                        │ implementados por
   ┌────────────────────────────────────▼─────────────────────────────────┐
   │  ADAPTADORES DE SALIDA (plugins)                                     │
   │  providers/ (youtube, tiktok, instagram, web, pdf, localfile…)       │
   │  transcriber/ (faster-whisper)   ocr/ (tesseract, paddle)            │
   │  ai/ (ollama, gemini, openai, anthropic, deepseek)                   │
   │  storage/ (sqlite, postgres)     cache/ (memory, sqlite, redis)      │
   │  queue/ (sqlite-queue, arq)      export/ (markdown, json, text)      │
   └──────────────────────────────────────────────────────────────────────┘
```

### 5.3 Modelo de ejecución

Dos procesos (o dos tareas asyncio en dev):

1. **Server**: expone tools MCP. Los tools "pesados" solo validan, resuelven cache, y encolan → responden en < 1 s con `job_id` o con el resultado cacheado.
2. **Worker**: consume la cola, ejecuta el pipeline stage a stage, persiste checkpoints, emite eventos de progreso (consultables vía `job_status`).

### 5.4 Contrato central: `AnalysisDocument`

Todo converge en un único documento canónico versionado (`schema_version`), JSON-first. Markdown y texto son **proyecciones** generadas por `export/`, nunca la fuente de verdad. Esto garantiza RF-09 sin duplicar lógica.

---

## 6. Árbol de carpetas

```
creator-research-mcp/
├── pyproject.toml                  # deps, ruff, mypy strict, pytest
├── docker-compose.yml              # perfiles: core | ollama | redis | postgres
├── Dockerfile
├── .github/workflows/ci.yml        # lint + typecheck + tests + build
├── config/
│   ├── default.yaml                # config base (todo lo configurable vive acá)
│   ├── providers.yaml              # providers habilitados + confiabilidad + límites
│   ├── ai.yaml                     # motores, modelos, orden de fallback, prompts refs
│   └── prompts/                    # prompts versionados por faceta (jinja2)
│       ├── summary.md.j2
│       ├── technologies.md.j2
│       └── ...
├── src/creator_research/
│   ├── domain/                     # PURO: sin I/O, sin frameworks
│   │   ├── entities/               # ContentItem, Analysis, Creator, Course, Roadmap...
│   │   ├── value_objects/          # SourceURL, ContentHash, Facet, SkillLevel...
│   │   ├── services/               # PrerequisiteGraph, DedupService (lógica pura)
│   │   └── errors.py
│   ├── application/                # casos de uso (orquestación)
│   │   ├── analyze_content.py
│   │   ├── analyze_channel.py
│   │   ├── compare_entities.py
│   │   ├── generate_course.py
│   │   ├── generate_roadmap.py
│   │   ├── analyze_comments.py
│   │   ├── query_history.py
│   │   └── ports/                  # interfaces (Protocols): ContentProvider,
│   │       │                       #   Transcriber, OCREngine, AIEngine,
│   │       │                       #   Repository, Cache, JobQueue, Exporter
│   ├── pipeline/                   # motor de stages
│   │   ├── engine.py               # ejecuta DAG de stages con checkpoints
│   │   ├── context.py              # PipelineContext (estado entre stages)
│   │   └── stages/                 # detect, fetch_metadata, fetch_subtitles,
│   │                               #   download_audio, transcribe, extract_frames,
│   │                               #   ocr, fetch_comments, ai_analysis, persist
│   ├── providers/                  # un paquete por fuente (plugin)
│   │   ├── base.py                 # ContentProvider ABC + ProviderCapabilities
│   │   ├── registry.py             # descubrimiento por entry-points + config
│   │   ├── youtube/
│   │   ├── vimeo/
│   │   ├── tiktok/                 # reliability: fragile
│   │   ├── instagram/              # reliability: fragile
│   │   ├── twitter/                # reliability: fragile (solo video+texto)
│   │   ├── web/                    # trafilatura + playwright fallback
│   │   ├── pdf/
│   │   └── localfile/              # MP4/MP3/PDF/MD subidos — fallback universal
│   ├── transcriber/                # faster_whisper adapter
│   ├── ocr/                        # tesseract / paddle adapters
│   ├── ai/
│   │   ├── base.py                 # AIEngine Protocol + tipos comunes
│   │   ├── router.py               # selección + fallback + presupuesto de tokens
│   │   ├── ollama.py  gemini.py  openai.py  anthropic.py  deepseek.py
│   │   └── extraction/             # extractores por faceta (usan prompts/)
│   ├── comparison/                 # motor de comparación
│   ├── course_generator/           # dedup, orden, módulos, ejercicios
│   ├── roadmap/                    # grafo de prerequisitos → roadmap
│   ├── storage/
│   │   ├── models.py               # SQLAlchemy
│   │   ├── repositories/           # implementación de ports.Repository
│   │   └── migrations/             # Alembic
│   ├── cache/                      # memory + sqlite + redis adapters
│   ├── queue/                      # sqlite-queue + arq adapters, worker.py
│   ├── export/                     # json.py, markdown.py, text.py
│   ├── mcp/
│   │   ├── server.py               # FastMCP: registro de tools
│   │   ├── tools/                  # un módulo por grupo de tools
│   │   └── schemas.py              # pydantic: inputs/outputs de tools
│   ├── config.py                   # pydantic-settings (yaml + env)
│   ├── container.py                # DI: construye e inyecta adapters según config
│   └── observability/              # structlog setup, métricas, timers
└── tests/
    ├── unit/                       # dominio y servicios puros
    ├── integration/                # pipeline con fixtures (videos cortos CC)
    └── contract/                   # cada provider contra su interfaz
```

---

## 7. Diagrama de módulos

```
                              ┌─────────────┐
                              │   mcp/      │  (tools = fachada)
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
              ┌───────────────│ application │───────────────┐
              │               └──────┬──────┘               │
              │                      │ puertos               │
      ┌───────▼───────┐       ┌──────▼──────┐        ┌──────▼──────┐
      │   pipeline/   │       │   domain/   │        │  queue/     │
      │ (stages DAG)  │       │ (puro)      │        │ (jobs)      │
      └───┬───┬───┬───┘       └─────────────┘        └─────────────┘
          │   │   │
  ┌───────▼┐ ┌▼──────────┐ ┌▼─────┐     ┌──────────┐  ┌─────────┐
  │providers│ │transcriber│ │ ocr/ │     │   ai/    │  │ storage/│
  │registry │ │ (whisper) │ │      │     │ router + │  │  cache/ │
  └─────────┘ └───────────┘ └──────┘     │ engines  │  │ export/ │
                                         └──────────┘  └─────────┘

Reglas de dependencia (enforced por import-linter en CI):
  domain      → (nada)
  application → domain
  pipeline    → application.ports, domain
  adapters    → application.ports, domain
  mcp         → application
  PROHIBIDO: domain → cualquier adapter; provider → provider
```

---

## 8. Flujo completo del procesamiento

### 8.1 Flujo de `analyze(url)` — caso video YouTube

```
Usuario (Claude/ChatGPT)
   │  analyze(url="https://youtube.com/watch?v=X", depth="full")
   ▼
[MCP tool]
   1. Canonicalizar URL (quitar tracking params, normalizar)
   2. content_hash = sha256(url_canónica + pipeline_version + depth)
   3. ¿Cache hit vigente? ──sí──► devolver analysis_id + resumen (fin, <500ms)
   4. No → detectar provider (youtube) + tipo (video)
   5. Validar capacidades del provider vs depth pedido
   6. Encolar job → devolver { job_id, eta_estimada, status: queued }
   ▼
[Worker — pipeline por stages, checkpoint tras cada una]
   S1  fetch_metadata      yt-dlp --dump-json (título, canal, duración, fecha, tags)
   S2  fetch_subtitles     yt-dlp subs manuales > automáticos
   S3  download_audio      SOLO si S2 falló → yt-dlp audio-only + ffmpeg → wav 16k
   S4  transcribe          SOLO si S3 corrió → faster-whisper (modelo por config)
   S5  extract_frames      ffmpeg keyframes cada N seg (config) si depth=full
   S6  ocr                 tesseract sobre frames → texto en pantalla + código
   S7  fetch_comments      youtube-comment-downloader / Data API (si habilitado)
   S8  ai_analysis         ai.router → extractores por faceta (§13) sobre
                           transcript + ocr + metadatos + comentarios
   S9  embed               embeddings del análisis (para dedup/similaridad futura)
   S10 persist             AnalysisDocument → DB; cache set; job done
   ▼
Usuario: job_status(job_id) → done → get_analysis(analysis_id, format="markdown")
```

### 8.2 Bifurcaciones por tipo

- **Artículo/blog/doc**: S1 → extracción trafilatura (→ Playwright si vacío) → S8 → S10.
- **PDF**: texto nativo → si páginas sin texto → rasterizar + OCR → S8 → S10.
- **Archivo local MP4**: entra en S3 (sin descarga) → resto igual.
- **Canal**: flat-list → ranking por vistas/recencia → N jobs `analyze` hijos → job agregador construye `CreatorProfile`.

### 8.3 Manejo de fallos

Cada stage declara `required | optional`. Fallo en optional (ej. comentarios) → se registra warning y continúa. Fallo en required (ej. Instagram bloqueó descarga) → job termina en `failed_with_guidance` con mensaje accionable: _"Instagram bloqueó la extracción automática (limitación conocida, ver capacidades). Descargá el reel y usá analyze con file_path."_

---

## 9. Diseño de base de datos

SQLite v1 / PostgreSQL v2 — mismo esquema vía SQLAlchemy + Alembic. JSON en columnas `JSON` (SQLite las soporta; en PG serán `JSONB`).

```
creators
  id PK · name · handle · platform · url · bio · metrics JSON
  first_seen_at · updated_at
  UNIQUE(platform, handle)

channels                                  -- un creador puede tener varios canales
  id PK · creator_id FK · platform · external_id · title · url
  stats JSON (subs, videos, views) · UNIQUE(platform, external_id)

content_items                             -- unidad universal de contenido
  id PK · channel_id FK NULL · creator_id FK NULL
  source_type ENUM(video, short, article, pdf, file, tweet, course_unit)
  provider TEXT · url TEXT NULL · file_path TEXT NULL
  canonical_url TEXT · content_hash TEXT UNIQUE   -- clave de cache/idempotencia
  title · description · duration_sec · published_at · language
  raw_metadata JSON · created_at

transcripts
  id PK · content_item_id FK · source ENUM(subtitles_manual, subtitles_auto,
  whisper, native_text) · language · text TEXT
  segments JSON        -- [{start, end, text}] para citar timestamps
  whisper_model TEXT NULL · created_at

ocr_results
  id PK · content_item_id FK · frame_second REAL · text TEXT · is_code BOOL

comments
  id PK · content_item_id FK · author · text · likes · replied_to NULL
  posted_at · raw JSON

analyses                                  -- documento canónico
  id PK · content_item_id FK · schema_version · pipeline_version
  depth ENUM(quick, standard, full)
  ai_engine TEXT · ai_model TEXT
  document JSON        -- AnalysisDocument completo (facetas tipadas)
  status ENUM(queued, running, done, failed, failed_with_guidance)
  error TEXT NULL · started_at · finished_at · created_at
  INDEX(content_item_id, pipeline_version)

facets                                    -- extracciones desnormalizadas p/ búsqueda
  id PK · analysis_id FK
  kind ENUM(technology, framework, tool, conclusion, best_practice,
            bad_practice, error, concept, keyword, question, glossary_term,
            architecture_note, curriculum_item)
  value TEXT · detail JSON · confidence REAL
  INDEX(kind, value)                      -- "¿quién enseña Astro?" en 1 query

embeddings
  id PK · owner_type ENUM(analysis, content_item) · owner_id
  model TEXT · vector BLOB               -- sqlite-vec / pgvector

comparisons
  id PK · kind ENUM(creators, videos, channels, technologies, courses)
  subject_ids JSON · dimensions JSON · result JSON (matriz + síntesis)
  ai_engine · created_at

courses
  id PK · title · source_analysis_ids JSON · level
  structure JSON       -- módulos → capítulos → lecciones → ejercicios → proyecto
  created_at

roadmaps
  id PK · domain TEXT · source_analysis_ids JSON
  graph JSON           -- nodos (temas) + aristas (prerequisitos)
  rendered JSON        -- versión ordenada por niveles
  created_at

jobs
  id PK · type · payload JSON · status · progress JSON (stage actual, %)
  checkpoints JSON     -- resultados intermedios por stage (reanudación)
  attempts INT · last_error · created_at · updated_at

cache_entries
  key TEXT PK          -- content_hash
  analysis_id FK · pipeline_version · expires_at
```

**Decisiones clave:** (a) `facets` desnormalizada habilita las consultas de UC-10 sin parsear JSON; (b) `checkpoints` en `jobs` hace el pipeline reanudable; (c) `content_hash` unifica cache + idempotencia + dedup de ingesta.

---

## 10. Diseño de cada Tool MCP

**Decisión de diseño:** el brief lista ~30 tools. Exponer 30 tools degrada la selección de tools del LLM cliente (contexto, ambigüedad). Se exponen **12 tools** bien descritos que cubren el 100% de la lista original; las 20 variantes `extract_*` colapsan en un solo tool parametrizado por faceta. Mapeo completo al final de la sección.

Todos los outputs incluyen `format: json | markdown | text` (default markdown para lectura, json para encadenar).

| #   | Tool               | Input (resumen)                                                                                                                                                                                                                          | Output                                                                                                          | Sync/Async          |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | `analyze`          | `url` XOR `file_path`; `depth: quick\|standard\|full`; `force_refresh: bool`                                                                                                                                                             | cache hit → `analysis_id` + resumen · miss → `job_id` + eta                                                     | Async               |
| 2   | `analyze_channel`  | `url`; `max_videos` (default 10); `strategy: top\|recent\|mixed`                                                                                                                                                                         | `job_id` (job agregador)                                                                                        | Async               |
| 3   | `job_status`       | `job_id`                                                                                                                                                                                                                                 | estado, stage actual, %, errores, `analysis_id` si terminó                                                      | Sync                |
| 4   | `get_analysis`     | `analysis_id` XOR `url`; `sections?: []`; `format`                                                                                                                                                                                       | AnalysisDocument (completo o secciones)                                                                         | Sync                |
| 5   | `extract`          | `analysis_id`; `facets: [conclusions\|technologies\|frameworks\|tools\|code\|best_practices\|bad_practices\|errors\|architecture\|roadmap_hints\|level\|curriculum\|questions\|concepts\|keywords\|glossary\|examples\|steps]`; `format` | facetas pedidas (de DB si existen; recomputa si `refresh`)                                                      | Sync*               |
| 6   | `compare`          | `kind`; `subject_ids: [2..10]`; `dimensions?: []`; `format`                                                                                                                                                                              | matriz comparativa + síntesis + veredicto                                                                       | Async si >3 sujetos |
| 7   | `generate_course`  | `analysis_ids: []` XOR `channel_id`; `target_level`; `focus?`                                                                                                                                                                            | `job_id` → Course (módulos/capítulos/ejercicios/proyecto)                                                       | Async               |
| 8   | `generate_roadmap` | `domain: frontend\|backend\|ai\|devops\|custom`; `analysis_ids?`; `custom_goal?`                                                                                                                                                         | Roadmap (grafo + orden)                                                                                         | Async               |
| 9   | `analyze_comments` | `analysis_id` o `url`                                                                                                                                                                                                                    | FAQs, errores comunes, críticas, gaps                                                                           | Async               |
| 10  | `search_knowledge` | `query`; filtros: `kind?`, `creator?`, `technology?`, `date_range?`                                                                                                                                                                      | resultados de `facets` + análisis (incluye `find_similar_creators` vía embeddings con `mode: similar_creators`) | Sync                |
| 11  | `history`          | `limit`, `type?`, `since?`                                                                                                                                                                                                               | listado de análisis/comparaciones/cursos previos                                                                | Sync                |
| 12  | `capabilities`     | —                                                                                                                                                                                                                                        | providers habilitados, confiabilidad, motores IA activos, límites conocidos (§0)                                | Sync                |

*`extract` es sync si las facetas ya existen; si requiere recomputar con IA, devuelve `job_id`.

**Mapeo brief → tools:** `analyze_video/analyze_pdf/analyze_article/analyze_creator` → `analyze` (detección automática) · todos los `extract_*` → `extract(facets=[…])` · `compare_creators/videos` → `compare(kind=…)` · `generate_learning_path/curriculum` → `generate_roadmap`/`generate_course` · `generate_markdown/json` → parámetro `format` universal · `search_related_content/find_similar_creators` → `search_knowledge` · `save_analysis` → implícito (todo se persiste) · `history` → `history`.

**Esquemas:** todos los inputs/outputs con Pydantic → JSON Schema publicado en el tool (MCP `inputSchema`). Errores siempre estructurados: `{error_code, message, guidance, retriable}`.

---

## 11. Diseño de Providers

### 11.1 Interfaz (`application/ports`)

```
ContentProvider (Protocol)
  · matches(url) -> bool                      # ¿esta URL es mía?
  · classify(url) -> ContentKind              # video | channel | playlist | article | profile
  · capabilities() -> ProviderCapabilities
  · fetch_metadata(url) -> ContentMetadata
  · fetch_text(url) -> TextPayload | None     # subtítulos / artículo / texto nativo
  · fetch_media(url, kind) -> MediaFile | None  # audio/video para transcribir
  · fetch_comments(url, limit) -> list[Comment] | None
  · list_items(channel_url, strategy, n) -> list[url]   # solo si kind=channel

ProviderCapabilities
  · reliability: stable | fragile | manual_only
  · supports: {metadata, subtitles, media_download, comments, channel_listing}
  · requires: {cookies?: bool, api_key?: str}
  · legal_notes: str          # se muestra en tool `capabilities`
```

### 11.2 Matriz de providers v1

| Provider  | reliability | metadata       | texto/subs               | media              | comments       | channel | Notas                            |
| --------- | ----------- | -------------- | ------------------------ | ------------------ | -------------- | ------- | -------------------------------- |
| youtube   | stable      | yt-dlp         | yt-dlp subs              | yt-dlp             | Data API / ycd | ✅      | Provider de referencia           |
| vimeo     | stable      | yt-dlp         | yt-dlp                   | yt-dlp             | ❌             | ❌      | Solo público                     |
| web       | stable      | og-tags        | trafilatura → Playwright | ❌                 | ❌             | ❌      | Respeta robots.txt               |
| pdf       | stable      | pypdf meta     | pdfplumber + OCR         | ❌                 | ❌             | ❌      | Local o URL                      |
| localfile | stable      | ffprobe        | —                        | directo            | ❌             | ❌      | **Fallback universal**           |
| tiktok    | fragile     | yt-dlp         | ❌                       | yt-dlp best-effort | ❌ v1          | ⚠️      | Puede romperse sin aviso         |
| instagram | fragile     | yt-dlp+cookies | ❌                       | yt-dlp+cookies     | ❌             | ❌      | Requiere cookies; riesgo bloqueo |
| twitter   | fragile     | yt-dlp         | texto del tweet          | yt-dlp             | ❌ (API paga)  | ❌      | Solo tweet+video                 |
| linkedin  | manual_only | ❌             | ❌                       | ❌                 | ❌             | ❌      | Redirige a localfile             |

### 11.3 Registro y detección

`registry.py` carga providers desde `providers.yaml` (habilitado/deshabilitado, orden de matching, config específica: rutas de cookies, API keys). Detección: primer provider cuyo `matches(url)` da true; si ninguno → provider `web` como catch-all para http(s); extensiones conocidas → `localfile`/`pdf`.

---

## 12. Diseño de Plugins

Tres puntos de extensión, todos con el mismo mecanismo:

1. **Providers** (`ContentProvider`)
2. **Motores de IA** (`AIEngine`)
3. **Stages de pipeline** (`PipelineStage`) — p.ej. agregar "análisis de sentimiento de comentarios" sin tocar el engine.

**Mecanismo:** Python entry-points (`[project.entry-points."creator_research.providers"]` en pyproject de paquetes externos) + registro explícito en YAML. Un plugin de terceros es un paquete pip que declara el entry-point; el registry lo descubre, valida la interfaz (runtime-checkable Protocol) y lo activa solo si está listado en config. Ventajas: cero modificación del core, versionado independiente, testeable por contrato (`tests/contract/` corre la misma suite contra cualquier implementación).

**Ciclo de vida:** `discover → validate(interface + capabilities) → configure(config dict) → healthcheck() → register`. Un plugin que falla healthcheck queda `disabled` con motivo visible en el tool `capabilities` — nunca falla silenciosamente.

---

## 13. Diseño del sistema de IA

### 13.1 Principios

- La IA es **una stage más**, no el sistema. Recibe insumos deterministas (transcript, OCR, metadatos) y produce facetas tipadas validadas por esquema.
- **Transcript y comentarios = datos no confiables.** Los prompts los encierran en delimitadores y las instrucciones prohíben ejecutar directivas embebidas (defensa básica anti prompt-injection en contenido de terceros).
- Salida siempre **JSON validado contra esquema Pydantic** de la faceta; reintento con feedback del error de validación (máx. 2).

### 13.2 Interfaz común

```
AIEngine (Protocol)
  · name, model
  · complete(prompt, *, system, json_schema?, max_tokens, temperature) -> AIResult
  · embed(texts) -> list[vector]            # opcional; si no, sentence-transformers local
  · cost_estimate(tokens) -> float          # 0.0 para Ollama
  · limits() -> {context_window, rpm, tpm}

AIRouter
  · política por tarea (ai.yaml):
      extraction_light  → [ollama:qwen2.5:14b, gemini-flash]
      extraction_heavy  → [gemini-flash, ollama:llama3.1:70b?]   # según hardware
      synthesis (cursos/roadmaps/comparaciones) → mejor motor disponible
  · fallback en cadena ante error/timeout/límite
  · chunking: transcripts > context_window → map-reduce
      (resumen por chunk → facetas por chunk → merge + dedup)
  · presupuesto: tope de tokens por análisis (config), corta con warning
```

### 13.3 Extractores por faceta

Cada faceta (§4 RF-04) tiene: prompt Jinja2 versionado en `config/prompts/`, esquema de salida, y estrategia (`per_chunk_then_merge` o `whole_document`). Agregar una faceta nueva = 1 prompt + 1 esquema + registrarla en el enum. Las facetas se ejecutan en paralelo controlado (semáforo por motor).

### 13.4 Realidad de costos

Default `ai.yaml`: **Ollama-only** (gratis, offline). Perfil `hybrid`: Gemini free tier para síntesis pesada (mejor calidad, rate-limited). Perfiles `openai/anthropic`: opt-in, con `cost_estimate` logueado por análisis para que el gasto sea visible.

---

## 14. Diseño del sistema de Cache

**Clave:** `sha256(canonical_url ∥ depth ∥ pipeline_version ∥ ai_profile)` — cambiar el pipeline o el perfil de IA invalida naturalmente.

**Niveles:**

| Nivel         | Adapter                        | Contenido                                        | TTL                                             |
| ------------- | ------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| L1            | memoria (LRU, proceso)         | resultados de `get_analysis`/`extract` calientes | 15 min                                          |
| L2            | tabla `cache_entries` (SQLite) | mapeo hash → analysis_id                         | 7 días (config; el brief pide exactamente esto) |
| L3 (opcional) | Redis                          | reemplaza L1 si hay múltiples workers            | idem L1                                         |

**Cache de artefactos intermedios:** audio descargado, transcript y OCR se guardan asociados al `content_item` **sin TTL** — un `force_refresh` re-corre solo la etapa de IA, no vuelve a descargar/transcribir (la etapa más cara). Esto convierte "reanalizar con otro modelo" en una operación de segundos.

**Invalidación:** `force_refresh=true` en `analyze` · bump de `pipeline_version` · comando de mantenimiento `cache prune`.

---

## 15. Diseño del sistema de Comparación

**Entrada:** 2–10 sujetos del mismo `kind` (creators, videos, channels, technologies, courses) — todos deben tener análisis previo (si falta, el tool responde qué analizar primero; no compara a ciegas).

**Pipeline de comparación (determinista + IA):**

1. **Carga** de `AnalysisDocument`s + facetas desnormalizadas.
2. **Alineación determinista:** intersección/diferencia de tecnologías, niveles, temarios — puro SQL sobre `facets`, sin IA. (Ej.: "TikTok-dev-A enseña Astro y Bun; B no los toca").
3. **Dimensiones:** default por kind (creadores: stack, nivel, profundidad, estilo pedagógico, frecuencia, gaps; tecnologías: madurez, curva, ecosistema, casos de uso) o custom del usuario.
4. **Síntesis IA:** matriz + evidencia (citas con timestamps del transcript) → veredicto estructurado: fortalezas, debilidades, solapamiento, **huecos de contenido** (directamente útil para UC-10: qué curso falta en el mercado).
5. **Persistencia** en `comparisons` + export a los 3 formatos.

Escala: comparar 10 canales no re-procesa nada; opera sobre análisis ya persistidos (por eso es barato).

---

## 16. Diseño del sistema de Cursos

**Entrada:** N `analysis_ids` (o un canal ya analizado) + nivel objetivo + foco opcional.

**Pipeline:**

```
1. Recolectar temarios + conceptos de cada análisis
2. DEDUP semántico ── embeddings (sentence-transformers) + clustering
   → "useState explicado en 4 videos" = 1 lección con la mejor fuente
     (criterio: profundidad detectada + claridad + recencia)
3. GRAFO de prerequisitos ── domain/services/PrerequisiteGraph:
   heurísticas deterministas (nivel declarado, orden de aparición,
   menciones "antes de esto deberías saber…") + refinamiento IA
4. ORDEN topológico → secuencia de lecciones
5. AGRUPACIÓN en módulos (cohesión temática por clustering)
6. Por capítulo, IA genera: objetivos, contenido resumido con
   referencias (video fuente + timestamp), ejercicios, preguntas de repaso
7. PROYECTO FINAL: IA propone proyecto integrador que cubra ≥70%
   de los conceptos del curso
8. Persistir en `courses` + export (markdown = temario navegable
   con links y timestamps a las fuentes)
```

**Nota honesta:** el curso generado es un **esqueleto curado con referencias**, no contenido original completo — y eso es exactamente lo útil para el caso de uso real (diseñar cursos propios sabiendo qué ya existe y en qué orden enseñarlo). Reproducir el contenido de los videos ajenos ni es legal ni es el objetivo.

---

## 17. Diseño del sistema de Roadmaps

Comparte el 70% con cursos (mismo `PrerequisiteGraph`), pero el output es un **grafo de temas**, no lecciones:

- **Fuentes:** (a) análisis existentes del dominio pedido; (b) si el corpus es pobre, la IA completa con conocimiento general **marcando cada nodo con `source: corpus | model`** — trazabilidad de qué viene de contenido analizado y qué es relleno del modelo.
- **Estructura:** nodos = temas (con nivel, esfuerzo estimado, recursos = content_items del corpus que lo cubren); aristas = prerequisito duro/blando.
- **Render:** niveles (beginner → advanced) en Markdown + Mermaid (`graph TD`) embebido + JSON del grafo.
- **Plantillas por dominio** (frontend/backend/ai/devops) en config: definen ejes esperados del dominio para que la IA no omita áreas enteras; `custom` parte solo del corpus + goal del usuario.

---

## 18. Diseño del sistema de almacenamiento

- **Repositorios por agregado** (`AnalysisRepository`, `CreatorRepository`, `CourseRepository`…) implementando `ports.Repository` — la aplicación nunca ve SQLAlchemy.
- **SQLite v1:** archivo único + WAL mode (lecturas concurrentes con el worker escribiendo). sqlite-vec para embeddings. Backup = copiar un archivo.
- **Migración a PostgreSQL/Neon:** mismo ORM/migraciones; cambio = 1 línea de `DATABASE_URL`. Trigger para migrar: >1 worker concurrente pesado o >~20 GB.
- **Blobs** (audio temporal, frames): filesystem bajo `data/media/{content_hash}/`, con política de retención config (`keep_audio: false` por default — se borra tras transcribir; transcript sí se conserva siempre).
- **Exports** generados on-demand (no se persisten los .md; el JSON canónico es la verdad).

---

## 19. Riesgos técnicos

| #   | Riesgo                                                      | Prob.               | Impacto                | Mitigación                                                                                                                                              |
| --- | ----------------------------------------------------------- | ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Extractores de IG/TikTok se rompen (cambios anti-bot)       | **Alta**            | Medio                  | reliability=fragile visible; fallback localfile; tests de contrato en CI diario que detectan rotura temprano; el core no depende de ellos               |
| 2   | Bloqueo/ban de cuenta por scraping con cookies              | Media               | Alto (cuenta personal) | Documentar uso de cuenta secundaria; rate limiting cortés; feature opt-in deshabilitada por default                                                     |
| 3   | Whisper en CPU demasiado lento para videos largos           | Media               | Medio                  | faster-whisper + modelo `small` default; priorizar subtítulos existentes (S2 evita S3/S4 en ~80% de YouTube); límite de duración configurable con aviso |
| 4   | Calidad de extracción con modelos locales chicos < esperada | Media               | Medio                  | Router por tarea (§13); validación por esquema con reintentos; perfil hybrid con Gemini free para síntesis                                              |
| 5   | Timeouts MCP en operaciones largas                          | Alta (si se ignora) | Alto                   | Resuelto por diseño: modelo de jobs (§5.3). Riesgo residual: UX de polling — mitigar con `eta` y progreso por stage                                     |
| 6   | Prompt injection vía transcripts/comentarios de terceros    | Media               | Medio                  | Delimitación de datos no confiables + salidas restringidas a esquemas + el servidor no ejecuta acciones derivadas del contenido                         |
| 7   | Cuota de YouTube Data API insuficiente (canales grandes)    | Baja                | Bajo                   | 10k unidades/día alcanza para ~100 videos con comentarios; fallback a youtube-comment-downloader                                                        |
| 8   | Crecimiento de SQLite (transcripts largos)                  | Baja                | Bajo                   | Compresión de `text` opcional; camino Neon ya diseñado                                                                                                  |
| 9   | Deriva legal (ToS cambian)                                  | Media               | Medio                  | `legal_notes` por provider centralizadas; providers frágiles desactivables por config sin release                                                       |
| 10  | Scope creep (30 tools, 7 motores IA, 9 providers…)          | **Alta**            | Alto                   | Roadmap de implementación por fases (§20); v1 = youtube + web + pdf + localfile + Ollama, que cubre ~85% del valor real                                 |

---

## 20. Mejoras futuras

**Fase 2 (post-v1 estable):**

- Providers frágiles (TikTok, Instagram, Twitter) como paquetes plugin separados con su propio ciclo de release.
- Redis + arq para paralelismo real de workers; Neon para DB.
- Análisis multimodal de frames con modelos de visión locales (LLaVA vía Ollama): detectar diagramas, UI mostrada, slides — más allá del OCR.
- Webhooks/notificación al terminar jobs (en vez de polling).

**Fase 3:**

- Grafo de conocimiento explícito (tecnología ↔ creador ↔ concepto) consultable — versión propia de "codebase-memory" pero para contenido educativo.
- Monitoreo de canales: re-scan periódico, diff de temario ("este creador empezó a cubrir X").
- UI web ligera (ahí sí TypeScript) para navegar el corpus, grafos de roadmaps y cursos.
- Detección de tendencias: qué tecnologías crecen en el corpus por trimestre.
- Exportar cursos a formatos de plataformas (SCORM/Markdown-para-LMS).
- Fine-tuning de prompts por evaluación automática (golden set de videos CC con facetas esperadas).

---

## Anexo: Orden de implementación propuesto (para aprobación)

1. **Sprint 0** — esqueleto: config, DI, logging, DB + migraciones, CI, Docker.
2. **Sprint 1** — vertical slice completo: `analyze(youtube)` con subtítulos + Ollama + cache + `get_analysis`/`job_status`. _Un solo camino, de punta a punta._
3. **Sprint 2** — Whisper (videos sin subs), providers web/pdf/localfile, `extract` y facetas desnormalizadas.
4. **Sprint 3** — `analyze_channel`, comentarios YouTube, `search_knowledge`, `history`.
5. **Sprint 4** — `compare`, embeddings, dedup.
6. **Sprint 5** — `generate_roadmap`, `generate_course`.
7. **Sprint 6** — transporte HTTP + Cloudflare Tunnel (ChatGPT), providers frágiles como opt-in.

_Fin del documento. No se escribió ni se escribirá código hasta aprobación explícita de esta arquitectura._
