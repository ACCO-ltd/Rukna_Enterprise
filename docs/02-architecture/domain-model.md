# Construction Domain Model

Version: 3.0.0
Status: Active
Last Updated: 2026-08-02
Changes: v3 — synced to actual Sprint 2 Prisma schema (Phases 1–4).
         Corrected Project fields, ProjectMember/Role, BOQ three-pointer model,
         BOQNode isLeaf/code/description fields, added WorkflowTriggerBinding.

---

## Aggregate Boundaries

`Project` is the central business scope and reporting root. It is **not** a DDD
God Aggregate. The following are each independent aggregate roots:

```
Project                    Aggregate root — lifecycle, membership, metadata
Contract                   Aggregate root — references projectId
BOQ + BOQVersion           Aggregate root — references projectId
PurchaseOrder              Aggregate root — references projectId
GoodsReceiptNote           Aggregate root — references projectId
MaterialRequest            Aggregate root — references projectId
StockTransfer              Aggregate root
IPC                        Aggregate root — references projectId, contractId
Subcontract                Aggregate root — references projectId
DailyProgressReport        Aggregate root — references projectId
ProjectSuspension          Event record   — references projectId
```

Cross-aggregate communication occurs through public interfaces and domain events.
No aggregate may directly modify the internal state of another.

---

## Entity Map

```
Organization
│
├── OrganizationMembership  (explicit user ↔ org join — Sprint 2)
│   └── OrganizationMembershipRole
│
├── Users, Roles, Permissions
├── WorkflowDefinition (DOA approval chains)
├── WorkflowTriggerBinding (trigger event → workflow mapping — Sprint 2)
├── ExchangeRate (currency × date → rate)
│
└── Project  ◄── BUSINESS SCOPE ROOT (not a DDD God Aggregate)
    │
    ├── ProjectSuspension (active suspension record — separate from lifecycle)
    ├── ProjectMember
    │   └── ProjectMemberRole
    │
    ├── BOQ [separate aggregate — Sprint 2 Phase 4]
    │   └── BoqVersion (DRAFT | BASELINED | SUPERSEDED | CANCELLED)
    │       └── BoqNode (versioned tree — section → item)
    │
    ├── Contract (future sprint)
    ├── Subcontract (future sprint)
    ├── IPC (future sprint)
    ├── Procurement Chain (future sprint)
    ├── CostLedger (future sprint)
    └── StockLedger (future sprint)
```

---

## Entity Descriptions — Implemented (Sprint 2)

---

### Organization

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| name | string | |
| slug | string | unique — used as subdomain |
| status | enum | `ACTIVE`, `SUSPENDED` |
| createdAt / updatedAt | timestamp | |

---

### OrganizationMembership

Explicit record linking a user to an organization. Every authenticated request
validates an active membership record. JWT guard rejects tokens where membership
is `SUSPENDED` or `REMOVED`.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | FK → Organization |
| userId | cuid | FK → User (CASCADE on delete) |
| status | enum | `ACTIVE`, `SUSPENDED`, `REMOVED` |
| isDefault | boolean | user's default org on login |
| joinedAt | DateTime | |
| removedAt | DateTime? | |
| removedBy | cuid? | |

Unique constraint: `(organizationId, userId)`.

### OrganizationMembershipRole

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| membershipId | cuid | FK → OrganizationMembership (CASCADE) |
| roleId | cuid | FK → Role (CASCADE) |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

---

### WorkflowTriggerBinding

Maps a trigger event (document submission or state transition) to a workflow
definition. Looked up in 4-step priority order by `WorkflowTriggerResolverService`.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid? | null = tenant-wide default |
| triggerKind | enum | `DOCUMENT`, `STATE_TRANSITION` |
| entityType | string | e.g. `"Project"`, `"PurchaseOrder"` |
| transactionType | enum? | `WorkflowTransactionType` — set for DOCUMENT kind |
| fromState | string? | source state — null = any source state |
| toState | string? | destination state |
| workflowDefinitionId | cuid | FK → WorkflowDefinition |
| priority | int | higher wins when multiple bindings match |
| isActive | boolean | false = binding exists but is inactive (Sprint 2: all false) |
| createdAt | DateTime | |

