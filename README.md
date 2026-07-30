# Rukna Enterprise Platform

Multi-tenant, multi-vertical ERP platform built for ACCO Ltd and beyond.
Architecture: shared NestJS API + one PostgreSQL database per tenant + Next.js 16 frontend.

---

## Apps & Ports

| App | URL | Description |
|-----|-----|-------------|
| `apps/api` | `http://acco.localhost:3001` | NestJS REST API |
| `apps/web` | `http://acco.localhost:3000` | Next.js 16 frontend |
| PostgreSQL | `localhost:5435` | Docker — platform + tenant DBs |

---

## Prerequisites

- **Node.js** 22+ — [nodejs.org](https://nodejs.org)
- **pnpm** 9+ — `npm install -g pnpm`
- **Docker Desktop** — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

---

## Step 1 — Add local subdomain (once per machine)

The API uses subdomains to identify tenants. `acco.localhost` must resolve locally.

**Windows** (open Notepad as Administrator, then open `C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1   acco.localhost
```

**macOS / Linux** (`sudo nano /etc/hosts`):
```
127.0.0.1   acco.localhost
```

Add one line per tenant slug when you provision more tenants later.

---

## Step 2 — Clone and install

```bash
git clone https://github.com/ACCO-ltd/Rukna_Enterprise.git
cd Rukna_Enterprise
pnpm install
```

`pnpm install` automatically generates both Prisma clients via the `postinstall` script.

---

## Step 3 — Configure environment

```bash
# API environment
cp apps/api/.env.example apps/api/.env

# Frontend environment
cp apps/web/.env.example apps/web/.env.local
```

The defaults in `.env.example` work out of the box for local development.
You do not need to change anything to get started.

---

## Step 4 — Start the database

```bash
docker compose up -d
```

Starts a PostgreSQL 16 container on port **5435**.
Wait ~5 seconds for it to become healthy (`docker compose ps` to check).

---

## Step 5 — Run migrations

```bash
# Platform DB (tenant registry)
pnpm --filter @erp/api run db:migrate:platform

# Tenant DB (ACCO schema)
pnpm --filter @erp/api run db:migrate:tenant
```

---

## Step 6 — Provision the ACCO tenant

```bash
pnpm --filter @erp/api run tenant:provision \
  --slug=acco \
  --name="ACCO Ltd" \
  --admin-email=admin@acco.com \
  --admin-password=ChangeMe123!
```

This creates the `rukna_acco` database, seeds default roles, and registers the tenant in the platform registry.

---

## Step 7 — Start all dev servers

```bash
pnpm dev
```

Open `http://acco.localhost:3000` in your browser.
Login with `admin@acco.com` / `ChangeMe123!`.

---

## Frontend-Only Setup

If the API is already deployed to a shared environment, you can skip Docker and run only the frontend:

```bash
# 1. Edit apps/web/.env.local and set:
NEXT_PUBLIC_API_URL=https://api.rukna.dev/api/v1

# 2. Run only the web app:
pnpm --filter @erp/web dev
```

---

## Common Commands

```bash
# Start everything
pnpm dev

# Start only the API
pnpm --filter @erp/api dev

# Start only the frontend
pnpm --filter @erp/web dev

# Type-check all packages
pnpm type-check

# Lint all packages
pnpm lint

# Provision a new tenant
pnpm --filter @erp/api run tenant:provision --slug=<slug> --name="<Name>"

# Run migrations after schema changes
pnpm --filter @erp/api run db:migrate:tenant
pnpm --filter @erp/api run db:migrate:platform

# Regenerate Prisma clients after schema changes
pnpm --filter @erp/api run db:generate

# Stop the database
docker compose down

# Wipe the database and start fresh
docker compose down -v && docker compose up -d
```

---

## Project Structure

```
Rukna_Enterprise/
├── apps/
│   ├── api/                     # NestJS backend — Clean Architecture
│   │   ├── prisma/              # Tenant schema + migrations
│   │   ├── prisma-platform/     # Platform registry schema + migrations
│   │   ├── src/platform/        # Core platform modules (auth, tenancy, users…)
│   │   └── scripts/             # tenant-provision.ts
│   └── web/                     # Next.js 16 frontend — App Router
├── packages/
│   ├── types/                   # Shared TypeScript types (JwtPayload, enums…)
│   ├── ui/                      # Shared React components
│   ├── config/                  # Shared config helpers
│   └── tsconfig/                # Shared TypeScript configs
├── docker-compose.yml
└── turbo.json
```

---

## Team

| Role | Person | Contact |
|------|--------|---------|
| Platform Architect / Backend | Abdulsalam | abdulsalam.shiikhow@gmail.com |
| CEO / Domain Expert | Eng Ahmed Shirie | ACCO Ltd |

Backend changes require sign-off from Abdulsalam.
Business rule questions go to Eng Ahmed Shirie.
See `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` for AI agent rules.
