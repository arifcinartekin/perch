# Perch

**A calm, private feed reader — in your browser, on iPhone and on Android. Local by default,
synced if you want, and never watching what you read.**

Perch reads RSS, Atom and JSON feeds. It has no telemetry, no ads and no trackers, and it needs no
account: your subscriptions, categories, read and starred articles, notes and settings live on
your device. It comes as:

- **A browser extension** (Chrome, Edge, Brave, Firefox) with a toolbar popup that finds the
  feeds on the page you're on, and a full-screen reader.
- **An iPhone and iPad app** with widgets, which fetches feeds on the phone itself.
- **An Android app**, native too, fetching feeds on the phone.
- **A web reader** on any Perch Server you run, which keeps its library in your browser too.

The reader is calm and uncluttered — ink, cream and ember on frosted glass, with a sidebar,
collapsible categories, unread counts and one-column reading. Full articles load by themselves
(Mozilla Readability), with the feed's own content as a fallback. Search covers the open feed,
category or everything (<kbd>/</kbd> or <kbd>⌘K</kbd>). Under **Settings → Appearance** you pick
the background, accent and button colours for the light and dark themes, and a background
picture.

### Three separate things

Perch keeps these apart on purpose, so you can tell exactly what goes where.

1. **Your library is always on your device.** Feeds are fetched by the device itself (the web
   reader asks its server to fetch them anonymously, because a web page isn't allowed to).
   No favicons are loaded: they would tell each site that you follow it.
2. **Sync is optional**, under Settings → Sync, one way per library:
   - **Sync chain — no account.** Start a chain on one device, scan its QR code or type its code
     on the others. Everything is encrypted on your devices with keys derived from the code; the
     relay (`sync.perch.ws`, [your own](#run-your-own-relay), or any Perch Server with
     `PERCH_CHAIN` on) can order the records but not read them, and doesn't even see feed addresses. The devices in a chain list each
     other, sealed like everything else.
   - **Your own Perch Server.** Self-hosters and organisations can run a server that keeps each
     account's library and fetches its feeds ([apps/server](./apps/server/README.md)).
3. **A Perch account is only a name for sharing,** on a Perch Server someone runs (Perch itself
   hosts none): a username, a password and a recovery code — no email. You need it only to
   **share a note** as a public page; it doesn't sync anything. Passwords never leave the device:
   Perch derives a key with Argon2id and sends only that.

### Notes and sharing

Write a markdown note on any article. Notes are private and sync with the rest of your library.
Pass one on as text from any app. Signed in to a Perch Server, **Share** publishes a copy at a
random address (`<server>/shared/…`) under your @username; editing the note updates the page,
deleting it takes the page down. Every shared page has a report form; server admins handle
reports from the account page.

### Also

- **Starter packs and Explore:** on an empty library, and any time from the compass in the
  top bar (Feeds tab on the iPhone), add a whole pack or single feeds: a few well-known feeds per topic (science, space,
  technology, privacy and security, self-hosting, world news; Turkish packs too), picked by hand
  and listed in [`packages/core/src/starter-packs.ts`](./packages/core/src/starter-packs.ts).
  They ship inside the apps, so choosing one tells no server anything.
- **Export / import** subscriptions as OPML, or the extension's full JSON backup.
- **App lock:** a 6-digit PIN in the extension, and a PIN with Face ID, Touch ID or a fingerprint
  on the phones.
- **Six app icons** on the iPhone (Settings → App icon), drawn from the same vector mark.
- **Recovery codes** instead of password-reset email, saved as a PDF; accounts can be deleted
  from every app.

### Privacy you can check

The official services are run by one person, without commercial purpose, and are deliberately
small: this site and **sync.perch.ws**, a relay for sync chains that stores only records it
can't read — no accounts, no email addresses, no access logs, no IP addresses, no libraries.
Questions and ideas go to [GitHub Discussions](https://github.com/arifcinartekin/perch/discussions). Server images are built and attested by this repository's CI, and the
server reports the commit it runs — see [perch.ws/transparency](https://perch.ws/transparency),
the [privacy policy](https://perch.ws/privacy) and the [terms](https://perch.ws/terms). Servers
run by anyone else are their operators' responsibility.

### Run your own relay

`sync.perch.ws` already can't read what it stores; running your own relay keeps even the
encrypted records on a machine you control. It is the same Perch Server image in `relay` mode:
only the chain API, no accounts, no web app, no logs.

On a fresh Ubuntu VPS with a DNS record (`relay.example.com`, grey cloud on Cloudflare) pointing
at it:

```sh
curl -fsSL https://raw.githubusercontent.com/arifcinartekin/perch/main/deploy/setup.sh \
  | sudo bash -s -- relay.example.com
echo 'PERCH_MODE=relay' | sudo tee -a /opt/perch/deploy/.env
sudo /opt/perch/deploy/update.sh
curl -s https://relay.example.com/api/v1/server     # "mode":"relay","chain":true
```

Or behind a reverse proxy you already run:

```sh
docker run -d --restart unless-stopped -p 127.0.0.1:8080:8080 -v perch-relay:/data \
  -e PERCH_MODE=relay -e PERCH_TRUST_PROXY=true ghcr.io/arifcinartekin/perch-server:<commit>
```

Then, on one device, Settings → Sync → Relay → **Use another** → `relay.example.com` → Start a
chain. Devices that scan its QR code get the relay address with it; on a device where you type
the code, set the same relay first. Moving an existing chain needs no tool: every device already
holds the whole library, so leave the old chain and start or join one on your relay. Records
expire on the same schedule as on sync.perch.ws (read, unstarred items after 60 days, deletions
after 90, unused chains after 180). The relay must be reachable over HTTPS from the public
internet; the phones refuse plain HTTP except on the local network (iOS) or in debug builds
(Android). Every setting is in [apps/server/README.md](./apps/server/README.md) and
[deploy/README.md](./deploy/README.md).

<!-- SCREENSHOT: docs/screenshots/reader.png — the full-screen reader, dark mode -->
<!-- SCREENSHOT: docs/screenshots/popup.png — the toolbar popup showing a discovered feed -->
<!-- GIF: docs/screenshots/discovery.gif — visiting a blog, orange dot appears, add from popup -->

---

## Why Perch is different

Most "RSS reader" extensions ask for **"Read and change all your data on all websites"** the
moment you install them. Perch does not. It ships with **zero host permissions**. The scary
install warning never appears.

| What Perch asks for                                      | When                                                                        | Why                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                | install                                                                     | Store your feed list, categories, and settings.                                                                                       |
| `activeTab`                                              | install                                                                     | Read the current tab's `<head>` for feed `<link>` tags — but **only** when you open the Perch popup, and **only** for that one tab.   |
| `scripting`                                              | install                                                                     | Inject the one-shot "find `<link rel=alternate>`" reader into the active tab (paired with `activeTab`).                               |
| `alarms`                                                 | install                                                                     | Refresh your feeds on a schedule in the background.                                                                                   |
| `*://*/*` (optional)                                     | only if you turn on **"Auto-discover feeds on every site"** in Settings     | Scan pages for feeds as you browse and show an orange dot on the toolbar icon. Toggling the setting off **immediately revokes** this. |
| a single origin, e.g. `https://example.com/*` (optional) | when you add a feed, or open **Full text** for an article from a new domain | Fetch that one site's feed / article HTML. Access grows only for sites you actually use.                                              |
| your relay's or server's origin (optional)               | when you start or join a sync chain, or sign in                             | Talk to the relay or server you chose. Leaving or signing out keeps your data on the device.                                          |

In Firefox the manifest also declares what is sent, and only once you turn it on
(`data_collection_permissions`: nothing required; optionally your library for sync, your
sign-in and username for accounts, and the notes you share). Firefox asks for it in the same
prompt as the relay's or server's origin.

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

3. **The orange dot.** If Perch finds one or more feeds you haven't added, it puts a small orange dot
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
  the Perch icon. No background scanning. No orange dot until you open the popup.
- **Opt in (`*://*/*` granted):** background scanning + a live orange dot as you browse. Turn the
  setting off and Perch calls `permissions.remove` — the access is gone immediately.

Adding a feed always requests just that feed's origin (e.g. `https://blog.example.com/*`) so the
background refresher can fetch it. If you decline, the feed is still added but flagged
"needs access", with a one-click **Grant access** button in its edit dialog.

---

## Architecture

Perch is an npm-workspaces monorepo. Everything that doesn't depend on a browser lives in
`packages/core`, so the server shares the exact same parsing, ids and search as the
extension. The iPhone app is Swift: like the extension it works on its own, fetching feeds on
the phone, or talks to a server. Its Swift ports of the protocol (key derivation included) and
of the feed and article ids are tested against the TypeScript ones. The Android app (Kotlin,
Compose) is local-first in the same way, with Kotlin ports tested the same way. The reading app itself lives in `packages/reader` and runs twice:
in the extension over local storage, and on the web — either over the same local code run in
the page (on a hub) or over a personal server's API. One UI, behind one `ReaderBackend`
interface.

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
│  ├─ src/chain.ts         sync chains: the code, key derivation, sealed records.
│  ├─ src/notes.ts         notes and safe markdown rendering.
│  ├─ src/pow.ts           the sign-up proof of work.
│  ├─ src/recovery.ts      recovery codes; recovery-pdf.ts writes the PDF.
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
│  │  │                    extension-only settings (discovery, sync, Perch account, backup,
│  │  │                    lock).
│  │  └─ options/          Thin redirect to reader.html#/settings.
│  ├─ src/lib/
│  │  ├─ discovery/        link-tag collector (scripting API) + orchestration.
│  │  ├─ storage/          storage.local (settings, feeds, categories) +
│  │  │                    IndexedDB via idb (articles, full-text cache, wallpaper).
│  │  ├─ feeds/            refresh orchestration (conditional GET, upsert, prune).
│  │  ├─ readability/      reader-page-only full-text fetch + @mozilla/readability + sanitise.
│  │  ├─ permissions/      runtime host-permission helpers.
│  │  ├─ sync/             Perch Server sign-in and sync chains, sync engine (pull → merge →
│  │  │                    push), triggers.
│  │  ├─ backend.ts        the reader's data layer (ReaderBackend over local storage).
│  │  └─ backup.ts …       JSON backup, messaging, badge, PIN lock.
│  └─ tests/              Vitest: storage (fake-indexeddb), backup, and a jsdom smoke test.
├─ android/                The Android app, local-first (Kotlin, Compose, Liquid Glass via Haze). See apps/android/README.md.
├─ ios/                    The iPhone and iPad app with widgets, local or synced (SwiftUI, iOS 26+). See apps/ios/README.md.
│  ├─ Perch/               tabs and screens, sessions (Keychain), sync chain, Perch account,
│  │                       app lock, QR scanning, offline sync and image cache, background
│  │                       refresh, live updates over Server-Sent Events.
│  └─ PerchKit/            Swift package: API client and types, a port of core/theme.ts, the
│                          offline store (SQLite), Argon2id + HKDF key derivation (reference C
│                          Argon2); `swift test` on the Mac.
├─ web/                    The web app (Vite PWA), served by the server. On a hub: the reader with
│                          its library in the browser (the extension's lib/ code run with a small
│                          stand-in for the WebExtension API, src/local/) and the Perch account
│                          at /account. On a personal server: @perch/reader over the server API.
└─ server/                 Perch Server: self-hostable. `personal` mode keeps libraries and
   │                       fetches feeds; `hub` mode holds Perch accounts and shared notes only;
   │                       `relay` mode is only a sync-chain relay (how sync.perch.ws runs).
   ├─ src/auth/            accounts, sessions, devices, invites, recovery codes, the sign-up
   │                       proof of work, optional email (codes; addresses kept only as hashes).
   ├─ src/feeds/           SSRF-safe fetcher, background worker, subscribe-from-any-URL.
   ├─ src/reader/          reader API: articles, search, read state, OPML, settings.
   ├─ src/fulltext/        Readability (linkedom) for the web reader, cached per article.
   ├─ src/sync/            sync records (last writer wins), change feed, Server-Sent Events.
   ├─ src/chain/           the relay for sync chains: sealed records it can order, not read.
   ├─ src/notes/           notes, shared pages, reports.
   ├─ src/proxy/           a hub's anonymous feed fetcher for the web reader.
   ├─ src/db/              Drizzle schema (SQLite); migrations in drizzle/.
   └─ tests/               Vitest against an in-memory database and a local feed server.
```

Running your own server is covered in [apps/server/README.md](./apps/server/README.md), and
the official deployment in [deploy/README.md](./deploy/README.md). The landing page and the
privacy policy, terms and transparency pages are in `site/`.

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
npm run brand          # regenerate every icon (extension, web, iOS) from brand/src
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
