---
Status: accepted
---

<!-- Domain-approved by Eng Ahmed Shirie 2026-08-17. Technical prerequisite: PlatformFile MVP (ADR-014). -->

# Programme & Progress: the professional control model

## Status note

**Implementation status.** MVP built (DPR lifecycle → verified progress, WorkPackage weighted
roll-up, physical-vs-financial + collection-vs-progress signals, IPA pre-fill). **Time domain — Phase
1 (planned baseline + schedule variance, CONST-PROG-011): DONE.** An approved `ProgressTarget[]`
curve (ACCO's monthly milestones) on the baseline drives a "planned today %" (linear interpolation of
the curve; 0 before the first target, clamped to the last after), and `GET
/projects/:id/programme/schedule-variance` compares it to the verified physical roll-up →
BEHIND/AHEAD_OF_SCHEDULE. Curve managed via `GET`/`PUT /projects/:id/programme/targets` (validated:
0–100, unique dates, non-decreasing).

**Time domain — Phase 2 (programme activities, CONST-PROG-005): DONE.** A `ProgrammeActivity` under
WorkPackage carries *time* (planned start/end, duration, milestone flag) — the BOQ → WorkPackage →
Activity control layer. CRUD under `/work-packages/:id/activities` and `/programme/activities/:id`,
listable per project via `/projects/:id/programme/activities`; dates validated (end ≥ start,
duration ≥ 0). No dependency network. Membership enforced via the activity's work package's project.

**Phase 3 (controlled reopen/correction, CONST-PROG-010): DONE.** An APPROVED report is reopened
via `POST /progress/reports/:id/reopen` (requires a reason) → `REOPENED`, which records
`reopenedBy/reopenedAt/reopenReason` on the DPR as the audit trail. REOPENED is an editable,
re-submittable state (measurements can be corrected, then submit → SUBMITTED → re-approve). Because
verified progress counts **only** APPROVED measurements, a reopened report's contribution drops out
of the roll-up until it is corrected and re-approved — so there is never a silent edit of trusted
progress. The APPROVED→REOPENED transition is guarded (only APPROVED may reopen) and — like
approval — routes through the **ADR-022 command-governance gate** (`gateStateTransition` on
`DailyProgressReport`, `APPROVED→REOPENED`), so ACCO can place reopen behind a DOA workflow; with no
active binding it proceeds unchanged (backward-compatible). *Audit design:* the DPR's
`reopenedBy/At/Reason` columns hold the **latest** reopen for display, while each governed reopen
opens its own approval instance — the durable per-cycle trail. No separate reopen-history table is
built by design (the gate's approval instances cover multi-cycle audit).

**Round-2 — Progress over time (BE-1): DONE.** A `ProgressSnapshot` (immutable) per project per
period freezes what this ADR already computes — the weighted physical roll-up (`getRollup`),
overall verified-to-date, and the cost-consumed % from the physical-vs-financial signal
(`getPhysicalFinancialSignal`) — nothing is recomputed on read. **Immutability rationale:** because
progress can be restated via a DPR reopen (CONST-PROG-010), a snapshot is the auditable *as reported*
record and is never mutated once written (`@@unique(projectId, periodEndDate)`; a duplicate capture
is a 409). Captured on-demand via `POST /projects/:id/progress/snapshots` (source=`MANUAL`,
`capturedById` = the caller), gated by `manage:project` like the rest of the module; the stored
`periodEndDate` is the supplied "as of" date, defaulting to today — never the server clock (the
accounting-date rule). Two read models feed the frontend: `GET /projects/:id/progress/curve`
(planned-vs-actual S-curve + `status ∈ AHEAD|ON_TRACK|BEHIND|INSUFFICIENT_DATA` + variance) and
`GET /projects/:id/progress/period-comparison` (overall physical/verified previous·current·delta from
the two most-recent snapshots). Curve/status/variance math lives in a pure module
(`domain/progress-curve.ts`), unit-tested directly.

**Provisional baseline (Option-C, BE-1):** the planned line is computed on read as a linear ramp
0→100% from `Project.startDate → expectedEndDate` (sampled at the snapshot dates so it aligns with the
actual line); empty when the project has no usable dates → `INSUFFICIENT_DATA`. `baselineProvisional:
true` flags it. **BE-2 seam:** the real baseline source (Option-A: work-package planned dates+weights,
frozen; or Option-B: entered points) — pending Eng Ahmed's memo — replaces only
`computeProvisionalBaseline` in the pure module; the read contract and the UI are unchanged.

**Deferred to BE-2:** the confirmed Option-A/B baseline (+ `WorkPackage.plannedStart/End` if A);
the **period-close capture hook** (extend `POST /periods/:id/close` to write a
`source=PERIOD_CLOSE` snapshot per active project — the `accountingPeriodId` column is present for
this); and **per-BOQ-leaf period comparison** (BE-1 is overall-only — per-leaf needs per-leaf
snapshot lines or a verified-as-of derivation this scope does not store).

**Deferred:** evidence-driven only — dependency networks (FS/SS/FF/SF), Excel/P6 import, recovery
programmes. Activity-date → planned-% derivation (feeding schedule variance from activities rather
than the target curve) is a possible later refinement.

**Amendment 2026-09-28 — Progress redesign backend (owner-approved).**

1. *Milestone ↔ work package link and readiness.* A `ProgrammeMilestone` names the work packages that
   make up its stage (`ProgrammeMilestoneWorkPackage`, unique per pair, removed with either side;
   both on the same project; a schedule-only phase cannot be linked because it has no measurable
   scope). The milestone read model carries each linked package's verified physical % — computed by
   the roll-up's own pure helpers (`leafPercentComplete`, `progressValueByLeaf`,
   `packagePercentComplete`), so it always equals the package's `percentComplete` in
   `GET …/progress/rollup` — and a derived **`readyToVerify`** = status PLANNED ∧ ≥1 package linked ∧
   every linked package **fully verified on exact quantities** (every work leaf's verified ≥ its
   measurable quantity, Decimal; contingency ignored). The displayed % is the rounded whole number
   the roll-up reports (199.1 of 200 shows 100), so readiness deliberately never reads it — the
   milestone is billing evidence (ADR-023 CONST-COM-011) and must not be prompted early. Readiness
   is a prompt, never a gate: verifying stays a deliberate human act, and a milestone with no
   packages linked is simply never "ready". A VERIFIED milestone's package set is frozen (409),
   re-checked under a row lock inside the swap transaction.
