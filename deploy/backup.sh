#!/usr/bin/env bash
# Copies the database while Perch keeps running (SQLite's online backup), then
# compresses it and keeps the last 14 days.
#   sudo /opt/perch/deploy/backup.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${PERCH_DATA:-/var/lib/perch}"
KEEP_DAYS="${PERCH_BACKUP_DAYS:-14}"
name="perch-$(date -u +%Y%m%d-%H%M%S).db"

if ! docker compose -f "$DIR/deploy/compose.yml" ps --status running -q perch | grep -q .; then
  echo "Perch isn't running; nothing to back up."
  exit 0
fi

docker compose -f "$DIR/deploy/compose.yml" exec -T perch node -e "
  const db = require('better-sqlite3')('/data/perch.db', { fileMustExist: true });
  db.backup('/data/backups/$name').then(() => db.close(), (e) => { console.error(e); process.exit(1); });
" </dev/null
gzip -9 "$DATA/backups/$name"
find "$DATA/backups" -name 'perch-*.db.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) $DATA/backups/$name.gz ($(du -h "$DATA/backups/$name.gz" | cut -f1))"
