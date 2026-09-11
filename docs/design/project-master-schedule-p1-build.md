# P1 Build Spec — Guided Schedule Builder + BOQ-Derived Progress

**Status:** DRAFT for review — no code written yet.
**Date:** 2026-09-08
**Parent design:** `docs/design/project-master-schedule.md` (§4.1, §8 architecture decision — Option (ii), ADR-029).
**Depends on:** §8 APPROVED (WBS grain = Work Package; progress derived from BOQ verification).

---

## 1. What P1 delivers

A **guided way to build a project's Master Schedule** and see it progress **automatically** from Daily Progress Reports — no one types a "% complete." Concretely:

1. **Work packages carry a time window** (planned dates) → they become the schedule/phase rows.
2. **Derived progress per phase** — % complete (already computed) + **derived actual start/finish** (from approved DPRs), surfaced on the Gantt-lite as a plan-vs-actual overlay.
3. **A guided setup wizard** — start from the **"ACCO standard building schedule"** template, assign BOQ scope per phase, set dates, and let the system **suggest weights from assigned BOQ value**. The user is guided at every step, never staring at an empty grid.

**Out of P1** (later phases): milestone→payment bridge UI (P2), baseline freeze/versioning (P3), branded PDF (P4), activity-level (sub-phase) rows, dependencies, manual %-complete entry.

## 2. Grounding — what already exists (compose, don't rebuild)
- `WorkPackage` (`schema.prisma:944-962`): `code, name, responsibleOwner, progressWeight` (fraction). **Date-less today.**
- BOQ scope: join `WorkPackageBoqNode` (`schema.prisma:994-1005`), **one leaf → ≤1 WP** (`@@unique([boqNodeId])`, CONST-PROG-012).
- Derived %: `weightedPackagePercent` = Σ(leaf value × leaf %) ÷ Σ(leaf value) (`progress-rollup.ts:33-52`); leaf % = verified qty ÷ BOQ qty (`progress.service.ts:338-340`); WP→project weighted by `progressWeight` (`getRollup`, `progress.service.ts:394-411`).
- Verified data: approved DPR measurements (`progress.repository.ts:104-109`, `sumVerifiedForNode:87-101`), leaf values (`findLeafValues:147-153`).
- UI: **Plan & Setup** `work-packages-section.tsx` — `CreateWorkPackageForm` + `AllocateForm` ("Allocate item"); **Gantt-lite** `programme/components/activities-section.tsx` (planned bars, grouped by WP); wire types `programme-api.ts`.
- Read-model: package line `construction.ts:288-301`.

## 3. Backend work

### 3.1 Schema migration (additive, nullable — zero backfill; tables empty in seeds)
Add to `WorkPackage` (`schema.prisma:944-962`):
```
plannedStart  DateTime? @db.Date  @map("planned_start")
plannedEnd    DateTime? @db.Date  @map("planned_end")
durationDays  Int?                @map("duration_days")
forecastEnd   DateTime? @db.Date  @map("forecast_end")   // optional PM estimate
scheduleOnly  Boolean   @default(false) @map("schedule_only") // non-measurable phase (no BOQ scope)
```
- **% complete and actual dates are NOT stored** — derived on read (§3.4).
- `scheduleOnly` flags a non-measurable phase (Mobilization, Design): excluded from the physical-% weighting, tracked by dates only, never a silent 0 (§8.5).

### 3.2 Endpoints
- **`PATCH /work-packages/:id`** — accept `{ name?, responsibleOwner?, progressWeight?, plannedStart?, plannedEnd?, durationDays?, forecastEnd?, scheduleOnly? }`. *(Add if no WP PATCH exists today; else extend it.)*
  - Validation: `plannedEnd ≥ plannedStart` (reuse `validateActivityDates` logic, `progress.service.ts`); `durationDays ≥ 0`; if `scheduleOnly=true` the WP must have **no** `WorkPackageBoqNode` links (else 400).
  - Auth: project-scoped (`projectAccess.assertMember`).
