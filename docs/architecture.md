# Creator Research MCP — Architecture

This document describes the system as it is actually built and running today.

## Core idea: client-reasoning only

The server's only job is to **fetch and structure data**. It never runs an LLM, never
transcribes audio, never does OCR, and never analyzes content on its own. All reasoning
happens in the MCP client (Claude, ChatGPT, or any other MCP-compatible LLM) that calls the
tools.

```
list_videos(channel)         → stats + outlierScore + tags (yt-dlp or YouTube Data API)
get_transcript(url)           → metadata + captions/subtitles (yt-dlp / FxTwitter / scraping)
get_comments(url)             → public YouTube/Instagram comments
        │
        ▼
The client LLM reasons over the returned text, inside the conversation
        │
        ▼
save_analysis(url, facets)    → persisted, later searchable and comparable
```

Consequences of this design:

- No GPU/CPU budget for AI is ever spent by this server — only network calls to fetch data.
- The server has zero server-side AI dependencies.
- Anything that looks like "analysis" in the tool list (`analyze_creator`, `compare_creators`,
  `generate_course`, `generate_roadmap`) is **deterministic aggregation** over structured data
  (medians, outlier detection, keyword frequency, prerequisite ordering) — never a model call.
  Where real interpretation is needed (spotting a hook, judging a narrative structure), the
  tool explicitly tells the client LLM to read the actual transcript via `get_transcript`.

## Monorepo layout

pnpm workspaces + Turborepo, four packages:

| Package                 | Responsibility                                                      |
| ------------------------ | --------------------------------------------------------------------- |
| `packages/core`          | Pure domain logic (Zod schemas, stats, ports/interfaces). Zero I/O. |
| `packages/db`            | Drizzle ORM + SQLite (WAL mode), migrations, repositories.           |
| `packages/providers`     | One adapter per platform (YouTube, TikTok, Instagram, Twitter/X, LinkedIn, web, PDF, local files). |
| `apps/mcp-server`        | MCP tool registration, dual transport (stdio + Streamable HTTP), the executable binary. |

Dependency direction is one-way: `mcp-server → providers → core`, and `db → core`. Nothing in
`core` imports from `db` or `providers`.

## Domain model (`packages/core`)

- **`domain/content.ts`** — `ContentKind` (video/short/channel/playlist/article/pdf/file/tweet),
  `SourceRef` (a URL or a local file path), `canonicalizeUrl` (strips tracking params, lowercases
  the host) and `contentHash`/`sourceHash` (sha256-based idempotency keys used when persisting
  content items).
- **`domain/analysis.ts`** — `AnalysisDocument`: the canonical, versioned JSON shape produced by
  `save_analysis`. `FacetKind` enumerates the kinds of insight a client can attach (summary,
  conclusions, technologies, best/bad practices, code, glossary, etc). JSON is the source of
  truth; Markdown/plain-text renders are projections generated on read (`export/markdown.ts`),
  never stored separately.
- **`domain/stats.ts`** — the statistical core used by every metrics-related tool:
  - `median` / `medianAbsoluteDeviation` (MAD): robust alternatives to mean/standard deviation
    that don't get skewed by a single viral video.
  - `detectOutlier(value, cohort)`: a modified z-score (`0.6745 · (x − median) / MAD`) plus a
    `confidence` tier (`low`/`medium`/`high`) based on cohort size — a value can look extreme
    and still be low-confidence if the sample is tiny.
  - `computeGrowthMetrics(snapshots, publishedAt, now)`: deltas and per-hour/per-day velocity
    between two metric snapshots. Guiding rule: **never divide by an absent or zero
    denominator** — any metric that can't be computed with certainty comes back as `null`, with
    the reason listed in a `limitations: string[]` array. Nothing is ever guessed.
- **`ports/provider.ts`** — the `ContentProvider` interface every adapter implements:
  `matches(url)`, `classify(url)`, `capabilities()`, `fetchMetadata`, `fetchText`, and the
  optional `listItems`/`fetchComments`. `ProviderCapabilities.reliability` is one of
  `stable | fragile | manual_only` and is surfaced at runtime through the `capabilities` tool, so
  the client LLM never promises something a provider can't actually deliver.

