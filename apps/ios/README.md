# Perch for iPhone

A native SwiftUI feed reader. Like the extension it needs no account: it opens straight into an
empty library, you add feeds, and the phone fetches them itself. Connect a
[Perch Server](../server/README.md) under Settings → Sync and the library is the server's,
kept in sync with the extension and the web reader. Or, without any account, put the phone's
library in a sync chain with your other devices. iOS 26 or later, so the tab bar, toolbars
and sheets are Liquid Glass.

- **Without a server:** feeds, categories, read and starred articles and settings live on the
  phone. It finds a site's feed (from the page's `<link rel="alternate">`, or the usual
  addresses), reads RSS, RSS 1.0, Atom and JSON Feed, refreshes every quarter of an hour while
  open and in background refresh, and keeps 60 days of articles (starred ones for good). Full
  text comes from the article's page. Feed and article ids are the ones `packages/core` gives,
  so connecting a server later adds the same feeds (read and starred state stay on the phone).
- **Sync chain:** Settings → Sync → Sync chain starts a chain (on `sync.perch.ws`) or joins one
  by its code; scanning a chain's QR code with the Camera opens the app ready to join. Feeds,
  categories, read and starred articles, theme and colours sync with the extension and other
  phones; each device still fetches the feeds itself. The code lives in the Keychain, and the
  relay only sees encrypted records (see `PerchKit/Chain.swift` and
  `LocalBackend+Chain.swift`, the Swift side of `packages/core/src/chain.ts` and the
  extension's sync engine).

- **Tabs:** Unread, Feeds, Starred, Settings and Search. The tab bar tucks away while you
  scroll.
- **iPad:** the same tabs, with split views: feeds, articles and the article side by side in
  Feeds, and the list beside the article in Unread, Starred and Search.
- **Lists:** each row has the feed, a short summary and the article's first picture (from the
  image cache, so it shows offline too; can be turned off). Swipe a row to read or star it.
- **Reading:** stars, keep unread, the site's full text, share, Safari, and the next article.
  Text size and line spacing (kept on the phone), reading time, a progress line, and bars that
  step aside while you scroll down.
- **Library:** add feeds (from a site or feed address), rename them and move them between
  categories. Create, rename, fold and delete categories, and mark a feed, a category or
  everything read.
- **Offline:** without a server everything is on the phone already. With one, the newest
  unread articles (100 to 3000) and every starred one, with their images and any full text you
  opened, stay on the phone. Background refresh keeps them current. Read and star changes made
  offline are queued and sent when the server is back.
- **Personalisation:** everything the extension and web reader have, synced with the account
  when there is one:
  - the theme;
  - separate light and dark colours for background, text, accent and buttons (the same
    palette maths as `core/theme.ts`, with the same presets);
  - glass on/off, transparency and blur;
  - the reading font.

  A background photo with dim and blur stays on this phone, like the extension's wallpaper.

- **Account** (with a server): change password, devices (sign one out), invites for admins.
  OPML import and export work either way.
- **Widgets:** the unread count and the newest unread articles on the Home Screen (small,
  medium, large) and the Lock Screen. Tapping an article opens it.
- **Notifications** (off until turned on in Settings): background refresh posts one when it
  finds new articles.

## Open and run

```bash
open apps/ios/Perch.xcodeproj
```

Pick the **Perch** scheme and an iPhone or iPad simulator (or your device) and run. For a
device, set your team under Signing & Capabilities first, for both the Perch and PerchWidgets
targets; they share the `group.app.perch.ios` app group, which your team needs to be able to
register (change it in both `.entitlements` files and `Shared/WidgetSnapshot.swift` if not).

No server is needed to try it. To sync, on the simulator the app reaches a server on the Mac at
`http://localhost:8080` (`npm run dev:server` from the repo root). On a phone, use the Mac's LAN
address (plain http is allowed only for local addresses) or your public https server.

The project is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen).
After adding or removing files run `xcodegen` in this folder; the generated project is
committed so Xcode opens it directly.

## Layout

