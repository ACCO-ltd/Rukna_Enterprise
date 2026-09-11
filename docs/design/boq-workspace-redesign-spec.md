# BOQ Workspace Redesign — Implementation Spec

**Status:** SPEC — 2026-09-10. Type: **FULL-STACK**. Inputs: ADR-029 (CONST-BOQ-026..034),
`boq-workspace-redesign-architecture.md` (APPROVED). Owner: Abdulsalam (backend + schema +
types); frontend engineer (web). Domain sign-off: Eng Ahmed (billing/authority rulings, §0).

Every MUST/SHOULD below is testable; the test is named inline or in §13.

---

## 0. Spec-time refinement of the snapshot mechanism (READ FIRST)

> **SIGNED OFF 2026-09-10** by the product owner + Eng Ahmed: the in-place `COMMITTED` +
> frozen `SNAPSHOT` mechanism and the R1 migration plan are approved. **Execution of R1 still
> requires a full DB backup + a dry-run on a production clone before it runs against
> acco.rukna.site** — sign-off is on the mechanism and plan, not a waiver of the safety steps.

The architecture chose **Option A — a perpetual working draft over immutable `BASELINED`
snapshots**, reusing `createDraftFromApproved` (deep-copy → new node ids). Writing the spec
exposed a flaw: **downstream records (Contract, Progress `WorkPackageBoqNode`/
`ProgressMeasurement`, `PurchaseOrderLine`, `ProjectCostBudgetLine`, IPA items) reference
`BoqNode` by id.** Deep-copy mints new ids, so money-neutral edits and contingency
reallocations made on a draft would **not reach downstream until a re-baseline+adopt** —
which contradicts D1 ("edit freely, no ceremony") and makes a reallocation invisible to the
progress/cost it should immediately affect.

**Refinement (engineering-only; no D1–D7 or user-facing change):** the operational BOQ is
**one long-lived version, edited in place with stable node ids**; a **snapshot is a frozen
*copy* taken at commit and at each variation adopt** — a read-only legal record that nothing
operational ever references. Node-id churn is eliminated; live edits are immediately real
downstream; immutability is preserved *where it matters* (the snapshot), and IPA already
snapshots rate/currency at claim time so it never depended on node immutability.

`BoqVersionStatus` gains `COMMITTED` (the live operational version) and `SNAPSHOT` (a frozen
record); `DRAFT` remains the pre-commit working version. `BASELINED` is migrated (§12).
The architecture doc §1 is updated to match.

---

## 1. Schema & migration — MUST

**S-1 New enums.**
```prisma
enum NodeRole { WORK CONTINGENCY }
enum CommercialTreatment { IN_CONTRACT SEPARATE_CHARGE ABSORBED }
```
**S-2 `BoqVersionStatus` additions:** `COMMITTED`, `SNAPSHOT` (keep `DRAFT`, `SUPERSEDED`,
`CANCELLED`; `BASELINED` retired post-migration).
**S-3 `BoqNode`** gains `nodeRole NodeRole @default(WORK)` and
`commercialTreatment CommercialTreatment @default(IN_CONTRACT)`.
**S-4 `Contract`** gains `baseContractValue Decimal @db.Decimal(18,2)`; `contractValue`
keeps its column but its meaning becomes **current** (= base + Σ approved on-contract
variations). Paired currency already present.
**S-5 `Boq` pointers** reduce to `currentVersionId` (the operational version — `DRAFT`
pre-commit, `COMMITTED` after) and `committedSnapshotVersionId` (the frozen as-signed record;
null pre-commit). `currentDraftVersionId`/`currentApprovedVersionId`/`originalBaselineVersionId`
are migrated into these (§12).

**Tests (MUST):** migration applies on a copy of production; `prisma migrate` is
reversible-safe; new columns default correctly; a raw-SQL check confirms exactly one
`COMMITTED` version per committed BOQ and ≥1 `SNAPSHOT`.

**OUT OF SCOPE:** any per-line *expected cost* column on `BoqNode` (cost-vs-value stays in
`ProjectCostBudget` for the first cut, per the arch default).

## 2. Lifecycle & invariants — MUST

**State model (operational version):** `DRAFT → COMMITTED`. Snapshots are separate `SNAPSHOT`
rows, never transitioned. `SUPERSEDED`/`CANCELLED` retained for a discarded pre-commit draft.

- **L-1 Single operational version.** Exactly one non-snapshot version per BOQ
  (`Boq.currentVersionId`). Test: attempting to create a second `DRAFT`/`COMMITTED` fails.
