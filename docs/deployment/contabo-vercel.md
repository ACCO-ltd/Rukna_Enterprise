# Deploying Rukna — Contabo (API + DB + storage) + Vercel (web)

This is the single-tenant (**ACCO only**) production runbook. Web runs on **Vercel**, the
API + PostgreSQL + MinIO run on **one Contabo VPS**, and everything hangs off the domain
**`rukna.site`**:

| Host | Runs on | Serves |
|---|---|---|
| `acco.rukna.site` | Vercel | the Next.js web app |
| `api.rukna.site` | Contabo (Caddy → api) | the NestJS API |
| `storage.rukna.site` | Contabo (Caddy → MinIO) | file uploads/downloads (presigned) |

**Why one registrable domain:** the refresh-token is an HttpOnly cookie set by
`api.rukna.site`. Because `acco.` and `api.` share the registrable domain `rukna.site`, the
browser treats web→api calls as *same-site* and sends the cookie with `SameSite=Lax`. Put the
web on a raw `*.vercel.app` domain instead and login will silently fail.

> **Shared VPS (this deployment).** The target Contabo box already runs other products behind
> a single shared Caddy (`deploy-caddy-1`, config `/opt/simad/deploy/Caddyfile`, network
> `deploy_internal`) that owns ports 80/443. So Rukna does **not** run its own Caddy:
> `deploy/docker-compose.prod.yml` attaches `rukna_api` + `rukna_minio` to `deploy_internal`,
> and the two blocks in `deploy/Caddyfile` are **appended** to the shared Caddyfile (then
> `caddy reload`), exactly how the `tconnect-*` sites are wired. On a *clean* box you would
> instead add a Caddy service that publishes 80/443 — see the git history of this file.

> You (the operator) do the account/DNS/secret steps — they need your credentials.

---

## 0. Prerequisites

- A Contabo VPS (Ubuntu 22.04+), root/sudo SSH access, ports **80** and **443** open.
- The `rukna.site` domain with access to its DNS.
- A Vercel account with the GitHub repo connected.
- Docker + Docker Compose plugin on the VPS:
  ```bash
  curl -fsSL https://get.docker.com | sh
  docker compose version   # verify the plugin is present
  ```

---

## 1. DNS records

Point the three hosts at the VPS (and the web at Vercel). Replace `<VPS_IP>`.

| Type | Name | Value |
|---|---|---|
| A | `api` | `<VPS_IP>` (DNS only / not proxied) |
| A | `storage` | `<VPS_IP>` (DNS only / not proxied) |
| CNAME | `acco` | `cname.vercel-dns.com` (Vercel shows the exact target) |

Wait for `api.rukna.site` and `storage.rukna.site` to resolve to the VPS before step 4
(Caddy needs them live to issue TLS certs). Check: `dig +short api.rukna.site`.

---

## 2. Get the code + fill secrets on the VPS

```bash
git clone https://github.com/ACCO-ltd/Rukna_Enterprise.git
cd Rukna_Enterprise

# App config for the API (all app env, incl. DB URLs + JWT + MinIO)
cp apps/api/.env.production.example apps/api/.env

# Compose-level secrets (DB + MinIO passwords the containers boot with)
cp deploy/.env.example deploy/.env
```

Generate secrets:
```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 24   # DB_PASSWORD (avoid : / @ to keep the URL clean, or URL-encode them)
openssl rand -base64 24   # MINIO_SECRET_KEY
```

Now edit the two files. **The DB password must be identical in both**, and the MinIO
keys must match:

- `deploy/.env`: `DB_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `FILE_STORAGE_BUCKET`.
- `apps/api/.env`: put the same `DB_PASSWORD` inside `PLATFORM_DATABASE_URL` **and**
  `DATABASE_URL` (both use host `postgres`, the compose service name), the same MinIO keys in
  `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`, both `JWT_*` secrets, and confirm:
  - `FRONTEND_URL=https://acco.rukna.site`
  - `COOKIE_DOMAIN=.rukna.site`
  - `DEFAULT_TENANT_SLUG=acco`
  - `MINIO_ENDPOINT=https://storage.rukna.site`

Edit `deploy/Caddyfile`: set the `email` to a real inbox (Let's Encrypt expiry notices).

> `apps/api/.env` and `deploy/.env` are git-ignored — they never get committed.

---

## 3. Bring up the data + storage tier and run migrations

```bash
# Postgres + MinIO first (and create the file bucket)
docker compose -f deploy/docker-compose.prod.yml up -d --build postgres minio minio-init

# Apply platform-registry migrations (one-shot)
docker compose -f deploy/docker-compose.prod.yml run --rm migrate
```

The `migrate` step creates the platform-registry schema. There are no tenants yet — that's
next.

---

## 4. Provision the ACCO tenant (first-time only)

This creates the `rukna_acco` database, migrates + seeds it (org, admin role, admin user, ACCO
approval chains), and registers it so the API can resolve `acco`.

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm migrate \
  pnpm tenant:provision \
    --slug=acco \
    --name="ACCO Ltd" \
    --admin-email=admin@acco.com \
    --admin-password='<a-strong-admin-password>'
```

Record the admin password in your password manager — it is not printed back.

---

## 5. Start the API, then wire it into the shared Caddy

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

This starts `rukna_api` + `rukna_minio` on the shared `deploy_internal` network (no Caddy of
its own). Now add Rukna's two sites to the existing Caddy and reload it gracefully:

```bash
# Back up the shared Caddyfile first
cp /opt/simad/deploy/Caddyfile /opt/simad/deploy/Caddyfile.bak.$(date +%s)
# Append Rukna's blocks and reload (Caddy validates before applying — a bad config is refused)
cat deploy/Caddyfile >> /opt/simad/deploy/Caddyfile
docker exec deploy-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

Caddy fetches Let's Encrypt certs for `api.rukna.site` + `storage.rukna.site` (needs the
step-1 DNS live, DNS-only). Verify:

