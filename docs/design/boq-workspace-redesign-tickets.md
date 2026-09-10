# BOQ Workspace Redesign — Build Tickets

**Status:** TICKETS — 2026-09-10. Source: `boq-workspace-redesign-spec.md`, ADR-029,
`boq-workspace-redesign-architecture.md`. Backend + schema + `@erp/types` = Abdulsalam;
web = frontend engineer. Each ticket is a narrow but complete vertical slice sized for one
context window.

## Dependency graph

```
R1 (schema+migration) ─┬─► R2 (commit lifecycle) ─┬─► R3 (tie-out/3-layer value) ─┬─► R5 (classifier) ─┬─► R6 (variation+VO bill)
                       │                          ├─► R4 (contingency) ───────────┘                    └─► R7 (separate-charge bill)
                       │                          └─► R8 (access/visibility) ──────────────┐
                       │                                                                    │
                       ├─► R9 (progress exclusion, PARALLEL, disjoint)                      │
                       │                                                                    ▼
                       └───────────────► R10 (read models: workspace/compare/timeline) ──► R11 (frontend)
                                          (needs R2,R3,R4)                    (needs R10 + R8)
```

Frontier now: **R1** — but it is **BLOCKED** on a human go-ahead for the live migration (§0
of the spec). Everything else unblocks from there.

---

### R1 — Schema deltas + version-model migration
- **Objective:** Land the additive schema and migrate the version model to the in-place
  operational + frozen-snapshot shape (spec §0/§1/§12).
- **Context:** Introduces `NodeRole`, `CommercialTreatment`; `BoqVersionStatus` gains
  `COMMITTED`/`SNAPSHOT`; `BoqNode.nodeRole`/`commercialTreatment`; `Contract.baseContractValue`;
  `Boq` pointers → `currentVersionId` + `committedSnapshotVersionId`.
- **Dependencies:** none (foundation).
- **Likely affected area:** `apps/api/prisma/schema.prisma`, a Prisma migration, `@erp/types`
  enums. **Disjoint from all other tickets' write areas.**
- **Acceptance:** S-1..S-5; M-1..M-3. Migration applies on a production copy; every existing
  `WorkPackageBoqNode`/`ProgressMeasurement`/`PurchaseOrderLine`/`ProjectCostBudgetLine`/IPA
  item still resolves (ids preserved — former baseline becomes the operational version); one
  `COMMITTED` + ≥1 `SNAPSHOT` per committed BOQ (raw-SQL check).
- **Tests:** migration up/rollback on a seeded DB; reference-integrity query; default-value
  unit tests.
- **Non-goals:** any behavior change (pure schema/migration).
- **Risks:** ⚠ **LIVE PRODUCTION MIGRATION (acco.rukna.site).** Repointing `BASELINED`→
  `COMMITTED` + snapshot copies while preserving downstream ids is the single highest-risk
  step. Requires a backup + a dry-run on a prod clone + explicit human go-ahead. **BLOCKED
  until signed off.**
- **Class:** BLOCKED → then SEQUENTIAL (foundation).

### R2 — Commit-to-contract lifecycle (in-place operational version)
- **Objective:** Replace `baseline` with **commit** (`DRAFT→COMMITTED`, governed), write the
  commit `SNAPSHOT`, and switch node writes to in-place-with-pin on the operational version.
- **Context:** Reworks `boq-versioning.service` + `boq-tree.service` write guard.
- **Dependencies:** R1.
- **Likely affected area:** `boq/application/*`, `boq/domain/*` (pin policy),
  `boq/presentation/boq.controller` (`/commit`), `@erp/types`.
- **Acceptance:** L-1..L-7 — single operational version; governed commit (409 gated / passthrough);
  readiness+pricing-complete precondition; `SNAPSHOT` written + `committedSnapshotVersionId`
  set; post-commit pin rejects value-changing writes (409 `CONTRACT_VALUE_LOCKED`), allows
  money-neutral; ids stable across edits; one `BoqChangeEvent` per write; snapshot nodes
  immutable (403).