2. *Over-quantity at submit.* CONST-PROG-002/009 (cumulative verified ≤ BOQ measurable quantity) is
   now checked at DPR **submit** as well as approve; approve stays authoritative because other
   reports may be approved in between, and runs under a row lock on the measured BOQ lines in the
   same transaction as the status change. Both raise `DPR_EXCEEDS_BOQ_QUANTITY` with the offending lines.
3. *Re-baseline provenance.* A re-baseline must cite a variation that is **adopted**
   (`CLIENT_APPROVED`) on this project's contract; a draft, rejected or reversed (`WITHDRAWN`)
   variation cannot justify moving the frozen plan.
4. *Money visibility.* The physical-vs-financial and collection-vs-progress signals, and milestone
   release amounts, follow the BOQ money tiers (ADR-029 §8 A-2): amounts are null for a caller
   without the tier (PM / Site Engineer are money-blind); ratios and status stay.
5. *Allocation race.* A concurrent allocation of the same BOQ leaf (the `@@unique([boqNodeId])`
   backstop, CONST-PROG-012) is a 409 `BOQ_ITEM_ALREADY_ALLOCATED`, not a 500.

**Amendment 2026-09-29 — money-derived percentages are money (owner decision).** Refines item 4
above: a ratio of two amounts discloses the amounts' relationship, so it follows the same tier as
the amounts. For a caller without the cost tier, `progress/signal` nulls `costConsumedPercent` and
`divergence` and reports `status: 'HIDDEN'`; the S-curve's `actual[].costPercent` and a snapshot
capture's `costConsumedPercent` are nulled too (the stored snapshot keeps the true figure). For a
caller without the margin tier, `progress/collection-signal` nulls `collectedPercent` and
`divergence` (`status: 'HIDDEN'`), and milestone `releases[].percentage` (share of contract value)
is null. `HIDDEN` is not `INSUFFICIENT_DATA` — that would be a false claim about the project.
Physical and verified progress % are not money and stay visible to everyone.
*Same day, second owner decision:* contract-derived figures (the collection signal and milestone
release share + amount) follow **`canViewContractFigures`** = the margin tier **or `view:contract`**
— the permission that already shows them on Commercial — so the Construction Director sees them on
Progress too. PM / Site Engineer hold neither and stay hidden. The cost signal stays on the cost tier.