- **L-2 Commit is governed.** `DRAFT → COMMITTED` passes `CommandGovernanceService
  .gateStateTransition('BoqVersion','DRAFT','COMMITTED', id)` (ADR-011), preparer ≠ approver.
  Gated → 409 with `approvalInstanceId`. Test: gated + passthrough paths.
- **L-3 Commit preconditions.** Baseline-Ready (existing readiness policy, CONST-BOQ-016)
  **and** the operational version is Pricing-Complete. Not ready → 400 with per-node blockers.
- **L-4 Snapshot on commit.** Commit writes a frozen `SNAPSHOT` copy and sets
  `committedSnapshotVersionId` + `Contract.baseContractValue` from the tie-out total (§3).
  Snapshot nodes are never mutated (test: any write to a `SNAPSHOT` node → 403).
- **L-5 Post-commit pin.** On a `COMMITTED` version, a node write that would change the
  **in-contract billable total** is rejected (409, `CONTRACT_VALUE_LOCKED`) unless issued by
  the variation command (§6). Money-neutral writes (description, code, reorder, reallocation,
  contingency draw, `SEPARATE_CHARGE`/`ABSORBED` additions) are allowed. Tests: a rate change
  that moves the in-contract total is rejected; a description edit is allowed; a
  contingency→work reallocation keeping the total constant is allowed.
- **L-6 Stable ids.** Editing a `COMMITTED` version never mints new node ids (test:
  id set is invariant across a money-neutral edit and a reallocation).
- **L-7 History.** Every node write emits one `BoqChangeEvent` in the same transaction
  (existing behavior, unchanged). Reallocation/contingency draws record a `MOVE`/`UPDATE`
  event with amounts.

## 3. Tie-out & three-layer contract value — MUST

- **T-1 In-contract total.** `inContractTotal(version) = Σ leaf.totalAmount WHERE
  commercialTreatment = IN_CONTRACT` (includes `CONTINGENCY` nodes and on-contract variation
  leaves; excludes `SEPARATE_CHARGE`; `ABSORBED` counts in-contract as it is contingency-
  funded). Exposed by `BoqReadPort.getInContractTotal(versionId): Decimal`.
- **T-2 Base value frozen at commit.** `Contract.baseContractValue = inContractTotal(commit
  snapshot)`, set once at commit, never changed thereafter. Test: base is immutable across
  later variations.
- **T-3 Current value.** `Contract.contractValue = baseContractValue + Σ (net billable
  amount of adopted on-contract variations)`. Test: adopting a +$2,000 VO moves current to
  base+2,000; base unchanged.
- **T-4 Contract creation enforces tie-out.** A `Contract` referencing a committed version
  must have `baseContractValue == inContractTotal(referenced version)`; a mismatch → 400
  `TIEOUT_MISMATCH` with the delta. Enforced in the **Contract** module via `BoqReadPort`.
- **T-5 Total client revenue** (read model) `= contractValue(current) + Σ separate charges`
  (§5). Never mutates `contractValue`. Test: a separate charge raises revenue, not contract
  value.
- **T-6 Milestone base.** `ContractPaymentInstallment` amount derivation changes from
  `% × contractValue` to **`% × baseContractValue`** (CONST-BOQ-032). Test: after a variation
  raises current value, milestone amounts are unchanged.

## 4. Contingency — MUST

- **C-1 Marker.** Contingency is one or more `nodeRole = CONTINGENCY` leaf/section lines,
  part of the in-contract total.
- **C-2 Remaining derived.** `contingencyRemaining = Σ contingency leaf.totalAmount −
  Σ draws to date`, computed, never stored. Test: matches ledger of draws.
- **C-3 Draw command.** `drawContingency(toNodeId, amount)` reallocates: contingency line
  −amount, target work line +amount, in-contract total unchanged (satisfies L-5). One
  transaction, one `BoqChangeEvent`. Auth: `manage-contingency:boq` (commercial). Test:
  total unchanged; remaining ticks down; over-draw beyond remaining → 400 `CONTINGENCY_EXCEEDED`.
- **C-4 Absorbed scope.** An `ABSORBED` line is added and funded by an equal contingency
  draw (net-zero to the total). Test: adding absorbed scope of $X reduces contingency by $X,
  in-contract total constant.

## 5. Extra-work classifier — MUST

`addExtraWork(lines[], treatment)` on a `COMMITTED` version. `treatment ∈ {ABSORB,
VARIATION, SEPARATE}`.
- **E-1 ABSORB** → `commercialTreatment=ABSORBED`, funded by contingency draw (§C-4),
  no client, contract value unchanged. Auth: `manage-contingency:boq`.
- **E-2 VARIATION** → creates a `VariationOrder` (Commercial, ADR-026) pre-priced from the
  lines; nodes are **not** added to the operational version until the VO is client-approved
  and adopted (§6). Auth: `edit-scope:boq` to prepare; approval governed.