- **Tests:** the L-series specs.
- **Non-goals:** tie-out at contract create (R3); contingency (R4).
- **Risks:** the pin invariant must define "in-contract billable total" identically to R3's
  tie-out — share one policy fn.
- **Class:** SEQUENTIAL (after R1).

### R3 — Tie-out + three-layer contract value
- **Objective:** Derive/validate `contractValue`; freeze `baseContractValue`; re-base milestone
  derivation.
- **Context:** `BoqReadPort.getInContractTotal`; Contract create/finalize enforcement; milestone
  amount base change.
- **Dependencies:** R1, R2.
- **Likely affected area:** `construction/contracts/*`, a BOQ read port, `commercial`/installment
  derivation. **Disjoint from R4's boq-internal write area** → R3 ∥ R4 after R2.
- **Acceptance:** T-1..T-6 — in-contract total policy; base frozen at commit; current =
  base+ΣVOs; contract-create tie-out (400 `TIEOUT_MISMATCH` + delta); milestone amounts derive
  from `baseContractValue` and don't move when current rises.
- **Tests:** the T-series specs.
- **Non-goals:** the VO that raises current (R6); separate-charge revenue (R7).
- **Risks:** milestone-base change must not alter already-issued invoices (M-4 legacy flag).
- **Class:** SEQUENTIAL (after R2); PARALLEL with R4.

### R4 — Contingency pool + drawdown
- **Objective:** First-class contingency + audited draw.
- **Dependencies:** R1, R2.
- **Likely affected area:** `boq/application` (`drawContingency`), `boq/domain`,
  `@erp/types`. Distinct from R3 (contract module).
- **Acceptance:** C-1..C-4 — `CONTINGENCY` role; remaining derived; draw keeps in-contract
  total constant (satisfies R2 pin), decrements remaining, over-draw → 400
  `CONTINGENCY_EXCEEDED`; absorbed scope net-zero.
- **Tests:** the C-series specs.
- **Non-goals:** the classifier UI/command wrapper (R5).
- **Risks:** draw must not double-count against progress (coordinate with R9).
- **Class:** SEQUENTIAL (after R2); PARALLEL with R3.

### R5 — Extra-work classifier
- **Objective:** `addExtraWork(lines, treatment)` = Absorb | Variation | Separate.
- **Dependencies:** R3, R4.
- **Likely affected area:** `boq/application`, thin calls to Variations + Commercial ports.
- **Acceptance:** E-1..E-4 — each branch's effect on contractValue / totalClientRevenue /
  contingencyRemaining / whether nodes land on the operational version; auth per branch.
- **Tests:** the E-series specs.
- **Non-goals:** the variation adopt path internals (R6); separate-charge billing (R7).
- **Risks:** VARIATION branch must not add nodes until adopt (E-2).
- **Class:** SEQUENTIAL (after R3, R4).

### R6 — Variation raises current value + VO billing line
- **Objective:** On-contract VO adopt appends in place, raises current value, cuts a snapshot,
  and produces a separate VO billing line under the frozen milestone schedule.
- **Dependencies:** R3, R5.
- **Likely affected area:** `construction/variations/*` (`ApplyVariationToBoqService`,
  `AdoptBaselineService`), `contracts`, `commercial`/AR (VO invoice line).
- **Acceptance:** V-1..V-4 — append in place (stable ids); current += net, base unchanged,
  `SNAPSHOT` written, re-adopt 409; VO certificate line separate from the milestone (never
  merged); post-commit quantity edits move no client figure.
- **Tests:** the V-series specs + the CONST-BOQ-032 certificate-composition test.
- **Non-goals:** separate-charge billing (R7).
- **Risks:** the raise-current + snapshot + VO-line must be one transaction.
- **Class:** SEQUENTIAL (after R5).

