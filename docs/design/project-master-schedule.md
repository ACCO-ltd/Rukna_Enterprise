# Project Master Schedule — Living Baseline, Report & Billing Bridge

**Status:** DRAFT for review — no code written yet.
**Date:** 2026-09-08
**Author:** senior product/eng review (Claude) with Abdulsalam
**Scope:** turn ACCO's traditional Word/Excel "Project Master Schedule" into a **living, professional artifact** in the Progress workspace — a frozen baseline with automatic plan-vs-actual, a generated report that replaces the document, and an explicit bridge to the 40/30/20/10 payment schedule. Sibling of `docs/design/commercial-billing-model-refinement.md`.

---

## 1. Why this exists

ACCO issues a "Project Master Schedule" per project (sample: ref `AGH01-06-26-2026-7380_PR`, project `ACCO-WBR-26-0062`) containing: an 8-activity WBS with durations/dates, a monthly planned-completion curve (Jun 15% → Dec 100%), a site-meeting cadence, and performance/quality KPIs. Today it is a **static document, retyped each month**.

**The professional goal:** enter the plan **once**, let actuals flow in from Daily Progress Reports automatically, compute variance itself, connect its milestones to billing, and **generate the document from live data** so it is always current — instead of a file emailed around.

**Key framing (do not lose this):** this Master Schedule is the **Programme** (execution plan) — it is a *different thing* from the **Payment Schedule** (the 40/30/20/10 commercial billing stages). They are distinct domains that meet at exactly one point: **a programme milestone, when verified, releases its payment stage.**

| | Master Schedule (Programme) | Payment Schedule (Commercial) |
|---|---|---|
| Question | When does work happen? On track? | When do we bill, how much? |
| Granularity | 8 activities + monthly curve | 4 stages (40/30/20/10) |
| Home | **Progress** workspace | **Commercial** workspace |
| Meet at | verified `ProgrammeMilestone` → releases `ContractPaymentInstallment` | |

## 2. Confirmed decisions

| # | Decision |
|---|---|
| D1 | **In scope:** (a) living baseline + plan-vs-actual, (b) generated Master Schedule report/PDF, (c) visible milestone→payment-stage bridge. |
| D2 | **Deferred (out of this pass):** site-meeting cadence register and performance/quality KPI register. Revisit later. |
| D3 | **Stay lean — no Primavera.** No dependency network, no P6/MSP import, no recovery/what-if baselines. (Honors ADR-021; the full versioned-programme ambition in `docs/domains/programme-progress-delivery-spec.md` stays `NOT_IMPLEMENTED`.) |
| D4 | Spec first; implementation reviewed before any code. |

## 3. Current state (grounded)

Progress workspace IA: single route `/projects/[id]/progress`, headline band + a `ViewSwitcher` over 5 views — **Overview** (S-curve/performance), **Record** (DPRs), **Verification** (verified % per BOQ leaf), **Schedule** (milestones + activities), **Plan & Setup** (work packages + baseline editor) (`progress-tab.tsx:18,51-95`).