- **E-3 SEPARATE** → `commercialTreatment=SEPARATE_CHARGE` lines added in place (excluded
  from tie-out), plus a Commercial one-off charge object for billing (§7). Cost-coded and
  progress-tracked like any node. Auth: `edit-scope:boq` + a commercial "bill separately"
  capability.
- **E-4** Test each branch for its effect on `contractValue`, `totalClientRevenue`,
  `contingencyRemaining`, and whether nodes appear on the operational version.

## 6. Variation → current value + VO billing line — MUST

Extends the existing `ApplyVariationToBoqService` / `AdoptBaselineService`.
- **V-1 Append in place.** On adopt of a `CLIENT_APPROVED` on-contract VO,
  `appendVariationNodes` adds `sourceType=VARIATION`, `commercialTreatment=IN_CONTRACT`,
  `sourceChangeOrderId` leaves to the **operational** `COMMITTED` version (stable ids), in
  one transaction. (No deep-copy fork.)
- **V-2 Raise current value + snapshot.** Same transaction: `Contract.contractValue +=
  net(VO)`; a new `SNAPSHOT` copy is written; the VO is stamped applied (existing idempotency).
  Test: current value rises by the VO net; base unchanged; a `SNAPSHOT` is created; re-adopt
  is a 409.
- **V-3 VO billing line (Commercial/AR).** Adopting an on-contract VO creates a billable
  **VO line** (amount-based, outside the `Σ% = 1.0` schedule) that attaches to the certificate/
  invoice of the stage in which the varied work completes, shown as a **separate component**
  (CONST-BOQ-032). Test: a certificate for a milestone + VO shows two lines summing correctly,
  and never a merged milestone figure.
- **V-4 Lump-sum.** Post-commit quantity edits never change any client figure (D7/INV-6).
  Test: editing a leaf quantity leaves base, current, and installment amounts unchanged.

## 7. Read models — MUST

- **R-1 Workspace read model** (`GET /boq/workspace`, extended): life-stage
  (WORKING/COMMITTED), base & current contract value, contingency reserve + remaining, total
  client revenue, per-tier field visibility (§8), and compare-to-signed availability. Assembled
  server-side (ADR-016 deep read), never computed client-side.
- **R-2 Compare-to-signed** (`GET .../compare-to-signed`): diff(operational current,
  `committedSnapshotVersionId`), classifying money-neutral vs value changes. Replaces the
  peer-version compare.
- **R-3 Timeline** (`GET .../timeline`): commit + each variation snapshot + notable history,
  newest-first.
- **R-4 Separate charge** persists as a `ClientInvoice` with null `sourceInstallmentId` +
  a source tag; `totalClientRevenue` aggregates them (Commercial/AR owns this).

## 8. Access, visibility, governance — MUST

- **A-1 Capabilities:** `view:boq`, `edit-scope:boq`, `edit-cost:boq`, `commit:boq`
  (replaces `baseline:boq`), `manage-contingency:boq`. Technically separate; co-assignable.
  Test: each gates its command; absence → 403.
- **A-2 Visibility tiers, server-enforced** (fields omitted from the read model, not hidden
  in UI):
  - Operational (`view:boq`): scope, qty, unit, progress — **no money**.
  - Cost-control (`view-cost:boq`): + line budgets, rates, cost-coding.
  - Commercial/Exec (`view-margin:boq`): + base & current value, contingency reserve +
    remaining, margin, contract-vs-cost.
  Test: a `view:boq`-only token receives a payload with no rate/amount/contingency/margin
  fields; a `view-cost` token sees budgets but not contingency/margin; `view-margin` sees all.
- **A-3 Governance prepare≠approve.** `commit:boq` and variation approval route through the
  DOA/approval-policy engine (ADR-027) with four-eyes; the preparer cannot self-approve. Test:
  self-approval blocked; a distinct approver succeeds.
- **A-4 Contingency authority.** `drawContingency`/`ABSORB` require `manage-contingency:boq`
  (commercial). *(Default; a PM-draw-up-to-limit variant is OUT OF SCOPE unless later chosen.)*

## 9. Progress contingency exclusion — MUST

- **P-1** `progress-rollup` value-weighting excludes `nodeRole = CONTINGENCY` leaves (they
  are not physical work). Test: a project with a large contingency line shows the same
  physical % as one without it; contingency contributes zero weight.
- **P-2** `SEPARATE_CHARGE` and `ABSORBED` work **is** progress-tracked (they are real work).
  Test: measurements against them roll up normally.

## 10. Frontend (web) — MUST/SHOULD

