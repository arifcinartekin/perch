# Store listings and review notes

Everything the App Store, Google Play, Chrome Web Store, Edge Add-ons and Firefox Add-ons ask for, in one
place. Lengths are checked against each store's limits (in brackets). Keep it in step with the
apps: if a permission or a kind of data changes, change it here and in the store forms.

## App Store (iPhone and iPad)

| Field              | English                                                                     | Türkçe                         |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------ |
| Name [30]          | Perch – RSS Reader                                                          | Perch – RSS Okuyucu            |
| Subtitle [30]      | Calm, private feed reading                                                  | Sakin ve gizli akış okuma      |
| Category           | News (secondary: Productivity)                                              | Haberler (ikincil: Verimlilik) |
| Support URL        | https://perch.ws                                                            | https://perch.ws               |
| Marketing URL      | https://perch.ws                                                            | https://perch.ws               |
| Privacy Policy URL | https://perch.ws/privacy                                                    | https://perch.ws/privacy       |
| Age rating         | 4+ (no user-generated content shown in the app; shared notes are web pages) | 4+                             |

**Promotional text** [170]

- EN: Read RSS, Atom and JSON feeds in a calm, private reader. No account needed, no tracking. Sync your devices with an end-to-end encrypted chain.
- TR: RSS, Atom ve JSON akışlarını sakin ve gizli bir okuyucuda oku. Hesap gerekmez, izleme yok. Cihazlarını uçtan uca şifreli bir zincirle eşitle.

**Keywords** [100, comma-separated, no spaces needed]

- EN: `rss,feed,reader,atom,news,blog,offline,privacy,self-hosted,widget,articles,read later,opml`
- TR: `rss,akış,okuyucu,haber,blog,atom,çevrimdışı,gizlilik,makale,opml,feed,bülten,teknoloji`

**Description** [4000]

EN:

> Perch is a calm, private reader for the websites you follow. Add any site or feed and read its
> newest articles in a clean, uncluttered layout, with the full article loaded for you.
>
> LOCAL BY DEFAULT
> Your feeds, what you've read and your notes stay on your iPhone. Perch fetches the feeds
> itself. No account, no analytics, no ads, no trackers.
>
> SYNC WITHOUT AN ACCOUNT
> Start a sync chain and scan its QR code on your other devices: the Perch browser extension,
> the web reader at app.perch.ws or another iPhone. Everything is encrypted on your devices; the
> relay in between can't read your feeds or what you read.
>
> MADE FOR READING
> • Full articles load by themselves, in sans or serif type
> • Unread, Starred and search across every feed
> • Starter packs and Explore: well-known science, technology, privacy, self-hosting and news feeds
> • Notes on any article, in markdown; share one as a public page if you like
> • Offline reading with pictures, background refresh and widgets
> • Your own colours for light and dark mode, a background photo, six app icons
> • An optional app lock with Face ID
> • OPML import and export
>
> YOURS
> Perch is open source. Run your own Perch Server and sync with it, or don't run one at all.
> A Perch account is only a name for sharing notes, with no email address.

TR:

> Perch, takip ettiğin siteler için sakin ve gizli bir okuyucu. Herhangi bir siteyi ya da akışı
> ekle, en yeni makalelerini sade bir düzende oku; makalenin tamamı kendiliğinden yüklenir.
>
> VARSAYILAN OLARAK CİHAZINDA
> Akışların, okudukların ve notların iPhone'unda kalır. Perch akışları kendisi çeker. Hesap yok,
> analitik yok, reklam yok, izleyici yok.
>
> HESAPSIZ SENKRON
> Bir senkron zinciri başlat ve QR kodunu diğer cihazlarında okut: Perch tarayıcı eklentisi,
> app.perch.ws'teki web okuyucu ya da başka bir iPhone. Her şey cihazlarında şifrelenir; aradaki
> aktarıcı akışlarını ya da ne okuduğunu göremez.
>
> OKUMAK İÇİN YAPILDI
> • Makalelerin tamamı kendiliğinden, düz ya da tırnaklı yazıyla yüklenir
> • Okunmamış, Yıldızlı ve tüm akışlarda arama
> • Başlangıç paketleri ve Keşfet: tanınmış bilim, teknoloji, gizlilik, self-hosting ve haber akışları
> • Her makaleye markdown ile not; istersen birini herkese açık bir sayfa olarak paylaş
> • Resimlerle çevrimdışı okuma, arka planda yenileme ve widget'lar
> • Açık ve koyu mod için kendi renklerin, arka plan fotoğrafı, altı uygulama ikonu
> • Face ID ile isteğe bağlı uygulama kilidi
> • OPML içe ve dışa aktarma
>
> SENİN
> Perch açık kaynaklı. Kendi Perch sunucunu kurup onunla senkron yap ya da hiç sunucu kurma.
> Perch hesabı yalnızca not paylaşmak için bir ad; e-posta adresi istemez.

