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

## Architecture reference

See [`docs/architecture.md`](docs/architecture.md) for the current system design and
[`README.md`](README.md) for the tool list and installation instructions. If you change the
architecture, update both in the same change — a doc that contradicts itself (as happened in the
incident above) is worse than no doc.
