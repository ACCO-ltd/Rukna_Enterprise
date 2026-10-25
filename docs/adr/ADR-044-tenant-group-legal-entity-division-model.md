# ADR-044: Tenant, Group, Legal Entity & Division Model (Multi-Entity Platform)

Status: PROPOSED (direction approved by platform owner; blocked on Eng Ahmed's two business answers before ACCEPTED)
Date: 2026-10-06
Deciders: Abdulsalam (Backend Engineer / Platform Owner), Eng Ahmed Shirie (CEO, ACCO Ltd) — **legal-entity structure AND consolidation requirement pending (see DECISION REQUIRED)**

Supersedes/amends: ADR-001 Decision 1 (ARCH-MT-002 is relaxed *within* a tenant; see Decision 2).

---

## Context

Rukna was built as a single-vertical construction ERP with one live tenant (ACCO). Two forces now reshape the platform:

1. **ASAS Group is a holding group with seven business areas** — ACCO (construction & contracting), Engineering & Consultancy, Elite (manufacturing), Sukaan Property (real estate), Garriyo (logistics & fleet), RBM (building materials), Tacab (agribusiness). Whether these are seven legal entities, divisions of fewer entities, or a mix is **not yet confirmed** and is a business/legal fact, not an engineering one.
2. **Rukna is to be commercialized as a rentable multi-tenant SaaS ERP** — sold to unrelated companies ranging from a single small contractor to a multi-company holding group, each activating only the modules they need.

The current model conflates three concepts into one `Organization` row: the data-isolation boundary, the accounting (books) boundary, and the top of the org tree. A single `Organization` per tenant database, a single `orgId` in the JWT, and every query hard-scoped to `activeOrganizationId` (ADR-001 `ARCH-MT-002`) make it structurally hard to (a) keep separate statutory books per subsidiary while optionally (b) consolidating across them or (c) sharing HR/master data between them.

This ADR separates the conflated concepts into an explicit layered model that serves **both** ASAS-as-group **and** a single-company SaaS customer from one architecture, without forcing simple customers to carry group complexity — **and without building anything the business has not yet asked for.**

**Guiding principle — additive, never substitutive.** Legal entity, project, and operational-root are *independent* dimensions. This ADR adds dimensions and optional parents; it does not rename or repurpose existing columns, and it removes nothing.

Non-goals: this ADR does **not** build consolidation, intercompany accounting, an entity switcher, billing, subscription management, or a tenant self-service control plane. It defines the *data and access model* those will later sit on, and the *order* in which they may be built if and only if the business requires them.

---

## The layered model

```
Tenant                     ← data-isolation + subscription boundary (one database)
  └── Group (optional)     ← consolidation + shared-master-data scope
        └── Legal Entity    ← accounting/books boundary (own CoA, fiscal calendar, tax, GL/AR/AP)
              └── Division  ← management reporting (a dimension, not its own books)
                    └── Department / Cost Center
                          └── Project (and, per vertical, Order / Job)   ← operational dimension
```

| Layer | Meaning | Where it lives today |
|---|---|---|
| **Tenant** | A Rukna customer. Hard data-isolation boundary. One Postgres database. | **Exists** — `prisma-platform` registry `Tenant` (`slug`, `dbUrl`, `status`, `plan`). |
| **Group** | Optional corporate holding above legal entities. Enables consolidation + shared master data. | **New, optional** — model in the tenant DB. |
| **Legal Entity** | A registered company with its own books. The accounting boundary. | **Is today's `Organization`** — reinterpreted, not replaced; `organizationId` already carries this scope. |
| **Division** | A business area inside a legal entity (e.g. ACCO → Construction / Engineering). | **Dimension** — reuse/extend posting dimensions; no new aggregate yet. |
| **Department / Cost Center** | Management/financial dimensions. | **Exist** — `departmentId`, `costCenterId` on the posting port. |
| **Project** (/ Order / Job) | Operational dimension. Project is construction-specific and **retained**; other verticals add their own roots additively. | **Exists** (`Project`, `projectId`). |

---

## Decision 1 — `Organization` is reinterpreted as **Legal Entity**; a **Group** sits optionally above it

We do **not** rename `organizationId` across the schema. `Organization` already owns the chart of accounts, ledger, fiscal periods, suppliers, clients, and projects — it is already the books boundary. We reinterpret it as the **Legal Entity** and add an optional parent:

```prisma
model Group {
  id             String        @id @default(cuid())
  name           String
  // consolidation currency, group-level settings …
  legalEntities  Organization[]
  @@map("groups")
}

model Organization {            // == Legal Entity
  id       String  @id @default(cuid())
  groupId  String? @map("group_id")      // NEW — null for single-company customers
  group    Group?  @relation(fields: [groupId], references: [id])
  // … all existing fields and relations unchanged …
  @@index([groupId])
}
```

**Backward compatibility is the point.** Live ACCO becomes exactly one `Organization` with `groupId = null`. Nothing about its data, queries, or auth changes on day one. A single-company SaaS customer is the same shape. Only a group customer (ASAS, *if* it has multiple entities) populates `Group` and attaches entities.

**Constraint ARCH-ME-001:** The accounting books boundary is the Legal Entity (`Organization`, scoped by `organizationId`). Every `Account`, `JournalEntry`, `AccountingPeriod`, and financial report remains scoped to exactly one legal entity. Books of two legal entities are never commingled.

**Constraint ARCH-ME-002:** `Group` carries no books of its own. Group-level figures are *derived* by consolidation (Decision 4), never posted directly.

**Constraint ARCH-ME-003 (additive-only):** Introducing the legal-entity/group model must not remove or repurpose any existing dimension. In particular, `projectId`, `departmentId`, and `costCenterId` are retained with their current meaning. The legal-entity dimension is the *existing* `organizationId`, not a replacement for any of these.

---

## Decision 2 — Tenant stays the isolation boundary; a tenant DB may hold **multiple** legal entities

`ARCH-MT-002` ("no cross-org queries; one org per database") is **amended**: the hard, inviolable wall is between **tenants** (databases). *Within* a tenant database, multiple legal entities may coexist and privileged reads may cross entities (for consolidation and shared master data, if built).

```
Tenant: ASAS Group         → database asas_db   → Group{ entities per Ahmed's answer }
Tenant: Small Contractor   → database sc_db      → Organization{Small Contractor Ltd}, group = null
Tenant: XYZ Holdings       → database xyz_db      → Group{XYZ Construction, XYZ Trading}
```

**Constraint ARCH-MT-002 (amended):** No tenant may ever access another tenant's database. Cross-*tenant* queries remain prohibited. Cross-*legal-entity* reads are permitted only within a single tenant database and only through dedicated group/consolidation services (Decisions 4–5), never by ad-hoc business queries.

**Constraint ARCH-ME-004:** A legal entity cannot be moved between tenants. Entity→tenant assignment is fixed at provisioning. Migrating a company between customers is an export/import operation, not a foreign-key change.

**Constraint ARCH-ME-005 (no hard-coded 1:1):** No code, migration, or query may assume that a tenant database contains exactly one legal entity, or that `organizationId` is globally unique-per-tenant-as-a-singleton. This is the assumption the Entity-Boundary Audit (below) exists to find and remove.

**Rationale:** Consolidation and shared HR require subsidiaries to be co-resident and jointly queryable. Database-per-legal-entity would force a separate ETL/reporting plane per group customer and break shared master data. The customer-facing isolation guarantee (one `pg_dump`) lives at the tenant level, which is where customers actually want it.

---

## Decision 3 — Legal Entity, Project, and Division are **independent dimensions**; none substitutes for another

A single transaction can carry answers to several orthogonal questions, and they must not be collapsed:

| Question | Dimension | Column | Notes |
|---|---|---|---|
| Which company's books own this? | **Legal Entity** | `organizationId` | Always present. The accounting boundary. |
| Which project is this for? | **Project** | `projectId` | **Nullable** — null = organization-scope (non-project). Retained. |
| Which business area / cost pool? | **Division / Dept / Cost Center** | `departmentId`, `costCenterId` | Management reporting only. |

**Worked example (the one the PM got wrong):**

```
ACCO Ltd · Project "Digfer Hospital" · PO $100,000
  organizationId = ACCO     (legal entity / books)
  projectId      = Digfer   (project P&L)

ACCO Ltd · organization-wide office supplies · PO $20,000
  organizationId = ACCO
  projectId      = NULL     (org-scope commitment)
```

`CommitmentLedger` therefore **retains `projectId` (nullable)** and uses the existing `organizationId` as the legal-entity scope. **The earlier proposal to replace `projectId` with `reportingEntityId` is rejected** — it would destroy project-level commitment reporting, and project/job P&L is an explicit ACCO requirement (Financial Accounting discovery).

**On other verticals:** retail/manufacturing have no "project" — they have orders/jobs. When such a vertical lands, its operational root is added as a **new additive nullable dimension** (e.g. `orderId`, `jobId`), never by overloading or replacing `projectId`.

**On the name `reportingEntityId`:** rejected as ambiguous. Accounting belongs to the **Legal Entity**; the column is `organizationId` today and conceptually `legalEntityId`. "Reporting entity" could later mean legal company, division, branch, reporting unit, or cost center — different concepts that must stay distinct.

**Constraint ARCH-ME-006:** Division/Department/Cost Center are reporting dimensions only. No feature may gate business logic or isolation on them. Authorization and books scoping happen at Legal Entity and Tenant.

---

## Decision 4 — Consolidation is OPTIONAL and demand-gated, not implied by separate entities

Separate legal entities do **not** imply a consolidation engine. The correct logic:

```
Separate legal entities
      ↓  (always)
Separate statutory books per entity
      ↓  (potential, not automatic)
Possible need for group-level reporting
      ↓  (only if management explicitly requires it, and on their timeline)
Build consolidation + intercompany elimination
```

If/when management requires group reporting, consolidation is produced by reading each member entity's ledger within the tenant DB and **eliminating intercompany balances** — requiring an intercompany marker on inter-entity transactions, elimination rules at read time, and a group consolidation currency (ADR-024 is single-currency USD, so for ASAS this is currently a translation no-op).

**Constraint ARCH-ME-007:** Consolidated figures are read-model only. The consolidation service never writes to any entity's ledger.

**Build timing:** dormant until the business explicitly confirms the *need* for consolidated/intercompany reporting (DECISION REQUIRED Q2). Separate books per entity can be operated independently in Rukna with no consolidation at all.

---

## Decision 5 — Access evolves in stages; entity switcher is independent of consolidation

Today the JWT carries a single `orgId` and the session is locked to one organization. The target model and its **strict build order**:

```
1. Legal-entity structure           (data model — this ADR)
2. Cross-entity authorization model  (which users may access which entities)
3. Entity switcher UX                (ONLY if a user must work across entities)
4. Consolidation                     (ONLY if management requires group reporting — Decision 4)
```

- Stages 3 and 4 are **decoupled**. An entity switcher may be needed *without* consolidation (e.g. one Finance Manager authorized over ACCO + Elite + Sukaan), and consolidation may be needed without every user switching. Do not bundle them.
- The session will carry **`activeLegalEntityId`** plus the set of **accessible legal-entity ids**; a group-scope permission allows read across a group's entities.

**Backward compatibility:** a token with a single accessible entity behaves exactly as today. `activeOrganizationId` in `RequestIdentity` maps to `activeLegalEntityId`.

**Constraint ARCH-ME-008:** Every business query scopes to `activeLegalEntityId` by default. Cross-entity visibility is opt-in, requires group-scope permission, and is served only by dedicated group/consolidation endpoints — never by silently widening an existing per-entity query.

**Constraint ARCH-ME-009 (unchanged from ADR-001 ARCH-SEC-002):** A token minted for one tenant is rejected against another. Tenant mismatch = 401.

---

## Decision 6 — Module entitlements formalize the existing `Tenant.plan`; billing is out of scope

To make Rukna rentable, each tenant activates a set of modules. We formalize the existing `Tenant.plan` string into an explicit entitlement set:

```
TenantModule { tenantId, module (ACCOUNTING|PROCUREMENT|INVENTORY|CONSTRUCTION|MANUFACTURING|RETAIL|HR|…),
               status (ENABLED|DISABLED), enabledAt, configuration }
```

Vertical modules gate their routes/UI on entitlement.

**Constraint ARCH-ME-010:** Module availability is data, resolved from tenant entitlements — never a code branch on tenant identity (`if (tenant === 'ACCO')` is prohibited).

**Out of scope:** subscription plans, billing, metering, self-service provisioning. The entitlement *model* is defined here so verticals can gate from day one; the commercial machinery is a later ADR.

---

## Entity-Boundary Audit (required architecture spike, before Inventory)

Before building Inventory — and independent of Ahmed's answers — run a short, **read-only** audit that finds every place the code implicitly assumes *one organization = one legal entity = the whole tenant*. This is **not** building multi-entity accounting; it is ensuring tomorrow's change is cheap rather than discovering a landmine mid-build.

For each model below, confirm the current scoping column(s) and classify the correct future boundary:

| Component | Current boundary | Correct future boundary |
|---|---|---|
| Tenant / registry | Tenant | Tenant |
| `Account`, `JournalEntry`, `FiscalYear`, `AccountingPeriod` | `organizationId` | **Legal Entity** |
| `BankAccount`, `TaxCode`, `PostingProfile`, numbering sequences | `organizationId` | **Legal Entity** |
| `SupplierBill`, `ClientInvoice`, `SupplierPayment`, `CustomerReceipt` | `organizationId` | **Legal Entity** (+ project/vertical dimension) |
| `PurchaseOrder`, `CommitmentLedger` | `organizationId` (+ `projectId`) | **Legal Entity + Project/Org scope** (projectId retained) |
| `Project` | `organizationId` | **Legal Entity + Project** |
| Inventory (to be built) | — | **Legal Entity + location/warehouse** |
| Users / memberships | Tenant / org | **Tenant + per-entity permissions** |
| Group reporting | — | Optional future layer |

Deliverable: a classification sheet + a list of any code paths that would break if a tenant held more than one legal entity (the `ARCH-ME-005` violations). No code changes in the spike itself.

---

## Frozen sequence (next architectural direction)

```
NOW
 ├── ADR-044 review (this document)
 ├── Ahmed confirms:  Q1 legal-entity structure   Q2 consolidation requirement + timing
 ├── Construction v1 release gate  (HARD gate — freeze construction after)
 ├── Entity-Boundary Audit (read-only spike)
 ├── Inventory  (as src/business/inventory/, a shared module — NOT under construction)
 ├── Enterprise hardening: organization/workflow/files/notifications
 └── Manufacturing
```

Built **only if the business explicitly confirms the need**, strictly in this order:

```
Legal entities → cross-entity authorization → entity switcher (if cross-entity users) → consolidation (if group reporting required) → group P&L / BS / cash flow
```

---

## DECISION REQUIRED (blocks ACCEPTED status — Eng Ahmed / ASAS management)

Two distinct questions. The second does **not** follow automatically from the first:

**Q1 — Legal structure.** Of the seven ASAS business areas (ACCO, Engineering & Consultancy, Elite, Sukaan Property, Garriyo, RBM, Tacab), **which are separately registered companies / taxpayers filing their own statutory accounts, and which are merely divisions/business units of a larger entity?**

**Q2 — Consolidation need.** **Does ASAS management require Rukna to produce group-level consolidated financial reporting and/or intercompany accounting — and if so, on what timeline?** (It is entirely valid to run separate entities with separate books and *no* consolidation.)

Secondary input: confirm the group consolidation currency and whether any entity transacts in a non-USD currency (interacts with ADR-024 single-currency-USD).

The architecture in this ADR supports any combination of answers without change. The answers set only the *build timing and cost* of Decisions 4–5.

---

## Consequences

**Positive**
- One architecture serves ASAS-as-group and single-company SaaS customers; simple customers carry zero group complexity (`groupId = null`).
- Tenant isolation (the security-critical wall) is unchanged and made explicit.
- Live ACCO is unaffected; all changes are additive and backward compatible.
- `Organization` → Legal Entity reinterpretation avoids a schema-wide FK rename.
- Keeping Legal Entity, Project, and Division as independent dimensions preserves project P&L and org-scope commitments, and leaves room for retail/manufacturing operational roots.
- Entitlements make the platform rentable without hard-coding tenants.
- Nothing speculative is built: consolidation and the entity switcher are demand-gated and ordered.

**Negative / costs**
- Amending `ARCH-MT-002` to allow intra-tenant cross-entity reads is a real relaxation; ordinary per-entity queries must never silently widen (ARCH-ME-008).
- The Entity-Boundary Audit is upfront work, but it is the insurance that makes the later change cheap.
- Consolidation with intercompany elimination remains the hardest accounting module *if* Q2 is "yes."
- The eventual auth change (single `orgId` → `activeLegalEntityId` + accessible set + group scope) touches the JWT, strategy, and `RequestIdentity`; it ships behind the single-entity default.

**Neutral**
- Division/Dept/Cost Center remain dimensions; a future vertical may promote one to an aggregate under a new ADR.
- Other verticals' operational roots (order/job) are future additive dimensions, out of scope here.
```
