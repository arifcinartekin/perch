# Perch Server

A self-hostable server for Perch. In **personal mode** it fetches your feeds in the
background, keeps your read and starred state, and serves it to every device you sign in on.
One process, one SQLite file, no external services.

> Status: early. Accounts, feed fetching and the reader API work and are tested. The sync API
> for the extension, the web reader and E2E mode (for the official server) come next.

## Run it

```bash
docker build -f apps/server/Dockerfile -t perch/server .   # from the repository root
docker run -d -p 8080:8080 -v perch-data:/data --name perch perch/server
```

The first account you create becomes the admin. After that, sign-up is by invite unless you
change `PERCH_SIGNUP`. For HTTPS, see [`docker-compose.example.yml`](./docker-compose.example.yml)
(Caddy, automatic certificates).

Without Docker (Node 22+):

```bash
npm ci
npm run build:server
DATABASE_URL=./perch.db node apps/server/dist/main.js
```

## Configuration

| Variable                    | Default            | Meaning                                                                                  |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `PERCH_MODE`                | `personal`         | `personal` (the server fetches feeds). `e2e` is not available yet.                       |
| `DATABASE_URL`              | `./data/perch.db`  | SQLite file. The Docker image uses `/data/perch.db`. Postgres support is planned.        |
| `PORT` / `HOST`             | `8080` / `0.0.0.0` | Where to listen.                                                                         |
| `PERCH_PUBLIC_URL`          |                    | The address clients use, e.g. `https://reader.example.com`. Marks cookies `Secure`.      |
| `PERCH_SIGNUP`              | `invite`           | `open`, `invite` (admin creates codes) or `closed`. The first account is always allowed. |
| `PERCH_FETCH_INTERVAL_MIN`  | `30`               | Minutes between refreshes of a feed (5–1440). Failing feeds back off up to a day.        |
| `PERCH_FETCH_ALLOW_PRIVATE` | `false`            | Allow feeds on private / loopback addresses.                                             |
| `PERCH_FETCH_ALLOW_HOSTS`   |                    | Comma-separated hostnames allowed to resolve to private addresses (e.g. `nas.local`).    |
| `PERCH_TRUST_PROXY`         | `false`            | Use `X-Forwarded-For` for rate limiting. Only behind a proxy you control.                |

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

## Development

```bash
npm run dev:server          # tsx watch, database in apps/server/data/
npm test -w @perch/server
npm run db:generate -w @perch/server   # after editing src/db/schema.ts
```
