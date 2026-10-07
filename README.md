# Perch

**A privacy-first RSS reader that lives in your browser — local by default, synced if you want.**

Perch is a cross-browser extension (Chrome, Edge, Brave, Firefox) for discovering and reading
RSS, Atom, and JSON feeds. It needs no account, has no telemetry and no third-party backend.
Every feed, every category, every read/unread flag, and every cached article stays in your
browser's local storage. The only network requests Perch makes are to the feeds, articles, and
favicons **you** have added — and, only if you turn on sync, to a
[Perch Server](./apps/server/README.md) you choose.

It has two surfaces:

- **A toolbar popup** for discovering feeds on the page you're looking at and adding/removing them.
- **A full-screen reader** — a clean, greyscale, FreshRSS/Feedly-style reading experience with a
  sidebar, collapsible categories, unread counts, and one-column article reading. Articles load
  their full text automatically (via Mozilla Readability) with the feed's own content as a
  fallback; there's no mode switch and no button to press. A search bar across the top
  searches the open feed, category or everything (<kbd>/</kbd> or <kbd>⌘K</kbd> to focus).

Power users can make it their own under **Settings → Appearance**: pick the background, accent and
button colours (separately for the light and dark theme — text contrast adjusts automatically),
and set a background image for the full-screen reader with dim and blur controls.

**Sync (optional).** Connect a self-hosted Perch Server under **Settings → Sync** and your
subscriptions, categories, read and starred articles, and settings follow you across browsers
(and, soon, the mobile app). Your password never leaves the device — Perch derives a key from it
with Argon2id and sends only that. The PIN and background image stay per device.

It also does the things a local-first tool should: **export / import** your subscriptions (OPML
or a full JSON backup), and an optional **6-digit PIN** to keep a passer-by out of your reader.

<!-- SCREENSHOT: docs/screenshots/reader.png — the full-screen reader, dark mode -->
<!-- SCREENSHOT: docs/screenshots/popup.png — the toolbar popup showing a discovered feed -->
<!-- GIF: docs/screenshots/discovery.gif — visiting a blog, red dot appears, add from popup -->

---

## Why Perch is different

Most "RSS reader" extensions ask for **"Read and change all your data on all websites"** the
moment you install them. Perch does not. It ships with **zero host permissions**. The scary
install warning never appears.

| What Perch asks for                                      | When                                                                        | Why                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                | install                                                                     | Store your feed list, categories, and settings.                                                                                     |
| `activeTab`                                              | install                                                                     | Read the current tab's `<head>` for feed `<link>` tags — but **only** when you open the Perch popup, and **only** for that one tab. |
| `scripting`                                              | install                                                                     | Inject the one-shot "find `<link rel=alternate>`" reader into the active tab (paired with `activeTab`).                             |
| `alarms`                                                 | install                                                                     | Refresh your feeds on a schedule in the background.                                                                                 |
| `*://*/*` (optional)                                     | only if you turn on **"Auto-discover feeds on every site"** in Settings     | Scan pages for feeds as you browse and show a red dot on the toolbar icon. Toggling the setting off **immediately revokes** this.   |
| a single origin, e.g. `https://example.com/*` (optional) | when you add a feed, or open **Full text** for an article from a new domain | Fetch that one site's feed / article HTML. Access grows only for sites you actually use.                                            |
| your Perch Server's origin (optional)                    | when you connect sync in Settings                                           | Talk to the sync server you chose. Signing out keeps your data on the device.                                                       |

The extension pages also allow `'wasm-unsafe-eval'` in their content security policy. That lets
Perch run its own bundled Argon2id (WebAssembly) when you sign in to a sync server; it does not
allow loading code from anywhere.

Everything is auditable: it's a small codebase, the dependency list is short and boring, and the
build is reproducible with `npm ci && npm run build`.

---

## How feed discovery works

1. **`<link>` tag detection (primary).** Perch injects a tiny function into the current tab that
   reads `<link rel="alternate" type="application/rss+xml">` / `application/atom+xml` /
   `application/feed+json` tags from the page `<head>`. This is fast and accurate and always runs
   first. It uses `activeTab`, so it only happens for the tab you're on, when you ask for it.

