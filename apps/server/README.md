# Perch Server

A self-hostable server for Perch. One process, one SQLite file, no external services (email is
optional, with your own provider). It runs in one of two modes:

- **`personal`** — it keeps each account's library, fetches the feeds in the background, keeps
  read and starred state, and serves it to every device you sign in on, including the web reader
  over its API. For yourself, a family, or an organisation.
- **`hub`** — how app.perch.ws runs. It holds Perch accounts (names for sharing notes) and the
  notes people share, relays sync chains, and serves the web reader, which keeps its library in
  the browser and fetches feeds through the hub's anonymous proxy. It keeps no libraries.

Either mode can relay sync chains (`PERCH_CHAIN=true`).

## Run it

```bash
docker build -f apps/server/Dockerfile -t perch/server .   # from the repository root
docker run -d -p 8080:8080 -v perch-data:/data --name perch perch/server
```

Open `http://your-server:8080` for the **web reader** — the same reader as the extension,
installable as an app (PWA). The first account you create becomes the admin. After that, sign-up is by invite unless you
change `PERCH_SIGNUP`. For HTTPS, see [`docker-compose.example.yml`](./docker-compose.example.yml)
(Caddy, automatic certificates).

Without Docker (Node 22+):

```bash
npm ci
npm run build:server && npm run build:web
DATABASE_URL=./perch.db node apps/server/dist/main.js
```

The server finds the web build in `apps/web/dist` by itself (or wherever `PERCH_WEB_ROOT`
points). For working on the web reader, run `npm run dev:server` and `npm run dev:web`, then
open http://localhost:5173 — Vite proxies `/api` to the server.

## Configuration

