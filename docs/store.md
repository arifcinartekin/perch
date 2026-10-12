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
> an Android phone or another iPhone. Everything is encrypted on your devices; the
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
> No account with us, ever: there's nothing to sign up for.

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
> bir Android telefon ya da başka bir iPhone. Her şey cihazlarında şifrelenir; aradaki
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
> Bizde hiçbir zaman hesap yok: kaydolunacak bir şey yok.

### App Privacy (nutrition labels)

Answer **"No, we do not collect data from this app."** The label then reads **Data Not
Collected**.

- The library, notes and settings stay on the device.
- Sync chain records leave the device only end-to-end encrypted, with a key the developer never
  has, through a relay that keeps no accounts, logs or IP addresses.
- Perch runs no accounts. A Perch Server the user connects to (their own, a friend's) is run by
  someone else, who is responsible for it; the demo server exists for App Review only (sign-up
  closed).
- No analytics, ads, crash SDKs or tracking. Tracking: **No**.

### Export compliance (encryption)

The app uses only standard encryption from Apple's frameworks: HTTPS, and AES-GCM and HKDF
(CryptoKit) for sync chains, plus Argon2id to stretch passwords on the device. In App Store
Connect: "Does your app use encryption?" → **Yes**; "Does it qualify for any of the exemptions…"
→ the app uses standard algorithms provided by the operating system, which Apple's questionnaire
lists as exempt. Confirm against Apple's current wording before answering; the answer is the
developer's declaration.

### App Review Information

- Sign-in required: **No** (the app works without an account); a demo account on demo.perch.ws
  for "Sync with a Perch Server" and sharing.
- Contact: Arif Çınar Tekin, contact@perch.ws.
- Notes (paste; the chain code and password go only into App Store Connect):

> Perch works without any account: add feeds from Feeds → Explore (compass) or the "+" button.
>
> Sync chain (no account): Settings → Sync chain → Start a chain shows a code and QR code for
> your other devices. To see joining work, choose Join a chain and enter this test chain's code:
> [CHAIN CODE]. Its feeds and a note appear in a few seconds.
>
> Sync with a Perch Server: Settings → Connect to a Perch Server → demo.perch.ws, then sign in
> with the account below. demo.perch.ws is a test server we run for review; Perch itself runs no
> accounts. The same account works under Settings → Perch account, to share a note as a public
> page (open an article → Note → Share).
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

- Does the app collect or share user data? **No.** The library stays on the phone; sync chain
  records are end-to-end encrypted with a key the developer never has; Perch runs no accounts.
- Data is encrypted in transit: **Yes** (HTTPS). Account deletion: not applicable (no accounts).
  A Perch Server the user connects to is run by someone else, under their own policy.

**Permissions**

| Permission                                           | Why                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `INTERNET`                                           | Fetches the user's feeds and articles, and talks to the sync relay or Perch account server the user chose. |
| `CAMERA` (asked when tapping Scan)                   | Only to scan a sync chain's QR code; the picture is read on the device and not kept.                       |
| Biometric (`USE_BIOMETRIC`, from androidx.biometric) | Optional app lock: open the app with a fingerprint or face.                                                |

**App access** (for Google's review): the app works without signing in. Sync chain: Settings →
Sync chain → Join a chain with the test chain's code (only in Play Console). Sharing a note as a
page: Settings → Perch account → Sign in to demo.perch.ws with the review account (only in Play
Console).

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

- Collected: **Website content** — only when the user turns on a sync chain, and then only end-to-end
  encrypted (the relay can't read it). **Authentication information** only if the user signs in to
  a Perch Server of their own, which receives it, not us.
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
