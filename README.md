# Perch

**A privacy-first, local-only RSS reader that lives in your browser.**

Perch is a cross-browser extension (Chrome, Edge, Brave, Firefox) for discovering and reading
RSS, Atom, and JSON feeds. There is no account, no cloud sync, no telemetry, and no third-party
backend. Every feed, every category, every read/unread flag, and every cached article stays in
your browser's local storage. The only network requests Perch ever makes are to the feeds,
articles, and favicons **you** have added.

It has two surfaces:

- **A toolbar popup** for discovering feeds on the page you're looking at and adding/removing them.
- **A full-screen reader** — a modern, FreshRSS/Feedly-style reading experience with a sidebar,
  categories, unread counts, and per-article summary / full-text modes.

<!-- SCREENSHOT: docs/screenshots/reader.png — the full-screen reader, dark mode -->
<!-- SCREENSHOT: docs/screenshots/popup.png — the toolbar popup showing a discovered feed -->
<!-- GIF: docs/screenshots/discovery.gif — visiting a blog, red dot appears, add from popup -->

---

## Why Perch is different

Most "RSS reader" extensions ask for **"Read and change all your data on all websites"** the
moment you install them. Perch does not. It ships with **zero host permissions**. The scary
install warning never appears.

| What Perch asks for | When | Why |
| --- | --- | --- |
| `storage` | install | Store your feed list, categories, and settings. |
| `activeTab` | install | Read the current tab's `<head>` for feed `<link>` tags — but **only** when you open the Perch popup, and **only** for that one tab. |
| `scripting` | install | Inject the one-shot "find `<link rel=alternate>`" reader into the active tab (paired with `activeTab`). |
| `alarms` | install | Refresh your feeds on a schedule in the background. |
| `*://*/*` (optional) | only if you turn on **"Auto-discover feeds on every site"** in Settings | Scan pages for feeds as you browse and show a red dot on the toolbar icon. Toggling the setting off **immediately revokes** this. |
| a single origin, e.g. `https://example.com/*` (optional) | when you add a feed, or open **Full text** for an article from a new domain | Fetch that one site's feed / article HTML. Access grows only for sites you actually use. |

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

```
src/
├─ entrypoints/
│  ├─ background.ts        Service worker: alarm-driven refresh, message router,
│  │                       toolbar badge, optional auto-discovery listener.
│  ├─ popup/               React. Discover / add / remove feeds for the current site.
│  ├─ reader/              React + HashRouter. The full-screen reading app:
│  │  ├─ components/       Sidebar, StreamView, ArticleList, ArticlePane, dialogs, toasts.
│  │  └─ pages/Settings    All user settings (also the extension's options page).
│  └─ options/             Thin redirect to reader.html#/settings.
├─ lib/
│  ├─ parser/              RSS 2.0 / RDF, Atom, JSON Feed → one normalised shape.
│  │                       XML via fast-xml-parser (no DOM → runs in the worker).
│  ├─ discovery/           link-tag collector, candidate URL builder, bounded prober.
│  ├─ storage/             storage.local (settings, feeds, categories) +
│  │                       IndexedDB via idb (articles, full-text cache).
│  ├─ feeds/               refresh orchestration (conditional GET, upsert, prune), favicons.
│  ├─ readability/         reader-page-only full-text fetch + @mozilla/readability + sanitise.
│  ├─ permissions/         runtime host-permission helpers.
│  ├─ sanitize.ts          DOMPurify wrapper (render-time only).
│  ├─ messaging.ts         tiny typed wrapper over runtime.sendMessage.
│  └─ badge.ts             the red discovery dot.
├─ components/ hooks/      shared React primitives and hooks.
└─ assets/                 Tailwind entry + design tokens.
tests/                     Vitest: parser, dates, discovery, storage (fake-indexeddb),
                           and a jsdom smoke test that mounts the whole reader.
```

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

- **Chrome / Edge / Brave:** `chrome://extensions` → enable *Developer mode* → *Load unpacked*
  → pick `.output/chrome-mv3/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick
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
node scripts/gen-icons.mjs   # regenerate the PNG icons from code
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