Engineering shape owned by Abdulsalam; the domain rules are gated on **Eng Ahmed Shirie**. This
ADR **extends** ADR-002's `CONST-PROG-001/002/003` (it must not silently change them) and depends
on **PlatformFile (ADR-014)**, which is unbuilt and is a hard prerequisite. It refines the
`POLICY_FROZEN` spec in `docs/domains/programme-progress-delivery-spec.md`. Nothing is implemented
until sign-off + PlatformFile land. Part of the Round-1 audit ADR set (018 matching, 019 lifecycle,
020 BOQ, 021 programme/progress).

## Context

Programme & Progress is the biggest un-built gap (capability matrix: `NOT_DESIGNED`). The frozen
spec is enterprise-ambitious (dependency networks, P6/MSP imports, delay-claims, recovery
programmes) — built in full it becomes the next over-engineered subsystem. ACCO's real artefact is
a monthly-target PDF (broad phases Excavation→Finishing, June 15%→Dec 100%, weekly meetings) —
evidence of their *current maturity*, not the target.

Decision: **do not design to ACCO's weak current habits; implement a professional
construction-control model and train them into it — but build the smallest architecture that
enforces the professional controls without becoming Primavera.** Their sample is the migration
starting point, not the product spec.

## Decision

### CONST-PROG-004 — Four separated truths, one workspace
Programme (plan: *when*), Site Record (DPR: *what happened*), Verified Progress (*what is built and
trusted*), Performance (*ahead/behind*). These are modelled and displayed as distinct concerns.

### CONST-PROG-005 — Explicit control layer: BOQ → WorkPackage → Activity
`WorkPackage` is an always-present control seam between contractual scope (BOQ) and site execution.
It carries `code, name, responsibleOwner, progressWeight, status`, BOQ allocations and activity
links. `ProgrammeActivity` carries time (dates, duration, milestone?). The BOQ leaf keeps scope +
quantity + rate.

### CONST-PROG-006 — Measurement method is the reused BOQ property
Progress reuses `BoqNode.measurementMethod` (QUANTITY | PERCENTAGE | MILESTONE) — already snapshotted
into `InterimPaymentApplicationItem.measurementMethodSnapshot`. Progress is its first consumer that
*branches* on it (QUANTITY → measured/total; MILESTONE → objective steps; "start/finish" → a simple
milestone). No parallel measurement-method enum is created.

### CONST-PROG-007 — Weighted physical progress, never money-weighted
`activity/package progress = verified measured quantity ÷ measurable quantity`, rolled up by
**WorkPackage `progressWeight`**. Weights across an approved reporting scope total exactly 100%, are
set at baseline, and are immutable afterwards. BOQ monetary value is never the physical-progress
weight. Physical progress and financial progress are deliberately different numbers.

### CONST-PROG-008 — Progress originates only from an approved DPR *(extends CONST-PROG-001)*
A DPR is an evidence container (date, conditions, labour, equipment, performed work, issues/delay
reason, evidence[]); the `ProgressMeasurement` inside it becomes verified only on DPR approval
(workflow-gated). Mobile-first capture.

### CONST-PROG-009 — Cumulative ≤ scope, excess is surfaced not capped *(extends CONST-PROG-002)*
Cumulative verified quantity cannot exceed approved measurable scope. Excess is **never silently
capped**; it is surfaced and routed to the `Request Unplanned Requirement` classifier
(ADR-020 CONST-BOQ-025: measurement correction / approved variation / variation pending /
unplanned non-recoverable work).

### CONST-PROG-010 — Approved progress is immutable *(extends CONST-PROG-003)*
Corrections only through a controlled, authorised, audited reopen/correction. No silent edits.
*Implemented (Phase 3):* `reopen` moves APPROVED→REOPENED, capturing `reopenedBy/reopenedAt/
reopenReason`; the reopened report is editable + re-submittable and its measurements stop counting as
verified until re-approval. *Authorised* via the ADR-022 governance gate (same seam as approval), so
reopen can be placed behind a DOA workflow.

