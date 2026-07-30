# Sprint 1 — Exact Build Plan

Status: READY TO BUILD
Date: 2026-07-30
Engineer: Abdulsalam (backend) + Frontend Engineer (frontend)

Read before touching any file:
1. ADR-001 · ADR-002 · ADR-003
2. tenancy.md
3. domain-model.md
4. boundaries.md

---

## Build Order (strict — each step unblocks the next)

### STEP 1 — Platform Prisma Schema
**Files to create:**
```
apps/api/prisma-platform/schema.prisma
```
**Contains:** Tenant model only (slug, name, db_url, status, plan).
**Run after:** `prisma migrate dev --schema=prisma-platform/schema.prisma`
**Unblocks:** TenancyService, all multi-tenancy code.

---

### STEP 2 — Tenant Schema Additions
**File to edit:** `apps/api/prisma/schema.prisma`

**Add to User model:**
- `preferredLanguage Language @default(EN)`

**Add new models:**
- `ExchangeRate` (see ADR-003 Decision 7 for exact fields)
- `WorkflowDefinition`
- `WorkflowCondition`
- `WorkflowStep`
- `ApprovalInstance`
- `ApprovalAction`

**Add new enums:**
- `Language { EN AR }`
- `WorkflowTransactionType { MATERIAL_REQUEST PURCHASE_ORDER SUPPLIER_PAYMENT STOCK_TRANSFER MATERIAL_ISSUE SUBCONTRACT_CERTIFICATE IPC VARIATION }`
- `ApprovalStatus { PENDING APPROVED REJECTED CANCELLED }`
- `ApprovalActionType { APPROVE REJECT DELEGATE ESCALATE }`

**Run after:** `prisma migrate dev --schema=prisma/schema.prisma`
**Unblocks:** All business modules.

---

### STEP 3 — Update Shared Types
**File to edit:** `packages/types/src/auth.ts`

```typescript
export interface JwtPayload {
  sub: string;
  email: string;
  orgId: string;
  tenantSlug: string;    // ADD
  roles: string[];
  permissions: string[]; // ADD — format: "action:resource"
  lang: 'en' | 'ar';    // ADD
  iat?: number;
  exp?: number;
}
```

**Also add to** `packages/types/src/index.ts`:
- Export `TenantStatus`, `Language`, `WorkflowTransactionType` enums

**Unblocks:** Auth service completion, JWT guard update.

---

### STEP 4 — TenancyModule
**Files to create:**
```
apps/api/src/platform/tenancy/tenancy.module.ts
apps/api/src/platform/tenancy/tenancy.service.ts
apps/api/src/platform/tenancy/tenancy.middleware.ts
apps/api/src/platform/tenancy/tenancy.context.ts   ← AsyncLocalStorage wrapper
```

**tenancy.context.ts:**
```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface TenancyContext {
  slug: string;
  orgId: string;
  client: PrismaClient;  // from @prisma/client (tenant)
  lang: 'en' | 'ar';
}

export const tenancyStorage = new AsyncLocalStorage<TenancyContext>();
```

**tenancy.service.ts:**
- Inject platform `PrismaService` (reads tenant registry)
- `private clients = new Map<string, PrismaClient>()`
- `async getClient(): PrismaClient` — reads from AsyncLocalStorage
- `async resolveTenant(slug: string): TenancyContext` — looks up DB, caches client
- `async getTenantOrThrow(slug: string): Tenant` — throws 404 if not found

**tenancy.middleware.ts:**
- Extract subdomain from `request.hostname`
- Call `tenancyService.resolveTenant(slug)`
- Run `next()` inside `tenancyStorage.run(context, () => next())`
- Throw `NotFoundException` if tenant not found or suspended

**Register in AppModule:** Apply `TenancyMiddleware` globally with `configure(consumer)`

**Unblocks:** All subsequent steps.

---

### STEP 5 — Update JWT Guard and Strategy
**Files to edit:**
```
apps/api/src/platform/auth/infrastructure/jwt.strategy.ts
apps/api/src/common/guards/jwt-auth.guard.ts
```

**jwt.strategy.ts:** Update `validate()` to cross-check `payload.tenantSlug`
against the current `tenancyStorage` context slug. Throw `UnauthorizedException`
on mismatch.

**jwt-auth.guard.ts:** No changes — inherits from `AuthGuard('jwt')`.

---

### STEP 6 — Complete AuthService
**File to edit:** `apps/api/src/platform/auth/application/auth.service.ts`

**login(dto):**
1. Get tenant PrismaClient from `TenancyService.getClient()`
2. Find user by email in tenant DB — throw `UnauthorizedException` if not found
3. Validate `bcrypt.compare(dto.password, user.passwordHash)`
4. Load user's roles → load permissions for those roles
5. Build `JwtPayload` with `tenantSlug`, `permissions`, `lang`
6. Sign access token (15m) and refresh token (7d)
7. Store refresh token hash in `RefreshToken` table (tenant DB)
8. Return `TokenPair`