Route `apps/web/.../projects/[id]/boq`. Actor: QS/PM/commercial. Backend contracts: §7.
- **F-1 (MUST)** Retire the version panel / "create revision" / peer-version compare. One
  living BOQ.
- **F-2 (MUST)** **Money band** — life-stage aware: Working (contract target · allocated ·
  left-to-allocate · Commit) / Committed (contract value 🔒 · contingency left bar · cost to
  date · client revenue). Fields present only per the caller's visibility tier.
- **F-3 (MUST)** Tree shows **Contingency** as a distinct line; total "ties to contract" ✓.
- **F-4 (MUST)** **Commit to contract** confirm (business-impact copy; governed → "awaiting
  approval" on 409).
- **F-5 (MUST)** **Add extra work** drawer — two-question classifier
  (Absorb/Variation/Separate) exactly per §5.
- **F-6 (MUST)** **Cover from contingency** per-line action (§C-3).
- **F-7 (MUST)** **History timeline** + **Compare to signed** (§R-2/R-3).
- **F-8 (MUST)** Plain-language labels ("Commit to contract", "Add extra work", "Cover from
  contingency"); never "baseline/draft/version/snapshot".
- **F-9 (SHOULD)** Empty/loading/restricted states; no rate/amount/contingency for
  operational-tier users.
- Tests: component/RTL for classifier, money band per tier, compare-to-signed; existing web
  test suite stays green.

## 11. Cross-module integration contracts — MUST

- **I-1 Contract ← BOQ:** `BoqReadPort.getInContractTotal(versionId)`; tie-out enforced at
  contract create/finalize (T-4) and current-value raise at adopt (T-3/V-2).
- **I-2 Variations ↔ BOQ/Contract:** append-in-place (V-1) + raise current (V-2) + VO
  billing line (V-3) in one governed flow.
- **I-3 Commercial/AR:** milestone base = `baseContractValue` (T-6); VO + separate-charge
  billing lines; `totalClientRevenue` read model (R-4).
- **I-4 Progress:** contingency exclusion (P-1). No id churn (L-6) so existing measurements
  stay attached.
- **I-5 Procurement/Finance:** unchanged; `CONTINGENCY`/`SEPARATE_CHARGE` leaves are valid
  `boqNodeId` cost-coding targets.

## 12. Migration & compatibility — MUST

- **M-1** Additive columns/enums with defaults; backfill `WORK`/`IN_CONTRACT`, and
  `baseContractValue = contractValue` for existing contracts.
- **M-2** Version migration: each BOQ's current `BASELINED` (approved) version →
  `COMMITTED` (the operational version) + a `SNAPSHOT` **copy** set as
  `committedSnapshotVersionId`; existing `SUPERSEDED` → `SNAPSHOT` (historical). Any existing
  open `DRAFT` is merged/discarded so L-1 holds. `Boq` pointer columns migrated to
  `currentVersionId`/`committedSnapshotVersionId`.
- **M-3** Downstream `boqVersionId`/`boqNodeId` references repoint to the `COMMITTED`
  operational version's nodes (id-preserving where the operational version = the former
  baseline; the migration keeps the former baseline's ids as the operational version, so no
  reference rewrite is needed). Test: every existing `WorkPackageBoqNode`/`ProgressMeasurement`
  /`PurchaseOrderLine`/`ProjectCostBudgetLine`/IPA item still resolves.
- **M-4** Tie-out is enforced **only** on new commits/contracts/adopts; legacy contracts with
  `contractValue ≠ inContractTotal` surface a **non-blocking** "not tied out" flag, never a
  failure. Test: a legacy mismatched contract loads and bills normally.
- **M-5** `@erp/types` DTO changes (rename baseline→commit, drop version picker, add tiers)
  land with the web change (BOUND-002). Old `baseline` endpoint 308→ `commit` for one release.

## 13. Consolidated test list (MUST pass)

Backend: L-1..L-7, T-1..T-6, C-1..C-4, E-1..E-4, V-1..V-4, A-1..A-4, P-1..P-2, M-1..M-4,
plus: cross-org isolation on every new command; decimal-string serialization on all money;
governed-gate passthrough + 409; audit event per mutation. Frontend: F-1..F-9 component tests
+ existing suite green. E2E: build → commit (governed) → correct a description → draw
contingency → add absorbed → raise a client variation → adopt → verify base frozen, current
raised, milestone amounts unchanged, VO billing line separate, progress % excludes contingency.

## 14. Out of scope (this iteration)

Per-line expected-cost on the BOQ (use `ProjectCostBudget`); PM-draw-contingency-to-limit;
Excel round-trip export; remeasurable billing (D7 = lump-sum); scope/cost editor as *forced*
separate roles (kept co-assignable). Each is a named future item, not a silent omission.
