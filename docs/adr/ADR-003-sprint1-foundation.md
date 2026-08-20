# ADR-003: Sprint 1 Foundation Decisions

Status: ACCEPTED
Date: 2026-07-30
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)
Sprint: 1 — Foundation

---

## Context

Sprint 1 builds the foundation every other sprint depends on. These decisions were drilled
one-by-one before any code was written. No deviation is permitted without a new ADR.

Platform name: **Rukna** (Arabic: ركنة — pillar). This is the product name under which
the ERP is marketed and sold. ACCO Ltd is the first client, not the product name.

---

## Decision 1 — Tenant Registry Location

**Rule: ARCH-MT-001 (extended)**

The tenant registry lives in a dedicated **platform database** separate from all tenant databases.

```
Platform DB (DATABASE_URL env var)
  └── tenants table: id, slug, name, db_url, status, plan, created_at

Tenant DB (resolved per request from registry)
  └── All business data: Organization, User, Role, Project, BOQ...
```

The existing `PrismaService` connects to the platform DB.
A new `TenancyService` resolves and caches tenant Prisma clients.

**Constraint ARCH-MT-005:** The platform database must never contain tenant business data.
The tenant registry stores connection metadata only.

---

## Decision 2 — Tenant Context Flow in NestJS

**Rule: ARCH-MT-006**

Tenant context flows through the request pipeline using **Node.js AsyncLocalStorage**.

```
Request → TenancyMiddleware
  → reads subdomain → resolves slug
  → gets tenant PrismaClient from TenancyService cache
  → runs handler inside tenancyStorage.run({ client, slug, orgId })
    → any service calls tenancyService.getClient() transparently
```

**Why AsyncLocalStorage:**
- No method signature changes anywhere in the codebase
- No REQUEST-scoped provider cascade (performance)
- Services stay clean — they call `tenancyService.getClient()` not `this.prisma`
- Works correctly across all async/await chains within a request

**Constraint ARCH-MT-007:** No service, repository, or controller may import or
instantiate `PrismaClient` directly. All database access goes through
`TenancyService.getClient()` for tenant data, or the injected platform `PrismaService`
for registry data only.

---

## Decision 3 — JWT Payload

**Rule: ARCH-SEC-001**

The JWT payload carries `tenantSlug` and `permissions[]`.

```typescript
export interface JwtPayload {
  sub: string;           // user ID in tenant DB
  email: string;
  orgId: string;         // organization ID in tenant DB
  tenantSlug: string;    // ADDED: cross-tenant replay protection
  roles: string[];       // role names
  permissions: string[]; // ADDED: "action:resource" strings, e.g. "approve:purchase-order"
  iat?: number;
  exp?: number;
}
```

**The JWT guard cross-checks:** `payload.tenantSlug` must match the subdomain resolved
by the middleware. Mismatch = 401. This closes the cross-tenant token replay attack vector.

**Permissions are embedded at login time** from the user's assigned roles.
Access token TTL: 15 minutes. Permissions refresh every 15 minutes via token rotation.

**Constraint ARCH-SEC-002:** The JWT guard must always validate both:
1. Token signature and expiry
2. `payload.tenantSlug === request.tenantSlug` (from AsyncLocalStorage context)

---

## Decision 4 — DOA / Workflow Engine Schema

**Rule: ARCH-DOA-002**

Schema is designed for full power now. Sprint 1 executes sequential steps only.
Parallel and escalation logic ships in a later sprint — but the **columns exist now**
so no migration is needed when that sprint arrives.

```
WorkflowDefinition
  id, org_id, transaction_type, name, name_ar, is_active
  requires_ceo_confirmation  BOOLEAN  ← flagged for ACCO placeholder chains

WorkflowCondition
  id, definition_id
  field          e.g. "amount"
  operator       e.g. "gte" | "lt" | "eq"
  value          e.g. "50000"
  currency_code

WorkflowStep
  id, definition_id
  step_order     INT   ← sequential order
  group_order    INT   ← NULL in Sprint 1; same group_order = parallel (Sprint 2+)
  role_required  STRING  ← e.g. "PROJECT_MANAGER"
  is_optional    BOOLEAN
  escalate_after_hours  INT?  ← NULL in Sprint 1 (Sprint 2+)
  notify_roles   STRING[]

ApprovalInstance
  id, workflow_definition_id, transaction_type, transaction_id
  status: PENDING | APPROVED | REJECTED | CANCELLED
  current_step_order  INT
  initiated_by, initiated_at

ApprovalAction
  id, instance_id, step_order
  action: APPROVE | REJECT | DELEGATE | ESCALATE
  actor_id, acted_at, notes
  ← IMMUTABLE after insert
```