### App Privacy (nutrition labels)

Answer **"Yes, we collect data"**, because a Perch account sends a username and shared notes to
account.perch.ws. Everything else stays on the device or is end-to-end encrypted.

| Data type (Apple's term)                                                 | Collected                                                         | Linked to the user | Tracking | Purpose           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------ | -------- | ----------------- |
| Contact Info → Name                                                      | No                                                                | —                  | —        | —                 |
| Contact Info → Email Address                                             | No (account.perch.ws asks for none)                               | —                  | —        | —                 |
| Identifiers → User ID                                                    | Yes, only with a Perch account or a server account (the username) | Yes                | No       | App Functionality |
| User Content → Other User Content                                        | Yes, only notes the user shares as public pages                   | Yes                | No       | App Functionality |
| Usage Data, Diagnostics, Location, Browsing History, Purchases, Contacts | No                                                                | —                  | —        | —                 |

Notes for the form:

- Sync chain records leave the device only end-to-end encrypted, with a key the developer never
  has. Apple's guidance treats data the developer can't read as not collected; if in doubt,
  disclose "Other User Content — App Functionality, not linked".
- A server the user connects to themselves (their own Perch Server, or demo.perch.ws) is the
  user's choice; its operator is responsible for it.
- Tracking: **No** (no data is used for tracking or shared with data brokers).

### Export compliance (encryption)

The app uses only standard encryption from Apple's frameworks: HTTPS, and AES-GCM and HKDF
(CryptoKit) for sync chains, plus Argon2id to stretch passwords on the device. In App Store
Connect: "Does your app use encryption?" → **Yes**; "Does it qualify for any of the exemptions…"
→ the app uses standard algorithms provided by the operating system, which Apple's questionnaire
lists as exempt. Confirm against Apple's current wording before answering; the answer is the
developer's declaration.

### App Review Information

- Sign-in required: **No** (the app works without an account); demo accounts below for the
  account features.
- Contact: Arif Çınar Tekin, contact@perch.ws.
- Notes (paste, with the passwords filled in only in App Store Connect):

> Perch works without any account: add feeds from Feeds → Explore (compass) or the "+" button.
>
> Sync chain (no account): Settings → Sync chain → Start a chain. To try joining from a second
> device, open https://app.perch.ws in any browser → Settings → Sync → Join and enter the code
> shown on the iPhone (or scan the browser's QR code from the iPhone's Join screen).
>
> Sync with a Perch Server: Settings → Connect to a Perch Server → demo.perch.ws, then sign in
> with the demo account below. demo.perch.ws is a test server we run for review;
> our main server only holds accounts for sharing notes.
>
> Perch account (sharing notes): Settings → Perch account → Sign in, server account.perch.ws,
> with the account.perch.ws account below. Then open an article, write a note and choose Share.
>
> Permissions: the camera is used only to scan a sync chain's QR code; Face ID only for the
> optional app lock (Settings → App lock).

## Google Play (Android)

| Field                    | Value                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| App name [30]            | Perch – RSS Reader (TR: Perch – RSS Okuyucu)                                                                                    |
| Short description [80]   | EN: A calm, private feed reader. No account, no tracking. · TR: Sakin ve gizli bir akış okuyucu. Hesap yok, izleme yok.         |
| Category                 | News & Magazines                                                                                                                |
| Contact email            | contact@perch.ws                                                                                                                |
| Website / privacy policy | https://perch.ws · https://perch.ws/privacy                                                                                     |
| Ads                      | No                                                                                                                              |
| Content rating           | Questionnaire: no violence, no user-generated content shown in the app (shared notes are web pages), no ads → Everyone / PEGI 3 |
| Target audience          | 18+ is safest; the app isn't aimed at children                                                                                  |

**Full description** [4000]: the App Store description, replacing the iPhone lines: "widgets"
and "six app icons" are left out; "Face ID" becomes "fingerprint or face"; "Share → Perch from
your browser adds a site's feed" can be added.

**Data safety** (Play Console → App content):

- Does the app collect or share user data? **Yes, collects** (no sharing).
- Collected, only when the user signs in to a Perch account: **Personal info → User IDs** (the
  username) and **App activity → Other user-generated content** (notes the user shares as
  pages). Purpose: App functionality. Optional (the app works without). Not processed
  ephemerally. Users can request deletion (in the app, Settings → Perch account → Delete
  account).
- Sync chain records are end-to-end encrypted on the device; Google's form treats data the
  developer can't read as not collected. If in doubt, also declare "App activity → Other
  user-generated content, App functionality, optional".
- Data is encrypted in transit: **Yes** (HTTPS). Account deletion URL: https://perch.ws/privacy
  (section "Deleting your data") or in-app.
- Not collected: location, contacts, photos, files, health, financial info, messages, device
  IDs, crash logs or diagnostics (the app has no analytics or crash SDK).

**Permissions**

| Permission                                           | Why                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `INTERNET`                                           | Fetches the user's feeds and articles, and talks to the sync relay or Perch account server the user chose. |
| `CAMERA` (asked when tapping Scan)                   | Only to scan a sync chain's QR code; the picture is read on the device and not kept.                       |
| Biometric (`USE_BIOMETRIC`, from androidx.biometric) | Optional app lock: open the app with a fingerprint or face.                                                |

**App access** (for Google's review): the app works without signing in. For the Perch account
features: Settings → Perch account → Sign in, server account.perch.ws, with the review account
(credentials only in Play Console). Sync chain: Settings → Sync chain → Start a chain; to join
from a second device open https://app.perch.ws → Settings → Sync → Join.

**Release**: Play App Signing on; the upload key lives outside the repository and is read from
`apps/android/keystore.properties` (see apps/android/README.md). Build the bundle with
`./gradlew :app:bundleRelease` and upload `app/build/outputs/bundle/release/app-release.aab`.

## Chrome Web Store (and Edge Add-ons)

| Field              | Value                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Name               | Perch – RSS Reader                                                                                                          |
| Summary [132]      | A calm, private feed reader. Local by default, no telemetry, no broad site access; sync with an end-to-end encrypted chain. |
| Category           | Productivity (Edge: Productivity)                                                                                           |
| Language           | English (Turkish listing optional)                                                                                          |
| Homepage / support | https://perch.ws                                                                                                            |
| Privacy policy     | https://perch.ws/privacy                                                                                                    |

**Single purpose** (asked by the Chrome Web Store):

> Perch is a feed reader: it finds the RSS, Atom and JSON feeds of the sites you visit, lets you
> subscribe, and shows their articles in a full-page reader.

**Permission justifications**

| Permission                       | Justification                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                        | Keeps the user's feed list, categories, settings, notes and read state in the browser.                                                                                                      |
| `activeTab`                      | When the user opens the popup, reads the current tab's feed links so they can subscribe.                                                                                                    |
| `scripting`                      | Runs a one-time function in the active tab (with activeTab) that collects `<link rel="alternate">` feed tags.                                                                               |
| `alarms`                         | Refreshes the user's feeds in the background on the schedule they choose.                                                                                                                   |
| Optional host access (`*://*/*`) | Requested per site when the user adds a feed or opens an article, to fetch that one site. All sites only if the user turns on "Auto-discover feeds on every site", revoked when turned off. |
| Remote code                      | **No.** All code is in the package; the WebAssembly (Argon2id) is bundled.                                                                                                                  |

**Data usage disclosures** (Privacy practices tab)

- Collected: **Website content** and **Authentication information** — only when the user turns on
  sync or signs in to a Perch account, and only to provide that feature.
- Check: not sold to third parties; not used or transferred for purposes unrelated to the
  single purpose; not used to determine creditworthiness or for lending.

## Firefox Add-ons (AMO)

- Summary [250]: same as the Chrome summary.
- Description: the App Store description, without the iPhone-only lines (widgets, Face ID,
  app icons).
- Data collection: declared in the manifest (`data_collection_permissions`): nothing required;
  optional authenticationInfo, personallyIdentifyingInfo, browsingActivity and websiteContent,
  asked for when the user starts or joins a sync chain or signs in.
- Source code: AMO may ask for it because the build is bundled. Give the repository link and
  the build steps from the README (`npm ci && npm run build:firefox`).

## Screenshots

- iPhone 6.9" (1320 × 2868) and 6.5" (1284 × 2778): Unread list, an article, Explore, sync
  chain with its QR code, Settings → Appearance. iPad 13" if the iPad layout is offered.
- Chrome / Edge / Firefox: 1280 × 800 — the reader, the popup finding a feed, Explore.
- Use the demo accounts and starter packs, never a personal library.
