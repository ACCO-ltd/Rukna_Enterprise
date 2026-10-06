#!/usr/bin/env bash
# Production deploy for the Contabo VPS — run by .github/workflows/deploy.yml after CI passes on
# main, and safe to run by hand (`bash deploy/deploy.sh`). It does exactly what the manual runbook
# did, in order, and stops at the first failure:
#
#   1. back up both Rukna databases (pg_dumpall), verify the archive, keep the newest $KEEP
#   2. bring the checkout to origin/main
#   3. rebuild + restart the Rukna stack (the one-shot `migrate` service applies migrations)
#   4. fail if the migrate container did not exit 0
#   5. wait for the API health check and the web app to answer
#
# Only Rukna's compose project is touched (`name: rukna`); SIMAD/TConnect on the same box are not.
# ALWAYS uses deploy/docker-compose.prod.yml — never the root dev compose file (2026-09-27 incident).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/Rukna_Enterprise}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP="${KEEP:-14}"
# A dump of both databases is far larger than this; anything smaller means pg_dumpall failed.
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-20000}"
API_HEALTH_URL="${API_HEALTH_URL:-https://api.rukna.site/api/v1/health}"
WEB_URL="${WEB_URL:-https://acco.rukna.site}"

# Everything runs inside main(), which bash reads in full before executing: the `git reset --hard`
# below rewrites this very file, and a script being rewritten mid-read can run garbage.
main() {
cd "$REPO_DIR"
compose() { docker compose -f deploy/docker-compose.prod.yml "$@"; }

echo "── 1/5 backup ──"
mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/rukna_backup_predeploy_$(date +%F_%H%M%S).sql.gz"
# A failed or truncated dump must not linger and count towards the $KEEP kept backups.
if ! docker exec rukna_postgres pg_dumpall -U erp_user | gzip > "$backup" || ! gzip -t "$backup"; then
  rm -f "$backup"
  echo "::error::Database backup failed — nothing was deployed."
  exit 1
fi
size=$(stat -c%s "$backup")
if [ "$size" -lt "$MIN_BACKUP_BYTES" ]; then
  rm -f "$backup"
  echo "::error::Backup is only $size bytes — refusing to deploy without a real backup ($backup)."
  exit 1
fi
echo "backup ok: $backup ($size bytes)"
# Keep the newest $KEEP pre-deploy backups (other files in the folder are never touched).
ls -1t "$BACKUP_DIR"/rukna_backup_predeploy_*.sql.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --

echo "── 2/5 code ──"
before=$(git rev-parse --short HEAD)
git fetch origin main
git reset --hard origin/main
after=$(git rev-parse --short HEAD)
echo "deploying $before → $after"

echo "── 3/5 rebuild + restart ──"
# Build first, on its own: a build failure stops here while the old containers keep serving
# (no downtime), so a broken build can never be reported as a deploy.
compose build
# A failed migration makes `up` fail too (rukna_api waits for migrate to succeed). Remember the
# result so step 4 can show the migrate log and the backup path before failing the deploy.
up_rc=0
compose up -d || up_rc=$?

echo "── 4/5 migrations ──"
compose logs migrate | grep -E "Applying migration|No pending migrations|All migrations|Error" || true
migrate_exit=$(docker inspect rukna-migrate-1 --format '{{.State.ExitCode}}')
if [ "$migrate_exit" != "0" ]; then
  echo "::error::Database migrations failed (migrate exit $migrate_exit). Backup: $backup"
  compose logs --tail 80 migrate
  exit 1
fi
if [ "$up_rc" -ne 0 ]; then
  echo "::error::Starting the new containers failed (compose up exit $up_rc). Backup: $backup"
  compose ps
  exit 1
fi
# The API container must be running the image that was just built — otherwise the old code is
# still serving and the health checks below would pass without anything having shipped.
for pair in rukna_api:rukna-api rukna_web:rukna-web; do
  container="${pair%%:*}"; image="${pair##*:}:latest"
  if [ "$(docker inspect "$container" --format '{{.Image}}')" != "$(docker image inspect "$image" --format '{{.Id}}')" ]; then
    echo "::error::$container is not running the newly built $image."
    exit 1
  fi
done

echo "── 5/5 health ──"
for _ in $(seq 1 36); do
  if curl -fsS "$API_HEALTH_URL" > /dev/null 2>&1; then break; fi
  sleep 5
done
curl -fsS "$API_HEALTH_URL"; echo
web_status=000
for _ in $(seq 1 24); do
  web_status=$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL" || true)
  case "$web_status" in 200|307|308) break ;; esac
  sleep 5
done
echo "web $WEB_URL → $web_status"
case "$web_status" in
  200|307|308) ;;
  *) echo "::error::Web app is not answering ($web_status)."; exit 1 ;;
esac

compose ps
docker image prune -f > /dev/null || true
# `compose up` recreates rukna_api whenever apps/api/.env changed, so a healthy deploy also proves
# the current settings work: keep them as the known-good copy deploy/restart-api.sh rolls back to.
env_state_dir="${ENV_STATE_DIR:-$HOME/rukna-env-backups}"
( umask 077 && mkdir -p "$env_state_dir" && cp apps/api/.env "$env_state_dir/api.env.last-good" ) || true
echo "Deploy of $after complete."
}

main "$@"