| Path                        | What                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `Perch/PerchApp.swift`      | Entry point: the library; live updates while active.               |
| `Perch/App/Session.swift`   | Phone library or server sign-in; the token lives in the Keychain.  |
| `Perch/App/Reader.swift`    | Library, counts, settings, article state, from either backend.     |
| `Perch/App/Brand.swift`     | Palette and the backdrop behind the glass.                         |
| `Perch/Views/`              | Connect, library, article list, article, add feed, settings.       |
| `Perch/App/Glance.swift`    | The widgets' snapshot and new-article notifications.               |
| `PerchWidgets/`             | Widget extension; reads the snapshot, never the server.            |
| `Shared/`                   | Code compiled into both the app and the widgets.                   |
| `PerchKit/`                 | Swift package: API client and types, key derivation, HTML helpers. |
| `PerchKit/…/LocalBackend`   | The library on the phone: fetching, feed discovery, OPML.          |
| `PerchKit/…/FeedParser`     | RSS, RSS 1.0, Atom and JSON Feed; dates as found in the wild.      |
| `PerchKit/Sources/CArgon2/` | The Argon2 reference implementation (20190702, CC0 / Apache-2.0).  |
| `Perch/Assets.xcassets`     | Generated by `npm run brand` from `brand/src`.                     |

## Security notes

- The password never leaves the phone: Argon2id with the account's salt, then HKDF, exactly
  as `packages/core/src/auth.ts`. `PerchKitTests` checks the result against vectors from the
  TypeScript code.
- Article HTML is untrusted. It renders in a `WKWebView` with JavaScript off, a non-persistent
  data store and a CSP that allows only images, media and inline styles; links open in Safari
  instead of navigating the page.
- Images load only through the app's image cache, without cookies, and `srcset` is dropped, so
  nothing in an article reaches the network behind the cache's back.
- No favicons: fetching them would tell each site which feeds you follow.
- Without a server the phone fetches feeds and full-text pages itself, so those sites see its
  address, as they would with the extension. Requests go without cookies or a shared cache.
  Article HTML is stored without scripts, styles, frames and event handlers.
- Signing out deletes the account's offline copy and cached images from the phone, and the
  widgets' snapshot, and goes back to the phone's own library.
- The widgets get titles, feed names and the unread count from a file the app writes to the
  shared app-group folder; they have no token and make no network requests.

## Languages

English and Turkish, in `Perch/Support/Localizable.xcstrings` (and `InfoPlist.xcstrings` for the
permission prompt) and `PerchWidgets/Localizable.xcstrings`. Xcode adds new strings to the catalog when it builds; the app follows the
phone's language.

## Tests

```bash
cd apps/ios/PerchKit && swift test
```

These include the phone library: parsing each feed format, ids checked against
`packages/core`, discovery, OPML, and adding, refreshing and unsubscribing against stubbed
HTTP, and sync chains: the code, keys and sealed records against vectors shared with the
TypeScript tests (each side opens what the other sealed), and two phone libraries syncing
through an in-memory relay. Add `PERCH_TEST_SERVER=http://localhost:8080 PERCH_TEST_USER=… PERCH_TEST_PASSWORD=…` to
also run the live tests (sign in, library, state, events, sign out) against a running server.

Debug builds can open the phone library (`SIMCTL_CHILD_PERCH_DEV_LOCAL=1`, or `=fresh` for an
empty one, which also signs out) or sign in from the launch environment for simulator checks:
`SIMCTL_CHILD_PERCH_DEV_SERVER`, `…_PERCH_DEV_USER`, `…_PERCH_DEV_PASSWORD`, and
`…_PERCH_DEV_OPEN=all|article|feed:<title>` to open a screen, `…_PERCH_DEV_TAB=<tab>`, and
`…_PERCH_DEV_BACKGROUND=1` to run a background refresh as soon as the app goes to the
background (`=new` treats every unread article as new, to see a notification). Release builds
don't contain this.

`PerchUITests` runs against a server: reading (open an article, scroll, text size, next article,
on iPhone and iPad), picking colours quickly, turning on notifications, and adding the widget to
the Home Screen and opening an article from it. It's skipped unless the same variables are
passed with the `TEST_RUNNER_` prefix:

```bash
TEST_RUNNER_PERCH_DEV_SERVER=http://localhost:8080 TEST_RUNNER_PERCH_DEV_USER=… \
TEST_RUNNER_PERCH_DEV_PASSWORD=… xcodebuild test -scheme Perch -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

`TEST_RUNNER_PERCH_SHOTS=<folder>` also saves its screenshots there. With
`TEST_RUNNER_PERCH_UI_SITE=daringfireball.net` (any site with a feed; needs the internet) it also
starts an empty phone library, adds the site and opens an article. With
`TEST_RUNNER_PERCH_UI_CHAIN=<perch://chain link>` (a chain holding a feed, on a relay the
simulator can reach) it joins the chain from its link, checks the feed arrived, stars an
article and opens the code for adding a device.

## Not yet

End-to-end encrypted servers; push notifications (these come from background refresh, so
they're as timely as iOS lets that be); and carrying read and starred state from the phone's
library to a server account (the feeds go along).
