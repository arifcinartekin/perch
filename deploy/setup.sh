#!/usr/bin/env bash
# Sets up a fresh Ubuntu 24.04 server for Perch. Run as root (or with sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/arifcinartekin/perch/main/deploy/setup.sh \
#     | sudo bash -s -- app.perch.ws
#
# Installs Docker, opens only SSH/HTTP/HTTPS, turns on security updates, checks
# out Perch to /opt/perch, starts it behind Caddy and schedules a daily backup.
# Safe to run again.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${PERCH_REPO:-https://github.com/arifcinartekin/perch.git}"
BRANCH="${PERCH_BRANCH:-main}"
DIR=/opt/perch
DATA=/var/lib/perch

if [[ -z "$DOMAIN" ]]; then
  echo "usage: setup.sh <domain>   e.g. setup.sh app.perch.ws" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ufw unattended-upgrades docker.io docker-buildx docker-compose-v2
systemctl enable --now docker
dpkg-reconfigure -f noninteractive unattended-upgrades

step "Swap (headroom for building the image)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

step "Firewall: SSH, HTTP, HTTPS"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

step "SSH: keys only, if a key is installed"
keys=0
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  if [[ -s "$f" ]]; then keys=1; fi
done
if [[ $keys -eq 1 ]]; then
  cat >/etc/ssh/sshd_config.d/10-perch.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl try-reload-or-restart ssh
  echo "Password logins are off."
else
  echo "No SSH key found; password logins stay on. Add a key, then run this again."
fi

step "Perch checkout in $DIR"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" merge -q --ff-only "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi

step "Configuration"
mkdir -p "$DATA/backups"
chown -R 1000:1000 "$DATA" # the image runs as user node (1000)
ENV="$DIR/deploy/.env"
if [[ -f "$ENV" ]]; then
  sed -i "s/^PERCH_DOMAIN=.*/PERCH_DOMAIN=$DOMAIN/" "$ENV"
else
  cat >"$ENV" <<EOF
PERCH_DOMAIN=$DOMAIN
PERCH_SIGNUP=invite
PERCH_FETCH_INTERVAL_MIN=30
PERCH_DATA=$DATA
EOF
fi
chmod 600 "$ENV"

step "Build and start"
docker compose -f "$DIR/deploy/compose.yml" up -d --build
"$DIR/deploy/update.sh" --wait-only

step "Daily backup at 03:30"
cat >/etc/cron.d/perch-backup <<EOF
30 3 * * * root $DIR/deploy/backup.sh >>/var/log/perch-backup.log 2>&1
EOF

step "Done"
cat <<EOF
Perch is running. Open https://$DOMAIN now and create the first account:
it becomes the admin, so don't leave the page open to someone else first.

  update:  sudo $DIR/deploy/update.sh
  backup:  sudo $DIR/deploy/backup.sh     (daily, kept 14 days in $DATA/backups)
  logs:    sudo docker compose -f $DIR/deploy/compose.yml logs -f perch
EOF
