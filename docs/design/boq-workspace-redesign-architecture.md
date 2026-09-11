# BOQ Workspace Redesign — Architecture

**Status:** ARCHITECTURE — post-grill (`/architect`), 2026-09-10. Inputs: **ADR-029** and
`docs/design/boq-workspace-redesign.md` (decisions D1–D7). The three blocking decisions were
resolved with Eng Ahmed on 2026-09-10 — see **§12**. Verdict at foot: **APPROVED**.

**Author:** architect pass over Abdulsalam's backend (`apps/api/src/business/construction/`).

This document maps the seven owner-approved decisions onto the *existing*
`Boq / BoqVersion / BoqNode` machinery and the Contract / Commercial / Progress / Finance
seams, per the SAD (Clean Architecture, modular monolith, ADR-011 governance seam,
`Prisma.Decimal`, `TransactionalAuditOutboxService`). It reuses machinery; it does not
reinvent it.

---

## 1. Guiding realisation — reuse the version machinery as the snapshot mechanism

The redesign says "no versions, one living BOQ + history." The existing model already has
exactly the primitive we need for D6's *as-committed snapshot*: an immutable `BASELINED`
`BoqVersion`. So we **keep the machinery and change the vocabulary and the UI**, we do not
tear it out:

| Redesign concept (user-facing) | Existing primitive (under the hood) |
|---|---|
| **Working BOQ** (the one live, editable BOQ) | the current `DRAFT` `BoqVersion` |
| **Commit to contract** | `baseline` (DRAFT → BASELINED), governed via ADR-011 |
| **As-committed snapshot** (D6) | the `BASELINED` `BoqVersion` (immutable) |
| **Compare to signed** | diff(current DRAFT, contract's BASELINED version) |
| Each **approved variation** snapshot | the new `BASELINED` version cut on variation adopt |
| **History** | `BoqChangeEvent` (already per-line, in-transaction) |

**The one structural change to the lifecycle:** after commit, a **working draft always
exists** (auto-created from the committed baseline) and *is* the live BOQ. The user never
sees "draft vs version"; they see one BOQ. Value-changing edits to that draft are refused
unless they arrive through the variation command. This is **Option A** (perpetual working
draft over immutable snapshots), chosen over Option B (relax baseline immutability + a new
snapshot table) because it preserves the ADR-016 immutability invariant that IPC / Contract
/ downstream records depend on, and reuses `createDraftFromApproved`, the DRAFT-only write
guard, and the governed baseline unchanged. **ADR-worthy — recorded below.**

> **REFINED AT SPEC TIME (2026-09-10) — see `boq-workspace-redesign-spec.md` §0.** The
> deep-copy revision mechanism mints **new node ids**, but downstream records reference
> `BoqNode` by id — so money-neutral edits/contingency reallocations on a draft would not
> reach Progress/Cost/Contract until a re-baseline+adopt, breaking D1. Corrected mechanism:
> the operational BOQ is **one long-lived version edited in place with stable ids**
> (`BoqVersionStatus.COMMITTED`), and a **snapshot is a frozen *copy*** (`SNAPSHOT`) taken at
> commit and each variation adopt — nothing operational references a snapshot. Same
> user-facing behaviour and immutability *where it matters* (the legal snapshot); no D1–D7
> change. Read the "current DRAFT / BASELINED" rows above through this refinement
> (operational = `COMMITTED`; as-committed snapshot = `SNAPSHOT`).

## 2. System boundary & ownership

- **BOQ module** (`construction/boq`) owns scope structure, the internal budget, the
  contingency pool, the working draft, snapshots, history, and the tie-out *figure it
  exposes*. It initiates extra-work classification.
- **Contract module** owns `contractValue` and the tie-out *enforcement* (a Contract may
  not exist below its BOQ's in-contract total).
- **Variations module** (`construction/variations`) owns variation lifecycle + client
  approval; on adopt it raises `contractValue` and repoints the baseline.
- **Commercial/AR** owns billing (milestone installments, separate charges) and the
  *total-client-revenue* read model.
- **Progress** consumes BOQ leaves as before, with one change: contingency is excluded from
  value-weighting.
- BOQ never writes Contract/Commercial/Progress rows; it exposes read interfaces and emits
  domain intents (create-variation, create-separate-charge). Cross-module calls stay within
  the construction domain and go through application services, never repositories (SAD §4.1).

## 3. Model additions (schema deltas on the existing tables)

Minimal, additive, all defaulted (non-breaking):

**`BoqNode`**
- `nodeRole  NodeRole  @default(WORK)` — enum `WORK | CONTINGENCY`. Identifies the
  contingency pool line(s). Counts toward contract value; **excluded from progress
  value-weighting**.
- `commercialTreatment CommercialTreatment @default(IN_CONTRACT)` — enum
  `IN_CONTRACT | SEPARATE_CHARGE | ABSORBED`. The classifier outcome (D4). Only
  `IN_CONTRACT` (incl. contingency + on-contract variations) counts toward `contractValue`.
  `ABSORBED` is contingency-funded (a reallocation; counts in-contract, flagged "not
  charged" for reporting). `SEPARATE_CHARGE` is **excluded** from the tie-out and feeds
  total-client-revenue.
- (`sourceType`/`sourceChangeOrderId` unchanged — provenance for variations already exists.)

**`Contract`** — no new column required; `contractValue` stays, but its *meaning* changes
from "free-typed" to "derived from / validated against the committed BOQ."

**No new tables.** Snapshots = `BoqVersion`. History = `BoqChangeEvent`. Separate charges =
an AR `ClientInvoice` with no `sourceInstallmentId` (see §7, subject to a decision). This
keeps the change small and the migration a pure column-add with a trivial backfill
(`WORK`, `IN_CONTRACT`).

## 4. Invariants

- **INV-BOQ-TIEOUT-1 — Contract ties out to the committed BOQ.** At contract create/finalize
  and at variation adopt, `Contract.contractValue == Σ leaf.totalAmount` over the referenced
  `BASELINED` version where `commercialTreatment = IN_CONTRACT` (includes `CONTINGENCY`
  nodes and on-contract variation leaves; excludes `SEPARATE_CHARGE`). Enforced in the
  **Contract** module against a BOQ read port. A contract below this total is rejected.
  *(Supersedes ADR-016's "BOQ total and contract value may legitimately differ.")*
- **INV-BOQ-PIN-2 — The post-commit working draft is pinned to the contract value.** A node
  write on a committed BOQ's draft that would change the in-contract billable total is
  rejected (`409`) unless it is issued by the variation command. Money-neutral edits
  (reallocation, contingency draw, description/code/reorder) are allowed and logged.
- **INV-BOQ-SNAP-3 — Snapshots are immutable.** `BASELINED` versions are never edited
  (ADR-016 preserved). A snapshot is cut at commit and at each on-contract variation adopt.
- **INV-BOQ-CONT-4 — Contingency is a named, legible pool.** `nodeRole = CONTINGENCY` lines
  are part of `contractValue` but excluded from progress value-weighting; a drawdown
  reallocates contingency → work line, total unchanged, one `BoqChangeEvent`, and the
  remaining pool is derived (never stored) as `Σ contingency leaf.totalAmount − Σ draws`.
- **INV-BOQ-REV-5 — Two figures.** `totalClientRevenue(project) = Σ active contractValue +
  Σ separate charges`. `SEPARATE_CHARGE` and `ABSORBED` never move `contractValue`.
- **INV-BOQ-LUMP-6 — Lump-sum.** Post-commit quantity edits never change client billing;
  the client figure moves only through an adopted on-contract variation (D7).
- **INV-BOQ-GOV-7 — Governed transitions unchanged.** Commit (`DRAFT→BASELINED`) and
  variation client-approval pass through `CommandGovernanceService.gateStateTransition`
  (ADR-011). No second approval door (ADR-016 rejected-alternative upheld).
- **CONST-BOQ-013..018 stand** — one currency, decimal money, structural validity, readiness
  single-source, dense order, governed transition. Readiness now also asserts tie-out
  before commit.

## 5. Commands & interfaces (application layer)

| Command | Module | Auth | Governance | Transaction |
|---|---|---|---|---|
| `commitToContract(versionId)` (= baseline) | BOQ | commit capability (see §9) | ADR-011 gate | baseline in one tx; cuts the snapshot |
| create/finalize `Contract(boqVersionId)` | Contract | contract capability | — | reads BOQ tie-out (port), validates INV-1, sets `contractValue` |
| `reallocate` / `drawContingency(toNode, amount)` | BOQ | manage:boq | — | DRAFT write + `BoqChangeEvent`, one tx (INV-2/4) |
| `addExtraWork(lines, treatment)` | BOQ → | manage:boq (+ commit cap for billable) | variation path gated | Absorb = contingency draw (tx here); Variation = create `VariationOrder` (Commercial); Separate = create charge (Commercial) |
| `adoptVariation(voId)` (on-contract) | Variations + Contract | variation-approve | already governed | **one tx:** append (exists) → baseline → repoint `boqVersionId` → `contractValue += net` → milestone re-derivation *(see DECISION 1)* |

**Ports (interfaces BOQ exposes / consumes):**
- `BoqReadPort.getInContractTotal(versionId): Decimal` — consumed by Contract (INV-1).
- `BoqReadPort.compareToSigned(projectId): Diff` — consumed by the workspace read model.
- BOQ consumes `VariationsPort.createFromBoqLines(...)` and `CommercialPort.createSeparateCharge(...)` — thin application-service calls, no repository reach-through.

The existing deep `GET /boq/workspace` read model (ADR-016) extends to carry: contract
value, contingency remaining, total client revenue, and the three life-stage flags —
assembled server-side, never computed in the client.

## 6. Data flow (happy path)

```
Build → commitToContract ─gate─► BASELINED snapshot ─► Contract(boqVersionId, contractValue=tieout)
                                                             │ milestone installments derive % × value
Post-commit live draft (auto-created):
  money-neutral edits ───────────► BoqChangeEvent (free)          contractValue unchanged
  drawContingency ───────────────► reallocate, pool ↓, logged      contractValue unchanged
  addExtraWork:
    ├ Absorb    ─► contingency draw (as above)                     contractValue unchanged
    ├ Separate  ─► Commercial one-off charge                       contractValue unchanged; revenue ↑
    └ Variation ─► VariationOrder → client approval ─adopt─► new snapshot,
                    boqVersionId repointed, contractValue ↑, milestones re-derived (DECISION 1)
```

## 7. Cross-module impact

- **Contract:** `contractValue` becomes derived/validated (INV-1). New read dependency on
  BOQ. On-contract variation adopt now raises it (was untouched — see `apply-variation`
  comment line 33).
- **Commercial / AR:** milestone installments derive `% × contractValue`, so a mid-contract
  value rise re-spreads unless bounded — **DECISION 1**. "Separate charge" needs a home: a
  `ClientInvoice` with null `sourceInstallmentId` and a source tag, plus a
  `totalClientRevenue` read model — **DECISION 2** (does separate-charge scope live in the
  BOQ at all, or only as a Commercial charge?).
- **Progress (ADR-021):** `progress-rollup` value-weights by `BoqNode.totalAmount`; it must
  now **exclude `nodeRole = CONTINGENCY`** so the cushion never inflates % complete. Small,
  contained change; projects without contingency lines are unaffected.
- **Procurement / Finance:** unchanged — they cost-code to `boqNodeId` (a node identity,
  not amount). Contingency and separate lines are valid cost-coding targets.
- **Variations:** the *trigger* originates in the BOQ UI; the aggregate + approval stay in
  Commercial (ADR-026). `AdoptBaselineService` gains the `contractValue` raise + milestone
  step.

## 8. Migration & compatibility

1. **Additive columns** `nodeRole`, `commercialTreatment` with safe defaults; backfill all
   existing nodes to `WORK` / `IN_CONTRACT`. No data rewrite.
2. **Legacy contracts** may have `contractValue ≠ BOQ in-contract total`. INV-1 is enforced
   **only on new commits / new contracts / adopts**, never retroactively; existing contracts
   surface a non-blocking "not tied out" reconciliation flag rather than failing.
3. **Existing baselined versions** remain valid snapshots. The first post-migration edit on
   a committed BOQ auto-creates the perpetual working draft (reuses `createDraftFromApproved`).
4. **Wire vocabulary** — the workspace/read DTOs rename `baseline`→`commit`, drop the version
   picker; `packages/types` change lands with the web change (owned by Abdulsalam, BOUND-002).

## 9. Authorization / capability

Today: `view:boq / manage:boq / baseline:boq`. The redesign needs finer capability:
- money-neutral edits + contingency draws → `manage:boq`.
- **commit to contract** and **classifying extra work as billable** are *commercial* acts
  (they set/raise the client's money) → a distinct capability.
- variation approval → the existing commercial/variation approver.
This is exactly ADR-020 **CONST-BOQ-022** (`BOQ_SCOPE_EDITOR / BOQ_COST_EDITOR /
BOQ_APPROVER`) plus a margin-visibility split (the BOQ now shows contract-value-vs-cost).
**DECISION 3.**

## 10. Failure semantics

- Tie-out mismatch at contract create → `400` with the delta.
- Value-changing edit on a committed draft outside the variation command → `409`
  ("contract-value changes must go through a variation").
- Contingency draw exceeding remaining pool → `400`.
- Commit when not Baseline-Ready or not tied out → `400` with blockers (ADR-016 pattern).
- Variation adopt when already adopted → `409` (exists).
- Commit / variation approval gated → `409` with `approvalInstanceId` (ADR-011, exists).

## 11. ADR-worthy decisions taken in this pass

- **Perpetual working draft over immutable snapshots (Option A)** — §1. Preserves ADR-016
  immutability; reuses existing machinery. → fold into ADR-029 as the implementation shape.
- **Reuse `BoqVersion` as the snapshot store; no new snapshot table** — §1/§3.
- **`contractValue` becomes derived/validated, not free-typed** — INV-1 (supersedes ADR-016
  boundary; already noted in ADR-029).

---

## 12. Resolutions — open decisions closed with Eng Ahmed (2026-09-10)

**Decision 1 — Variation billing under milestone. RESOLVED: base schedule frozen, variation
billed as an identifiable line.** The original milestone schedule stays fixed on the
**base contract value** ($200k/$150k/$100k/$50k = $500k). An approved variation is certified
and billed as its **own traceable line** (`VO-001 — $2,000`), attached to the certificate/
invoice of the stage in which the varied work completes — never merged into the milestone
amount. Architectural consequences:
- **Contract value is three layered figures:** `baseContractValue` (frozen at commit —
  drives the milestone `%`), `currentContractValue = base + Σ approved on-contract variations`,
  and `totalClientRevenue = current + Σ separate charges`. **The milestone installment
  derivation base changes from live `contractValue` to the frozen `baseContractValue`** — a
  correction to the current `% × contractValue`.
- **Certificates/invoices carry multiple components** (milestone line + VO line(s)) rather
  than a single collapsed figure. Lives in Commercial/AR; the VO line is amount-based, not
  percentage-based, so it sits outside the `Σ% = 1.0` schedule.

**Decision 2 — Separate-charge scope. RESOLVED: in the BOQ, classified, cost- & progress-
tracked.** `SEPARATE_CHARGE` lines live in the BOQ (excluded from the tie-out via INV-1's
`IN_CONTRACT` filter) so their cost codes to `boqNodeId` and progress tracks them like any
node. ACCO tracks cost and progress on pay-now extras, so they must be real nodes.

**Decision 3 — Capability, governance, visibility. RESOLVED (see model below).**

### Final access & control model

**Capabilities** (`action:resource`, technically separate, co-assignable to one person today):
`view:boq` · `edit-scope:boq` · `edit-cost:boq` · `commit:boq` (replaces `baseline:boq`) ·
`manage-contingency:boq`.

**Visibility tiers** (server-enforced field omission in the read model):
- **Operational** (`view:boq`) — scope, qty, unit, progress. No money.
- **Cost control** (`view-cost:boq`) — + line budgets, rates, cost-coding. PM/QS.
- **Commercial/Executive** (`view-margin:boq`) — + base & current contract value, contingency
  reserve + remaining, margin, contract-vs-cost profitability. Commercial/finance/exec only.

**Governance — prepare ≠ approve**, via `CommandGovernanceService` + the ADR-027 DOA engine
(not hardcoded): commit-to-contract and variation approval are both governed transitions
requiring a distinct approver (four-eyes). Contingency draw is a **commercial-authority** act
(PM surfaces the overrun, commercial releases the reserve).

> **R8 wiring note (2026-09-10).** Distinct-approver is the DOA chain's design, not BOQ code:
> the seeded fixed chain `BOQ_COMMIT` (Construction Director → CFO → CEO, CONST-DOA-009) plus the
> SoD engine at approval time enforce it. R8 repointed that chain from the retired
> `BoqVersion DRAFT → BASELINED` to the governed `DRAFT → COMMITTED` (reusing the
> `BOQ_BASELINE` transaction type — no new enum, no migration), and added `DRAFT:COMMITTED` to the
> policy-transition registry, so four-eyes actually fires on the commit path. `CommandGovernanceService
> .gateStateTransition` records the preparer as `initiatedBy`; the approval engine then requires a
> different actor to complete the chain. Chains remain inactive until a deliberate per-org activation.

**Controls (defense in depth):** RBAC capability → project membership (`ProjectAccessService`)
→ approval policy (DOA) → server-side read-model field omission → audit
(`TransactionalAuditOutbox` + `BoqChangeEvent`).

**Boundary:** full profitability is a cross-aggregate read (BOQ contingency + `ProjectCostBudget`
+ GL actuals) assembled in the Finance financial-position read model, gated by `view-margin`.

### Remaining non-blocking item
- **Expected-cost depth** — whether to track a per-line *expected cost* on the BOQ now, or
  rely on the existing `ProjectCostBudget` aggregate for cost-vs-value. Recommendation: rely
  on `ProjectCostBudget` for the first cut (no new BOQ cost field); revisit only from evidence.
- **Contingency-draw authority** — modelled as commercial-only; confirm ACCO doesn't want PMs
  to draw directly up to a limit.

---

## VERDICT: APPROVED

The architecture is sound, reuses existing machinery (version-as-snapshot, governance seam,
audit outbox, decimal money), preserves the ADR-016 immutability that downstream records
depend on, and all three blocking decisions are resolved (§12). Proceed to **spec → tickets**.
Model deltas are additive (two defaulted `BoqNode` columns + `baseContractValue` on Contract +
a contingency-exclusion in the progress roll-up); the migration is a column-add with a trivial
backfill and no retroactive enforcement on legacy contracts.
