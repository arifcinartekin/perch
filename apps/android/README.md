# Perch for Android

A native Android app (Kotlin, Jetpack Compose, Android 9+), local-first like the extension and
the iPhone app: the phone fetches feeds itself, without cookies, and keeps the library on the
device (SQLite for articles, a JSON file for feeds and settings; no cloud backup).

- `core/` — Kotlin ports of packages/core: feed parsing (RSS, RDF, Atom, JSON Feed), dates,
  discovery, readability, OPML, ids and the theme palette. Tests check ids and palettes against
  values from the TypeScript core.
- `data/` — the article store and `LocalBackend` (refresh, add, read/star state).
- `ui/` — the screens, with Liquid Glass bars and buttons from
  [Haze](https://github.com/chrisbanes/haze)'s glass material (full optics on Android 13+, a blur
  before that; solid surfaces when glass is off in Settings).
- `work/` — background refresh with WorkManager.

Starter packs ship as `assets/starter-packs.json`, written by `npm run starter-packs`.

Not yet: sync chains, Perch accounts, notes and widgets.

```sh
cd apps/android
./gradlew :app:testDebugUnitTest   # core tests
./gradlew :app:assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

Or open `apps/android` in Android Studio.