### CONST-PROG-011 — Baseline / Forecast / Actual are distinct
The baseline programme is never silently overwritten. Baseline (committed), Forecast/Revised
(intended now), and Actual (what happened) are separate and all retained; revision history is
preserved and shown as one current programme + change feed + history (mirrors ADR-016/019 one-view
UX, not a version dropdown). ACCO's monthly targets are modelled as an approved `ProgressTarget[]`
curve on the baseline → drives "planned today".

### CONST-PROG-012 — Anti-double-counting
The same measured quantity cannot contribute more than once through overlapping BOQ/package/activity
allocations.

### CONST-PROG-013 — Every WorkPackage has an explicit responsible owner
A control item without an owner decays into "someone should handle it."

### CONST-PROG-014 — Separate metrics, no composite score
Physical progress, financial progress, quality, and safety are distinct dimensions. No arbitrary
"project performance = 83%". Cost never determines physical progress; incurred cost can legitimately
lead physical progress (mobilisation, advances, materials).

### CONST-PROG-015 — Commercial firewall (shared invariant)
Verified progress *suggests* an IPA claim quantity; a QS confirms; it never auto-bills (PROG-D14).
This is the same firewall as ADR-018 CONST-MATCH-013 and ADR-020 CONST-BOQ-025: built ≠
automatically contractually claimable.

### CONST-PROG-016 — Full evidence chain
Traceable: project % → WorkPackage → measurement → DPR → source artifacts (photos, measurement
sheets, delivery tickets, inspections, test results). A photo shows work happened, not the exact
quantity; evidence supports multiple attachment types via PlatformFile — Programme creates no
separate file storage.

## Value-adds (approved, in scope)

1. Progress feeds the guided **Overview cockpit** (ADR-019 readiness engine).
2. Progress **pre-fills IPA** claim quantities (suggestion only; firewall intact).
3. **Physical-vs-financial signal** per line/package (e.g. 36% built / 51% cost = "investigate"),
   not EVM.
4. **Mobile-first DPR + multi-evidence.**
5. **Capture site conditions / delay reasons on the DPR now**; formal DelayEvent/EOT engine deferred.

## Delivery sequencing (value-first)

0. **PlatformFile MVP (prerequisite):** `PlatformFile` + `FileStoragePort` + MinIO adapter,
   tenant-partitioned, signed-URL serving; resolve dangling `*Attachment.platformFileId` FKs.
   Unblocks Progress evidence and the Documents tab.
1. **Progress core:** BOQ↔WorkPackage allocation + weights; DPR + ProgressMeasurement
   (approved-DPR provenance, ≤scope, anti-double-count); roll-up; Overview heartbeat; IPA pre-fill;
   physical-vs-financial signal.
2. **Programme light:** activities + baseline dates + milestones + `ProgressTarget` curve →
   planned-vs-verified variance. No dependency network.
3. **Deferred (evidence-driven only):** FS/SS/FF/SF dependencies, Excel then P6/MSP import, recovery
   programmes, formal DelayEvent/EOT/claims, EVM, CPM/critical-path, BIM/IoT/AI quantity.

## Considered options

- **Build the full frozen spec now (rejected).** Enterprise scheduling + imports + claims is
  dormant complexity for ACCO's maturity — the tolerance-engine/DOA-ambition pattern again.
- **Design to ACCO's current monthly-milestone habit (rejected).** Locks in weak control (progress
  by eye). We train them into measured, evidence-backed control instead.
- **Defer WorkPackage / attach weight to activities (rejected by owner).** Chose the always-explicit
  control layer for responsibility + measurement discipline.
- **Separate progress measurement-method enum (rejected).** Reuse `BoqNode.measurementMethod` to
  avoid drift from the IPA snapshot.

## Consequences

- New context `construction/programme` owning programme/versions/activities/work-packages/DPR/
  measurements/allocations/milestones; references BOQ/Contract by ID only; never mutates BOQ; never
  auto-creates IPA/IPC (ARCH-BOUNDARY-001, the firewall).
- Hard dependency on PlatformFile; Progress evidence cannot ship before it.
- Reuses existing seams: ADR-019 readiness engine (Overview), the ADR-020 unplanned-requirement
  classifier (excess handling), the `isEffective`/one-view pattern (programme baseline UX).
- Gated on Eng Ahmed for domain rules; part of the batched Round-1 sign-off.