**refresh(dto):**
1. Verify refresh token signature
2. Find `RefreshToken` record — throw if not found or revoked
3. Mark old token as revoked
4. Issue new access token + rotate refresh token
5. Reload permissions (captures any role changes in last 7d)

**logout(dto):**
1. Find `RefreshToken` record
2. Set `revokedAt = now()`

---

### STEP 7 — DOA Workflow Module
**Files to create:**
```
apps/api/src/platform/workflows/workflows.module.ts
apps/api/src/platform/workflows/application/workflows.service.ts
apps/api/src/platform/workflows/application/approval.service.ts
apps/api/src/platform/workflows/presentation/workflows.controller.ts
apps/api/src/platform/workflows/domain/entities/workflow.entity.ts
apps/api/src/platform/workflows/infrastructure/workflows-prisma.repository.ts
apps/api/src/platform/workflows/seeders/acco-workflows.seed.ts
```

**workflows.service.ts:**
- `getDefinitionForTransaction(orgId, type, amount)` — evaluates conditions, returns matching definition
- `getStepsForDefinition(definitionId)` — returns ordered steps

**approval.service.ts:**
- `initiate(orgId, transactionType, transactionId, initiatorId)` — creates `ApprovalInstance`
- `approve(instanceId, actorId, notes)` — records action, advances to next step
- `reject(instanceId, actorId, notes)` — records action, sets instance to REJECTED
- `getCurrentStep(instanceId)` — returns current pending step
- `isFullyApproved(instanceId)` — true when all steps approved

**acco-workflows.seed.ts:**
- Seeds all 7 ACCO workflow definitions (see ADR-003 Decision 5)
- All marked `requires_ceo_confirmation: true`, `is_active: false`
- Amount thresholds: placeholder values pending CEO confirmation

---

### STEP 8 — Tenant Provisioning Script
**File to create:**
```
apps/api/scripts/tenant-provision.ts
```

**Run as:** `pnpm tenant:provision --slug=acco --name="ACCO Ltd" --plan=standard`

**Script steps:**
1. Connect to platform DB
2. Check slug is unique (throw if taken)
3. `CREATE DATABASE rukna_{slug}` via pg client
4. Run tenant migrations: `prisma migrate deploy`
5. Seed: default org, admin user, roles, permissions, workflow templates
6. Insert into platform `tenants` table
7. Log success with access URL

---

### STEP 9 — Frontend: i18n Setup
**Files to create:**
```
apps/web/messages/en/common.json
apps/web/messages/en/auth.json
apps/web/messages/en/platform.json
apps/web/messages/ar/common.json
apps/web/messages/ar/auth.json
apps/web/messages/ar/platform.json
apps/web/src/i18n/request.ts
apps/web/src/middleware.ts       ← next-intl middleware
```

**Routing:** No URL locale segment. Language resolved from:
1. JWT `lang` field (logged-in users)
2. `Accept-Language` header (logged-out users)
3. Default: `en`

---

### STEP 10 — Frontend: Login Page
**Files to create:**
```
apps/web/src/app/(auth)/login/page.tsx
apps/web/src/app/(auth)/layout.tsx
apps/web/src/features/auth/components/login-form.tsx
apps/web/src/features/auth/hooks/use-login.ts
apps/web/src/features/auth/api/auth-api.ts
```

**Requirements:**
- Bilingual: English label + Arabic label visible simultaneously (or toggle)
- Mobile-responsive: works on 375px width
- Fields: email, password, show/hide password toggle
- Error: "Invalid email or password" — same message for both (no user enumeration)
- On success: redirect to dashboard, store tokens in httpOnly cookie (not localStorage)
- RTL layout in Arabic mode

---

## Package.json Scripts to Add

```json
"db:generate": "prisma generate --schema=prisma/schema.prisma && prisma generate --schema=prisma-platform/schema.prisma",
"db:migrate:tenant": "prisma migrate dev --schema=prisma/schema.prisma",
"db:migrate:platform": "prisma migrate dev --schema=prisma-platform/schema.prisma",
"db:migrate:tenant:prod": "prisma migrate deploy --schema=prisma/schema.prisma",
"db:migrate:platform:prod": "prisma migrate deploy --schema=prisma-platform/schema.prisma",
"tenant:provision": "tsx scripts/tenant-provision.ts"
```

---

## Definition of Done — Sprint 1

- [ ] `acco.localhost:3001/api/v1/auth/login` returns a valid JWT with `tenantSlug: "acco"`
- [ ] JWT from `acco` rejected at `other.localhost:3001` (cross-tenant check works)
- [ ] `TenancyService` resolves correct Prisma client per subdomain
- [ ] All ACCO workflow definitions seeded and visible in DB
- [ ] `ExchangeRate` table exists in tenant DB
- [ ] `User.preferredLanguage` field exists
- [ ] Login page renders in English and Arabic · RTL layout works in Arabic
- [ ] Login page works on 375px mobile viewport
- [ ] Platform migrations applied to platform DB
- [ ] Tenant migrations applied to acco DB
- [ ] `pnpm tenant:provision` script runs end-to-end