**4-step resolution order** (highest priority first):
1. org-specific + exact fromState + toState
2. org-specific + toState only (fromState = null)
3. tenant-default + exact fromState + toState
4. tenant-default + toState only

---

### Project

Business scope root. Every construction transaction references a Project.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| organizationId | cuid | FK → Organization |
| code | string(30) | unique within org — **immutable after creation** |
| name | string | |
| nameAr | string? | |
| description | string? | |
| status | enum | see lifecycle below |
| clientName | string? | client/employer name |
| contractValue | decimal(18,2)? | paired with `currency` |
| currency | string(3)? | ISO 4217 — paired with `contractValue` |
| startDate | date? | |
| expectedEndDate | date? | |
| createdBy | cuid | User who created the project |
| createdAt / updatedAt | timestamp | |

**Lifecycle:**

```
DRAFT → APPROVED → MOBILIZING → ACTIVE → PRACTICAL_COMPLETION → CLOSEOUT → CLOSED
```

`CANCELLED` is reachable from `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE` only.
`CANCELLED` is **prohibited** from `PRACTICAL_COMPLETION` and `CLOSEOUT`.

Suspension is **not** a lifecycle status. See `ProjectSuspension` below.

Fields editable only in `DRAFT` status: all fields except `code` (immutable).

---

### ProjectSuspension

Separate operational condition. A suspended project retains its lifecycle status.
Lifecycle transitions (`/approve`, `/activate` etc.) are blocked while suspended.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | FK → Project (RESTRICT) |
| reason | string | required |
| suspendedAt | DateTime | default now() |
| suspendedBy | cuid (User) | |
| resumedAt | DateTime? | null = currently active suspension |
| resumedBy | cuid? | |

**Constraint:** Only one active suspension per project at a time.
Enforced by service AND partial unique index:

```sql
CREATE UNIQUE INDEX "project_suspensions_one_active_per_project"
ON "project_suspensions"("project_id")
WHERE "resumed_at" IS NULL;
```

---

### ProjectMember

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | FK → Project (RESTRICT) |
| userId | cuid | FK → User (RESTRICT) |
| joinedAt | DateTime | default now() |
| joinedBy | cuid | User who added this member |
| removedAt | DateTime? | null = currently active member |
| removedBy | cuid? | |

Soft-delete: members are deactivated via `removedAt`, not hard-deleted.

Partial unique index ensures one active membership per project+user:

```sql
CREATE UNIQUE INDEX "project_members_one_active_per_project_user"
ON "project_members"("project_id", "user_id")
WHERE "removed_at" IS NULL;
```

### ProjectMemberRole

A member may hold multiple project roles simultaneously.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| memberId | cuid | FK → ProjectMember (CASCADE) |
| role | enum | `ProjectRole` — see values below |
| assignedAt | DateTime | |
| assignedBy | cuid (User) | |
| removedAt | DateTime? | |

**ProjectRole enum values:**
```
PROJECT_MANAGER
QUANTITY_SURVEYOR
SITE_ENGINEER
COMMERCIAL_MANAGER
FINANCE_REVIEWER
VIEWER
```

---

### Boq

BOQ aggregate root. One BOQ per project. Carries three version pointers — each
maintained by the application layer, not FK-constrained in Prisma.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| projectId | cuid | unique FK → Project |
| organizationId | cuid | denormalized for query performance |
| originalBaselineVersionId | cuid? | **immutable once set** — the original contract baseline |
| currentApprovedVersionId | cuid? | currently approved (BASELINED) version |
| currentDraftVersionId | cuid? | currently open draft version (null if none) |
| createdAt / updatedAt | timestamp | |

**Three-pointer semantics:**
- `originalBaselineVersionId`: set on first `baseline()` call; never overwritten. Preserves the original contract baseline even after subsequent revisions.
- `currentApprovedVersionId`: updated on every `baseline()` call.
- `currentDraftVersionId`: set when a draft is created; cleared on baseline or cancel.

---

### BoqVersion

Snapshot of the BOQ tree at a point in time. Only `DRAFT` versions accept mutations.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| boqId | cuid | FK → Boq |
| versionNumber | int | sequential per BOQ, auto-incremented |
| status | enum | `DRAFT`, `BASELINED`, `SUPERSEDED`, `CANCELLED` |
| notes | string? | revision notes |
| baselinedAt | DateTime? | set when status → BASELINED |
| baselinedBy | cuid? | User who baselined |
| createdBy | cuid | |
| createdAt / updatedAt | timestamp | |

