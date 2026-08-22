---
Status: accepted
---

# ACCO Authority Matrix: Delegation of Authority, Segregation of Duties, and roles

## Status note

Domain-approved by **Eng Ahmed Shirie (CEO, ACCO Ltd)** on 2026-08-17. This ADR **activates and
completes** the previously-parked DOA + value-threshold + SoD machinery (`SegregationOfDutiesService`,
`WorkflowStep`, threshold routing) — it is now confirmed *required*, not deletable. Two config
items remain open and do **not** block this ADR: **(D)** the numeric bill-match / over-receipt
tolerances (ADR-018 seed values) and **(E)** the A12 settlement-ledger question.

### Implementation status (staged)

- **Phase 1 — Segregation of Duties (CONST-DOA-003): DONE.** `SegregationOfDutiesService` (built but
  never called) is now wired into the procure-to-pay + journal chain and its rules activated as of
  the 2026-08-17 sign-off — that date is the formal policy effective date the seed was waiting for.
  Enforced pairs: **requester ≠ MR approver** (MR approve), **PO creator ≠ goods receiver** (GRN
  create), **goods receiver ≠ bill approver** (bill approve), **bill approver ≠ payment approver**
  (payment approve), **journal preparer ≠ journal approver** (journal approve). Access never grants
  authority (CONST-DOA-002): the Procurement Officer's Store-Keeper access does not exempt the PO-
  creator receipt block.
- **Phase 1b — remaining SoD rules: DONE.** All seven CONST-DOA-003 rules are now wired and active.
  **Vendor maintainer ≠ PO/payment processor:** `Supplier.createdBy` records the maintainer
  (nullable — legacy suppliers have an unknown one), checked at PO create and payment create.
  **System administrator ≠ business-transaction approver:** enforced in `ApprovalService.approve`,
  keyed on the consolidated `SYSTEM_ADMINISTRATOR` role (the tenant super-user `ADMIN` is a
  different role and is not blocked; the rule is dormant until someone holds `SYSTEM_ADMINISTRATOR`).
- **CONST-DOA-004 documented exception: DONE.** The one sanctioned override to the PO-creator-
  receipt block. New `PoReceiptException` model + flow: **request** (derives the receiver from the
  PO creator) → an **independent supervisor verifies** (≠ receiver) → the **CFO approves** (holds
  the CFO role, distinct from receiver and supervisor). `GoodsReceiptService.create` consults it —
  an APPROVED exception clears the receiver, so the SoD block does not fire. Endpoints under
  `/procurement/receipt-exceptions` (distinct from the over-receipt quantity exception on the GRN).

**ADR-022 is now fully implemented** (Phases 1, 1b, 2, 3, 3b, 4). Go-live activation of the seeded
bands/chains remains a deliberate per-org step (role-holders + `dev-activate-doa-bands.seed.ts`).

### Role set correction (ACCO, 2026-08-22)

The CONST-DOA-001 role list below was **revised by ACCO** after implementation. The seeded role
vocabulary (`acco-value-bands.ts`) and all chains now use:

- **Procurement Manager** — not "Procurement Officer".
- **No Store Keeper** and **no Quantity Surveyor** roles (procurement covers stores; the
  Construction Director covers QS scope/measurement).
- **CEO** — not "Group CEO"; and **no Board Chairman** tier (the > \$50k PO band is CFO + CEO).

Full seeded set: `CONSTRUCTION_DIRECTOR`, `PROJECT_MANAGER`, `SITE_ENGINEER`, `PROCUREMENT_MANAGER`,
`ACCOUNTANT`, `FINANCE_OFFICER`, `CFO`, `CEO`, `SYSTEM_ADMINISTRATOR`. **This is a starting set, not
a fixed list** — roles live in the per-org Role registry and more can be added in Settings when an
org needs them. (The `ProjectRole` enum used for project-membership `responsibleRole` is a separate,
UI-facing concept and is intentionally not migrated here.)
- **Phase 2 — value-threshold routing engine (CONST-DOA-005): DONE (engine, dormant).** A trigger
  binding may now carry an amount band (`minAmount`/`maxAmount`, half-open `[min, max)`; both null =
  catch-all). The resolver filters candidate bindings by the document value, so the same transition
  routes to different approval chains by amount; the gate threads the value through (wired at PO
  submit and payment approve) and snapshots `evaluatedAmount` + `matchedPolicyId` + `conditionSnapshot`
  on the `ApprovalInstance` (immutable evidence, ADR-007). **No bands are seeded/activated** — the
  engine is inert until Phase 3 configures ACCO's bands and the approval chains have role-holders, so
  it does not gate any live command yet. Backward-compatible: amount-less callers only ever match
  catch-all bindings.
