# Multi-Tenancy Implementation Guide

Version: 2.0.0
Status: Active
Last Updated: 2026-08-02
Reference: ADR-001, ADR-003 (Decisions 1–3, 10), ADR-004 (Decisions 6, 19, 21, 22)

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
│    db_url: (encrypted credential)       │
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
- Cached in a bounded LRU map (max 50 clients, idle eviction)
- Accessed via `TenancyService.getClient()` — never instantiated directly
- Used for ALL business data operations

---

## Two Typed Contexts (ADR-004 Decision 6)

Two separate, typed interfaces carry request context through the pipeline.
They are established at different points and must never be confused.

```typescript
// Established by TenancyMiddleware — runs BEFORE authentication
interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  client: TenantPrismaClient;
}

// Established by JwtAuthGuard — runs AFTER token validation
interface RequestIdentity {
  userId: string;
  activeOrganizationId: string;
  roles: string[];
  permissions: string[];
  lang: 'en' | 'ar';
}
```

`TenantContext` is stored in `AsyncLocalStorage`.
`RequestIdentity` is attached to the Express request object by `JwtAuthGuard`.

---

## Request Flow

```
1. Request arrives: GET acco.rukna.com/api/v1/projects

2. TenancyMiddleware (global, runs first — no auth required)
   ├── Extracts subdomain: "acco"
   ├── Calls TenancyService.getTenant("acco")
   │   └── SELECT * FROM tenants WHERE slug = 'acco' AND status = 'ACTIVE' (platform DB)
   ├── Validates tenant exists and is ACTIVE
   ├── Gets cached PrismaClient for acco_db
   └── Runs handler inside AsyncLocalStorage:
       TenantContext { tenantId, tenantSlug: "acco", client: <PrismaClient> }

3. JwtAuthGuard
   ├── Validates JWT signature and expiry
   ├── Extracts payload.tenantSlug
   ├── Asserts payload.tenantSlug === "acco"   ← cross-tenant replay check
   ├── Verifies userId has active OrganizationMembership for payload.orgId
   └── Attaches RequestIdentity to request object

4. RolesGuard / PermissionsGuard
   └── Reads RequestIdentity.permissions

5. ProjectsController → ProjectsService
   ├── TenantContext  = tenancyService.getContext()    ← from AsyncLocalStorage
   └── RequestIdentity = request.identity              ← from JwtAuthGuard

6. ProjectsService queries
   └── prisma.project.findMany({
         where: { organizationId: identity.activeOrganizationId }
       })
       ← ALWAYS includes organizationId filter (ARCH-MT-008)
```

---

## Background Jobs and Async Workers (ADR-004 Decision 19)

AsyncLocalStorage is established per HTTP request. Background jobs, queue consumers,
scheduled tasks, and migration workers have no incoming HTTP request and therefore
**no automatic tenant context**.

Every asynchronous background job must explicitly establish context before any
database operation.

### BackgroundJobContext

```typescript
interface BackgroundJobContext {
  tenantId: string;
  tenantSlug: string;
  organizationId: string;
  actorId: string | 'SYSTEM';
  correlationId: string;
}
```

### Running a Background Job with Tenant Context

```typescript
// Worker must call this before any database operation
await tenancyService.runInContext(jobContext, async () => {
  // All code inside here runs with the correct AsyncLocalStorage context
  const prisma = tenancyService.getClient();
  await prisma.project.findMany({ ... });
});
```

`TenancyService.runInContext()` establishes AsyncLocalStorage for the duration of
the callback — the same mechanism used by `TenancyMiddleware`.

### Multi-Tenant Background Jobs

A job that processes all tenants (e.g., nightly report generation) must process
each tenant **serially** with a fresh context per tenant:

```typescript
for (const tenant of activeTenants) {
  await tenancyService.runInContext({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    organizationId: org.id,
    actorId: 'SYSTEM',
    correlationId: generateCorrelationId(),
  }, async () => {
    await generateNightlyReport();
  });
}
```

Never share a single tenant context across multiple tenants in one job execution.

---

## Tenant Client Cache (ADR-004 Decision 22)

The cache requires lifecycle management before production use.

**Required controls:**
- Maximum cache size (default: 50 clients)
- LRU eviction for idle tenants — calls `$disconnect()` before eviction
- Per-tenant connection pool limit (prevents one tenant exhausting all DB connections)
- Cache invalidation when tenant `status` changes to `SUSPENDED` or `TERMINATED`
- Slug validation before creating a client — tenant must exist and be `ACTIVE`

```typescript
// Protected factory — never call PrismaClient constructor directly
const client = await tenancyService.getClient();      // from AsyncLocalStorage
const client = await tenancyService.getClientFor(slug); // explicit slug (workers only)
```

---

## dbUrl Is a Secret (ADR-004 Decision 21)

The platform DB `tenants.db_url` column stores a database credential. It must be
treated as a secret, not ordinary metadata.

**Rules:**
- Encrypt at application level before storage, or store as a vault secret reference
- Never return `dbUrl` in any API response
- Never log `dbUrl` — log tenant slug and tenant ID instead
- Rotate credentials without downtime using the provisioning tooling
- The provisioning script must not output `dbUrl` to stdout

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
3. Seeds default data: roles, permissions, workflow templates, WorkflowTriggerBinding defaults
4. Registers in platform DB: `INSERT INTO tenants (slug, name, db_url, status)`
   (`db_url` encrypted before insert)
5. Creates default Organization record in tenant DB
6. Creates default admin User in tenant DB
7. Outputs: `✓ Tenant newclient provisioned at newclient.rukna.com`
   (does NOT output db_url)

The TenancyService cache picks up the new tenant on the next request automatically.

---

## Key Rules for Every Engineer and AI Agent

**ARCH-MT-007** — Never import or instantiate PrismaClient directly in business code.
Always use `TenancyService.getClient()`.

**ARCH-MT-008** — Every query on a model that has `organizationId` must include
`where: { organizationId: identity.activeOrganizationId }`. No exceptions.
Missing this filter is a data isolation security bug.

**ARCH-MT-004** — One tenant = multiple organisations. The database gives tenant
isolation. `organizationId` gives org isolation within the tenant. You need both.

**ARCH-MT-009** — `TenantContext` and `RequestIdentity` are separate. Do not merge them.
`TenantContext` is in AsyncLocalStorage. `RequestIdentity` is on the request object.

**ARCH-MT-013** — Background jobs must explicitly establish `BackgroundJobContext`
before any database operation. There is no implicit context in async workers.

**ARCH-SEC-002** — The JWT guard always validates `payload.tenantSlug === subdomain`.
A valid JWT from one tenant must never work on another tenant's subdomain.

**ARCH-ORG-004** — The JWT guard verifies that `payload.orgId` has an active
`OrganizationMembership` for the authenticated user. Stale org references are rejected.

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

Users are assigned to one Organisation as their default. They can be granted access to
additional Organisations via an explicit `OrganizationMembership` record.

Switching the active organisation:
1. Backend verifies active membership in the target org
2. Backend recalculates roles and permissions for that org
3. Backend issues a new short-lived access token
4. Frontend receives and stores the new token

The frontend must never locally change `orgId`. The backend issues a new token.
