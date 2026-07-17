# Creator Research MCP

## CleanCod3 Intelligence portable

Para ejecutar el dashboard, n8n, bridge, MCP y SQLite juntos con Docker, consulta la
[guía portable](docs/portable.md) y usa:

```bash
./cleancod3 start
```

[![CI](https://github.com/CleanCod3Systems/creator-research-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/CleanCod3Systems/creator-research-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript MCP server that fetches content data — YouTube, TikTok, Instagram, Twitter/X,
LinkedIn, articles, PDFs — so that the LLM client (ChatGPT, Claude) can analyze what content
performs well, what patterns repeat, and how to turn that into courses, scripts, or strategy.

Works with **any MCP client**: Claude Desktop / Claude Code (stdio), ChatGPT and remote
clients (Streamable HTTP).

## What it's for

Point your LLM client at a channel, a video, or a competitor's profile and ask things like:

- _"What are @channel's best-performing videos, and why do they outperform the rest?"_ —
  `list_videos` ranks by a median+MAD outlier score, not just raw views, so a single viral fluke
  doesn't skew the read.
- _"Get the transcripts of their top 3 videos and write me a script in the same style."_ —
  `get_transcript` pulls captions/subtitles + engagement so the LLM can read and imitate the
  actual content, not just metadata.
- _"What part of this video made people rewatch it — and what killed their interest?"_ —
  `get_retention_moments` matches the replay heatmap to the transcript by timestamp, so you get
  the actual words said at each hotspot/coldspot instead of a bare timestamp.
- _"How is this video growing — is it still gaining views a week later?"_ — `get_metrics_history`
  turns repeated measurements into real velocity (views/day, engagement/view), and is explicit
  about what it can't compute yet, instead of guessing.
- _"Compare these 5 creators: who posts more often, who covers what topics, what's missing?"_ —
  `analyze_creator`/`compare_creators` give deterministic stats (cadence, keywords, format
  performance) across multiple channels at once.
- _"What do people keep asking for in the comments that I haven't made yet?"_ —
  `get_content_ideas` clusters repeated requests/questions by shared vocabulary and ranks them by
  how many people asked plus engagement — a single comment isn't a pattern, so singletons are
  dropped.
- _"Turn what these videos teach into a course outline / learning roadmap."_ —
  `generate_course`/`generate_roadmap` deduplicate topics across saved analyses and order them
  by level.

Every number the server returns is either fetched directly from the platform or computed with a
documented formula (median absolute deviation for outliers, real deltas for growth) — never
fabricated. Where a platform genuinely doesn't expose something (Instagram profile listings,
Twitter/X threads, LinkedIn behind login), the `capabilities` tool says so explicitly instead of
returning a plausible-looking guess.

## Design: client-reasoning only

The server **fetches data, it never analyzes** — there's no AI engine running inside it.

```
list_videos(channel)        →  stats + outlierScore + tags (yt-dlp or YouTube Data API)
get_transcript(url)         →  metadata + subtitles/captions (yt-dlp/FxTwitter/scraping)
get_comments(url)           →  public YouTube/Instagram comments
       ↓
The client LLM (ChatGPT/Claude) analyzes the text inside the conversation
       ↓
save_analysis(url, facets)  →  persisted, queryable and comparable later
```

This is intentional: the server needs no RAM/CPU/GPU for AI — it only fetches and structures
data, so it's cheap and fast to run anywhere. See [`docs/architecture.md`](docs/architecture.md)
for the full design.

## Installation

**Requirements**: Node ≥ 20, `yt-dlp` on your PATH (`brew install yt-dlp` / `apt install yt-dlp`).
Everyone runs **their own copy**, with **their own credentials** — there is no shared server
and no data is centralized anywhere.

Keep `yt-dlp` updated (`pip install -U yt-dlp` / `brew upgrade yt-dlp`) — most TikTok/Instagram
extraction failures are fixed upstream within days by a new yt-dlp release, not by a code change
here. The `capabilities` tool reports the detected `ytDlpVersion` so you can check it against
[yt-dlp's releases](https://github.com/yt-dlp/yt-dlp/releases).

### Option 1 — npx (recommended, no cloning)

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

Paste this into your Claude Desktop/Code config. The SQLite database is created automatically
at `~/.creator-research/`. Every credential is optional (see [`.env.example`](.env.example)) —
if you want to use `YOUTUBE_API_KEY`, export it before opening the MCP client, or run HTTP mode
(below), which loads a `.env` file automatically.

```bash
npx creator-research-mcp http   # HTTP mode on :3333, for ChatGPT via a tunnel
```

### Option 2 — clone the repo (for development or contributing)

```bash
git clone https://github.com/CleanCod3Systems/creator-research-mcp.git
cd creator-research-mcp
pnpm install
cp .env.example .env   # fill in your credentials (all optional)
pnpm build
pnpm mcp:stdio        # stdio (Claude Desktop/Code, Cursor)
pnpm mcp:http         # HTTP :3333 (ChatGPT via Cloudflare Tunnel)
```

The binary loads `.env` automatically on startup (via `dotenv`) — nothing needs to be exported
by hand. `.env` is never committed (gitignored); `.env.example` documents every variable.

### Connecting to Claude Desktop

`claude_desktop_config.json` (if you cloned the repo instead of using npx):

```json
{
  "mcpServers": {
    "creator-research": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/repo", "mcp:stdio"]
    }
  }
}
```

Try the `capabilities` tool — it should list the providers and their limitations.

### Connecting to ChatGPT

ChatGPT's MCP connectors require a **Plus/Pro plan** and a remote HTTPS server:

```bash
# 1. HTTP server with a security token
MCP_AUTH_TOKEN=$(openssl rand -hex 16) pnpm mcp:http     # note the token

# 2. Free HTTPS tunnel
brew install cloudflared
cloudflared tunnel --url http://localhost:3333
# → gives you https://some-random-name.trycloudflare.com
```

In ChatGPT: **Settings → Apps & Connectors → Advanced settings → Developer mode** →
_Create connector_ → URL: `https://some-random-name.trycloudflare.com/mcp?key=YOUR_TOKEN`.

Notes: without `MCP_AUTH_TOKEN`, anyone with the URL can use your server. The trycloudflare URL
**changes on every run** and Cloudflare can kill it without notice; for a stable URL, use a
named tunnel (free with a Cloudflare account) or Tailscale Funnel.

## YOUTUBE_API_KEY (optional, free, recommended)

Without it, `list_videos` still works via `yt-dlp` (views are fine, likes aren't exact, and
occasionally come back `null`). With a free key from the
[YouTube Data API v3](https://console.cloud.google.com/apis/credentials):

- `list_videos` returns exact likes, real SEO tags, and no nulls (1 quota unit per batch of 50
  videos — the free 10,000/day quota is more than enough)
- `get_trending_videos` becomes available (what's currently trending on YouTube by region/category)
- `search_youtube_videos` becomes available (keyword search across all of YouTube, not just one
  channel — costs 100 quota units per call, so ~100 searches/day on the free quota)
- `get_channel_about`, `get_channel_monetization`, and `search_viral_videos` become available
  (channel bio/stats, deterministic non-AdSense monetization detection, and cross-channel outlier
  search)

```bash
export YOUTUBE_API_KEY="your-key-here"
```

## Available tools

| Tool                      | What it does                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`            | Enabled providers, honest limitations, and whether `YOUTUBE_API_KEY` is active                                                                                          |
| `list_videos`             | Videos of a channel (YouTube/TikTok) with views, duration, outlier score (median+MAD, not just average) and tags. Records a historical snapshot per video               |
| `get_transcript`          | Text + metadata + engagement for one or more URLs (`urls`, up to 15 in a batch), with `refresh` for stale cache — video/tweet/post/article/PDF, paginated with `offset`. No captions? Returns a best-effort `audioUrl` instead (client transcribes if it wants to; the server never does) |
| `get_comments`            | Public YouTube/Instagram comments with cache age and optional `refresh` — for spotting FAQs, criticism, and requested content                                           |
| `get_content_ideas`       | Groups repeated audience requests into ranked content ideas — deterministic TF-IDF clustering, no embeddings/AI                                                         |
| `get_video_heatmap`       | A YouTube video's "most replayed" graph: which seconds the audience rewinds the most                                                                                    |
| `get_retention_moments`   | Joins the replay heatmap with the transcript by timestamp: what was actually said at the most/least rewatched moments — no manual cross-referencing                     |
| `get_trending_videos`     | Official YouTube trending by region/category (requires `YOUTUBE_API_KEY`)                                                                                               |
| `search_youtube_videos`   | Keyword search across all of YouTube, not limited to one channel — filter by order/duration/recency (requires `YOUTUBE_API_KEY`)                                        |
| `get_channel_about`       | A channel's About page: name, description, subscriber/view/video counts, country, join date, keywords (requires `YOUTUBE_API_KEY`)                                      |
| `get_channel_monetization`| Deterministic, evidence-based detection of non-AdSense monetization (courses, memberships, affiliate links, merch, sponsorships...) from About + video descriptions — text/URL matching, not AI (requires `YOUTUBE_API_KEY`) |
| `search_viral_videos`     | Searches a topic and ranks results by outlierScore = views ÷ that channel's own lifetime average views per video (requires `YOUTUBE_API_KEY`)                           |
| `get_metrics_history`     | Historical snapshots for a URL + real growth (viewsPerDay, engagementPerView) between the first and last measurement — needs ≥2 measurements                            |
| `import_profile_snapshot` | Manually records followers/posts/likes/comments for a profile with no automated listing (e.g. Instagram) — feeds the same history above                                 |
| `analyze_creator`         | Deterministic stats for a channel: median views/duration, publish cadence, keywords, performance by format, outliers                                                    |
| `compare_creators`        | Compares 2–10 channels side by side on the same stats — shared vs. unique tags                                                                                          |
| `save_analysis`           | Persists the analysis the client LLM produced from a `get_transcript` call                                                                                              |
| `get_analysis`            | A document by `analysisId` or `url` — `format: markdown\|json\|text`                                                                                                    |
| `search_knowledge`        | Searches across every accumulated facet: "which videos teach Astro?"                                                                                                    |
| `compare`                 | A deterministic matrix between 2–10 analyses: shared / partial / unique per source                                                                                      |
| `generate_course`         | A course skeleton from N analyses: topic dedup, ordered by level                                                                                                        |
| `generate_roadmap`        | A leveled roadmap from the corpus, with a Mermaid diagram                                                                                                               |
| `history`                 | Recent analyses with their status                                                                                                                                       |

Typical flow: _"get me the most-viewed videos from @channel, the transcript of the top 3, and
turn that into a reel script"_ → `list_videos` → `get_transcript` × 3 → the LLM analyzes and
writes the script → optionally `save_analysis` to query it later.

Useful env vars: `YTDLP_EXTRA_ARGS` (for special local environments), `YOUTUBE_API_KEY`,
`MCP_AUTH_TOKEN`, `DATABASE_PATH`.

## Providers and honest limitations

| Source                                  | Status                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| YouTube, web articles, PDF, local files | ✅ stable                                                                                  |
| TikTok, Instagram, Twitter/X            | ⚠️ fragile — best-effort, can break if the platform changes                                |
| LinkedIn                                | ⚠️ fragile — public posts/articles only; behind the login wall, extraction is not possible |

- **Instagram**: public individual post/reel URLs are supported on a best-effort basis. Metadata
  includes author details, available engagement, thumbnails, captions, and carousel items. Public
  comments are best-effort and may be unavailable. Stories/highlights may expire, and image-only
  posts may have no text beyond their caption. There is no automatic profile listing. Pass
  individual URLs to `get_transcript` (it accepts `urls` in batch), or manually record
  followers/likes/comments with `import_profile_snapshot` to track profile growth over time.
  Credentials and browser cookies are not requested, and login is never bypassed.
- **Twitter/X**: only individual public tweets (via FxTwitter); profiles and replies are out of
  scope.
- **TikTok**: `yt-dlp` best-effort; no comments support.
- The `capabilities` tool exposes all of this at runtime so the client LLM never promises
  something the server can't actually do.

## Publishing a new version (maintainers)

The `.github/workflows/release.yml` workflow does everything: pushing a `v*` tag builds, tests,
and publishes all 4 workspace packages to npm (pnpm automatically replaces `workspace:*` with
the real versions).

```bash
# 1. bump the version in all 4 package.json files (core/db/providers/mcp-server) to the same number
# 2. commit + push to main
git tag v0.1.0 && git push --tags
```

Requires the `NPM_TOKEN` secret (repo Settings → Secrets → Actions on GitHub) with an
[npm automation token](https://www.npmjs.com/settings/~/tokens). The `ci.yml` workflow runs
build/typecheck/lint/test on every push/PR to `main`, no secret required.

## Architecture

- `packages/core` — pure domain logic (Zod) + ports (interfaces). No I/O.
- `packages/db` — Drizzle + SQLite (WAL).
- `packages/providers` — one adapter per platform (YouTube, TikTok, Instagram, Twitter, LinkedIn, web, PDF).
- `apps/mcp-server` — the active MCP tools. Dual transport (stdio/HTTP).

Full detail in [`docs/architecture.md`](docs/architecture.md).

## Security

- **`.env` is never committed** (it's in `.gitignore`). It holds your real `MCP_AUTH_TOKEN` and
  `YOUTUBE_API_KEY` — copy `.env.example` and fill in your own credentials, never share your
  `.env` or paste it into an issue/PR.
- **Generate `MCP_AUTH_TOKEN` with `openssl rand -hex 32`** (or longer). The comparison in
  `http.ts` runs in constant time (`crypto.timingSafeEqual`) so the token can't leak through
  timing. If you run the server without this token, anyone with the tunnel URL can use it — the
  server itself warns about this on stderr at startup.
- **`filePath` in `get_transcript` reads files from the disk the server runs on** (`.md`/`.txt`,
  plus media files for basic metadata), with no sandboxing by design (it's the fallback path for
  local content). If you expose the server over HTTP with a public tunnel, **any connected MCP
  client can request any file with those extensions that the process can read.** Don't run this
  on a machine with sensitive `.md`/`.txt` files accessible to the process's user, or restrict
  access at the network/tunnel level.
- **No `shell: true` calls anywhere**: every `yt-dlp` invocation uses `execFile` with arguments
  as an array (never string interpolation), which rules out command injection even if a URL
  contains shell metacharacters.
- **`data/*.db`** (SQLite) stays 100% local and gitignored — this is where your real search/
  analysis history accumulates. Don't upload it anywhere if it contains data you'd rather keep
  private.
- Before making a repo public: run `git log -p -- .env` (in case a commit ever included `.env`)
  and, if anything shows up, follow GitHub's guide to purge secrets from history — deleting the
  file in a new commit is **not** enough, it stays in history.

## Contributing

```bash
pnpm install
pnpm build       # compile all workspace packages
pnpm typecheck    # includes test files, unlike build
pnpm lint         # eslint
pnpm test         # vitest, per package
```

Pull requests should keep all four commands passing. There's no separate style guide beyond
what ESLint/Prettier already enforce (`pnpm format` to auto-fix).

## License

[MIT](LICENSE)
