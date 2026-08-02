# ADR-004: Sprint 2 Model Corrections and Consolidation

Status: ACCEPTED
Date: 2026-08-02
Deciders: Abdulsalam (Backend Engineer), Eng Ahmed Shirie (CEO, ACCO Ltd)
Supersedes: Portions of ADR-002 and ADR-003 where noted explicitly.

---

## Context

The Sprint 1 architecture produced a strong foundation. After grilling Sprint 2 scope
and conducting a consistency review, 25 discrepancies were identified between:

- decisions made during discovery (ADR-002)
- decisions subsequently locked during the Sprint 2 planning grill
- the current documentation (domain-model.md, architecture.md, tenancy.md)

These discrepancies must be resolved before any Sprint 2 implementation begins.
This ADR records every correction. Documents updated as a result are noted per decision.

**Sprint 2 implementation begins only after this ADR is accepted.**

---

## Decision 1 — Project Is a Business Scope Root, Not a DDD God Aggregate

**Supersedes:** ADR-002 Decision 1 description ("Project is the root entity. Every cost,
document, progress record, and financial transaction belongs to a Project.")

**Correction:** That statement is correct as a *reporting principle* — all project-specific
construction activity is attributed to a Project. It is incorrect as a DDD *aggregate* rule.

Project must not be one enormous aggregate containing BOQ, PurchaseOrder, StockLedger,
IPC, CostLedger, DailyProgressReport, Subcontract, and all their children. That aggregate
would be too large to load, lock, validate, and mutate safely.

**Rule CONST-AGG-001:** The following are each independent aggregate roots. Each holds
its own invariants. Each references projectId but is not owned by the Project aggregate.

```
Project                     Aggregate root — lifecycle, membership, metadata
Contract                    Aggregate root — references projectId
BOQ + BOQVersion            Aggregate root — references projectId
PurchaseOrder               Aggregate root — references projectId
GoodsReceiptNote            Aggregate root — references projectId
MaterialRequest             Aggregate root — references projectId
StockTransfer               Aggregate root
IPC                         Aggregate root — references projectId, contractId
Subcontract                 Aggregate root — references projectId
DailyProgressReport         Aggregate root — references projectId
ProjectSuspension           Event record — references projectId
```

Project is the central *business attribution scope* and reference dimension.
It is not the only aggregate.

**Documents updated:** domain-model.md

---

## Decision 2 — Project Lifecycle Replacement

**Supersedes:** ADR-002 domain-model.md field `status: TENDER, AWARDED, ACTIVE, SUSPENDED, COMPLETED, CLOSED`

**Rule CONST-LIFECYCLE-001:** The Project status lifecycle is:

```
DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION → CLOSEOUT → CLOSED
```

Terminal states: `CLOSED`, `CANCELLED`

```prisma
enum ProjectStatus {
  DRAFT
  APPROVED
  MOBILIZING
  ACTIVE
  PRACTICAL_COMPLETION
  CLOSEOUT
  CLOSED
  CANCELLED
}
```

**Rule CONST-LIFECYCLE-002 — CANCELLED restrictions:**

CANCELLED is allowed only from: `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE`.
CANCELLED is **prohibited** from: `PRACTICAL_COMPLETION`, `CLOSEOUT`.
CANCELLED always requires: reason (String), actor, DoA approval, audit event.

**Rule CONST-LIFECYCLE-003 — SUSPENDED is not a lifecycle state:**

SUSPENDED is not a value in `ProjectStatus`. Suspension is a separate operational
condition tracked in the `ProjectSuspension` table. A suspended project retains its
current lifecycle status (e.g., `ACTIVE`) while also having an open suspension record.

**Rule CONST-LIFECYCLE-004 — Controlled reopening:**

- `PRACTICAL_COMPLETION → ACTIVE`: permitted via dedicated command, requires authorization + audit.
- `CLOSEOUT → PRACTICAL_COMPLETION`: permitted via dedicated command, requires authorization + audit.
- No other backward transitions are permitted.

**Rule CONST-LIFECYCLE-005 — DoA-authorized transitions:**

All lifecycle transitions except DRAFT creation require DoA authorization via
`WorkflowTriggerBinding` resolution (see Decision 8).

**Documents updated:** domain-model.md, prisma/schema.prisma (migration required)

---

## Decision 3 — Tender and Opportunity Are Not Project

**Context:** The old `TENDER` and `AWARDED` lifecycle states implied a project starts at
tendering. That conflates two separate domains.

**Rule CONST-OPP-001:** Opportunity and tendering are modeled separately from Project.

```
Opportunity
└── Tender / Bid
    status: PREPARING | SUBMITTED | WON | LOST | WITHDRAWN
```

A Project is created *after* a tender is won, or directly for internal capital work
(no tender required). A Project does not begin life as a TENDER record.

This separation allows:
- tracking of lost bids without cluttering the project list
- internal projects without a tendering record
- joint-venture projects via separate tender path

**Sprint scope:** Opportunity and Tender are Sprint 3+ scope. The separation is recorded
here so the Project module is designed correctly from the start.

---

## Decision 4 — ProjectSuspension Partial Unique Index

**Supersedes:** Sprint 2 grill decision — "only one active suspension per project at a time,
enforced at service layer."

**Correction:** Service-layer enforcement alone is insufficient. Two concurrent requests
can both pass the service check and create two active suspension rows.

**Rule CONST-SUSP-001:** The service validation for an existing active suspension must exist
for user-facing error messages.

**Rule CONST-SUSP-002:** A PostgreSQL partial unique index enforces the database-level
invariant as the safety net:

```sql
CREATE UNIQUE INDEX uq_project_active_suspension
  ON project_suspensions (project_id)
  WHERE resumed_at IS NULL;
```

This index is added through a reviewed SQL migration. Prisma does not express all
partial-index forms directly; add via `prisma/migrations/<timestamp>_add_suspension_index/migration.sql`.

**Rule CONST-SUSP-003:** The `ProjectSuspension` table fields:

```
ProjectSuspension
  id
  projectId
  suspendedAt       DateTime
  suspendedBy       String (userId)
  reason            String
  resumedAt         DateTime? (null = currently suspended)
  resumedBy         String? (userId)
  resumeReason      String?
  authorizedBy      String? (DoA approver userId)
  createdAt         DateTime
```

---

## Decision 5 — Organization Membership Model

**Context:** ADR-003 states that users are assigned to one organization and may be granted
access to additional organizations. The `orgId` in the JWT represents the active organization.
But no explicit membership model was recorded.

**Rule ARCH-ORG-001:** Organization membership is an explicit, persisted model:

```
OrganizationMembership
  id
  organizationId
  userId
  status            ACTIVE | SUSPENDED | REMOVED
  isDefault         Boolean
  joinedAt          DateTime
  removedAt         DateTime?
  removedBy         String? (userId)
```

**Rule ARCH-ORG-002:** Organization-level role assignment:

```
OrganizationMembershipRole
  id
  membershipId
  roleId
  assignedAt        DateTime
  assignedBy        String (userId)
  removedAt         DateTime?
```

**Rule ARCH-ORG-003 — Organization switch validation:**

When a user switches the active organization:
1. Verify the user has an active `OrganizationMembership` record for the target org.
2. Recalculate roles and permissions for that org.
3. Issue a new short-lived access token with the updated `orgId`, `roles`, `permissions`.
4. Record the organization switch in the audit log where required by policy.

The frontend must never change `orgId` directly. The backend issues a new token.

**Rule ARCH-ORG-004:** The JWT guard must verify that the `orgId` in the JWT corresponds
to an active `OrganizationMembership` record for the authenticated user. Reject with 401
if membership is not found or not ACTIVE.

---

## Decision 6 — Tenant Context Split Into Two Interfaces

**Supersedes:** ADR-003 Decision 2 — the `AsyncLocalStorage` context currently stores
`{ client, slug, orgId }`.

**Correction:** The middleware runs before JWT authentication. At middleware time, `orgId`
is not yet known — it comes from the authenticated token. Storing `orgId` in the
tenancy context is premature.

**Rule ARCH-MT-009:** Split into two typed interfaces:

```typescript
// Established by TenancyMiddleware (runs before auth)
interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  client: TenantPrismaClient;
}

// Established by JwtAuthGuard (runs after token validation)
interface RequestIdentity {
  userId: string;
  activeOrganizationId: string;
  roles: string[];
  permissions: string[];
  lang: 'en' | 'ar';
}
```

**Correct request pipeline:**

```
TenancyMiddleware
  → reads subdomain → resolves tenant record
  → stores TenantContext in AsyncLocalStorage

JwtAuthGuard
  → validates token signature + expiry
  → validates payload.tenantSlug === TenantContext.tenantSlug
  → validates orgId has active OrganizationMembership
  → attaches RequestIdentity to request object

RolesGuard / PermissionsGuard
  → reads RequestIdentity.permissions

Service layer
  → reads TenantContext for db client
  → reads RequestIdentity for userId + activeOrganizationId
```

**Documents updated:** tenancy.md

---

## Decision 7 — Defense in Depth for Organization Isolation

**Extends:** ADR-003 Constraint ARCH-MT-008 (every query must filter by `organizationId`).

**Correction:** Code-review rules alone are not sufficient. Missing a filter becomes a
cross-organization data leak.

**Rule ARCH-MT-010:** Use scoped repository classes that require `organizationId` at the
call site, making omission impossible rather than merely forbidden:

```typescript
// Correct — organizationId required by method signature
projectRepository.findMany({ organizationId, filters });

// Wrong — arbitrary Prisma access scattered through services
prisma.project.findMany({ where: { ... } });
```

**Rule ARCH-MT-011:** Add composite uniqueness constraints containing `organizationId`
on all organization-scoped unique fields (e.g., project code unique within org).

**Rule ARCH-MT-012:** Write explicit cross-organization security tests that verify
a request authenticated for `org-A` cannot retrieve records belonging to `org-B`.
These are regression tests, not optional QA steps.

---

## Decision 8 — WorkflowTriggerBinding: Generic Trigger-to-Workflow Resolver

**Context:** Sprint 2 grill locked this design. Recorded here for completeness.

**Rule ARCH-DOA-004:** A `WorkflowTriggerBinding` table connects trigger events
(e.g., project lifecycle transitions) to workflow definitions:

```
WorkflowTriggerBinding
  id
  organizationId    String? (NULL = tenant-local default template)
  triggerEvent      String          e.g. "project.transition"
  fromState         String?         nullable = applies from any state
  toState           String          e.g. "APPROVED"
  workflowDefinitionId String
  priority          Int             lower = higher priority
  isActive          Boolean
  createdAt         DateTime
```

**Rule ARCH-DOA-005 — Resolution order** (first match wins):

1. org-specific exact match   (organizationId = ctx.orgId, fromState = current state)
2. org-specific wildcard      (organizationId = ctx.orgId, fromState = NULL)
3. tenant default exact match (organizationId = NULL, fromState = current state)
4. tenant default wildcard    (organizationId = NULL, fromState = NULL)

**Rule ARCH-DOA-006 — Terminology:**

`organizationId = NULL` means *tenant-local default template*, not a global platform record.
Default templates live in the tenant database and are seeded during provisioning.
They can be overridden per-organization without affecting other organizations.

**Rule ARCH-DOA-007 — Workflow condition typing:**

`WorkflowCondition` fields must reference controlled catalogued subjects, not arbitrary strings:

```
WorkflowCondition
  id
  definitionId
  subjectField    AMOUNT_REPORTING | PROJECT_TYPE | BRANCH | COST_CATEGORY | ...
  operator        EQ | NE | GT | GTE | LT | LTE | IN
  valueType       MONEY | STRING | ENUM | BOOLEAN
  valueJson       String (JSON)
  currencyCode    String?
```

Arbitrary field name strings in conditions create an unsafe runtime expression evaluator.
The controlled catalogue is extended by backend engineers via ADR, not by end users.

---

## Decision 9 — Project Membership: Controlled Roles, Multi-Role per Member

**Supersedes:** Any description of `ProjectMember.role` as a single String field.

**Rule CONST-MEMBER-001:** Project membership uses three tables:

```
ProjectRole
  id
  organizationId
  name            String (unique within org)
  nameAr          String
  permissions     String[]
  isActive        Boolean
  createdAt       DateTime

ProjectMember
  id
  projectId
  userId
  status          ACTIVE | REMOVED
  addedAt         DateTime
  addedBy         String (userId)
  removedAt       DateTime?

ProjectMemberRole
  id
  memberId
  projectRoleId
  assignedAt      DateTime
  assignedBy      String (userId)
  removedAt       DateTime?
```

**Rule CONST-MEMBER-002:** A project member may hold multiple project roles simultaneously.

**Rule CONST-MEMBER-003:** `ProjectRole.name` must reference a controlled record.
Free-text strings like "PROJECT_MANAGER", "Project Manager", "PM" are not equivalent.
New project roles are created via the ProjectRole management API, not embedded as raw strings.

**Rule CONST-MEMBER-004 — assertMember semantics:**

`ProjectMembershipService.assertMember(userId, projectId)` verifies the user has an
active `ProjectMember` record. It does not check roles. Role checks are separate.

The *intent* of CONST-SEC-002 (from ADR-003) is:

> Project authorization must occur before reading or mutating any project-owned business
> data. The full authorization chain is:
>
> Tenant isolation → Organization membership → Global permission → Project membership
> → Project operational role (where relevant) → Business state rules

**Rule CONST-MEMBER-005 — Defined bypass policies:**

The following roles are permitted to access project data without active project membership.
Each must be an explicit code path, not an undocumented bypass:

- Organization administrator
- Executive portfolio viewer
- Internal auditor
- Finance controller (read access to cost and billing data)
- System support (break-glass, requires audit event)

---

## Decision 10 — BOQ Versioning Model

**Supersedes:** ADR-002 Decision 2 `BOQNode` model (which has no versioning).

**Rule CONST-BOQ-004:** The BOQ is versioned via immutable `BOQVersion` records:

```
BOQ
  id
  organizationId
  projectId
  name            String
  baselineVersionId  String?  (nullable until first baseline)
  currentDraftVersionId String?

BOQVersion
  id
  boqId
  versionNumber   Int        (sequential per BOQ)
  status          DRAFT | BASELINED | SUPERSEDED | CANCELLED
  derivedFromVersionId String? (set when copying from a prior version)
  variationId     String?    (set when created from a Variation Order)
  approvedAt      DateTime?
  approvedBy      String?    (userId)
  createdAt       DateTime

BOQNode
  id
  versionId       String     (FK → BOQVersion)
  parentId        String?    (self-referential within same version)
  originNodeId    String?    (FK → BOQNode in prior version — set on deep copy)
  type            GROUP | ITEM
  stableCode      String     (human-readable, e.g. "01.02.003")
  name            String
  nameAr          String
  unit            String?    (ITEM only)
  quantity        Decimal?   (ITEM only)
  unitRate        Decimal?   (ITEM only)
  totalAmount     Decimal?   (ITEM only)
  measurementMethod QUANTITY | PERCENTAGE | MILESTONE  (ITEM only)
  path            String     (ancestry path using stable node IDs — not sortOrder)
  depth           Int
  sortOrder       Int        (display order — separate from path)
```

**Rule CONST-BOQ-005 — Baseline immutability:**

A `BASELINED` BOQVersion is permanently immutable. Any mutation attempt returns 400.

**Rule CONST-BOQ-006 — Version lifecycle:**

- Mutations are only permitted on `DRAFT` versions.
- When a Variation Order is approved, a new DRAFT version is created (full deep copy).
- Baselining transitions the current DRAFT to BASELINED and sets `BOQ.baselineVersionId`.
- The prior BASELINED version transitions to SUPERSEDED.
- IPC records reference a specific `BOQVersion.id` — never the BOQ root.

**Rule CONST-BOQ-007 — Full deep copy on new draft version:**

When creating a new draft version from a baseline, every `BOQNode` is deep-copied.
Each copied node receives `originNodeId` pointing to its source node in the prior version.
This provides lineage tracing across versions.

**Rule CONST-BOQ-008 — Path and sortOrder:**

`path` stores ancestry using stable node IDs (UUIDs or CUIDs). Reordering siblings
updates `sortOrder` only. It must never trigger a path rewrite for the reordered node
or any of its descendants.

`sortOrder` is a presentation field. `path` is a structural field. They are independent.

---

## Decision 11 — BOQ Tree: Recursive CTE for Subtree Operations

**Context:** Sprint 2 grill locked this design.

**Rule CONST-BOQ-009:** Node move operations use a PostgreSQL recursive CTE inside a
database transaction to recalculate `path` and `depth` for the moved node and all
descendants in one atomic operation.

**Rule CONST-BOQ-010:** Stable node IDs (the UUID/CUID of each BOQNode) are used in
the `path` field. This means reordering siblings (updating `sortOrder`) never invalidates
any path value.

Example path: `"7f3a2b.9c1d4e.a2f8b1"` (concatenated node IDs, not position codes).

---

## Decision 12 — Conditional Cost Allocation on Project Costs

**Supersedes:** ADR-002 Constraint CONST-COST-001:
> "Every cost transaction must carry a `boq_node_id` and `cost_category` before it can
> be posted to the project cost ledger."

**Correction:** Mandatory `boq_node_id` on every project cost is too strict. Legitimate
project costs that may not map to a specific BOQ item include: site office rental,
project insurance, permits, general site security, mobilization cost, head-office
allocation, financing charges, project-wide HSE expense, unallocated emergency cost.

**Rule CONST-COST-003:** Every posted project cost must carry:
- `projectId` (always mandatory)
- `costCodeId` or `costCategory` (always mandatory — controlled classification)

The allocation target is one of:
- `boqNodeId` (when cost is attributable to a specific BOQ item)
- Work package ID (future — Sprint 3+)
- Project overhead cost object (for project-level costs not tied to a BOQ item)
- `UNALLOCATED` queue (temporary — requires subsequent allocation within defined SLA)

**Rule CONST-COST-004:** Permanent unallocated costs are prohibited. An unallocated
cost entry must be resolved within the organization's defined allocation SLA.
Do not force attachment to a false BOQ item to satisfy a mandatory field.

**Constraint CONST-COST-001 is amended** by CONST-COST-003 and CONST-COST-004.

---

## Decision 13 — Inventory Acquisition Versus Project Consumption

**Supersedes:** ADR-002 Decision 5 (StockLedger model) — the mandatory `project_id`,
`boq_node_id`, `cost_category` on every `StockLedger` row.

**Correction:** Central warehouse stock operations do not always involve a project.
Mandatory project and BOQ fields break central inventory scenarios.

**Rule CONST-INV-004:** `StockLedger.projectId`, `StockLedger.boqNodeId`, and
`StockLedger.costCategory` are nullable.

**Rule CONST-INV-005 — Validation by transaction type:**

| Transaction type        | projectId required | boqNodeId required      |
|-------------------------|-------------------|-------------------------|
| RECEIPT (central)       | No                | No                      |
| CENTRAL_TRANSFER        | No                | No                      |
| RECEIPT (project-spec.) | Yes               | Usually yes             |
| ISSUE to construction   | Yes               | Yes or overhead object  |
| WASTAGE at project site | Yes               | Yes where identifiable  |
| RETURN_TO_VENDOR        | Conditional       | Conditional             |
| ADJUSTMENT              | No                | No                      |

**Rule CONST-INV-006 — Cost timing:**

Inventory acquisition and project consumption are separate cost events:

```
Supplier invoice posted
  → Inventory / GRNI accounting entry
  → Supplier payable entry
  (NOT a project cost)

Material issued to project site / work package
  → Project material cost entry
  → Inventory reduction
  (THIS is the project cost event)
```

For project-specific direct delivery (goods delivered directly to site, consumed
immediately), receipt and consumption may coincide. The system must support both
the warehoused-then-issued path and the direct-delivery path.

---

## Decision 14 — Three-Stage Ledger: Partial Transaction Support

**Extends:** ADR-002 Decision 7 (Three-stage commitment accounting).

**Correction:** The model currently implies one PO → one GRN → one invoice. Real
procurement includes partial receipts, multiple GRNs, partial invoices, price variances,
quantity variances, cancellations, and returns.

**Rule CONST-COMMIT-004:** Commitment accounting operates at the PO line level, not the
PO header level. Each `POLine` maintains open quantity and value independently.

**Rule CONST-COMMIT-005:** `CostLedger` rows are immutable movements (signed deltas).
Commitment release is an explicit credit movement, not an UPDATE on the original row.

Example for a partial receipt:

```
PO line: 1,000 units × $10 = $10,000 COMMITTED

GRN 1: 400 units received
  → Credit COMMITTED:  400 × $10 = $4,000
  → Debit ACCRUED:     400 × $10 = $4,000
  → Remaining COMMITTED open balance: $6,000

GRN 2: 300 units received
  → Credit COMMITTED:  300 × $10 = $3,000
  → Debit ACCRUED:     300 × $10 = $3,000
  → Remaining COMMITTED open balance: $3,000
```

Reports compute remaining commitment from open balances, not by treating COMMITTED,
ACCRUED, and ACTUAL as three additive columns for the same quantity.

---

## Decision 15 — IPC Numbering Correction

**Supersedes:** ADR-002 Constraint CONST-IPC-002:
> "IPC numbers are sequential per contract and must never have gaps."

**Correction:** Database sequences can have gaps due to transaction rollback, process
failure, or concurrency. Guaranteeing mathematical gaplessness is not achievable without
a dedicated serialized numbering ledger. Unless local regulation explicitly requires
gapless numbering, this is an over-promise.

**Rule CONST-IPC-004:** IPC numbers within a contract must be:
- Unique
- Monotonically increasing
- Assigned only at the moment of final FROZEN status (not at DRAFT creation)
- Never reused
- Voided IPC numbers retained as explicit void records where regulatory policy requires

**Constraint CONST-IPC-002 is replaced** by CONST-IPC-004.

---

## Decision 16 — Configurable IPC Evidence Policy

**Supersedes:** ADR-002 Decision 6 — "A BOQ quantity is only billable if it is supported
by ALL four document types (DPR, ITR, Measurement Sheet, Work Completion Record)."

**Correction:** This is too rigid. Administrative milestones may not need a DPR.
Excavation may not need a Work Completion Record per period. ITRs apply only to
quality-controlled activities. Some contracts use consultant-certified measurement only.

**Rule CONST-IPC-005:** Each BOQ item or work category is assigned a certification policy:

```
BOQItemCertificationPolicy
  boqVersionId
  boqNodeId (or categoryId)
  requiresDpr                 Boolean
  requiresItr                 Boolean
  requiresMeasurementSheet    Boolean
  requiresCompletionRecord    Boolean
  requiresConsultantCert      Boolean
```

The IPC engine evaluates required evidence for each item based on its policy, not a
single universal rule.

Default policy seeded at BOQ creation: `requiresDpr = true`, others configurable by QS.

---

## Decision 17 — Revenue Recognition: Pending Finance Validation

**Supersedes:** ADR-002 Decision 8 (Revenue Recognition formula).

**Correction:** The simplified formula `Recognized Revenue = Contract Value × physical progress`
is a management reporting shortcut, not a validated accounting specification.

**CONST-REV-PENDING:** The revenue recognition section of ADR-002 is classified as
**pending finance-policy validation**. It must not be implemented in production accounting
code until a qualified accountant confirms:

- Which contracts use output/physical-progress method vs. cost-to-cost
- Treatment of variations and claims
- Contract assets and liabilities (WIP vs. overbilling)
- Expected losses recognition
- Taxes, retention, advance treatment
- Internal projects and joint ventures

The management-reporting formula may be used for project dashboards. It must not be used
for journal entries or statutory financial statements.

**Rule CONST-REV-004:** Any implementation of `CostLedger` revenue entries must be
preceded by written sign-off from Eng Ahmed Shirie confirming the accounting method.

---

## Decision 18 — Clean Architecture Dependency Direction

**Supersedes:** architecture.md Section 4.3 diagram.

**Correction:** The diagram shows:

```
Presentation → Application → Domain → Infrastructure
```

That ordering implies Domain depends on Infrastructure, which is wrong.

**Rule ARCH-CA-001:** Dependencies point inward. The correct diagram:

```
                   ┌─────────────────────────────────┐
                   │             Domain               │
                   │  (entities, value objects,       │
                   │   domain events, port interfaces) │
                   └──────────────┬──────────────────┘
                                  ▲
                   ┌──────────────┴──────────────────┐
                   │          Application             │
                   │  (use cases, application         │
                   │   services, transactions)        │
                   └──────────────┬──────────────────┘
                                  ▲
           ┌──────────────────────┴──────────────────────┐
           │                                             │
  ┌────────┴────────┐                       ┌────────────┴────────┐
  │  Presentation   │                       │   Infrastructure    │
  │  (controllers,  │                       │   (Prisma, HTTP     │
  │   DTOs, guards) │                       │    clients, queues) │
  └─────────────────┘                       └─────────────────────┘
```

Domain must not import from NestJS, Prisma, PostgreSQL clients, HTTP types, queues,
or storage SDKs. Infrastructure implements interfaces (ports) defined in Domain.

**Documents updated:** architecture.md

---

## Decision 19 — Explicit Tenant Context for Background Jobs

**Extends:** ADR-003 Decision 2 (AsyncLocalStorage for tenant context).

**Context:** AsyncLocalStorage is established per HTTP request. Background jobs,
queue consumers, scheduled tasks, and migration workers do not have an incoming
HTTP request and therefore have no automatic tenant context.

**Rule ARCH-MT-013:** Every asynchronous background job that operates on tenant data
must explicitly establish tenant and organization context before any database operation:

```typescript
interface BackgroundJobContext {
  tenantId: string;
  tenantSlug: string;
  organizationId: string;
  actorId: string | 'SYSTEM';
  correlationId: string;
}
```

**Rule ARCH-MT-014:** Background job workers must call a designated
`TenancyService.runInContext(jobContext, fn)` wrapper that sets up `AsyncLocalStorage`
for the duration of the job — the same mechanism used by the HTTP middleware.

**Rule ARCH-MT-015:** Multi-tenant background jobs (e.g., nightly report generation)
must process each tenant serially, establishing fresh context per tenant, never sharing
a single context across tenants within one job execution.

**Documents updated:** tenancy.md

---

## Decision 20 — Refresh Token Security Requirements

**Extends:** ADR-003 Decision 3 (JWT payload) and Sprint 2 auth carryover.

**Rule ARCH-SEC-003:** Refresh tokens must:
- Have a unique identifier (`jti`)
- Be stored as a hash (bcrypt or SHA-256), never plaintext
- Support token rotation — each use issues a new refresh token and invalidates the prior one
- Implement token family tracking — if a previously-used token is presented, treat as
  a compromise: invalidate the entire family and force re-authentication
- Carry device/session metadata (user agent, IP hash) for audit purposes
- Have defined expiry (7 days default, configurable)
- Support "revoke current session" and "revoke all sessions" capabilities

**Rule ARCH-SEC-004 — Cookie configuration:**

Refresh tokens set as cookies must use:
- `HttpOnly` — inaccessible to JavaScript
- `Secure` — HTTPS only in production
- `SameSite=Strict` — no cross-site requests
- `Path=/api/v1/auth` — scoped to auth endpoints only
- Domain configured for the specific subdomain (not wildcard `*.rukna.com`
  unless cross-subdomain session sharing is explicitly decided and its security
  implications accepted)

**Rule ARCH-SEC-005:** Expired refresh tokens must be purged from the database by a
scheduled cleanup job to prevent unbounded table growth.

---

## Decision 21 — dbUrl Is a Secret, Not Metadata

**Context:** The platform DB `tenants` table stores `dbUrl` as a regular column.

**Rule ARCH-SEC-006:** `dbUrl` is a credential. It must be:
- Encrypted at the application level before storage, or stored as a secret reference
  (vault path) rather than the plaintext connection string
- Excluded from all API responses — never returned to any client
- Never logged in application logs
- Subject to rotation policy
- Accessible only to the specific platform service process, not broadly across the codebase

**Rule ARCH-SEC-007:** The provisioning script must not output `dbUrl` to stdout.
Log credential creation events without the credential value.

---

## Decision 22 — Tenant Client Cache: Required Lifecycle Controls

**Extends:** ADR-003 Decision 2 — `Map<slug, PrismaClient>` cache.

**Context:** An unbounded permanent `Map` works for a small number of tenants but
requires lifecycle management before production use.

**Rule ARCH-MT-016:** The tenant client cache must implement:
- Maximum cache size (configurable, default: 50 clients)
- LRU or TTL-based eviction for idle tenants
- Graceful `$disconnect()` on eviction
- Per-tenant connection pool limit (prevent one tenant exhausting all DB connections)
- Cache invalidation when a tenant's `status` changes to `SUSPENDED` or `TERMINATED`
- Protection against creating clients from arbitrary or unknown slugs — always validate
  tenant exists and has `status = ACTIVE` before returning a client

---

## Summary: Documents to Update

| Document                   | Sections affected                                       |
|----------------------------|---------------------------------------------------------|
| `domain-model.md`          | Project status enum, Project aggregate note, BOQ model,  |
|                            | StockLedger nullability, CostLedger cost objects,        |
|                            | OrganizationMembership model                             |
| `architecture.md`          | Section 4.3 Clean Architecture diagram direction         |
| `tenancy.md`               | Context split, request pipeline, background job rules    |
| `prisma/schema.prisma`     | ProjectStatus enum, ProjectSuspension, BOQVersion,       |
|                            | BOQNode versionId + originNodeId, OrganizationMembership |
| `adr/ADR-002`              | Constraints CONST-COST-001 (amended), CONST-IPC-002      |
|                            | (replaced), Revenue Recognition (pending)                |
| Sprint 2 build plan        | Add all new models and database migration requirements   |

---

## What Remains Correct in ADR-002

The following ADR-002 decisions are unchanged and remain binding:

- Decision 2: Configurable hierarchical BOQ tree (self-referential, unlimited depth) ✓
- Decision 3: Cost Categories cross-cut BOQ Items ✓
- Decision 4: Three measurement methods (QUANTITY, PERCENTAGE, MILESTONE) ✓
- Decision 5: Immutable StockLedger movements (CONST-INV-001, CONST-INV-002, CONST-INV-003) ✓
- Decision 6: IPC auto-generated from approved source documents; frozen on approval ✓
- Decision 7: Three-stage commitment accounting (extended by Decision 14 above) ✓
- Decision 9: Two Prisma setups (platform + tenant) ✓
- Decision 10: One tenant, multiple organizations; ARCH-MT-008 filter rule ✓

The following ADR-003 decisions are unchanged and remain binding:

- Decision 1: Platform DB registry separation (ARCH-MT-005) ✓
- Decision 2: AsyncLocalStorage for tenant context (extended by Decision 19 above) ✓
- Decision 3: JWT payload structure, cross-tenant check (extended by Decision 20) ✓
- Decision 4: DOA workflow schema ✓
- Decision 6: i18n structure ✓
- Decision 7: Exchange rate locking (ARCH-CCY-002, ARCH-CCY-003) ✓
- Decision 8: Permission scoping, assertMember (extended by Decision 9 above) ✓
