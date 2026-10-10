#!/usr/bin/env bash
# Pulls the latest Perch and restarts it, then waits until it answers. With
# PERCH_IMAGE in .env (e.g. ghcr.io/arifcinartekin/perch-server) it runs the
# image CI built and attested for the checked-out commit; otherwise it builds
# one here.
#   sudo /opt/perch/deploy/update.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$DIR/deploy/compose.yml")

if [[ "${1:-}" != --wait-only ]]; then
  git -C "$DIR" pull -q --ff-only
  echo "Now at $(git -C "$DIR" log -1 --format='%h %s')"
  # A copy of the database before the new version migrates it.
  "$DIR/deploy/backup.sh"
  export PERCH_COMMIT PERCH_IMAGE_TAG
  PERCH_COMMIT="$(git -C "$DIR" rev-parse HEAD)"
  if grep -qE '^PERCH_IMAGE=.+' "$DIR/deploy/.env" 2>/dev/null; then
    PERCH_IMAGE_TAG="$PERCH_COMMIT"
    if ! "${COMPOSE[@]}" pull -q perch; then
      echo "No image for $PERCH_COMMIT yet; CI may still be building it. Try again in a few minutes."
      exit 1
    fi
    "${COMPOSE[@]}" up -d
    echo "Running $(docker inspect --format '{{index .RepoDigests 0}}' "$(grep -E '^PERCH_IMAGE=' "$DIR/deploy/.env" | cut -d= -f2-):$PERCH_COMMIT")"
  else
    PERCH_IMAGE_TAG=latest
    "${COMPOSE[@]}" up -d --build
  fi
  docker image prune -f >/dev/null
fi

printf 'Waiting for Perch'
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T perch wget -qO- http://127.0.0.1:8080/healthz </dev/null >/dev/null 2>&1; then
    echo " ok"
    exit 0
  fi
  printf '.'
  sleep 2
done
echo " no answer after 2 minutes. Logs:"
"${COMPOSE[@]}" logs --tail 50 perch
exit 1