**Status transitions:**
- `DRAFT` → `BASELINED` (via `/baseline`) — the previous approved version becomes `SUPERSEDED`
- `DRAFT` → `CANCELLED` (via `/cancel`)
- `BASELINED` and `CANCELLED` are **terminal** — no further status change

Unique constraint: `(boqId, versionNumber)`.

---

### BoqNode

Self-referential tree node within a single `BoqVersion`. Nodes are version-scoped —
the same physical line item gets a new node ID in each version copy.

| Field | Type | Notes |
|---|---|---|
| id | cuid | version-scoped — new ID on each version copy |
| boqId | cuid | denormalized FK → Boq |
| versionId | cuid | FK → BoqVersion |
| parentId | cuid? | null = root node (within same version) |
| path | string | materialized path: `"rootId/childId/grandchildId"` |
| depth | int | 0 = root; auto-maintained |
| sortOrder | int | display order among siblings |
| code | string(50) | human-readable section code e.g. `"1.2.3"` |
| description | string | line item description (English) |
| descriptionAr | string? | Arabic description |
| isLeaf | boolean | true = can carry quantity/rate; false = summary section |
| unit | string(20)? | measurement unit — leaf nodes only, e.g. `m³`, `ton` |
| quantity | decimal(18,3)? | leaf nodes only |
| unitRate | decimal(18,2)? | leaf nodes only |
| currency | string(3)? | ISO 4217 — paired with unitRate |
| totalAmount | decimal(18,2)? | `quantity × unitRate`, stored for performance |
| originNodeId | cuid? | source node ID from the prior version (copy lineage) |
| createdAt / updatedAt | timestamp | |

**Path format:** `"rootId/childId/grandchildId"` (no leading slash, `/`-delimited node IDs).

Move algorithm uses two raw SQL updates:
1. Update moved node's `parentId`, `path`, `depth`, `sortOrder`
2. Bulk-update all descendants: replace `oldPath` prefix with `newPath` via `REPLACE + LIKE`

**Leaf vs summary distinction:**
- `isLeaf = false` (summary): has children; `quantity`, `unitRate`, `totalAmount` are null; `computedTotal` is aggregated from children at query time
- `isLeaf = true` (item): has no children; carries `quantity × unitRate = totalAmount`

---

## Entities Described in ADR-002 / ADR-004 — Not Yet Implemented

These entities are planned for future sprints. The schema descriptions in ADR-002 and
ADR-004 are the authoritative design. Do not implement without an updated sprint plan.

| Entity | Sprint |
|---|---|
| Contract, Milestone, RetentionTerms | Sprint 3+ |
| Subcontract, SubcontractCertificate | Sprint 3+ |
| IPC (Interim Payment Certificate) | Sprint 3+ |
| MaterialRequest, PurchaseOrder, GoodsReceiptNote | Sprint 3+ |
| StockLedger, StockTransfer | Sprint 3+ |
| CostLedger | Sprint 3+ |
| DailyProgressReport, MeasurementSheet, ITC | Sprint 3+ |
| LabourAttendance, EquipmentLog | Sprint 3+ |

---

## Glossary

| Term | Definition |
|---|---|
| BOQ | Bill of Quantities — the priced schedule of work items forming the basis of a construction contract |
| BoqVersion | An immutable snapshot of the BOQ at a point in time. BASELINED versions are permanent. |
| Baseline | The act of locking a DRAFT version as the approved BOQ — analogous to signing the contract schedule |
| IPC | Interim Payment Certificate — a periodic billing document certifying completed work for client payment |
| DOA | Delegation of Authority — the framework defining who can approve what, up to what value |
| WTB | WorkflowTriggerBinding — the mapping from a business event to a DOA approval chain |
| originNodeId | Lineage field on BoqNode — points to the source node in the prior version on deep copy |
| Materialized Path | Tree traversal technique storing the full ancestor chain as a path string for O(1) subtree queries |
| TenantContext | AsyncLocalStorage context carrying tenantId, tenantSlug, PrismaClient — set by TenancyMiddleware |
| RequestIdentity | request.user object set by JwtAuthGuard — carries userId, activeOrganizationId, roles, permissions |