- **Phase 3 — value-threshold config + role vocabulary (CONST-DOA-005, CONST-DOA-001): DONE
  (config-ready, dev-proven).** ACCO's PO bands (≤\$100 / \$100.01–\$1k / \$1k.01–\$50k / >\$50k) and
  payment bands (≤\$1k / \$1k.01–\$10k / >\$10k) are seeded as amount-banded `STATE_TRANSITION`
  bindings + cumulative role chains, expressed as data in `acco-value-bands.ts` and using the
  consolidated role vocabulary (`CONSTRUCTION_DIRECTOR`, `FINANCE_OFFICER`, `CFO`, `BOARD_CHAIRMAN`,
  `GROUP_CEO`, …). Everything is seeded **inactive**: the engine still gates nothing until a
  deliberate per-org activation (`prisma/seeds/dev-activate-doa-bands.seed.ts` does this for a dev
  DB — flips the bands active *and* grants the seeded admin the band roles so the loop is walkable).
  Tests prove the bands partition the amount axis and route through the Phase-2 resolver exactly as
  CONST-DOA-005 specifies.
- **Phase 3b — lifecycle/control approval chains (CONST-DOA-006..009): DONE (config-ready).** The
  Project **Start** (`DRAFT→ACTIVE`: PM → CFO → CEO), Project **Closeout** (`CLOSEOUT→CLOSED`:
  PM → Finance Officer → CEO), **BOQ baseline** (`BoqVersion DRAFT→BASELINED`: Construction
  Director → CFO → CEO), and **DPR** (`DailyProgressReport SUBMITTED→APPROVED`: Project
  Manager) chains are seeded as data (`acco-lifecycle-chains.ts`), inactive, with the consolidated
  roles. Start/Closeout repoint their existing generic project bindings to the specific chains. DPR
  approval — which was not gated — now routes through a backward-compatible governance seam
  (`DailyProgressReport` added to `GovernedEntity`; null gate → approval proceeds as before). Tests
  pin each chain to the matrix and confirm it resolves through the gate; the dev-activation seed
  covers bands *and* chains. **Still deferred:** the vestigial document-workflow definitions
  (`buildAccoChains`) keep legacy role names, and the ADR-019 leftover `Project DRAFT→APPROVED`
  requirement-policy row is inert (Start is `DRAFT→ACTIVE`).
- **Phase 4 — bank-signatory dual control on payment release (CONST-DOA-005): DONE.** New
  `BankAccountSignatory` (authorized signatories per account) and `PaymentReleaseSignature` models,
  and a `RELEASED` payment state. Release is a control **distinct from approval**: an APPROVED
  payment drawn on an account that has signatories must be signed by **≥2 distinct authorized
  signatories** (`POST /payments/:id/release`) before it can be posted — the 2nd signature sets
  `RELEASED`. SoD holds (CONST-DOA-003): the signer may be neither the payment approver nor the
  approver of a bill the payment settles (reuses `APPROVE_OR_RELEASE_SUPPLIER_PAYMENT`). **Non-
  breaking:** an account with no signatories is not under dual control and keeps the `APPROVED →
  post` path, so the control engages exactly where it is configured (signatories managed via
  `/bank-accounts/:id/signatories`).

## Context

The audit found the DOA/SoD subsystem armed but not wired, and flagged it as possible over-build.
Eng Ahmed confirmed ACCO's real authority model — explicit value thresholds, explicit segregation
of duties, and named approval chains — so the subsystem is justified and must be completed. ACCO's
titles also collapse: several proposed roles are the same job at different scope.

## Decision

### CONST-DOA-001 — Roles (consolidated to ACCO reality)

**Org-scoped (all projects):**
- **Construction Director** — full access to all projects; the org-wide project authority (the
  "how is every project going" role). **Owns BOQ scope + cost estimate (replaces a separate QS).**
  Recommends project Start and completion certification. Acts as **Construction's "Department Head"**
  for procurement (see thresholds). No separate monetary matrix beyond the Department-Head bands.
- **CFO** — procurement $1,000.01–$50,000; payment authority; budget/commercial confirmation;
  journal approver.
- **Group CEO** — final Start approval; final closure; >$50k; **absorbs Legal/Compliance** review.
- **Board / Chairman** — >$50k.
- **Finance Manager / Finance Officer** and **Accountant** — Finance confirmation, budgets, final
  account, AP/AR certification, journal preparation. Finance participates through the construction gates.
- **System Administrator** — no business-transaction approval authority.

