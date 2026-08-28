#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight collision check — run from the repo root BEFORE `up`.
# Aborts (exit 1) on any naming or port collision. Touches nothing.
#
#   bash deploy/preflight.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
echo "Pre-flight: inspecting for collisions before creating the Rukna stack..."

echo "── container names (must be free) ──"
for c in rukna_postgres rukna_minio rukna_api; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    echo "  ✗ in use: $c"; fail=1
  else
    echo "  ✓ free:   $c"
  fi
done

echo "── external proxy network (must exist; api attaches to it) ──"
if docker network ls --format '{{.Name}}' | grep -qx deploy_internal; then
  echo "  ✓ present: deploy_internal"
else
  echo "  ✗ missing: deploy_internal"; fail=1
fi

echo "── Rukna must publish NO host ports ──"
if grep -qE '^\s*-\s*"?[0-9]+:[0-9]+' deploy/docker-compose.prod.yml; then
  echo "  ✗ compose declares a published host port"; fail=1
else
  echo "  ✓ compose publishes no host ports"
fi

echo "── first-deploy volumes (should not pre-exist) ──"
for v in rukna_postgres_data rukna_minio_data; do
  if docker volume ls --format '{{.Name}}' | grep -qx "$v"; then
    echo "  ! exists (data would be reused): $v"
  else
    echo "  ✓ fresh:  $v"
  fi
done

echo "── SIMAD/TConnect containers that must stay untouched ──"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'deploy-|tconnect-' || echo "  (none found — check SIMAD is up)"

if [ "$fail" -ne 0 ]; then
  echo "ABORT: collision(s) found — nothing was created."; exit 1
fi
echo "✓ Pre-flight clean — safe to bring up project 'rukna'."