- **`POST /projects/:id/programme/apply-schedule-template`** — body `{ templateKey: 'ACCO_STANDARD_BUILDING' }`.
  - Creates the standard phases as work packages in **one transaction**.
  - Guard: only when the project has **zero** work packages (else 409 — don't silently duplicate). Alternative "append" mode is a later option.
- **`POST /projects/:id/programme/suggest-weights`** *(or a query on the rollup)* — returns suggested `progressWeight` per WP = (assigned BOQ value ÷ total assigned BOQ value). Read-only suggestion; the PATCH above persists chosen weights. *(This is the "don't make the user guess weights" helper.)*

### 3.3 The template (`ACCO_STANDARD_BUILDING`)
Server-side constant (single-tenant; configurable later). Phases + suggested durations from ACCO's sample; weights are **not** hardcoded (derived from BOQ value after scope assignment):

| # | Phase (WP name) | Suggested duration | scheduleOnly |
|---|---|---|---|
| 0 | Design Completion (2D & 3D) | 1 week | ✔ (no BOQ scope) |
| 1 | Mobilization & Site Preparation | 1 week | ✔ |
| 2 | Excavation & Foundation Works | 3 weeks | |
| 3 | Ground Floor Structural Works | 1 month | |
| 4 | First Floor Structural Works | 1 month | |
| 5 | Second Floor & Roof Structure | 1 month | |
| 6 | Blockwork, Plaster & MEP First Fix | 1 month | |
| 7 | Finishing Works | 1 month | |
| 8 | External Works, Testing & Handover | 1 month | |

`code` auto-generated (`WP-01…`); `sortOrder` set by sequence.

### 3.4 Derived reads (extend the rollup read-model)
Extend the per-WP rollup (`construction.ts:288-301` / `getRollup`) to include:
- `plannedStart, plannedEnd, durationDays, forecastEnd` (persisted).
- `percentComplete` — the **existing** `weightedPackagePercent` (surface per WP; regression-guard the value-weighting).
- `actualStart` (derived) — earliest approved-DPR measurement date across the WP's leaves. New repo query: min(measurement date) for a leaf set where `dpr.status='APPROVED'`.
- `actualFinish` (derived) — latest approved-DPR measurement date on the WP's leaves **iff `percentComplete === 100`**, else `null`. *(Approximation of "crossed 100"; exact history-replay deferred.)*
- `scheduleStatus` (derived) — per-phase ON_TRACK / AHEAD / BEHIND from planned dates vs derived %/actuals (reuse the project `scheduleStatusFor` bands, `progress-curve.ts`).
- `scheduleOnly` phases: `percentComplete = null` (excluded from the project weighting), status from dates only.

### 3.5 Invariants (preserved + new)
- **Preserved:** CONST-PROG-012 (leaf counted once) — no new allocation surface; verified ≤ BOQ qty; `progressWeight`s ≈ 1.0 (`weightsComplete`).
- **New:** `plannedEnd ≥ plannedStart`; `actualFinish` only when `percentComplete = 100`; `scheduleOnly` ⇒ no BOQ links.
- **Loose end to fix in this PR:** correct the stale `getRollup` docstring (`progress.service.ts:384-388`) that still says "not money-weighted."

## 4. Frontend work — the guided builder

Location: **Progress → Plan & Setup**. Add a **"Set up schedule"** guided flow; the Schedule view renders the result.

### 4.1 Guided setup wizard (the anti-frustration core)
Gate: disabled until a **BOQ baseline** exists (reuse the existing `noBaseline` hint from `work-packages-section.tsx:309`).
- **Step 1 — Start:** choose **"ACCO standard building schedule"** (→ `apply-schedule-template`) or **"Start blank."** Template pre-creates the 8 phases so the user edits, not invents.
- **Step 2 — Assign scope:** per phase, assign BOQ leaves (reuse `AllocateForm`/`POST /work-packages/:id/allocate`). Show live coverage: leaves assigned, **unassigned-leaves warning**, and a "mark as schedule-only" toggle for non-measurable phases.
- **Step 3 — Dates:** per phase `plannedStart/plannedEnd` via `DatePicker` (min/max = project start/expected end). **Auto-suggest**: sequence phases from project start using the template durations, or derive from the monthly `ProgressTarget` curve. User can override.
- **Step 4 — Weights & review:** **"Distribute weights by assigned BOQ value"** action (→ `suggest-weights`) so the user doesn't guess; show the reconcile-to-100% check (`weightsComplete`) and any unassigned scope; **Finish**.

### 4.2 Schedule view (Gantt-lite overlay)
Extend `activities-section.tsx` (or a WP-level sibling) so each **work package is a schedule row**: **planned bar** (baseline dates) + **derived-actual bar** overlaid + a **% chip** + a status dot (ON_TRACK/AHEAD/BEHIND). Sub-phase activities remain optional detail beneath, unchanged.

### 4.3 States
- **No BOQ baseline** → wizard disabled + hint.
- **No schedule yet** → prominent "Set up schedule" CTA (not an empty grid).
- **Partial** → banner: "N phases have no scope / no dates."
- **Complete** → the live Gantt with plan-vs-actual.
- Design-system: `@erp/ui` (`Dialog`, `DatePicker`, `Select`, `Table*`, `Badge`, `EmptyState`), lucide, `next-intl`, 375px + dark verified.

## 5. Slices (each independently shippable; smallest-safe first)
- **P1‑a (backend):** migration (WP dates + `scheduleOnly`) + `PATCH /work-packages/:id` + validation + rollup read-model extended with planned dates + `percentComplete`. Tests. *(No UI yet — verifiable via API.)*
- **P1‑b (backend):** derived `actualStart/actualFinish/scheduleStatus` reads + repo queries. Tests.
- **P1‑c (frontend):** Schedule-view Gantt overlay (planned + derived-actual + % + status) consuming P1‑a/b.
- **P1‑d (backend+frontend):** `apply-schedule-template` + `suggest-weights` + the **guided setup wizard** (Steps 1–4).

Order: **P1‑a → P1‑b → P1‑c → P1‑d.** `pnpm --filter @erp/web type-check` before every web push; rebuild `@erp/types` if wire types change; stage explicit paths (never `git add -A`).

## 6. Tests
**Backend (jest):**
- WP date validation (`plannedEnd ≥ plannedStart`, negative duration rejected).
- `scheduleOnly` requires no BOQ links.
- `apply-schedule-template`: creates the phases in one txn; 409 when WPs already exist.
- Derived `actualStart` = earliest approved measurement; `actualFinish` null until %=100 then set.
- `percentComplete` value-weighted regression (guard the `weightedPackagePercent` result; the 1-lot@100% + 10,000 m³@5% ≈ 5% example).
- `suggest-weights` = assigned value ÷ total assigned value; sums to ~1.0.
**Frontend (vitest + browser QA):**
- Wizard step flow, template apply, scope assignment, date auto-suggest within project bounds, weight distribution + reconcile-to-100.
- Gantt overlay renders planned + derived-actual + % + status; scheduleOnly phase shows dates only, no %.
- States: no-baseline (disabled), no-schedule (CTA), partial (banner), complete.
- 375px + dark.

## 7. Files likely touched
- **api:** `prisma/schema.prisma` (WorkPackage) + migration; `business/construction/progress/progress.controller.ts` + `progress.service.ts` + `progress.repository.ts` + `progress.dto.ts`; `progress-rollup.ts`/`progress-curve.ts` (reuse); read-model `construction.ts`.
- **web:** `features/progress/components/work-packages-section.tsx` (+ new wizard component); `features/programme/components/activities-section.tsx` (WP-row overlay) + `programme-api.ts`/hooks; `messages/en/progress.json` + `programme` labels.

## 8. Open confirmations (recommended defaults; do NOT block starting P1‑a)
- **Derive actual dates from DPRs** (recommended, assumed here) vs manual actual-date entry.
- **Non-measurable phases = schedule-only** (recommended, assumed) vs a manual % field.
- Template phase list/durations above — confirm ACCO's canonical set (Design phase 0 in or out).

*(Q-4 baseline authority and the full milestone→payment bridge are P3/P2 — not needed for P1.)*
