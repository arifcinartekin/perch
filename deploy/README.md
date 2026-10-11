# Deploying Perch on a VPS

One Ubuntu 24.04 machine runs the Perch Server and Caddy, which gets HTTPS certificates by
itself. The database is a single SQLite file in `/var/lib/perch`.

## Before you start

- A VPS with a public IPv4 address (2 vCPU and 2–4 GB RAM is plenty) and SSH access.
- A DNS `A` record for your domain (e.g. `app.perch.ws`) pointing at it. On Cloudflare, leave it
  **DNS only** (grey cloud) until the first certificate is issued; if you then turn the proxy
  on, set SSL/TLS to **Full (strict)**.

## Set up

```bash
ssh ubuntu@<server-ip>
curl -fsSL https://raw.githubusercontent.com/arifcinartekin/perch/main/deploy/setup.sh \
  | sudo bash -s -- app.perch.ws
```

The script installs Docker, opens only ports 22, 80 and 443, turns on automatic security
updates, switches SSH to keys only (if a key is installed), checks Perch out to `/opt/perch`,
builds and starts it, and schedules a daily backup. Running it again is safe.

Add a second name, e.g. `… | sudo bash -s -- app.perch.ws sync.perch.ws`, to also relay sync
chains (sync without an account) there; point its DNS at the same server first. Running the
script again with it turns that on for an existing install. That name answers only the chain
API: no web app and no sign-in there, and a browser gets a short page (`deploy/sync/`) saying
what the address is.

Then open `https://app.perch.ws` straight away and create the first account; it becomes the
admin. Sign-up is by invite after that (`PERCH_SIGNUP` in `/opt/perch/deploy/.env`).

### A hub, like app.perch.ws

`PERCH_MODE=hub` makes the server hold Perch accounts and shared notes but no libraries: readers
keep theirs on their devices and sync them through a chain. With `PERCH_CHAIN=true` the same
server relays the chains. A server switched from personal mode keeps the old libraries until you
start it once with `PERCH_PURGE_LIBRARIES=true` (move yours to a chain first).

### Perch accounts at their own address

app.perch.ws is the reader; Perch accounts (names for sharing notes) are managed at
account.perch.ws, which is the same server under another name. Point a DNS record at the machine
(grey cloud), then add to `.env` and run `update.sh`:

```sh
PERCH_ACCOUNT_DOMAIN=account.perch.ws
PERCH_ACCOUNT_URL=https://account.perch.ws
```

The web app then shows the account (sign-up, recovery code, shared notes, reports) on that
address, and the reader's /account goes there. Readers anywhere (app.perch.ws, the extension, the
iPhone, someone's own reader) sign in to it with a token kept on the device; no cookie is shared
across addresses.

### A forum that signs in with Perch accounts (Discourse)

community.perch.ws is a Discourse forum on its own server. People sign in to it with their Perch
account (DiscourseConnect), so the forum never asks for an email address: it gets the username
and a fixed account id, after the person confirms on account.perch.ws. Discourse requires an email
field, so it gets `<account id>@users.perch.invalid`, which can't receive mail.

1. Make a shared secret: `openssl rand -hex 32`.
2. On the Perch server, add to `.env` and run `update.sh`:

   ```sh
   PERCH_DISCOURSE_URL=https://community.perch.ws
   PERCH_DISCOURSE_SECRET=<the secret>
   ```

3. In Discourse (Admin → Settings), set:
   - `enable discourse connect`: on
   - `discourse connect url`: `https://account.perch.ws/discourse/sso`
   - `discourse connect secret`: the same secret
   - `auth overrides email`, `auth overrides username`: on
   - `disable emails`: yes (nothing could be delivered anyway)
   - `enable local logins`, `allow new registrations` through the forum's own form: off
   - `email editable`: off

Deleting a Perch account doesn't reach the forum: the forum account and its posts stay until the
person deletes them in the forum (allow that with `allow users to delete their own accounts`) or
an admin does. Discourse also keeps IP addresses for abuse prevention; review its log retention.

### Open sign-up without email

To let anyone sign up, with a proof of work instead of a CAPTCHA or an email check (this is how
app.perch.ws runs), add to `.env` and run `update.sh`:

