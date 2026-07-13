# Creator Research MCP

[![CI](https://github.com/CleanCod3Systems/creator-research-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/CleanCod3Systems/creator-research-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/CleanCod3Systems/creator-research-mcp/blob/main/LICENSE)

A TypeScript MCP server that fetches content data — YouTube, TikTok, Instagram, Twitter/X,
LinkedIn, articles, PDFs — so that the LLM client (ChatGPT, Claude) can analyze what content
performs well, what patterns repeat, and how to turn that into courses, scripts, or strategy.

Works with **any MCP client**: Claude Desktop / Claude Code (stdio), ChatGPT and remote
clients (Streamable HTTP).

Full source, architecture notes, and contributing guide:
[github.com/CleanCod3Systems/creator-research-mcp](https://github.com/CleanCod3Systems/creator-research-mcp).

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
get_comments(url)           →  public YouTube comments
       ↓
The client LLM (ChatGPT/Claude) analyzes the text inside the conversation
       ↓
save_analysis(url, facets)  →  persisted, queryable and comparable later
```

This is intentional: the server needs no RAM/CPU/GPU for AI — it only fetches and structures
data, so it's cheap and fast to run anywhere. See
[`docs/architecture.md`](https://github.com/CleanCod3Systems/creator-research-mcp/blob/main/docs/architecture.md)
for the full design.

## Installation

**Requirements**: Node ≥ 20, `yt-dlp` on your PATH (`brew install yt-dlp` / `apt install yt-dlp`).
Everyone runs **their own copy**, with **their own credentials** — there is no shared server
and no data is centralized anywhere.

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
at `~/.creator-research/`. Every credential is optional — if you want to use `YOUTUBE_API_KEY`,
export it before opening the MCP client, or run HTTP mode (below), which loads a `.env` file
automatically.

```bash
npx creator-research-mcp http   # HTTP mode on :3333, for ChatGPT via a tunnel
```

### Connecting to ChatGPT

ChatGPT's MCP connectors require a **Plus/Pro plan** and a remote HTTPS server:

```bash
# 1. HTTP server with a security token
MCP_AUTH_TOKEN=$(openssl rand -hex 16) npx creator-research-mcp http     # note the token

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

```bash
export YOUTUBE_API_KEY="your-key-here"
```

## Available tools

| Tool                       | What it does                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`             | Enabled providers, honest limitations, and whether `YOUTUBE_API_KEY` is active                                                                  |
| `list_videos`              | Videos of a channel (YouTube/TikTok) with views, duration, outlier score (median+MAD, not just average) and tags. Records a historical snapshot per video |
| `get_transcript`           | Text + metadata + engagement for one or more URLs (`urls`, up to 15 in a batch) — video/tweet/post/article/PDF, paginated with `offset`         |
| `get_comments`             | Public YouTube/Instagram comments — for spotting FAQs, criticism, and requested content                                                        |
| `get_video_heatmap`        | A YouTube video's "most replayed" graph: which seconds the audience rewinds the most                                                            |
| `get_retention_moments`    | Joins the replay heatmap with the transcript by timestamp: what was actually said at the most/least rewatched moments — no manual cross-referencing |
| `get_trending_videos`      | Official YouTube trending by region/category (requires `YOUTUBE_API_KEY`)                                                                       |
| `get_metrics_history`      | Historical snapshots for a URL + real growth (viewsPerDay, engagementPerView) between the first and last measurement — needs ≥2 measurements    |
| `import_profile_snapshot`  | Manually records followers/posts/likes/comments for a profile with no automated listing (e.g. Instagram) — feeds the same history above         |
| `analyze_creator`          | Deterministic stats for a channel: median views/duration, publish cadence, keywords, performance by format, outliers                            |
| `compare_creators`         | Compares 2–10 channels side by side on the same stats — shared vs. unique tags                                                                  |
| `save_analysis`            | Persists the analysis the client LLM produced from a `get_transcript` call                                                                      |
| `get_analysis`             | A document by `analysisId` or `url` — `format: markdown\|json\|text`                                                                            |
| `search_knowledge`         | Searches across every accumulated facet: "which videos teach Astro?"                                                                            |
| `compare`                  | A deterministic matrix between 2–10 analyses: shared / partial / unique per source                                                              |
| `generate_course`          | A course skeleton from N analyses: topic dedup, ordered by level                                                                                |
| `generate_roadmap`         | A leveled roadmap from the corpus, with a Mermaid diagram                                                                                       |
| `history`                  | Recent analyses with their status                                                                                                               |

Typical flow: _"get me the most-viewed videos from @channel, the transcript of the top 3, and
turn that into a reel script"_ → `list_videos` → `get_transcript` × 3 → the LLM analyzes and
writes the script → optionally `save_analysis` to query it later.

Useful env vars: `YTDLP_EXTRA_ARGS` (e.g. `--cookies-from-browser chrome` for rate-limited
Instagram), `YOUTUBE_API_KEY`, `MCP_AUTH_TOKEN`, `DATABASE_PATH`.

## Providers and honest limitations

| Source                                  | Status                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| YouTube, web articles, PDF, local files  | ✅ stable                                                                                    |
| TikTok, Instagram, Twitter/X             | ⚠️ fragile — best-effort, can break if the platform changes                                  |
| LinkedIn                                 | ⚠️ fragile — public posts/articles only; behind the login wall, extraction is not possible   |

- **Instagram**: there's no way to list an entire profile — this is a limitation of `yt-dlp`
  itself (`instagram:user (CURRENTLY BROKEN)`, with or without cookies), not of this server.
  Pass individual post/reel URLs to `get_transcript` (it accepts `urls` in batch), or manually
  record followers/likes/comments with `import_profile_snapshot` if you want to track growth over
  time. Browser cookies are never extracted and login is never bypassed.
- **Twitter/X**: only individual public tweets (via FxTwitter); profiles and replies are out of
  scope.
- **TikTok**: `yt-dlp` best-effort; no comments support.
- The `capabilities` tool exposes all of this at runtime so the client LLM never promises
  something the server can't actually do.

## Security

- **Generate `MCP_AUTH_TOKEN` with `openssl rand -hex 32`** (or longer) before running HTTP mode.
  The comparison is done in constant time (`crypto.timingSafeEqual`) so the token can't leak
  through timing. Without this token, anyone with the tunnel URL can use your server.
- **`filePath` in `get_transcript` reads files from the disk the server runs on** (`.md`/`.txt`,
  plus media files for basic metadata), with no sandboxing by design. If you expose the server
  over HTTP with a public tunnel, any connected MCP client can request any file with those
  extensions that the process can read.
- **No `shell: true` calls anywhere**: every `yt-dlp` invocation uses `execFile` with arguments
  as an array, which rules out command injection even if a URL contains shell metacharacters.

Full security notes:
[README → Security](https://github.com/CleanCod3Systems/creator-research-mcp#security).

## License

[MIT](https://github.com/CleanCod3Systems/creator-research-mcp/blob/main/LICENSE)