| Master Schedule block | Status | Evidence & gap |
|---|---|---|
| **A. Activity/WBS** (activity, duration, start/end) | **CONFIRMED, partial** | `ProgrammeActivity` (`schema.prisma:968-988`): `code, name, plannedStart, plannedEnd, durationDays, isMilestone, sortOrder`, hangs off `WorkPackage`. Gantt-lite UI `activities-section.tsx:155`. **GAP: no actual dates, no % complete, no baseline-vs-actual on the activity** — it is a *plan* grid only. No dependencies (deliberate). |
| **B. Monthly planned curve** (Jun 15%…Dec 100%) | **CONFIRMED** | `ProgressTarget` (`schema.prisma:1212-1227`): `{targetDate, cumulativePercent}`, non-decreasing, replace-all `PUT`. Baseline editor `baseline-section.tsx` ("Generate monthly (linear)"). **Automatic variance**: `getScheduleVariance`/`getCurve`/`scheduleStatusFor` → AHEAD/ON-TRACK/BEHIND. **GAP: not a versioned/frozen artifact** — editable replace-all rows, no approval, no history. |
| **C. Milestones** | **CONFIRMED** | `ProgrammeMilestone` (`schema.prisma:1017-1041`): `status PLANNED|VERIFIED, baselineDate, forecastDate, actualDate, verifiedBy/At`. Verify endpoint. **Billing link exists**: `ContractPaymentInstallment.programmeMilestoneId` + soft VERIFIED gate (`client-invoice.service.ts:152-159`). **GAP: no roll-up** — a milestone is verified by one manual click, not computed from the activities beneath it; the bridge is invisible in the UI. |
| **D. Meeting cadence** | **MISSING** | none. *(Deferred — D2.)* |
| **E. Performance/quality KPIs** | **MISSING** | none (the "Performance" view is the S-curve, not a KPI register). *(Deferred — D2.)* |
| **F. Report / PDF export** | **MISSING** | no print/export/PDF capability anywhere in progress/programme. |

## 4. Target design

### 4.1 Piece A — Living baseline + BOQ-derived progress + guided builder *(deeper path — Q-2 decided)*
**Goal:** the user records progress in **one place** (DPRs against the BOQ) and the Master Schedule — activity %, milestone readiness, S-curve — **updates itself**. No one stares at an empty grid guessing a "% per activity."

