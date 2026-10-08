#!/usr/bin/env bash
# Pulls the latest Perch, rebuilds and restarts it, then waits until it answers.
#   sudo /opt/perch/deploy/update.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$DIR/deploy/compose.yml")

if [[ "${1:-}" != --wait-only ]]; then
  git -C "$DIR" pull -q --ff-only
  echo "Now at $(git -C "$DIR" log -1 --format='%h %s')"
  # A copy of the database before the new version migrates it.
  "$DIR/deploy/backup.sh"
  "${COMPOSE[@]}" up -d --build
  docker image prune -f >/dev/null
fi

printf 'Waiting for Perch'
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T perch wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    echo " ok"
    exit 0
  fi
  printf '.'
  sleep 2
done
echo " no answer after 2 minutes. Logs:"
"${COMPOSE[@]}" logs --tail 50 perch
exit 1
