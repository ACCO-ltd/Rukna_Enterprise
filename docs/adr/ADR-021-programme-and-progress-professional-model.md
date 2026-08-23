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
0–100, unique dates, non-decreasing). **Deferred:** programme **activities** (CONST-PROG-005 —
`ProgrammeActivity` under WorkPackage with dates/duration/milestone), controlled reopen/correction
(CONST-PROG-010), and — evidence-driven only — dependency networks, Excel/P6 import, recovery
programmes.

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
