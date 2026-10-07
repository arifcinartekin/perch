# Contributing to Perch

Thanks for helping. Perch has a small, deliberate scope, so a little alignment up front saves
everyone time.

## Principles (please don't regress these)

1. **Local only.** No servers, no analytics, no telemetry, no third-party APIs. The only network
   requests are to feeds/articles/favicons the user has explicitly added.
2. **Minimal permissions.** No host permissions at install. Anything broader is optional,
   requested at runtime from a user gesture, clearly explained, and revocable. If a feature
   needs a new permission, that needs discussion first.
3. **Few dependencies.** The runtime dependency list is short on purpose (auditability). Adding
   one needs a good reason in the PR description.
4. **Cross-browser.** Chromium and Firefox, Manifest V3, one codebase. Use the `browser.*` API
   from `wxt/browser`, never `chrome.*` directly.
5. **English-only UI.**

## Getting set up

```bash
npm install
npm run dev            # Chrome + HMR
npm run dev:firefox    # Firefox
```

## Before you open a PR

```bash
npm run typecheck
npm test
npm run format
npm run build && npm run build:firefox
```

All of these run in CI too.

## Where things live

- **Feed parsing** — `packages/core/src/parser/`. Pure functions, no DOM (must run in the service
  worker and on the server). If you fix a real-world feed quirk, add a fixture in
  `packages/core/tests/fixtures/` and a case in `packages/core/tests/parser.test.ts`.
- **Discovery** — `packages/core/src/discovery/` (candidates, probing) and
  `apps/extension/src/lib/discovery/` (link tags via the scripting API). Keep the candidate list capped; keep probing bounded and
  polite (short timeout, small read, stop early).
- **Storage** — `apps/extension/src/lib/storage/`. `storage.local` for small records, IndexedDB (`idb`) for
  articles/full-text. Never overwrite a user's read/starred state on refresh.
- **Background** — `apps/extension/src/entrypoints/background.ts` + `apps/extension/src/lib/background/`. Assume the worker can
  restart at any time.
- **UI** — `apps/extension/src/entrypoints/popup/` (small, fast) and
  `apps/extension/src/entrypoints/reader/` (the main app). Shared bits in `src/components/` and
  `src/hooks/`.
- **Anything platform-independent** (ids, OPML, search, theming, types) belongs in
  `packages/core` so the server and mobile app can reuse it.

## Commit / PR style

- Small, focused PRs.
- Describe the user-facing change and any permission/dependency implications.
- Add or update tests for parser/discovery/storage changes.

## Reporting feed bugs

Include the feed URL (or, better, a minimal XML/JSON snippet that reproduces it) and what you
expected vs. what Perch showed.