| Variable                    | Default            | Meaning                                                                                                                                                                                                                  |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PERCH_MODE`                | `personal`         | `personal`: the server keeps each account's library and fetches its feeds. `hub`: Perch accounts and shared notes only; libraries stay on devices and sync by chain (how app.perch.ws runs). `e2e` is not available yet. |
| `PERCH_PURGE_LIBRARIES`     | `false`            | Hub mode: delete the libraries left from personal mode (once, after moving them to a chain).                                                                                                                             |
| `DATABASE_URL`              | `./data/perch.db`  | SQLite file. The Docker image uses `/data/perch.db`. Postgres support is planned.                                                                                                                                        |
| `PORT` / `HOST`             | `8080` / `0.0.0.0` | Where to listen.                                                                                                                                                                                                         |
| `PERCH_PUBLIC_URL`          |                    | The address clients use, e.g. `https://reader.example.com`. Marks cookies `Secure`.                                                                                                                                      |
| `PERCH_SIGNUP`              | `invite`           | `open`, `invite` (admin creates codes), `email` (anyone, after confirming an address with an emailed code) or `closed`. The first account is always allowed.                                                             |
| `PERCH_SIGNUP_POW`          | `0`                | Proof of work for signing up, in bits (0–28). About 20 takes a second or two on a phone and makes bulk sign-ups costly. The first account needs none.                                                                    |
| `PERCH_EMAIL`               | `off`              | `resend` to send email codes (signup, password reset, adding an address); `log` prints them instead (development).                                                                                                       |
| `PERCH_EMAIL_FROM`          |                    | Sender, e.g. `Perch <noreply@mail.example.com>`. The domain must be verified with your provider.                                                                                                                         |
| `RESEND_API_KEY`            |                    | Your own [Resend](https://resend.com) API key. Each server sends with its own account.                                                                                                                                   |
| `PERCH_EMAIL_KEY`           |                    | At least 32 characters. Email addresses are never stored, only a hash keyed with this; without it the key comes from the database. Never change it.                                                                      |
| `PERCH_PRIVACY_URL`         |                    | Your privacy policy. Linked from sign-up and shared notes, and shown in apps that read `/server`.                                                                                                                        |
| `PERCH_TERMS_URL`           |                    | Your terms of use, linked in the same places.                                                                                                                                                                            |
| `PERCH_FETCH_INTERVAL_MIN`  | `30`               | Minutes between refreshes of a feed (5–1440). Failing feeds back off up to a day.                                                                                                                                        |
| `PERCH_FETCH_ALLOW_PRIVATE` | `false`            | Allow feeds on private / loopback addresses.                                                                                                                                                                             |
| `PERCH_FETCH_ALLOW_HOSTS`   |                    | Comma-separated hostnames allowed to resolve to private addresses (e.g. `nas.local`).                                                                                                                                    |
| `PERCH_TRUST_PROXY`         | `false`            | Use `X-Forwarded-For` for rate limiting. Only behind a proxy you control.                                                                                                                                                |
| `PERCH_CHAIN`               | `false`            | Relay sync chains (sync without an account) for anyone. See below.                                                                                                                                                       |
| `PERCH_WEB_ROOT`            | `apps/web/dist`    | Folder with the built web reader. The Docker image sets it.                                                                                                                                                              |

## Running it for other people

Whoever runs a server is responsible for it. If other people use yours, you hold their data:
you are its data controller, and you need your own privacy policy and terms (set
`PERCH_PRIVACY_URL` and `PERCH_TERMS_URL` so the apps link to them). The policy at perch.ws
covers only the servers Perch's maintainer runs (app.perch.ws, sync.perch.ws); don't point
these settings at it. If you let people share notes, reports reach you at `/admin/reports`, and
handling them is up to you.

## How it works

- **Passwords never reach the server.** Clients stretch the password with Argon2id
  (`@perch/core/auth`) using a per-account salt from `POST /auth/prelogin`, and send only the
  derived auth key, which the server hashes again with scrypt. Unknown usernames get a stable
  fake salt, so prelogin doesn't reveal which accounts exist.
- **Sessions** are random tokens, one per device; only their SHA-256 is stored. Native clients
  send `Authorization: Bearer …`; the web UI gets an `HttpOnly`, `SameSite=Strict` cookie.
- **Feeds are shared.** Each feed URL is fetched once for all its subscribers, with conditional
  GET, a per-host concurrency limit and exponential back-off. Parsing is the same
  `@perch/core` parser the extension uses, and ids match, so read state lines up across devices.
- **SSRF protection.** Every outbound request resolves DNS through a filter that refuses
  loopback, private, link-local (cloud metadata), CGNAT and multicast ranges, on every redirect
  hop. Responses are capped at 5 MB.
- **Sync.** Subscriptions, categories, settings (one record per field) and read/starred state
  are small records keyed `type:id`. The server keeps the write with the latest hybrid logical
  clock for each key and numbers changes per account, so a client asks for "everything after
  version N". Changes made through the reader API become records too, so every device sees
  them. Read state older than 60 days and tombstones older than 90 are forgotten.
- **Sync chains** (`PERCH_CHAIN=true`). Devices without an account sync through the server as a
  relay. A chain is known only by the SHA-256 of a token its devices derive from the chain's
  code; records arrive encrypted (AES-256-GCM) under opaque slot names (an HMAC of the record
  key), so the server orders them per slot by clock and passes them on without seeing feeds,
  categories, settings or read state (`@perch/core/chain`). It forgets read, unstarred state
  after 60 days, deletions after 90 and chains unused for 180, caps a chain at 100 000 records,
  and limits new chains to 10 an hour per address.
- **Hub mode.** No reader, sync or notes API and no feed worker. `GET /proxy?url=` fetches a
  feed or page for the web reader: no session is read, nothing is logged, responses are cached
  for 10 minutes for everyone (so the server learns which feeds are popular, not who reads
  them), only feeds, pages and JSON pass, and addresses are rate-limited in memory.
- **Accounts without email.** Sign-up can ask for a proof of work (`PERCH_SIGNUP_POW`) instead
  of an email check, and every account can set a recovery code (only its hash is kept) to
  replace a forgotten password. With email turned on, addresses are kept only as a slow keyed
  hash (`PERCH_EMAIL_KEY`), never as text.
- **Shared notes and reports.** A shared note is a public page with a report form; admins see
  reports in the web app's settings, remove or keep pages, and can restore removed ones.
- **What it runs.** `/api/v1/server` reports the commit the image was built from; official
  images are attested by CI (see deploy/README.md).
- **Retention.** Each feed keeps its newest 200 articles plus anything from the last 90 days.
  Starred articles are never pruned, even after you unsubscribe.

## API

All endpoints live under `/api/v1` and speak JSON. The request and response types are in
[`packages/core/src/api.ts`](../../packages/core/src/api.ts).

| Endpoint                                                             | Purpose                                    |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `GET /server`                                                        | Mode, version, sign-up policy              |
| `POST /auth/prelogin` · `/auth/register` · `/auth/login` · `/logout` | Accounts and sessions                      |
| `GET /auth/me` · `POST /auth/password`                               | Current user, change password              |
| `GET /auth/challenge`                                                | Proof of work to sign up, when asked for   |
| `POST /auth/recover` · `/auth/recovery`                              | Reset with the recovery code, replace it   |
| `POST /auth/email/code` · `/auth/reset` · `/auth/email`              | Email codes, reset, add an address         |
| `POST /auth/delete`                                                  | Delete the account and its data            |
| `GET/PUT/DELETE /notes/:id` · `PUT/DELETE /shares/:id`               | Notes, and sharing one as a page           |
| `GET /admin/reports` · `POST /admin/reports/:id`                     | Reports on shared notes (admin)            |
| `GET /devices` · `DELETE /devices/:id`                               | Signed-in devices                          |
| `GET/POST /admin/invites` · `DELETE /admin/invites/:code`            | Invite codes (admin)                       |
| `GET /reader/library`                                                | Subscriptions and categories               |
| `POST /reader/feeds` · `PATCH/DELETE /reader/feeds/:id`              | Subscribe (feed or page URL), edit, remove |
| `POST /reader/categories` · `PATCH/DELETE /reader/categories/:id`    | Categories                                 |
| `GET /reader/articles?feed=&category=&unread=1&starred=1&q=&before=` | Article list, search, pagination           |
| `GET /reader/articles/:feedId/:id`                                   | One article                                |
| `GET /reader/counts`                                                 | Unread per feed, starred total             |
| `POST /reader/articles/state` · `/reader/articles/read-all`          | Mark read / starred                        |
| `POST /reader/refresh`                                               | Refresh now                                |
| `GET/POST /reader/opml`                                              | Export / import subscriptions              |
| `GET/PUT /reader/settings`                                           | Settings that follow the account           |
| `GET /sync/changes?since=&limit=` · `POST /sync/push`                | Sync records after a version, send changes |
| `GET /sync/events`                                                   | Server-Sent Events: the account changed    |
| `POST /chain` · `DELETE /chain`                                      | Start (or check) a sync chain, delete it   |
| `GET /chain/changes?since=&limit=` · `POST /chain/push`              | Sealed chain records after a version, send |

## Development

```bash
npm run dev:server          # tsx watch, database in apps/server/data/
npm test -w @perch/server
npm run db:generate -w @perch/server   # after editing src/db/schema.ts
```
