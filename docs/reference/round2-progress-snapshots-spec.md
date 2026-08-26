# Capability spec — Progress over time (snapshots + planned baseline)

Status: **Spec (backend-gated on one domain answer).** Senior-engineer decision recorded; the
planned-baseline *source* is pending Eng Ahmed (`docs/backend-requests/ceo-memo-progress-baseline.md`).
Owner authorized full-stack build.

## What it unlocks
One capability — a time series of progress + a planned baseline — turns two flat Progress views into
real project-control screens:
- **Performance** → a planned-vs-actual **S-curve** + "ahead/behind" schedule signal (today: 3 tiles).
- **Verified Progress** → **period-over-period** comparison (this month vs last, Δ) per BOQ line
  (today: a single as-of table).

It builds on ADR-021, which already computes the *live* numbers (weighted physical rollup, verified
%-per-leaf, the physical-vs-financial signal). The only genuinely new things are: **freeze those
numbers at points in time**, and **a planned line to compare against.**

## The three domain inputs (from the CEO memo) and how each shapes the build

| Decision | Effect on the build |
|---|---|
| **1 — planned baseline source** (A programme dates+weights / B manual %/period / C contract-dates curve) | Determines the `ProgressBaseline` shape. **A** ⇒ add planned start/finish to `WorkPackage`, derive+freeze the curve; **B** ⇒ store entered `{periodEnd, plannedPercent}` rows; **C** ⇒ compute on the fly from `Project.startDate/expectedEndDate`, no storage. **Everything else below is identical.** |
| **2 — frozen baseline?** (recommended yes) | If yes, `ProgressBaseline` is immutable; re-planning writes a *new* baseline version (auditable), old one retained. |
| **3 — snapshot cadence** (recommended month-end close) | Where the capture is triggered (period-close hook vs on-demand endpoint). |

**Nothing about the read side or the frontend depends on these** — they only change how the two
series are *sourced*. So the actuals half + the read contract + the UI can be built now; the baseline
source is a small, swappable module finalized when Eng Ahmed answers.

---

## Backend (apps/api — Abdulsalam's domain; new ADR)

### Model — `ProgressSnapshot` (immutable)
Per project, per period. Freezes the numbers ADR-021 already computes:
```
ProgressSnapshot {
  id, projectId,
  periodEndDate        // the "as of" date (month-end)
  accountingPeriodId?  // link when captured at period close
  physicalPercent      // weighted work-package rollup at capture time
  verifiedPercent      // verified-to-date / measurable, overall
  costConsumedPercent? // from the physical-financial signal (null when no cost data)
  source               // PERIOD_CLOSE | MANUAL
  capturedAt, capturedBy
  @@unique(projectId, periodEndDate)   // one snapshot per project per period
}
```
Immutable once written (progress can be restated via DPR reopen — ADR-021 CONST-PROG-010 — so the
snapshot is the auditable "as reported at close" record, deliberately *not* recomputed later).

### Model — `ProgressBaseline` (per Decision 1; frozen per Decision 2)
The planned cumulative % over time. Stored as a version + a series:
```
ProgressBaseline { id, projectId, version, setAt, setBy, source, note }
ProgressBaselinePoint { baselineId, periodEndDate, plannedCumulativePercent }
```
- **Option A:** on "set baseline," derive the series from work-package planned start/finish + weights
  (spread each weight linearly — or an S-curve — across its planned span), freeze the points. Requires
  `WorkPackage.plannedStartDate/plannedEndDate` (new nullable fields).
- **Option B:** the points are entered directly by the PM.
- **Option C:** no rows — the series is computed on read from `Project.startDate → expectedEndDate`
  (linear or a standard S-curve); a "provisional baseline" flag tells the UI it's the placeholder.

### Capture trigger (per Decision 3)
- **Month-end close (recommended):** extend `POST /periods/:id/close` — after the accounting close
  succeeds, compute + persist a `ProgressSnapshot(source=PERIOD_CLOSE)` for each active project (or
  the project being closed against). Reuses the existing period-close pre-flight pattern.
- Also expose `POST /projects/:id/progress/snapshots` (source=MANUAL) for an on-demand capture, gated
  by a progress-manage permission.

### Read endpoints (build now — source-agnostic)
- `GET /projects/:id/progress/curve`
  → `{ baseline: { periodEndDate, plannedPercent }[], actual: { periodEndDate, physicalPercent, verifiedPercent, costPercent }[] , scheduleVariancePercent, status }`
  where `status ∈ AHEAD | ON_TRACK | BEHIND | INSUFFICIENT_DATA` (behind = actual physical < planned
  at the latest snapshot by more than a small band). Feeds the Performance S-curve.
- `GET /projects/:id/progress/period-comparison?asOf=<periodEndDate>`
  → per BOQ leaf `{ code, description, previousPercent, currentPercent, deltaPercent }` + an overall
  row. Uses two snapshots (the asOf period and its predecessor). Feeds Verified period comparison.

All reads are tenant/project scoped; permission-gated like the rest of the progress module.

---

## Frontend (apps/web — consumes the above)

### Performance view (`performance-section.tsx`)
- Add a **planned-vs-actual S-curve** — a small token-styled SVG line chart (single-hue, like the
  StatTile sparkline but with axes/labels): planned line + actual physical line over `periodEndDate`.
- Add a **schedule-status** chip from `status`/`scheduleVariancePercent` (Ahead / On track / Behind).
- **Keep** the existing physical-vs-financial signal (cost divergence) and the metric strip.
- Honesty: `INSUFFICIENT_DATA` (no baseline or <2 snapshots) → "The progress curve begins after the
  first month-end close." — no fabricated line.

### Verified view (`verified-progress-section.tsx`)
- Add a **period selector** (populated from available snapshots) and **Previous / Current / Δ**
  columns to the BOQ table, from `period-comparison`.
- Default to the latest closed period; if only one snapshot exists, show current-only with a note.

### Reusable
- A small `ProgressCurveChart` (or extend the StatTile sparkline into a labeled `LineChart`) in
  `@erp/ui` or `apps/web` — single-hue accent, tokens only, dark-mode + 375 safe (charts scale, never
  force page width). Data-viz uses the `--chart-*` ramp, not the semantic status colours.

---

## What's certain now vs gated
- **Build now (no domain answer needed):** the `ProgressSnapshot` model + the manual-capture endpoint
  + both read endpoints + the whole frontend (curve chart, period comparison, honest empty states).
  The actual series is fully derivable from what ADR-021 already computes.
- **Gated on the memo:** the *baseline source* (A/B/C → which `ProgressBaseline` path), whether to add
  `WorkPackage.plannedStart/End` (A only), and wiring capture into period-close vs manual-only.

## Sequencing
1. **Backend BE-1:** `ProgressSnapshot` + manual-capture endpoint + the two read endpoints + tests.
   (Baseline returns provisional Option-C curve until the memo lands — honest, unblocks the frontend.)
2. **Frontend FE-1:** Performance S-curve + Verified period comparison against BE-1, with the
   insufficient-data states.
3. **BE-2 (after memo):** the confirmed baseline source (A/B), `WorkPackage` planned dates if A,
   period-close capture hook, frozen re-baseline.

This lets us ship a real, honest Performance/Verified upgrade immediately (Option-C provisional
baseline + manual snapshots), then swap in the confirmed baseline without touching the read contract
or the UI.