**Transaction types requiring workflow chains:**

| Code | Transaction Type |
|---|---|
| MATERIAL_REQUEST | Material Request |
| PURCHASE_ORDER | Purchase Order |
| SUPPLIER_PAYMENT | Supplier Payment |
| STOCK_TRANSFER | Stock Transfer |
| MATERIAL_ISSUE | Material Issue Request |
| SUBCONTRACT_CERTIFICATE | Subcontract Payment Certificate |
| IPC | Interim Payment Certificate |
| VARIATION | Variation / Change Order |

---

## Decision 5 — ACCO Workflow Chain Seeding

**Rule: ARCH-DOA-003**

All ACCO workflow definitions are seeded in Sprint 1.
They are marked `requires_ceo_confirmation: true` and `is_active: false`
until Eng Ahmed Shirie confirms the amount thresholds.

**ACCO chains (from CEO's business process document):**

Material Request:
  Step 1: SITE_ENGINEER (initiates, no approval needed — submits)
  Step 2: PROJECT_MANAGER
  Step 3: PROCUREMENT_OFFICER
  Step 4: FINANCE_MANAGER

Purchase Order:
  Step 1: PROJECT_MANAGER
  Step 2: PROCUREMENT_MANAGER
  Step 3: FINANCE_MANAGER
  Step 4: CFO (condition: amount >= threshold_1)
  Step 5: CEO (condition: amount >= threshold_2)

Subcontract Certificate:
  Step 1: SITE_ENGINEER
  Step 2: QUANTITY_SURVEYOR
  Step 3: PROJECT_MANAGER
  Step 4: COMMERCIAL_MANAGER
  Step 5: FINANCE_MANAGER
  Step 6: CFO
  Step 7: CEO

IPC:
  Step 1: QUANTITY_SURVEYOR
  Step 2: PROJECT_MANAGER
  Step 3: COMMERCIAL_MANAGER
  Step 4: FINANCE_MANAGER
  Step 5: CFO
  Step 6: CEO

Supplier Payment:
  Step 1: PROCUREMENT_OFFICER
  Step 2: STOREKEEPER
  Step 3: AP_ACCOUNTANT
  Step 4: FINANCE_MANAGER
  Step 5: CFO
  Step 6: CEO

Amount thresholds: PLACEHOLDER — must be confirmed by Eng Ahmed Shirie before activation.

---

## Decision 6 — i18n Structure

**Rule: ARCH-I18N-002**

Translation files are split by module namespace. Language preference is stored
in the user's profile in the tenant database.

```
apps/web/messages/
  en/
    common.json       ← buttons, labels, errors, dates, currencies
    auth.json         ← login, logout, session expired
    platform.json     ← org, users, roles, permissions, settings
    construction.json ← all construction module strings
  ar/
    common.json
    auth.json
    platform.json
    construction.json
```

Language preference: `User.preferredLanguage` field (enum: EN | AR).
Resolved on login. Stored in JWT as `lang`. No URL locale segment needed.

RTL: `<html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>` in root layout.

**Constraint ARCH-I18N-003:** Every new module added to the platform (retail,
manufacturing, logistics) gets its own namespace file. Never add strings from
one module into another module's namespace file.

---

## Decision 7 — Exchange Rate Locking

**Rule: ARCH-CCY-002 (extended)**

Exchange rates are locked at the moment a financial record is posted.
The `ExchangeRate` table provides the default rate in the UI. Finance can override it.
Once posted, the rate is immutable.

```
ExchangeRate (in tenant DB)
  id, org_id
  from_currency   VARCHAR(3)   e.g. "USD"
  to_currency     VARCHAR(3)   e.g. "SOS"
  rate            DECIMAL(18,6)
  valid_from      DATE
  created_by, created_at

Every financial record carries:
  amount              DECIMAL(18,2)   ← original amount
  currency_code       VARCHAR(3)      ← original currency
  reporting_rate      DECIMAL(18,6)   ← IMMUTABLE: rate at time of posting
  reporting_amount    DECIMAL(18,2)   ← IMMUTABLE: amount × rate at posting
  reporting_currency  VARCHAR(3)      ← org's reporting currency
```

**Constraint ARCH-CCY-003:** No process may recalculate `reporting_amount` on a
posted financial record. If a rate was entered incorrectly, the correction goes
through a reversing entry — never an UPDATE.

---

## Decision 8 — Permission Scoping

**Rule: CONST-SEC-001**

Permissions in the JWT are flat (`action:resource`). The JWT guard checks
permission existence. Project-level access is a domain concern enforced in the
service layer by `ProjectMembershipService.assertMember(userId, projectId)`.

```typescript
// Every construction service method that touches a specific project MUST call:
await this.projectMembership.assertMember(currentUser.sub, projectId);
// before any business logic executes.
```

This is enforced on ALL construction service methods that operate on a specific project.
Forgetting this call is a security violation. Code review must check for it.

**Constraint CONST-SEC-002:** The `ProjectMembershipService.assertMember` call must
appear as the FIRST line of business logic in any service method that accepts a
`projectId` parameter, before any database reads or writes.

---

## Decision 9 — Two Prisma Setups

**Rule: ARCH-DB-001**

Two separate Prisma configurations. Two generated clients. Two env vars.

```
apps/api/
  prisma/
    schema.prisma           ← TENANT schema (deployed to every tenant DB)
    migrations/             ← tenant DB migrations
  prisma-platform/
    schema.prisma           ← PLATFORM schema (deployed to platform DB once)
    migrations/             ← platform DB migrations
```

```json
// package.json scripts
"db:generate": "prisma generate --schema=prisma/schema.prisma && prisma generate --schema=prisma-platform/schema.prisma",
"db:migrate:tenant": "prisma migrate dev --schema=prisma/schema.prisma",
"db:migrate:platform": "prisma migrate dev --schema=prisma-platform/schema.prisma",
"db:migrate:tenant:prod": "prisma migrate deploy --schema=prisma/schema.prisma",
"db:migrate:platform:prod": "prisma migrate deploy --schema=prisma-platform/schema.prisma"
```

Imports:
```typescript
import { PrismaClient } from '@prisma/client';                    // tenant client
import { PlatformPrismaClient } from '../generated/platform';    // platform client
```

**Constraint ARCH-DB-002:** Models that belong to the platform schema (Tenant,
GlobalConfig) must never appear in `prisma/schema.prisma`. Models that belong to
the tenant schema (Organization, User, Project, BOQ, etc.) must never appear in
`prisma-platform/schema.prisma`.

---

## Decision 10 — Organisation Model

**Rule: ARCH-MT-004**

One tenant account can contain multiple organisations (business units).
Example: Asas Group (tenant) → ACCO Ltd, Asas Real Estate, Asas Trading (orgs).

**Every query in every module must filter by BOTH:**
1. The tenant database (enforced by AsyncLocalStorage — you are already in the right DB)
2. `organizationId` (enforced in every WHERE clause)

```typescript
// CORRECT — always scope to org
await prisma.project.findMany({ where: { organizationId: ctx.orgId } });

// WRONG — missing org scope, reads all orgs in the tenant
await prisma.project.findMany();
```

**Constraint ARCH-MT-008:** No `findMany`, `findFirst`, `count`, `aggregate`, or
`groupBy` query may omit `organizationId` in the where clause for models that
carry an `organizationId` field. This is a data isolation violation.

Code review must treat a missing `organizationId` filter as a security bug,
not a style issue.

---

## Platform Schema (prisma-platform/schema.prisma)

```prisma
model Tenant {
  id          String       @id @default(cuid())
  slug        String       @unique
  name        String
  dbUrl       String       @map("db_url")
  status      TenantStatus @default(PROVISIONING)
  plan        String       @default("standard")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")

  @@map("tenants")
}

enum TenantStatus {
  PROVISIONING
  ACTIVE
  SUSPENDED
  TERMINATED
}
```

---

## Tenant Schema Additions (prisma/schema.prisma)

Add to existing User model:
```prisma
preferredLanguage  Language  @default(EN) @map("preferred_language")
```

Add Language enum:
```prisma
enum Language {
  EN
  AR
}
```

Add ExchangeRate model:
```prisma
model ExchangeRate {
  id             String   @id @default(cuid())
  organizationId String   @map("organization_id")
  fromCurrency   String   @map("from_currency") @db.VarChar(3)
  toCurrency     String   @map("to_currency") @db.VarChar(3)
  rate           Decimal  @db.Decimal(18, 6)
  validFrom      DateTime @map("valid_from") @db.Date
  createdBy      String   @map("created_by")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, fromCurrency, toCurrency, validFrom])
  @@map("exchange_rates")
}
```

Add WorkflowDefinition, WorkflowCondition, WorkflowStep, ApprovalInstance,
ApprovalAction models (see Section Decision 4 above for field definitions).
