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

cd "$REPO_DIR"
compose() { docker compose -f deploy/docker-compose.prod.yml "$@"; }

echo "── 1/5 backup ──"
mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/rukna_backup_predeploy_$(date +%F_%H%M%S).sql.gz"
docker exec rukna_postgres pg_dumpall -U erp_user | gzip > "$backup"
gzip -t "$backup"
size=$(stat -c%s "$backup")
if [ "$size" -lt "$MIN_BACKUP_BYTES" ]; then
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
compose up -d --build

echo "── 4/5 migrations ──"
compose logs migrate | grep -E "Applying migration|No pending migrations|All migrations|Error" || true
migrate_exit=$(docker inspect rukna-migrate-1 --format '{{.State.ExitCode}}')
if [ "$migrate_exit" != "0" ]; then
  echo "::error::Database migrations failed (migrate exit $migrate_exit). Backup: $backup"
  compose logs --tail 80 migrate
  exit 1
fi

echo "── 5/5 health ──"
for _ in $(seq 1 36); do
  if curl -fsS "$API_HEALTH_URL" > /dev/null 2>&1; then break; fi
  sleep 5
done
curl -fsS "$API_HEALTH_URL"; echo
web_status=$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL")
echo "web $WEB_URL → $web_status"
case "$web_status" in
  200|307|308) ;;
  *) echo "::error::Web app is not answering ($web_status)."; exit 1 ;;
esac

compose ps
docker image prune -f > /dev/null
echo "Deploy of $after complete."
