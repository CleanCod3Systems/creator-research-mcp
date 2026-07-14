# Working on this repo — read this first

This file exists so any AI coding agent (Claude Code, Cursor, Codex, Copilot, or otherwise)
working on this repo stays on course. It was written after a real incident: a large,
well-engineered feature set (Instagram OAuth via Meta Graph API, a shared "auth broker" service,
SponsorBlock, consolidated research tools) was built in one session without checking it against
these principles, and had to be fully reverted because it contradicted #2 below. Check new work
against this file *before* building it, not after.

## Non-negotiable principles

1. **Client-reasoning only.** The server fetches and structures data. It never runs its own
   LLM, embeddings, local model, OCR, or transcription engine. If a task seems to require one of
   those, stop and ask the user first — don't add the dependency speculatively.
2. **No shared or centralized infrastructure.** Every user runs their own copy of this MCP with
   their own credentials (see the README's "Installation" section). Never introduce a component
   that requires the maintainer to run a persistent shared server (an OAuth broker, a hosted
   API, a shared database) without first confirming with the user — it directly contradicts the
   "there is no shared server" promise already documented in the README.
3. **Lightweight and free by design.** No heavy dependencies: no Python, no native ML libraries,
   no headless browsers beyond what's already used (jsdom for Readability). Statistics are
   deterministic (median/MAD for outliers, TF-IDF for comment clustering) — not embeddings, not
   an ML model.
4. **Never fabricate data.** If a metric can't be computed (missing denominator, insufficient
   sample size), return `null` plus an explicit entry in a `limitations: string[]` array. Never
   guess or interpolate.
5. **English only in the repo.** Code comments, docs, README, tool descriptions, and error
   messages are English — regardless of what language the conversation with the user is in.
   Exception: deliberate multilingual pattern-matching data (e.g. a Spanish stopword list) is
   fine, but comment that it's intentional.
6. **Confirm before architecture changes.** Before adding a new third-party integration, an
   OAuth flow, a new external service dependency, or anything that changes the project's shape
   in a way that could conflict with principles #1–#3, stop and ask the user directly. Don't
   build it first and hope the docs reconcile later.
7. **Tests for every new pure-logic module.** Before considering a change complete, run
   `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — all four, not a subset.

## Publishing

- Package scope is `@cleancod3/*` for the three internal packages (`core`, `db`, `providers`);
  the installable package is unscoped: `creator-research-mcp`.
- Version bumps happen across all 4 `package.json` files together, to the same number.
- Pushing a `v*` git tag triggers `.github/workflows/release.yml`, which really publishes to
  npm. Never push a version tag without the user's explicit go-ahead for that specific version —
  a prior commit/push to `main` does not imply consent to also publish.

## MCP tool design conventions

Grounded in the [official MCP spec](https://modelcontextprotocol.io/specification/draft/server/tools)
and community best practices (e.g. [awslabs/mcp design guidelines](https://github.com/awslabs/mcp/blob/main/DESIGN_GUIDELINES.md)),
adapted to this repo's TypeScript/Zod stack. Follow these for every new tool; see
[`.agents/skills/add-mcp-tool/SKILL.md`](.agents/skills/add-mcp-tool/SKILL.md) for the
step-by-step recipe (Claude Code also finds it via `.claude/skills/add-mcp-tool/SKILL.md`, a
pointer to the same file).

- **Naming**: `snake_case`, verb_noun (`list_videos`, `get_transcript`). Letters, digits,
  underscore, hyphen, dot only. Keep it under 64 characters to stay compatible with clients that
  still enforce the older limit, even though the spec now allows up to 128.
- **Descriptions carry instructions for the model, not just documentation.** Every tool
  description in this repo already states its data source, what it does NOT do, and any
  non-obvious usage hint (e.g. `get_transcript` telling the model to ground scripts in the
  creator's real voice). Keep doing that — it's more effective than a separate style guide the
  model has to remember, because it's right where the model decides whether to call the tool.
- **Zod schema for `inputSchema`, always.** Every parameter needs a `.describe()` when its
  purpose isn't obvious from the name alone.
- **Annotations**: every tool in this repo is read-only and hits the open web/local disk, so new
  tools should set
  `annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }`
  in `registerTool`'s config object. None of the existing tools set this yet (a real gap found
  2026-07-14) — define it inline per tool rather than as one shared constant, so a tool can
  override the hint if it's ever not read-only.
- **Errors**: distinguish protocol errors (let them throw — the SDK turns them into JSON-RPC
  errors automatically) from *tool execution* errors (bad input, provider failure, unsupported
  source). For the latter, this repo's convention is a JSON payload with an `error` code +
  human-readable `message` field, e.g. `{ "error": "unsupported", "message": "..." }` — keep
  using that shape for consistency across tools, and prefer it to throwing, since the model can
  read the message and retry with different arguments.
- **Never fabricate — the `limitations` pattern.** When a value can't be computed with
  certainty, return `null` for that field and add a plain-English reason to a
  `limitations: string[]` array in the payload, rather than omitting the field or guessing.
  `packages/core/domain/stats.ts` (`computeGrowthMetrics`) is the reference implementation.
- **Reuse before fetching.** Check `content.findIdByHash`/the relevant repository for a cached
  result before hitting a provider again (see `get_comments`/`get_content_ideas` sharing the same
  `CommentsRepository` cache). Never refetch data that's already in SQLite for the same
  `content_hash`.
- **Document the tool everywhere a human would look for it**: the tool table in both
  `README.md` and `apps/mcp-server/README.md`, a bullet in "What it's for" if it answers a
  concrete creator question, `docs/architecture.md` if it introduces a new domain module, and a
  `knownLimitations` entry in `capabilities.ts` if it has a non-obvious failure mode.
- **Tests**: pure logic (anything in `packages/core`) gets unit tests. Tools that just wire a
  provider call together can stay untested if the wiring is trivial, but any non-trivial
  transformation (like `retention.ts`'s `withTranscript` or `content-ideas.ts`'s
  `buildContentIdeas`) should be exported and tested in isolation from the network-touching
  handler.

## Architecture reference

See [`docs/architecture.md`](docs/architecture.md) for the current system design and
[`README.md`](README.md) for the tool list and installation instructions. If you change the
architecture, update both in the same change — a doc that contradicts itself (as happened in the
incident above) is worse than no doc.