- **Single source of truth (derived, not typed):** DPR measurements → verified % per BOQ leaf *(exists)* → value-weighted roll-up → **activity %** → milestone readiness → S-curve → billing release. One entry point; everything downstream is derived.
- **Derivation needs activity↔BOQ scope — key architecture decision (Q-6/D-grain).** Today the value-weighted verified-% engine runs at **work-package** grain; `ProgrammeActivity` carries only dates. To derive **per-activity** %, each measurable activity must own a slice of BOQ scope. Two shapes:
  - **(i) Activity owns BOQ scope** — assign BOQ leaves/sections to each activity; reuse the existing value-weighted engine at activity grain. *(Choose if activities must be finer than work packages.)*
  - **(ii) The schedule row IS the work-package** — work packages already own BOQ scope and a derived %; add the time window (start/end/duration) to them. *(Choose if ACCO's ~8 coarse phases simply ARE the work packages — likely the case.)*
  - **Recommend (ii) as the default** (least new modeling, reuses `weightedPackagePercent`), with (i) reserved for projects that need sub-package activities. **Confirm in the architecture pass before P1.**
- **Guided builder (the anti-frustration piece):** a step-by-step schedule setup — (1) start from an **"ACCO standard building schedule" template** (the 8 phases: Mobilization → … → Handover) or blank; (2) **assign BOQ scope** to each activity/phase; (3) set planned dates/durations (auto-suggested from the monthly curve); (4) flag billing milestones + link payment stages. The user is *guided*, never guessing.
- **Non-measurable activities** (Mobilization, Design) own no BOQ scope → excluded from the weighting or given an explicit manual %, clearly labelled — never a silent zero.
- **Freeze as baseline (Q-1):** the approved plan (scope map + dates + curve) becomes a versioned `ProgrammeBaseline` (one governing version at a time); actuals are measured against it.
- **Schedule view:** planned bar + **derived-actual** bar overlay + auto % chip; late/ahead visible at a glance. The S-curve (planned vs actual, AHEAD/ON-TRACK/BEHIND) is already built — we anchor it to the frozen baseline and surface it here.

### 4.2 Piece B — Generated Master Schedule report *(server-side, org-branded — Q-5 decided)*
**Goal:** a professional, **branded** client deliverable generated from live data — always current.

- **Server-generated PDF** (not a browser print). Pixel-stable, consistent, email-/archive-ready.
- **Organization branding:** ACCO name + **logo** in the header/footer, pulled from the `Organization` record (add a logo asset if the org has none). Falls back to org name when no logo.
- **Approach:** a server-side render (headless-browser or a PDF library) behind an endpoint; the output can be **auto-filed into the project Documents register** as a controlled document (ties to Documents Phase 7A). ⚠ Adds a PDF-generation dependency; verify the known storage TLS path *before* wiring auto-archive.
- **Contents** (mirrors ACCO's doc, from live data):
  - Header: ref, date, **client**, **project code** (`ACCO-WBR-26-0062`), project name, baseline version + "as of" date, **ACCO logo**.
  - Activity schedule table: No · Activity · Duration · Planned Start/End · **Derived Actual Start/End · % Complete**.
  - Planned curve: the monthly targets table **+ the plan-vs-actual S-curve chart**.
  - Milestones table: name · baseline · forecast · actual · status, **with the payment stage each releases**.
  - Optional "as-of snapshot" using the frozen baseline + latest `ProgressSnapshot` actuals.
- **Deferred blocks (D2)** — meeting cadence and KPI targets are *omitted* rather than faked.

### 4.3 Piece C — Milestone → payment-stage bridge (make the wire visible)
The plumbing exists; it is invisible. Make it explicit **both directions**:

- **On a Programme milestone (Progress):** a chip *"Releases: 40% Structure — $X"*; the Verify dialog notes *"verifying this makes the linked payment stage invoiceable."*
- **On the Payment Schedule (Commercial):** each stage shows its evidence milestone + status (*"Blockwork, Plaster & MEP First Fix — PLANNED / VERIFIED"*).
- **Advance stage is explicitly ungated:** ACCO's 40% "Structure" is the **advance** (paid early) — it is an `ADVANCE`-trigger installment with **no** verification gate; the UI must say so, not imply it waits on a milestone.
- **Optional roll-up (design option, §5 Q-3):** compute a milestone's readiness from the activities/work packages beneath it, instead of a lone manual verify.

**Worked example (from the sample):**
| Payment stage | Gate | Programme evidence (activity) |
|---|---|---|
| 40% Structure (advance) | none — paid early once contract ACTIVE | (structural activities 2–5, Jun–Sep) |
| 30% Partition & Plastering | milestone VERIFIED | "Blockwork, Plaster & MEP First Fix" (act. 6, end Oct) |
| 20% Installation & Paint | milestone VERIFIED | "Finishing Works" (act. 7, end Nov) |
| 10% Inspection & Handover | milestone VERIFIED | "External Works, Testing & Handover" (act. 8, end Dec) |

## 5. Phased plan

Backend + frontend + tests per phase; `pnpm --filter @erp/web type-check` before every web push; stage explicit paths (never `git add -A`).

- **P0 — Architecture pass** ✅ **DONE (2026-09-08) → Option (ii); see §8.** WBS grain = Work Package; progress derived from BOQ verification; additive migration; ADR-029 drafted. Unblocks P1.
- **P1 — Guided builder + BOQ-derived progress.** The schedule-setup wizard + "ACCO standard building schedule" template + BOQ-scope assignment + **derived** activity % (reusing the value-weighted engine) + Schedule-view overlay/% chips. Bigger than the original manual P1 — this is the "deeper, guided" system.
- **P2 — Milestone↔payment bridge UI.** Surface the existing link/gate both directions; label the 40% advance as ungated. Cheap; connects to the Commercial spec. *(No schema change.)*
- **P3 — Freeze/version the baseline.** `ProgrammeBaseline` (approve + single governing version + re-baseline); variance anchored to the approved baseline; lock casual editing of an approved plan.
- **P4 — Branded Master Schedule report.** Server-generated, org-branded PDF consuming P1–P3 data + optional auto-file into the Documents register. The deliverable that retires the Word doc — lands last (needs derived actuals + baseline to be meaningful).

## 6. Non-goals
- Meeting cadence register, KPI/quality-target register (D2 — deferred).
- Dependency network, P6/MSP import, recovery/what-if baselines (D3).
- No change to DPR capture, verification math, or the S-curve variance engine (reused as-is).

## 7. Decisions (resolved 2026-09-08)
- **Q-1 — Baseline model:** ✅ **lean `ProgrammeBaseline` version record** (one governing version at a time; re-baseline creates a new version). No what-if/history engine.
- **Q-2 — Activity % complete:** ✅ **DERIVED from the BOQ roll-up + a guided builder** (deeper path chosen over manual). Opens **Q-6**.
- **Q-3 — Milestone verification:** ✅ **keep manual "Verify"**, but show an activity/WP **readiness signal** beside it. Money events stay a named human act.
- **Q-4 — Approve / re-baseline authority:** ▶ **PM approves the initial baseline; re-baselining is senior/governed and linked to a Variation.** *(Confirm with Eng Ahmed.)*
- **Q-5 — Report format:** ✅ **server-generated, organization-branded PDF** (ACCO name + logo); may auto-file into the Documents register.
- **Q-6 — WBS grain for derivation (from Q-2):** ✅ **RESOLVED → Option (ii): the Work Package is the schedule row.** See §8 (P0 architecture pass, 2026-09-08).

## 8. P0 Architecture Decision — WBS grain & derivation (Q-6) — **APPROVED**

**Decision: Option (ii) — the Work Package IS the Master Schedule row ("phase").** Activities are optional finer detail. Progress is **derived from BOQ verification, never entered.** This reuses the entire existing engine with **zero new invariants**; Option (i) collides with a live invariant (below).

### 8.1 Grain & aggregates
- **Work Package = the schedule/phase row.** Already owns BOQ scope (`WorkPackageBoqNode`, one leaf → ≤1 WP), a value-weighted derived % (`weightedPackagePercent`), a `progressWeight` for the project roll-up, and an owner. It gains a **time window** (§8.3). **ACCO's 8 phases = 8 work packages.**
- **`ProgrammeActivity` = optional sub-phase time detail** under a WP. Not required for the Master Schedule; owns no BOQ scope, no derived %. Keep the capability; ACCO's 8-phase schedule needs none.
- **`ProgrammeMilestone` = project-level named stage**, optionally linked to a WP (new — powers the readiness signal) and to a billing installment (existing). Verified manually (Q-3).
- **`ProgrammeBaseline` = the frozen, versioned plan** (new — Q-1): snapshots the WP set + planned dates + weights + BOQ-scope map + `ProgressTarget` curve + milestone baseline dates. One governing (APPROVED) version per project.

### 8.2 Why (ii), not (i)
| | (ii) WP is the row | (i) activity owns BOQ scope |
|---|---|---|
| New invariants | **none** — CONST-PROG-012 untouched | new leaf-uniqueness vs activities — **collides** with the live "a leaf is counted exactly once" rule (`schema.prisma:990-993`) |
| BOQ↔scope | reuses `WorkPackageBoqNode` | new `ProgrammeActivityBoqNode` = a **second allocation surface** (double-count risk) |
| Derived % | already exists per WP | new activity-grain roll-up; redefines what WP % means |
| Allocation UI | already exists ("Allocate item", Plan & Setup) | new activity-grain UI |
| Migration | additive nullable date cols, **zero backfill** | new join table + **manual backfill of every activity** |
| Buys | matches ACCO's real WBS grain | sub-phase granularity — only if ACCO plans below the phase |

### 8.3 Data model delta (all additive)
- `WorkPackage` += `plannedStart? @db.Date`, `plannedEnd? @db.Date`, `durationDays? Int`, `forecastEnd? @db.Date`. **% complete and actual dates are DERIVED, never stored.**
- `ProgrammeMilestone` += `workPackageId? String` (nullable FK) — readiness signal + bridge.
- New `ProgrammeBaseline { id, projectId, version, status DRAFT|APPROVED, approvedBy?, approvedAt? }` + a captured plan snapshot. One APPROVED per project.
- **No change** to `BoqNode`, `WorkPackageBoqNode`, or CONST-PROG-012.

### 8.4 Data flow — single source of truth = DPRs
DPR measurement (per BOQ leaf) → **APPROVED** (verify, ≤ BOQ qty) → verified qty/leaf → leaf % (qty-based) → **WP %** (value-weighted, existing) → project physical % (`progressWeight`-weighted, existing) → S-curve/variance (existing) → Master Schedule row: **planned bar (baseline) vs derived-actual bar + derived %** → milestone readiness (from linked WP %) → **manual Verify** → releases `ContractPaymentInstallment` (existing gate).
- **Derived actuals (recommended):** `actualStart` = earliest approved-DPR measurement date on the WP's leaves; `actualFinish` = the approval/period date WP % hits 100. No manual actual-date entry. *(Confirmable; manual override possible.)*

### 8.5 Non-measurable phases (Mobilization, Design)
A WP with no BOQ scope has no derivable %. **Default:** **schedule-only** — tracked by planned-vs-actual *dates*, excluded from the physical-% weighting (`progressWeight` 0), clearly labelled "manually tracked" (never a silent 0). If it must contribute %, give it BOQ scope or an explicit manual weight.

### 8.6 Invariants
- **Preserved:** CONST-PROG-012 (leaf counted once) — the decisive reason for (ii); verified ≤ BOQ qty; `progressWeight`s sum ≈ 1.0 (`weightsComplete`).
- **New:** WP `plannedEnd ≥ plannedStart` (reuse `validateActivityDates`); derived `actualFinish` only when WP % = 100; exactly one APPROVED `ProgrammeBaseline` per project (mirrors BOQ's single baselined version); variance measured against the APPROVED baseline.

### 8.7 Authorization / transaction / failure
- WP schedule edits: project-scoped (existing `projectAccess.assertMember`). Baseline approve = PM; re-baseline = senior/governed + linked to Variation (**Q-4, pending Eng Ahmed**).
- Derivation is read-side — no new transaction boundary; reuses DPR-approval transactions.
- Failure: no BOQ baseline ⇒ allocation disabled (existing); no targets ⇒ provisional S-curve (existing `baselineProvisional`); empty weights ⇒ surfaced (`weightsComplete=false`).

### 8.8 Migration
Additive nullable columns + one new table + one nullable FK. **Tables are empty in all seeds → near-zero backfill.** Any hand-built prod WP rows stay valid (new columns null). **Loose end to fix:** the stale `getRollup` docstring (`progress.service.ts:384-388`) still says "not money-weighted" — the live code is value-weighted; correct it.

### 8.9 ADR-worthy — draft ADR-029 *(confirm number/path)*
> **ADR-029 — Master Schedule grain = Work Package; progress derived, not entered.**
> **Decision:** the WorkPackage is the schedule/phase row and owns BOQ scope; `ProgrammeActivity` is optional sub-detail; per-phase % and actual dates are **derived from approved DPR measurements, never manually entered**; a BOQ-allocation surface at activity grain is **rejected** because it violates CONST-PROG-012 (a leaf is counted exactly once).
> **Consequences:** master-schedule progress cannot drift from verified reality; adding sub-phase progress later requires revisiting this ADR, not a silent second allocation surface.
> **Alternatives:** Option (i) activity-owns-scope — rejected (new double-count invariant, second allocation UI, manual backfill).

### Verdict: **APPROVED** — Q-6 resolved → Option (ii). P1 is unblocked.
Remaining human decisions (do **not** block P1/P2; needed before P3/governance): **Q-4** (baseline authority — Eng Ahmed); confirm **derive-actuals-from-DPR** (recommended) vs manual; confirm **non-measurable-phase** default (schedule-only).
