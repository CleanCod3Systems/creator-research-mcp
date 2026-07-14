# Instagram public support design

## Goal

Improve Instagram support while keeping the project lightweight, local, stable, and honest about what can be fetched. The server must not request API tokens, OAuth credentials, browser cookies, or use a shared service.

## Scope

- Support public individual Instagram post, reel, and video URLs through the existing `yt-dlp` provider.
- Return metadata and the native Instagram caption when available.
- Treat profile listing as unsupported for automatic extraction; keep `import_profile_snapshot` as the manual path.
- Do not advertise Instagram comments until the extractor behavior is verified by a reproducible provider-specific test or fixture.
- Return structured public-only authentication/rate-limit errors without instructing users to export cookies.

## Implementation shape

- Keep the existing `ContentProvider` interface and `InstagramProvider`.
- Make Instagram's capability declaration conservative for comments.
- Keep `yt-dlp` as the only Instagram dependency and avoid adding a second scraper or browser runtime.
- Add deterministic unit tests for URL matching, URL classification, public-only error wording, and caption fallback behavior.
- Update both READMEs, architecture notes, provider configuration, and the runtime capability limitations so the same contract is visible everywhere.

## Non-goals

- Meta Graph API, OAuth, API tokens, shared authentication brokers, browser automation, profile scraping, or guessed metrics.
- Claiming that Instagram comments work based only on generic `yt-dlp` command flags.

## Acceptance criteria

- Public individual URL behavior remains available.
- Authentication or rate-limit failures do not ask for credentials or cookies.
- Instagram comments are not exposed as a guaranteed capability without evidence.
- Tests cover the provider's pure classification and text behavior.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` passes.
