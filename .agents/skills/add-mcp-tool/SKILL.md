---
name: add-mcp-tool
description: Use when adding a new MCP tool to creator-research-mcp, or reviewing whether an existing one follows this repo's conventions and the MCP spec.
---

# Adding an MCP tool to creator-research-mcp

Read [`AGENTS.md`](../../../AGENTS.md) first — this is the step-by-step recipe for its
"MCP tool design conventions" section and its non-negotiable principles (client-reasoning only,
no shared infra, lightweight, never fabricate, English only). Don't build anything here that
contradicts that file; if it seems like it might, stop and ask the user.

This applies regardless of which AI tool or agent you're using — Claude Code, Cursor, Codex,
Copilot, or a human contributor reading it directly.

## 1. Decide where the logic lives

- **Pure, testable transformation** (stats, clustering, text parsing) → a new file in
  `packages/core/src/domain/`, exported from `packages/core/src/index.ts`. No I/O in this layer.
- **Fetching from a platform** → `packages/providers/src/`, implementing (a subset of) the
  `ContentProvider` interface from `packages/core/src/ports/provider.ts`.
- **The MCP tool itself** → `apps/mcp-server/src/tools/<name>.ts`, registered in
  `apps/mcp-server/src/server.ts`.

Look at `apps/mcp-server/src/tools/retention.ts` (joins two existing data sources
deterministically) and `apps/mcp-server/src/tools/content-ideas.ts` (fetches + reuses a cached
repository + calls into a `packages/core` pure function) as the two reference shapes for a new
tool — most new tools look like one of these two.

## 2. Write the tool

- `server.registerTool("tool_name", { title, description, inputSchema }, handler)`.
- Name: `snake_case`, verb_noun, under 64 chars.
- `inputSchema`: Zod object, every non-obvious field gets `.describe(...)`.
- `description`: state the data source, what the tool does NOT do, and any usage hint the model
  needs at decision time (see `get_transcript`'s note about grounding scripts in the creator's
  real voice for the pattern).
- Set `annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }`
  unless the tool genuinely isn't read-only (nothing in this repo currently isn't).
- Errors: return `{ error: "<code>", message: "<human-readable reason>" }` as the JSON payload
  for expected failures (unsupported source, missing data, provider failure) instead of
  throwing. Reserve throwing/rejecting for genuine programming errors.
- Never compute a metric you can't be sure of — return `null` for that field and push a
  plain-English reason onto a `limitations: string[]` array in the payload instead.
- If a repository/cache already holds the data (check `content.findIdByHash` + the relevant
  `*Repository.getForItem`/`get*` method in `packages/db/src/repositories.ts`), reuse it instead
  of refetching.

## 3. Register it

Add the import + `register...Tool(server)` call in `apps/mcp-server/src/server.ts`.

## 4. Test it

- Any exported pure function (parsing, scoring, clustering, the `with*`/`build*` helpers) gets a
  `<name>.test.ts` next to it, covering at least: the happy path, an edge case with no/partial
  data, and — if relevant — the exact "never fabricate" behavior (nulls + limitations).
- Tool handlers that just wire a provider call together don't need their own test if the wiring
  is trivial and the interesting logic is already tested at the pure-function level.

## 5. Document it everywhere a human would look

- Tool table in **both** `README.md` and `apps/mcp-server/README.md` (they're duplicated on
  purpose — one is the GitHub landing page, the other is what renders on the npm page).
- A bullet under "What it's for" in both READMEs if the tool answers a concrete creator
  question (most do).
- `docs/architecture.md` if the tool introduces a new `packages/core` domain module.
- A `knownLimitations` entry in `apps/mcp-server/src/tools/capabilities.ts` if the tool has a
  non-obvious failure mode (needs a minimum sample size, only works for one platform, etc.).

## 6. Verify before calling it done

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

All four, not a subset. Then bump the version in all 4 `package.json` files (same number) if
this is meant to ship — but don't push a `v*` tag without the user's explicit go-ahead for that
specific version (see `AGENTS.md` → Publishing).