> **Finance ladder confirmed 2026-08-20:** the finance hierarchy is **Accountant → Finance Officer
> → CFO** (three tiers). Where this ADR writes "Finance Manager" (e.g. the payment ≤ $1,000 tier),
> read **Finance Officer**. There is no separate Finance-Manager role above the Finance Officer.

**Project-scoped (per project; chain configurable):**
- **Site Engineer** — prepares DPRs, enters progress, raises MRs (requester), takes site decisions.
- **Project Manager** — the single project-level authority (ACCO treats *Project Engineer /
  Project Manager / Project Coordinator as one role*). Reviews & approves DPRs; recommends Start;
  confirms Closeout deliverables. The Construction Director is the org-wide equivalent — not a
  separate layer.

**Procurement & Stores:**
- **Procurement Officer** — creates MR→PO, runs procurement; **also holds Store Keeper access**.
- **Store Keeper** — goods receipt / stores.

### CONST-DOA-002 — Access ≠ authority (the safety rule, applied twice)
A broad access grant never bypasses SoD.
- The Procurement Officer's Store-Keeper access does not let a PO creator freely receive goods —
  overlap triggers the controlled exception (CONST-DOA-004).
- The Construction Director's all-projects access does not let him approve his own requests.

### CONST-DOA-003 — Segregation of Duties (mandatory)
The following must be different people:
Requester ≠ own MR/PO approver · PO creator ≠ goods receiver · Goods receiver ≠ bill approver ·
Bill approver ≠ payment approver/releaser · Vendor maintainer ≠ PO/payment processor ·
Journal preparer ≠ journal approver · System administrator ≠ business-transaction approver.

### CONST-DOA-004 — The one controlled exception
A PO creator may temporarily also receive goods where staffing requires it, **only** if an
independent supervisor verifies receipt **and** the CFO approves the documented exception.

### CONST-DOA-005 — Thresholds are per-command (not one global ladder)

**Purchase Orders / Procurement:**
| Band | Authority |
|---|---|
| ≤ $100 | Department Head (= Construction Director) **or** Project Manager |
| $100.01 – $1,000 | Department Head + Finance confirmation |
| $1,000.01 – $50,000 | CFO *(merged band — no separate control at $10k for POs)* |
| > $50,000 | CFO + CEO *(revised 2026-08-22 — was CFO + Board Chairman + Group CEO)* |

**Supplier Payments:**
| Band | Authority |
|---|---|
| ≤ $1,000 | Finance Manager (after operational/AP certification) |
| $1,000.01 – $10,000 | CFO |
| > $10,000 | CFO + CEO *(revised 2026-08-22 — was CFO + Group CEO)* |

**Payment release** additionally requires **at least two authorized bank signatories** and SoD —
release is a distinct dual control from payment *approval*.

### CONST-DOA-006 — Project Start approval chain (DRAFT → ACTIVE)
Project Manager / Construction Director **recommends** → CFO confirms budget, funding & commercial
viability → Group CEO **final approval** (CEO also covers contract/obligations; no separate Legal
step). Board when delegated authority requires.

### CONST-DOA-007 — Project Closeout → Closed chain
Project Manager confirms deliverables + defects → Finance confirms final account, AR/AP, retention,
asset transfer → Internal Audit/Control may review → Group CEO **final closure approval**.

### CONST-DOA-008 — DPR approval chain
Site Engineer **prepares** → Project Manager **approves** (ACCO's Project Engineer/Manager are one
role). Configurable per project/organization.

### CONST-DOA-009 — BOQ baseline is preparer ≠ sole approver
Because the Construction Director prepares BOQ scope + cost, he cannot solely approve the baseline.
Baselining is a **controlled gate of the Start-project chain** (CONST-DOA-006): technical
preparation/recommendation → CFO budget/commercial confirmation → CEO final authorization →
baseline. *(Engineering recommendation consistent with ACCO governance, not an explicit ACCO
BOQ-baseline rule.)*

## Consequences
- **Completes** the DOA/threshold/SoD subsystem (`SegregationOfDutiesService`, `WorkflowStep`,
  value-threshold routing) — schedule its implementation; it is no longer "parked/deletable."
- Per-command threshold configuration (POs merge the $10k band; payments preserve it) — the engine
  must support command-scoped ladders, not one global matrix.
- Bank-signatory dual-control on payment release is a new control to build alongside payment approval.
- Roles map onto existing org-membership + project-membership + the Project Access Scope Resolver
  (ADR-009). Access scope and approval authority are separate axes.
- Ratifies the domain rules of ADR-018/019/020/021 (accepted). Open: tolerance values (D),
  settlement ledger (E).