2. **Bounded path probing (fallback).** If the page advertises no feed links, Perch probes a
   **capped list of ~18 well-known locations** on the same origin (`/feed`, `/rss.xml`,
   `/atom.xml`, `/index.xml`, `/feeds/posts/default`, `/?feed=rss2`, …). Each probe is a single
   `GET` with a ~3.5s timeout; Perch reads only the first couple of kilobytes and confirms it's
   really a feed by checking the `Content-Type` **and** sniffing the bytes (`<rss`, `<feed`,
   `<?xml`, `jsonfeed.org`). It stops early once it has found enough, and never makes more than
   the capped number of requests.

3. **The red dot.** If Perch finds one or more feeds you haven't added, it puts a small red dot
   on the toolbar icon.
   - By default this happens when you **open the popup** (via `activeTab`).
   - If you opt in to **auto-discovery** (Settings → Feed discovery), Perch also scans pages in
     the background as you browse, using the optional `*://*/*` permission. Cross-origin
     subdomain guesses (`rss.example.com`, `feeds.example.com`) are only tried in this mode,
     because they can't work without that permission anyway.

### The trade-off, honestly

Proactively showing "this site has a feed" while you browse **fundamentally requires** the
browser to let the extension see which sites you're on. There is no way around that. Perch's
answer is to make it **opt-in and instantly revocable** instead of demanded at install:

- **Default (no host permission):** discovery runs on the active tab, on demand, when you click
  the Perch icon. No background scanning. No red dot until you open the popup.
- **Opt in (`*://*/*` granted):** background scanning + a live red dot as you browse. Turn the
  setting off and Perch calls `permissions.remove` — the access is gone immediately.

Adding a feed always requests just that feed's origin (e.g. `https://blog.example.com/*`) so the
background refresher can fetch it. If you decline, the feed is still added but flagged
"needs access", with a one-click **Grant access** button in its edit dialog.

---

## Architecture

Perch is an npm-workspaces monorepo. Everything that doesn't depend on a browser lives in
`packages/core`, so the server and the upcoming mobile app share the exact same parsing, ids
and search as the extension. The reading app itself lives in `packages/reader` and runs twice:
in the extension over local storage, and on the web over the Perch Server API — one UI, two
data layers behind the same `ReaderBackend` interface.

```
packages/
├─ core/                   Platform-independent, no DOM, no browser APIs.
│  ├─ src/parser/          RSS 2.0 / RDF, Atom, JSON Feed → one normalised shape
│  │                       (fast-xml-parser, so it runs in a service worker or on Node).
│  ├─ src/discovery/       candidate URL builder + bounded prober.
│  ├─ src/feeds.ts         stable feed ids, display titles.
│  ├─ src/auth.ts          client-side Argon2id key derivation.
│  ├─ src/api.ts           Perch Server request / response types.
│  ├─ src/username.ts      username rules and look-alike folding.
│  ├─ src/sync.ts          sync records, protocol types, hybrid logical clock.
│  ├─ src/opml.ts          OPML import / export.
│  ├─ src/search.ts        accent-insensitive article search.
│  ├─ src/theme.ts         custom colour palettes.
│  ├─ src/types.ts         shared domain types.
│  └─ tests/               Vitest: parser, dates, normalisation, discovery, colours.
└─ reader/                 The reading app (React): sidebar, streams, article pane,
                           settings, theme. Talks to data only through src/backend.ts.
apps/
├─ extension/              The WXT browser extension.
│  ├─ src/entrypoints/
│  │  ├─ background.ts     Service worker: alarm-driven refresh, message router,
│  │  │                    toolbar badge, optional auto-discovery listener.
│  │  ├─ popup/            React. Discover / add / remove feeds for the current site.
│  │  ├─ reader/           @perch/reader over local storage, plus the PIN gate and the
│  │  │                    extension-only settings (discovery, sync, backup, lock).
│  │  └─ options/          Thin redirect to reader.html#/settings.
│  ├─ src/lib/
│  │  ├─ discovery/        link-tag collector (scripting API) + orchestration.
│  │  ├─ storage/          storage.local (settings, feeds, categories) +
│  │  │                    IndexedDB via idb (articles, full-text cache, wallpaper).
│  │  ├─ feeds/            refresh orchestration (conditional GET, upsert, prune).
│  │  ├─ readability/      reader-page-only full-text fetch + @mozilla/readability + sanitise.
│  │  ├─ permissions/      runtime host-permission helpers.
│  │  ├─ sync/             Perch Server sign-in, sync engine (pull → merge → push), triggers.
│  │  ├─ backend.ts        the reader's data layer (ReaderBackend over local storage).
│  │  └─ backup.ts …       JSON backup, messaging, badge, PIN lock.
│  └─ tests/              Vitest: storage (fake-indexeddb), backup, and a jsdom smoke test.
├─ web/                    The web reader (Vite PWA): sign-in, @perch/reader over the server
│                          API, account / devices / invites / OPML settings. Served by the server.
└─ server/                 Perch Server: self-hostable, fetches feeds, serves every device.
   ├─ src/auth/            accounts, sessions, devices, invites.
   ├─ src/feeds/           SSRF-safe fetcher, background worker, subscribe-from-any-URL.
   ├─ src/reader/          reader API: articles, search, read state, OPML, settings.
   ├─ src/fulltext/        Readability (linkedom) for the web reader, cached per article.
   ├─ src/sync/            sync records (last writer wins), change feed, Server-Sent Events.
   ├─ src/db/              Drizzle schema (SQLite); migrations in drizzle/.
   └─ tests/               Vitest against an in-memory database and a local feed server.
```