```sh
PERCH_SIGNUP=open
PERCH_SIGNUP_POW=20   # bits; about a second or two on a phone
```

Every account gets a recovery code at sign-up for resetting a forgotten password; the server keeps
only its hash.

### Sign-up and password reset by email (optional)

To confirm addresses by email instead, verify a sending domain with
[Resend](https://resend.com) using your own account, then add to `.env` and run `update.sh`:

```sh
PERCH_SIGNUP=email
PERCH_EMAIL=resend
PERCH_EMAIL_FROM=Perch <noreply@mail.example.com>
RESEND_API_KEY=re_...
PERCH_EMAIL_KEY=...   # openssl rand -base64 48
```

Perch never stores email addresses, only a hash keyed with `PERCH_EMAIL_KEY`, so a leaked
database or backup holds no addresses. Keep the key out of backups, and never change it: with a
new key nobody could reset their password by email. The Resend key only ever lives in that file.
Email also turns on password reset by email (recovery codes keep working) and lets accounts add
an address under Settings.

### Run the attested image instead of building

CI builds an image for every commit to main, publishes it as
`ghcr.io/arifcinartekin/perch-server:<commit>` and attests where it came from
([perch.ws/transparency](https://perch.ws/transparency)). To run those instead of building on the
server, add to `.env`:

```sh
PERCH_IMAGE=ghcr.io/arifcinartekin/perch-server
```

`update.sh` then pulls the image of the newest commit that changes what's in it (the paths in
`.github/workflows/image.yml`; a docs- or iOS-only push builds no image) and prints its digest.
After a push that does change it, wait for the "Server image" workflow to finish. The server reports the commit at
`/api/v1/server`.

### A demo server for App Review

App Review tries every button, "Sync with a Perch Server" included, which a hub refuses. A second,
separate server in personal mode gives reviewers (and anyone curious) something to connect to:

1. Point a DNS record at the machine, e.g. `demo.perch.ws` (grey cloud, like app.perch.ws).
2. Add to `.env` and run `update.sh`:

   ```sh
   COMPOSE_PROFILES=demo
   PERCH_DEMO_DOMAIN=demo.perch.ws
   ```

3. In the iPhone app: Settings → Connect to a Perch Server → `demo.perch.ws`, and create the
   reviewer account (the first account on a server is its admin; sign-up stays closed after).
   Give that username and password in App Store Connect → App Review Information.

It keeps its own database in `/var/lib/perch-demo` and shares nothing with the main server. It
keeps libraries in plain text like any personal server, so it's for testing only, and the privacy
policy says so. To start it over: stop it, delete that folder, start it again.

### Policies

The sign-up form, shared notes and the apps link to the privacy policy and terms when they're
set. They are the operator's own: for app.perch.ws that's perch.ws, and anyone else running this
needs their own (see [the server README](../apps/server/README.md#running-it-for-other-people)).
For app.perch.ws:

```sh
PERCH_PRIVACY_URL=https://perch.ws/privacy
PERCH_TERMS_URL=https://perch.ws/terms
```

## Moving to another server

See [MIGRATE.md](MIGRATE.md): copy the data folder and `.env` while the old server is stopped,
start the new one, point DNS at it.

## Day to day

| Task            | Command                                                        |
| --------------- | -------------------------------------------------------------- |
| Update          | `sudo /opt/perch/deploy/update.sh`                             |
| Back up now     | `sudo /opt/perch/deploy/backup.sh`                             |
| Logs            | `sudo docker compose -f /opt/perch/deploy/compose.yml logs -f` |
| Change settings | edit `/opt/perch/deploy/.env`, then `update.sh`                |

`update.sh` pulls `main`, backs up the database, rebuilds and waits until the server answers.
Backups are compressed copies in `/var/lib/perch/backups`, kept for 14 days. Copy them off the
machine now and then, e.g. `scp ubuntu@<server-ip>:/var/lib/perch/backups/*.gz .`

To restore one: stop Perch (`docker compose … stop perch`), `gunzip` the backup over
`/var/lib/perch/perch.db`, remove any `perch.db-wal` / `perch.db-shm` next to it,
`chown 1000:1000 /var/lib/perch/perch.db`, and start it again.