## Providers (`packages/providers`)

| Provider    | Reliability   | Notes                                                                                    |
| ----------- | ------------- | ----------------------------------------------------------------------------------------- |
| `youtube`   | stable        | `yt-dlp` for metadata/subtitles; optional YouTube Data API v3 (`YOUTUBE_API_KEY`) for exact likes/tags and trending. |
| `web`       | stable        | Readability (`@mozilla/readability` + `jsdom`) for articles/blogs.                        |
| `pdf`       | stable        | Text extraction via `unpdf`.                                                              |
| `localfile` | stable        | Reads `.md`/`.txt` (and media, for metadata) straight from local disk — universal fallback for anything with no automated provider. |
| `tiktok`    | fragile       | `yt-dlp` best-effort; no comments support.                                                |
| `instagram` | fragile       | No profile listing exists (a `yt-dlp` limitation, not this server's) — only single post/reel URLs via `get_transcript`, plus manual growth tracking via `import_profile_snapshot`. Never touches browser cookies or bypasses login. |
| `twitter`   | fragile       | Single public tweets via FxTwitter only — no profile/thread scraping.                     |
| `linkedin`  | fragile       | Public posts/articles only; anything behind the login wall is out of scope.               |

Cross-cutting: `retry.ts` wraps HTTP-based providers with exponential backoff, retrying
transient errors (429, 5xx, timeouts) and never retrying auth/permission errors (401/403/404).
Every `yt-dlp` invocation uses `execFile` with argument arrays — never a shell string — so a
malicious URL can't inject shell commands.

## Storage (`packages/db`)

SQLite via Drizzle ORM, WAL mode, migrations under `packages/db/migrations`. Actively used
tables:

- `creators`, `channels` — one row per creator/channel, used by `import_profile_snapshot` and
  the metrics-history tools.
- `content_items` — the universal content unit (video, article, PDF, tweet…), keyed by
  `content_hash` for idempotent re-fetching.
- `transcripts`, `comments`, `metric_snapshots` — raw fetched data, plus point-in-time
  view/like/comment counts that `computeGrowthMetrics` turns into growth metrics.
- `analyses`, `facets` — the persisted output of `save_analysis`, denormalized into `facets` so
  `search_knowledge` can query by kind/value without parsing JSON.
- `comparisons`, `courses`, `roadmaps` — outputs of `compare`, `generate_course`, and
  `generate_roadmap`.

## MCP server (`apps/mcp-server`)

- **Dual transport**: `src/index.ts` (stdio, for Claude Desktop/Code) and `src/http.ts`
  (Streamable HTTP, for ChatGPT or any remote client). Same `buildServer()` from `server.ts`
  powers both.
- **Tool registration**: each file under `src/tools/` registers one or more tools against the
  shared `McpServer` instance. See the tool table in [`README.md`](../README.md) for the full,
  up-to-date list — this document won't duplicate it to avoid the two going out of sync.
- **HTTP auth**: `http.ts` compares the bearer token / `?key=` query param against
  `MCP_AUTH_TOKEN` using `crypto.timingSafeEqual`, so a timing attack can't leak the token one
  byte at a time. If `MCP_AUTH_TOKEN` is unset, the server logs a warning and accepts any
  request — fine for a local stdio setup, not for a public tunnel.

## What this project deliberately does not do

- No server-side LLM calls, no local model inference, no GPU/CPU-heavy dependencies. Every tool
  either fetches data or does deterministic math on it.
- No video/audio processing pipeline. If a platform has no reliable free way to get structured
  data (Instagram profile listing, Twitter/X threads, LinkedIn behind the login wall), the
  answer is an honest limitation surfaced through the `capabilities` tool — not a heavier
  scraping/processing pipeline.
- No shared, centrally-hosted instance. Every user runs their own copy with their own
  credentials and their own local SQLite database (see [Security](../README.md#security) in the
  README).
