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
script again with it turns that on for an existing install.

Then open `https://app.perch.ws` straight away and create the first account; it becomes the
admin. Sign-up is by invite after that (`PERCH_SIGNUP` in `/opt/perch/deploy/.env`).

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