Running your own server is covered in [apps/server/README.md](./apps/server/README.md).

### Stack

[WXT](https://wxt.dev) + React + TypeScript + Tailwind CSS v4, Manifest V3 on **both** Chromium
and Firefox (Gecko 128+). WXT emits the right background format per engine
(`service_worker` vs `background.scripts`) and provides the promise-based `browser.*` API
(via `webextension-polyfill` semantics) so there is a single codebase and no hand-maintained
second manifest.

**Runtime dependencies** (deliberately few): `react`, `react-dom`, `react-router-dom`,
`fast-xml-parser`, `@mozilla/readability`, `dompurify`, `idb`.

### Data model

- **`storage.local`** — `settings`, `feeds[]`, `categories[]`. Small, synchronous-feeling,
  watched for cross-context sync.
- **IndexedDB (`perch`)** — `articles` (keyed by a stable hash of feed + guid/link, so read
  state survives refreshes), `fulltext` (Readability output cache, LRU-trimmed), `meta`.
- Feed refresh does a conditional `GET` (`ETag` / `Last-Modified`); a `304` skips parsing
  entirely. New items are inserted, existing items have their content updated but never their
  read/starred state, and old read items are pruned (keep newest N per feed, drop read items
  older than 60 days).

---

## Install from source

Requires Node 20+ and npm.

```bash
git clone <this-repo> perch
cd perch
npm install
```

### Run in development

```bash
npm run dev            # launches Chrome with the extension loaded + HMR
npm run dev:firefox    # launches Firefox
```

### Build an unpacked extension

```bash
npm run build          # -> .output/chrome-mv3/
npm run build:firefox  # -> .output/firefox-mv3/
npm run zip            # packaged .zip for the Chrome Web Store
npm run zip:firefox    # packaged .zip for AMO
```

**Load it manually:**

- **Chrome / Edge / Brave:** `chrome://extensions` → enable _Developer mode_ → _Load unpacked_
  → pick `.output/chrome-mv3/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_ → pick
  `.output/firefox-mv3/manifest.json`.

### Store links

- Chrome Web Store: _coming soon_
- Firefox Add-ons (AMO): _coming soon_
- Edge Add-ons: _coming soon_

---

## Development

```bash
npm run typecheck     # wxt prepare + tsc --noEmit
npm test              # vitest
npm run test:watch
npm run format        # prettier
node apps/extension/scripts/gen-icons.mjs   # regenerate the PNG icons from code
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests, and both production builds on every push
and PR.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). In short: keep the
dependency list small, keep permissions minimal and clearly justified, keep everything local,
and add a test when you touch the parser, discovery, or storage layers.

## License

[MIT](./LICENSE). Perch is genuinely open source and meant to be audited.
