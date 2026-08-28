#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Generate the two production .env files with matching, random secrets.
#
# Run ONCE on the server, from the repo root:   bash deploy/gen-secrets.sh
#
# It writes apps/api/.env + deploy/.env with consistent values (the DB password
# and MinIO keys are shared between them), chmod 600, and prints NOTHING secret.
# The ERP admin password is NOT set here — you supply it at tenant provisioning.
#
# Values are pre-set for the single-tenant ACCO deploy on rukna.site. Edit the
# HOST block below if your domain/hosts differ.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

API_ENV="apps/api/.env"
COMPOSE_ENV="deploy/.env"

if [[ -f "$API_ENV" || -f "$COMPOSE_ENV" ]]; then
  echo "Refusing to overwrite an existing $API_ENV or $COMPOSE_ENV." >&2
  echo "Delete them first if you really want to regenerate secrets." >&2
  exit 1
fi

# ── HOSTS (edit here if not the default rukna.site single-tenant setup) ───────
FRONTEND_URL="https://acco.rukna.site"       # the Vercel web origin (CORS)
COOKIE_DOMAIN=".rukna.site"                   # registrable domain of web + api
MINIO_ENDPOINT="https://storage.rukna.site"   # public S3 endpoint (via shared Caddy)
BUCKET="rukna-files"

# ── Secrets (URL-safe: hex for anything that lands in a connection string) ────
JWT_ACCESS_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
JWT_REFRESH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
DB_PASSWORD="$(openssl rand -hex 24)"
MINIO_ACCESS_KEY="rukna$(openssl rand -hex 5)"
MINIO_SECRET_KEY="$(openssl rand -hex 24)"

umask 077

cat > "$COMPOSE_ENV" <<EOF
DB_PASSWORD=$DB_PASSWORD
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
FILE_STORAGE_BUCKET=$BUCKET
EOF

cat > "$API_ENV" <<EOF
NODE_ENV=production
PORT=3001
FRONTEND_URL=$FRONTEND_URL
COOKIE_DOMAIN=$COOKIE_DOMAIN
COOKIE_SAMESITE=lax
PLATFORM_DATABASE_URL=postgresql://erp_user:$DB_PASSWORD@postgres:5432/rukna_platform
DATABASE_URL=postgresql://erp_user:$DB_PASSWORD@postgres:5432/rukna_acco
DEFAULT_TENANT_SLUG=acco
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
FILE_STORAGE_BUCKET=$BUCKET
MINIO_ENDPOINT=$MINIO_ENDPOINT
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
EOF

chmod 600 "$API_ENV" "$COMPOSE_ENV"

echo "✓ Wrote $API_ENV and $COMPOSE_ENV (matching secrets, chmod 600, nothing printed)."
echo
echo "Next: provision the ACCO tenant (you choose the admin password):"
echo "  docker compose -f deploy/docker-compose.prod.yml run --rm migrate \\"
echo "    pnpm tenant:provision --slug=acco --name=\"ACCO Ltd\" \\"
echo "    --admin-email=admin@acco.com --admin-password='<choose-a-strong-password>'"