```bash
curl -s https://api.rukna.site/api/v1/health          # expect a 200 JSON health payload
docker compose -f deploy/docker-compose.prod.yml ps   # rukna_api + rukna_minio + rukna_postgres healthy
```

If the health check resolves the tenant, the API is serving ACCO. (The other products behind
the shared Caddy are untouched — the append only adds new site blocks.)

---

## 6. Deploy the web app to Vercel

1. **New Project** → import the GitHub repo.
2. **Root Directory:** `apps/web` (keep "Include files outside the root directory" on — the
   build needs the workspace). The repo's `apps/web/vercel.json` already sets the install/build
   commands to build the workspace via turbo.
3. **Environment Variables (Production):**
   - `NEXT_PUBLIC_API_URL = https://api.rukna.site/api/v1`
   - Do **not** set `NEXT_PUBLIC_API_URL_TEMPLATE` (single-tenant uses the fallback for all calls).
4. **Domains:** add `acco.rukna.site` (Vercel gives you the CNAME target for step 1 if you
   didn't add it yet).
5. Deploy.

`NEXT_PUBLIC_*` vars are baked at build time — changing one needs a redeploy.

---

## 7. Smoke test

1. Open `https://acco.rukna.site` → login with `admin@acco.com` + the password from step 4.
2. Confirm the dashboard loads (the access token came back and the refresh cookie stuck —
   reload the page; if you stay logged in, cross-subdomain cookies work).
3. Create a project / open the Commercial workspace to confirm reads.
4. Upload a document (exercises the `storage.rukna.site` presigned path). If upload fails,
   see MinIO CORS below.

---

## Operations

**Deploy a new version** (after `git pull` on the VPS):
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
The `migrate` one-shot re-applies platform + every tenant's pending migrations before the API
starts (idempotent — `prisma migrate deploy` only applies existing migrations).

**Web:** pushing to the production branch auto-deploys on Vercel.

**Database backups** (both DBs live in the `rukna_postgres` container). Add a cron job:
```bash
docker exec rukna_postgres pg_dumpall -U erp_user | gzip > /backups/rukna_$(date +%F).sql.gz
```
Keep off-box copies. Two databases matter here: `rukna_platform` (the registry) and
`rukna_acco` (all business data).

**MinIO CORS** (only if browser uploads are blocked by CORS): allow the web origin on the
bucket, e.g. via `mc`:
```bash
docker compose -f deploy/docker-compose.prod.yml run --rm minio-init \
  /bin/sh -c "mc alias set local http://minio:9000 \$MINIO_ACCESS_KEY \$MINIO_SECRET_KEY && \
  mc admin config set local api cors_allow_origin='https://acco.rukna.site' && mc admin service restart local"
```

**Logs:**
```bash
docker compose -f deploy/docker-compose.prod.yml logs -f api
docker compose -f deploy/docker-compose.prod.yml logs -f caddy
```

---

## Going multi-tenant later (not now)

The code already supports it. To add tenants under `*.rukna.site`:
1. Set `TENANT_ROOT_DOMAIN=api.rukna.site` and drop `DEFAULT_TENANT_SLUG` on the API.
2. Front the API with a wildcard `*.api.rukna.site` (Caddy `*.api.rukna.site` block + wildcard
   TLS via a DNS-01 challenge).
3. Web: set `NEXT_PUBLIC_API_URL_TEMPLATE=https://{slug}.api.rukna.site/api/v1`, host the web on
   `*.rukna.site` (Vercel wildcard domain — needs a Pro plan).
4. Provision each tenant with `pnpm tenant:provision --slug=<tenant> ...`.
The `COOKIE_DOMAIN=.rukna.site` already set means the refresh cookie spans every subdomain.

---

## What changed in the repo for this deploy

- `apps/api/src/.../auth.controller.ts` — refresh-cookie `domain` + `sameSite` now read from
  `COOKIE_DOMAIN` / `COOKIE_SAMESITE` (unset ⇒ old host-only `Lax` behaviour).
- `apps/api/src/main.ts` — `FRONTEND_URL` accepts a comma-separated origin allow-list.
- `apps/api/.env.production.example`, `apps/web/.env.production.example` — prod env templates.
- `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.example` — the VPS stack.
- `apps/web/vercel.json` — monorepo build/install for Vercel.
