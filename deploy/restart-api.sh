#!/usr/bin/env bash
# Apply a change to apps/api/.env on the VPS — run by the "Restart API" workflow
# (.github/workflows/restart-api.yml), or by hand: `bash deploy/restart-api.sh`.
#
#   1. recreate rukna_api so it reads the edited apps/api/.env (nothing is rebuilt)
#   2. wait for the API health check
#   3. healthy  → save this .env as the last known-good copy (+ a dated copy, newest $KEEP kept)
#      unhealthy → put the last known-good .env back, recreate again, and fail the run;
#                  the edited file is kept as api.env.failed-<time> for you to fix
#
# "Healthy" means the API started and answers its health check — not that every setting is right
# (a wrong SMTP password or WhatsApp token still starts). The dated copies let you go back by hand:
#   cp ~/rukna-env-backups/api.env.<date> apps/api/.env && bash deploy/restart-api.sh
#
# The copies live in $ENV_STATE_DIR, outside the git checkout, readable only by this user.
# ALWAYS uses deploy/docker-compose.prod.yml; only the rukna_api container is touched.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Rukna_Enterprise}"
ENV_STATE_DIR="${ENV_STATE_DIR:-$HOME/rukna-env-backups}"
KEEP="${KEEP:-20}"
API_HEALTH_URL="${API_HEALTH_URL:-https://api.rukna.site/api/v1/health}"

# Everything runs inside main(), which bash reads in full before executing.
main() {
cd "$REPO_DIR"
compose() { docker compose -f deploy/docker-compose.prod.yml "$@"; }
env_file="apps/api/.env"
last_good="$ENV_STATE_DIR/api.env.last-good"
umask 077
mkdir -p "$ENV_STATE_DIR"

if [ ! -s "$env_file" ]; then
  echo "::error::$env_file is missing or empty — nothing restarted."
  exit 1
fi
if [ -f "$last_good" ] && cmp -s "$env_file" "$last_good"; then
  echo "apps/api/.env is unchanged since the last good start — restarting anyway."
fi

wait_healthy() {
  for _ in $(seq 1 36); do
    if curl -fsS "$API_HEALTH_URL" > /dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

echo "── restart rukna_api with the current apps/api/.env ──"
# Even if the recreate itself fails (the old container may already be stopped), go on to the
# health check so the rollback below can bring the API back.
compose up -d --no-deps --force-recreate rukna_api || echo "::warning::compose up failed — checking health and rolling back if needed."

if wait_healthy; then
  cp "$env_file" "$last_good"
  cp "$env_file" "$ENV_STATE_DIR/api.env.$(date +%F_%H%M%S)"
  ls -1t "$ENV_STATE_DIR"/api.env.20* 2> /dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
  echo "API is healthy with the new settings; saved as the last known-good copy."
  exit 0
fi

echo "::error::The API did not become healthy with the edited apps/api/.env."
compose logs --tail 60 rukna_api || true
if [ ! -f "$last_good" ]; then
  echo "::error::No last known-good copy exists yet, so nothing was rolled back. Fix apps/api/.env and run again."
  exit 1
fi
failed="$ENV_STATE_DIR/api.env.failed-$(date +%F_%H%M%S)"
cp "$env_file" "$failed"
cp "$last_good" "$env_file"
echo "── rolled back to the last known-good .env (your edit is saved as $failed) ──"
compose up -d --no-deps --force-recreate rukna_api || true
if wait_healthy; then
  echo "::error::Rolled back: the API is running again on the previous settings. Fix the edit and retry."
else
  echo "::error::The API is still unhealthy after rolling back — check 'docker logs rukna_api'."
fi
exit 1
}

main "$@"
