# Multi-Tenancy Implementation Guide

Version: 1.0.0
Status: Active
Last Updated: 2026-07-30
Reference: ADR-001 (Decision 1), ADR-003 (Decisions 1–3, 10)

---

## What We Built and Why

Rukna uses **C1 multi-tenancy**: one shared NestJS API, one PostgreSQL database per tenant.

When ACCO logs in at `acco.rukna.com`, they hit the same API as every other client.
The API reads `acco` from the subdomain, looks up ACCO's database URL in the platform
registry, and connects to ACCO's isolated PostgreSQL database. No other client's data
is accessible from that connection.

When a second client signs up, we run one provisioning script. Their database is created,
migrations run, and they get their own subdomain. Zero code changes to the API.

---

## Two Databases, Two Prisma Clients

```
┌─────────────────────────────────────────┐
│  Platform DB  (one, always running)      │
│  DATABASE_URL env var                    │
│                                         │
│  tenants table:                         │
│    slug: "acco"                         │
│    db_url: "postgres://...acco_db"      │
│    status: ACTIVE                       │
└─────────────────────────────────────────┘
                    │
                    │ TenancyService.getClient("acco")
                    ▼
┌─────────────────────────────────────────┐
│  ACCO Tenant DB  (resolved per request) │
│  postgres://erp_user:...@host/acco_db   │
│                                         │
│  Organization, User, Role, Permission   │
│  Project, BOQ, StockLedger, IPC...      │
└─────────────────────────────────────────┘
```

### Client 1: Platform PrismaService (singleton)
- Injected via NestJS DI as normal
- Connects to `DATABASE_URL` (platform DB)
- Used ONLY in `TenancyService` to look up tenant records
- Never used for business data

### Client 2: Tenant PrismaClient (per-tenant, cached)
- Created by `TenancyService` on first request for a slug
- Cached in `Map<slug, PrismaClient>`
- Accessed via `TenancyService.getClient()` — never instantiated directly
- Used for ALL business data operations

---

## Request Flow

```
1. Request arrives: GET acco.rukna.com/api/v1/projects

2. TenancyMiddleware (global, runs first)
   ├── Extracts subdomain: "acco"
   ├── Calls TenancyService.getTenant("acco")
   │   └── SELECT * FROM tenants WHERE slug = 'acco'  (platform DB)
   ├── Gets cached PrismaClient for acco_db
   └── Runs handler inside AsyncLocalStorage context:
       { slug: "acco", client: <PrismaClient>, status: ACTIVE }

3. JwtAuthGuard
   ├── Validates JWT signature and expiry
   ├── Extracts payload.tenantSlug
   └── Asserts payload.tenantSlug === "acco"  ← cross-tenant check

4. RolesGuard / PermissionsGuard
   └── Checks payload.permissions includes required permission

5. ProjectsController → ProjectsService
   └── const prisma = this.tenancyService.getClient()
       ← returns ACCO's PrismaClient from AsyncLocalStorage

6. ProjectsService queries
   └── prisma.project.findMany({ where: { organizationId: ctx.orgId } })
       ← ALWAYS includes organizationId filter (ARCH-MT-008)
```

---

## Local Development

Subdomains work on localhost in Chrome and Edge without any configuration:

```
acco.localhost:3001   → NestJS API (port 3001)
acco.localhost:3000   → Next.js web (port 3000)
```

Environment variables for local development:

```env
# apps/api/.env
DATABASE_URL="postgresql://erp_user:erp_password@localhost:5435/rukna_platform"
ACCO_DB_URL="postgresql://erp_user:erp_password@localhost:5435/rukna_acco"

JWT_ACCESS_SECRET="local-access-secret"
JWT_REFRESH_SECRET="local-refresh-secret"
JWT_ACCESS_EXPIRES="15m"
JWT_REFRESH_EXPIRES="7d"

FRONTEND_URL="http://acco.localhost:3000"
```

The `ACCO_DB_URL` is used by the provisioning script only. The TenancyService
reads `db_url` from the platform DB at runtime — not from env vars.

---

## Provisioning a New Tenant

When a new client signs up, run:

```bash
pnpm tenant:provision --slug=newclient --name="New Client Ltd" --plan=standard
```

The script:
1. Creates the tenant database: `CREATE DATABASE rukna_newclient`
2. Runs tenant migrations: `prisma migrate deploy --schema=prisma/schema.prisma`
3. Seeds default data: roles, permissions, workflow templates
4. Registers in platform DB: `INSERT INTO tenants (slug, name, db_url, status)`
5. Creates default Organization record in tenant DB
6. Creates default admin User in tenant DB
7. Outputs: `✓ Tenant newclient provisioned at newclient.rukna.com`

The TenancyService cache picks up the new tenant on the next request automatically.

---

## Key Rules for Every Engineer and AI Agent

**ARCH-MT-007** — Never import or instantiate PrismaClient directly in business code.
Always use `TenancyService.getClient()`.

**ARCH-MT-008** — Every query on a model that has `organizationId` must include
`where: { organizationId: ctx.orgId }`. No exceptions. Missing this filter is a
data isolation security bug.

**ARCH-MT-004** — One tenant = multiple organisations. The database gives you
tenant isolation. `organizationId` gives you org isolation within the tenant.
You need both.

**ARCH-SEC-002** — The JWT guard always validates `payload.tenantSlug === subdomain`.
A valid JWT from one tenant must never work on another tenant's subdomain.

---

## What "Organization" Means in This System

A **Tenant** is the paying customer (e.g., Asas Group). They have one database,
one Rukna subscription, one subdomain.

An **Organisation** is a business entity within that tenant
(e.g., ACCO Ltd, Asas Real Estate, Asas Trading).

```
Tenant: asas-group → database: rukna_asasgroup
  Organisation: ACCO Ltd          orgId: org_acco
  Organisation: Asas Real Estate  orgId: org_realestate  (future)
  Organisation: Asas Trading      orgId: org_trading      (future)
```

Users are assigned to one Organisation. They can be granted access to
additional Organisations by an admin. The active Organisation is carried
in the JWT `orgId` field.
