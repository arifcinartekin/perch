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

What it does, as the iPhone app does:

- Sync chains (end-to-end encrypted, no account), byte-compatible with the extension and the
  iPhone app; join by code, QR (CameraX + ZXing, no Play services) or a `perch://chain` link.
- A Perch account on a Perch Server someone runs, for sharing notes as pages; Argon2id, proof
  of work and recovery codes as in packages/core. Any note can be shared as text.
- Notes, app lock (PIN with fingerprint or face), background refresh, OPML, Share → Perch.

Not yet: syncing with your own Perch Server's library (personal mode), widgets, background
pictures and alternate icons.

## Release

Google Play signs the app (Play App Signing); you keep an upload key. Make one once and keep it
out of the repository:

```sh
keytool -genkeypair -v -keystore ~/perch-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

Then `apps/android/keystore.properties` (ignored by git):

```properties
storeFile=/Users/you/perch-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

`./gradlew :app:bundleRelease` writes the bundle to upload. Debug builds allow plain HTTP to
10.0.2.2 and localhost only, for a Perch Server on your machine (`adb reverse tcp:8080 tcp:8080`).

```sh
cd apps/android
./gradlew :app:testDebugUnitTest   # core tests
./gradlew :app:assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

Or open `apps/android` in Android Studio.