### R7 — Separate-charge billing + total-client-revenue read model
- **Objective:** Bill a `SEPARATE_CHARGE` as a one-off `ClientInvoice`; expose total client
  revenue.
- **Dependencies:** R3, R5.
- **Likely affected area:** `accounting/accounts-receivable` / `commercial`, a project read
  model. Distinct from R6 (variations) → R6 ∥ R7.
- **Acceptance:** R-4, T-5 — one-off invoice with null `sourceInstallmentId` + source tag;
  `totalClientRevenue = current + Σ separate charges`; contract value unaffected.
- **Tests:** R-4/T-5 specs.
- **Non-goals:** VO billing (R6).
- **Class:** SEQUENTIAL (after R5); PARALLEL with R6.

### R8 — Access capabilities + visibility tiers + governance
- **Objective:** New capabilities, three server-enforced visibility tiers, four-eyes
  prepare≠approve on commit + variation.
- **Dependencies:** R2 (commit exists); integrates with read models (R3/R7/R10).
- **Likely affected area:** `platform/permissions` seed, guards/decorators, BOQ read-model
  field omission, DOA policy config.
- **Acceptance:** A-1..A-4 — each capability gates its command (403 absent); read model omits
  money fields per tier (three payload-shape tests); self-approval blocked, distinct approver
  succeeds; contingency draw requires `manage-contingency:boq`.
- **Tests:** the A-series specs.
- **Non-goals:** the DOA policy content (configured, not coded).
- **Risks:** field-omission must be server-side (not UI) — assert in tests with raw payloads.
- **Class:** SEQUENTIAL (after R2); best landed alongside R10.

### R9 — Progress contingency exclusion
- **Objective:** Exclude `CONTINGENCY` from progress value-weighting; keep separate/absorbed
  tracked.
- **Dependencies:** R1 (needs `nodeRole`).
- **Likely affected area:** `construction/programme|progress` `progress-rollup`. **Disjoint
  from all BOQ/Contract write areas** → runs in parallel with R2–R8.
- **Acceptance:** P-1, P-2 — contingency contributes zero weight; separate/absorbed roll up
  normally.
- **Tests:** P-series specs.
- **Class:** PARALLEL (after R1).

### R10 — Workspace read model + compare-to-signed + timeline
- **Objective:** The deep read the new UI consumes.
- **Dependencies:** R2, R3, R4.
- **Likely affected area:** `boq/application` read services, `boq.controller`, `@erp/types`.
- **Acceptance:** R-1..R-3 — life-stage, base & current value, contingency remaining, total
  client revenue, per-tier fields; compare-to-signed diff vs `committedSnapshotVersionId`;
  timeline newest-first.
- **Tests:** R-series specs.
- **Non-goals:** the React UI (R11).
- **Class:** SEQUENTIAL (after R2, R3, R4).

### R11 — Frontend workspace redesign
- **Objective:** One-BOQ UI: money band, contingency line, commit confirm, add-extra-work
  drawer, cover-from-contingency, timeline + compare-to-signed; retire version panel; plain
  language; tier-aware.
- **Dependencies:** R10 (data) + R8 (tiers).
- **Likely affected area:** `apps/web/src/features/boq/**` (frontend engineer).
- **Acceptance:** F-1..F-9; existing web suite green.
- **Tests:** RTL for classifier, money band per tier, compare-to-signed; e2e build→commit→
  correct→draw→absorb→variation→adopt (spec §13 e2e).
- **Non-goals:** backend behavior.
- **Class:** SEQUENTIAL (after R10, R8).

---

## Parallelisation summary
- **Immediately after R1:** R2 and **R9** (parallel, disjoint).
- **After R2:** **R3 ∥ R4** (contract module vs boq-internal).
- **After R5:** **R6 ∥ R7** (variations vs AR).
- **R8** develops alongside **R10**; **R11** is last (needs both).
- Critical path: R1 → R2 → R3 → R5 → R6 → R10 → R11.
