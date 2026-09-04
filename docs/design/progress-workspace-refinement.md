# Progress Workspace — Product & UI Redesign Spec

**Status:** AGREED 2026-09-04 (all open decisions resolved — see §9) — building
**Date:** 2026-09-04
**Author:** design pass with Abdulsalam
**Scope (agreed):** Option (b) — full UX/UI redesign of the Progress tab **plus** closing the two dark-backend gaps: the **baseline-target** entry UI and the **programme activities / full schedule (WBS)** UI. Performance-first IA with a headline band and a separated Plan & Setup area. Surface separation of duties. Structured inputs (no blank guessing). Media (photo/video) evidence.

Companion analysis: this spec assumes the end-to-end trace already agreed in conversation (frontend `apps/web/src/features/progress/**` + `apps/web/src/features/programme/**`, backend `apps/api/src/business/construction/progress/**`, ADR-021 / ADR-023).

---

## 0. Doctrine to preserve (do not dilute)

These are the load-bearing decisions from ADR-021 the redesign must keep intact:

- **Four separated truths, one surface.** Plan (Programme) · What happened (DPR site record) · What is trusted (Verified progress) · How we're tracking (Performance). Never collapse into a single composite "83% healthy" score.
- **Physical progress is weight-based, never money-weighted** (CONST-PROG-007). Cost never drives physical %.
- **Commercial firewall** (CONST-PROG-015). Verified progress *suggests* an IPA claim; a QS confirms; nothing auto-bills.
- **Approved progress is immutable** except via controlled, audited reopen (CONST-PROG-010).
- **Cumulative ≤ BOQ scope** (CONST-PROG-009); excess is surfaced, never silently capped.
- **Honest data viz.** A single data point is a dot, not a trend line. Insufficient data says so.

The redesign changes *presentation, wayfinding and completeness of the surface* — not these rules.

---

## 1. Design-system rules for this work

**Source of truth = this repo's own system**, not the generic Meridian skill:

- Tokens: `apps/web/src/app/globals.css` (colors `bg-surface` / `text-foreground` / `text-muted-foreground` / `border-border` / semantic `success|warning|danger` + `-subtle` / `chart-1` / `chart-2`; type `text-h1..text-micro`; radii `rounded-control|panel|container`; elevation `shadow-e1|e2|e3`; density `h-control|h-row`).
- Components: `@erp/ui` (`packages/ui/src`). Reuse — do not re-roll: `Button` (default/outline/ghost/destructive), `Badge` (neutral/info/live/accent/warning/danger/historical), `Alert`, `Table*`, `Dialog`, `Popover`, `Select` (auto-upgrades to `Combobox` ≥10 items), `DatePicker`, `ViewSwitcher`, `Tabs`, `SectionHeader`, `StatTile`, `FormField/FormSection`, `Textarea`, `MoneyInput`, `ApprovalChain/Timeline/DecisionPanel`, `useToast`.
- App patterns: `MetricStrip`, `EmptyState`, `SetupChecklist`, `ProgressStepper`, `StatusBadge` (raw status → tone via `formatStatus`), `ConfirmActionDialog`, `RecordLayout/RecordHeader`.
- Doctrine: `docs/reference/ux-doctrine.md` (one primary action per screen; hairlines over boxed cards; level-3 = `ViewSwitcher`, level-2 = `Tabs`; tables scroll internally; comprehensive field states).

**"Change colors/states to look more professional"** is interpreted as: (a) use the existing semantic tokens *consistently* across all Progress statuses; (b) fix the chart series semantics; (c) complete the state coverage (first-run, provisional, insufficient); (d) add **3 missing primitives** (see §6). It is **not** a new palette.

---

## 2. The core reframe

**Before:** one flat `ViewSwitcher` of 5 equal views — Daily Reports · Work Packages · Verified · Milestones · Performance — landing on the *data-entry log*, with the actual answer (Performance) last, the planned line permanently provisional (no baseline UI), and a whole activities capability invisible.

**After:** the tab answers one question on arrival — *"Where are we vs plan, and can we trust it?"* — then offers the record and the setup behind it, cleanly split into **read / record / plan**.

```
BEFORE                              AFTER
Progress                            Progress
[Reports][WorkPkg][Verified]        ┌─ Headline band (always on): % physical · schedule · signal
[Milestones][Performance]           │
  └ lands on Reports (entry)        ├─ [ Performance ] ← default (the answer)
                                    ├─ [ Record ]        DPRs + detail (the log)
                                    ├─ [ Verified ]      per-BOQ trust table
                                    ├─ [ Schedule ]      milestones + activities/WBS (NEW)
                                    └─ [ Plan & Setup ]  work packages · weights · allocation · baseline (NEW)
```

Rationale: **reader-first ordering** (most opens are to read, not record); **setup separated from operation** so a reader never has to understand the control model to read a number; **the answer leads**.

---

## 3. Information architecture

### 3.1 Headline band (new, always visible above the switcher)

A single row of `StatTile`s (or `MetricStrip` on narrow) reading the *same* ADR-021 signals the Overview card reads, so Overview and Progress can never disagree:

| Tile | Value | Detail / tone |
|---|---|---|
| **Physical progress** | weighted `physicalPercent` % | `—` + reason if weights incomplete / no data |
| **Schedule** | `AHEAD / ON TRACK / BEHIND` + variance pp | tone: live / neutral / warning-danger |
| **Physical vs cost** | divergence pp | tone from signal status; `—` if no cost data |
| **Verified coverage** | verified-to-date % of scope | neutral; links to Verified view |

- Weights-incomplete or provisional-baseline conditions surface here as a single quiet inline note, not repeated in every view.
- This is the only place physical % is a *headline*; Work Packages / Verified show it as *detail*, resolving the "same number in 4 places" problem.

### 3.2 Views (level-3 `ViewSwitcher`, default = Performance)

1. **Performance** — S-curve (planned vs actual vs verified), schedule variance, the two divergence signals. Snapshot capture lives here.
2. **Record** — DPR list → DPR detail (measurements + media evidence + lifecycle). The only data-entry-heavy view.
3. **Verified** — per-BOQ-leaf trust table + period-over-period comparison.
4. **Schedule** *(NEW surface)* — milestones + programme activities as a WBS/Gantt-lite grouped by work package.
5. **Plan & Setup** *(reframed + NEW baseline editor)* — work packages, weights, BOQ allocation, and the **baseline-target curve editor**.

### 3.3 Wayfinding / first-run (new)

A project is not usable until BOQ is baselined → work packages exist with weights → leaves allocated → (baseline set) → DPRs recorded & approved. Today a fresh project lands on an empty log with no guidance.

Add a **setup gate**: when `physicalPercent` has no basis (no work packages / no allocation), the tab shows a `SetupChecklist` instead of empty widgets:

```
Set up progress tracking for this project        2 of 5 done
✔ BOQ baselined
✔ Work packages created
◻ Assign a weight to each work package        (weights total 60% — need 100%)
◻ Allocate BOQ items to work packages         (12 of 40 leaves allocated)
◻ Set the planned baseline                     (optional — improves the curve)
```

Each item deep-links to the exact editor. Once complete, the checklist collapses to a one-line "Setup complete — edit in Plan & Setup".

---

## 4. Tab-by-tab design

### 4.1 Performance (new default)

**Purpose:** answer "on track?" in one screen.

**Layout (top→bottom):**
1. **Schedule strip** — `StatTile`s: planned % today · verified actual % · variance pp + `Badge` status. If baseline is provisional, a `Badge tone="accent"` "Provisional baseline" with a link to set it.
2. **S-curve** (`ProgressCurveChart`, kept + retuned per §6.2): planned (dashed, muted), actual physical (solid `chart-1`), verified (solid `chart-2`, faint). Legend + accessible summary as today.
3. **Signals** — two `Alert`/signal rows: physical-vs-financial and collection-vs-progress (the latter currently only lives on Finance/P&L — surface a read-only copy here too, single source component).
4. **Snapshot action** — `Record progress snapshot` (permission-gated, kept). Add a small "Last snapshot: {date}" caption and, when period-close capture is wired, a note that month-end auto-captures.

**States:** insufficient-data (kept) · provisional-baseline (retune copy: "planned line is an estimate until a baseline is set — [Set baseline]") · error/retry (kept).

**Forms:** none except snapshot capture (stays a one-click action + optional date `Popover`; toast on success — keep).

---

### 4.2 Record — Daily Reports + DPR detail

**Purpose:** the site log. This is the operational heart and needs the most input polish.

#### 4.2.1 DPR list
- Keep the index-first table (Date · Status · Labour · Prepared by). Add a **Status filter** (`SavedViews`: All / Draft / Awaiting approval / Approved / Returned) so a PM can jump to "Awaiting approval".
- Status via `StatusBadge` mapping (§6.1). Row → detail.
- Primary action: `New daily report` (dialog).

#### 4.2.2 Create DPR — **stays a dialog**, redesigned form
The create dialog captures only the *header*; measurements + media are added in the draft detail (fast daily flow, no giant modal).

| Field | Control | Default | Notes |
|---|---|---|---|
| Report date | `DatePicker` | **today** | required; `max=today` (can't report the future) |
| Weather | **`Select`** (was free text) | **"Clear"** or last report's value | bounded taxonomy §5.2 — no typing "rainy"/"Rainy" |
| Temperature band | `Select` *(optional)* | — | e.g. `<25° / 25–32° / 33–38° / >38°` (hot-climate bands) — pending confirm |
| Labour on site | number | — | `min=0`; optional |
| Equipment on site | `Textarea` (1 row) | — | optional |
| Work performed | `Textarea` | — | optional narrative |
| Delay / disruption | **structured** (was free text) | **"No delay"** | category `Select` §5.2 + detail text shown only if category ≠ "No delay" |

On create → open the draft DPR detail focused on measurements.

#### 4.2.3 DPR detail — measurements + media + lifecycle
- **Header:** `RecordHeader`-style — date, `StatusBadge`, prepared-by; actions by state (Submit / Approve / Return / Reopen).
- **Lifecycle strip (NEW):** a compact `ApprovalChain` — `Prepared (X) → Submitted → Approved`. Makes provenance and the raise/approve split visible (see §7).
- **Measurements — inline (keep), improved:**
  - BOQ picker → **`Combobox`** (searchable; BOQ can be long), showing `code · description · unit`.
  - On pick, show **remaining scope inline**: "Scope 100 m³ · verified to date 40 · this report ⟶" so the user never guesses against the cap (pre-empts the CONST-PROG-009 rejection).
  - Quantity (number, 3dp) + notes. Add-to-table pattern (keep).
- **Evidence — media-first (NEW `MediaUpload`, §6.3):**
  - Multi-file **drag-drop** zone, `accept="image/*,video/*"`, thumbnails for images, filename + duration + play glyph for video, per-file progress + remove + retry.
  - Rendered as a **gallery grid**, not "Evidence file 1/2/3". Lightbox on click; download retained.
  - Copy: "Photos and short videos of the day's work. A photo shows work happened, not the exact quantity."
- **States:** approved → read-only with the existing success note; reopened → editable + audit reason banner.

**Approve / Return / Reopen** stay **dialogs** (`ConfirmActionDialog`): approve spells out consequences; return + reopen require a reason (keep).

---

### 4.3 Verified Progress

**Purpose:** the trusted per-line picture.
- Keep the per-BOQ-leaf table (Code · Description · Scope · Verified-to-date · % complete) + period comparison.
- Add a small `MetricStrip`: overall verified % · # leaves with progress · # fully complete. (Detail, not headline — headline is the band.)
- Read-only. Empty: "Approve a daily report to see progress here." (keep).

---

### 4.4 Schedule (NEW surface — closes the activities gap)

**Purpose:** make the built-but-invisible programme layer usable: milestones **and** activities as a WBS, with a light timeline. Backend CRUD already exists (`/programme/activities`, `/programme/milestones`).

**Layout:**
1. **Milestones** (moved here from the old peer view): table (Code · Name · Baseline · Forecast · Actual · Variance · Status). Create **inline** (keep), verify = **dialog** (default today). Milestone → billing link stays a Commercial concern; show a read-only chip "Bills installment: {name}" when linked.
2. **WBS / activities (NEW):** grouped by work package (`SectionHeader` per package), each with its activities (Code · Name · Planned start → end · Duration · Milestone flag). 
   - **Gantt-lite:** a horizontal timeline bar per activity across the project date range, using `chart-1` bars on a hairline grid (SVG, responsive, 375-safe by scrolling internally). This is the "full schedule view."
   - Editing: **inline row** add/edit within each package group for speed, plus a right-side **drawer** (`LifecycleCommandDrawer` pattern) for a single activity's full fields. Delete behind confirm.
   - No dependency network (FS/SS/FF/SF) — explicitly deferred per ADR-021; the timeline shows planned bars only.

**Inputs:** dates → `DatePicker` bounded to project start/end (avoid nonsense dates); duration auto-derives from start/end (read-only) or is entered when dates are open; `isMilestone` → `Checkbox`.

**States:** no work packages → point to Plan & Setup; work packages but no activities → inline "Add the first activity for {package}".

---

### 4.5 Plan & Setup (reframed — closes the baseline gap)

**Purpose:** the one place project setup lives, clearly labeled as configuration.

**Layout:**
1. **Work packages** — table (Code · Name · Owner · Weight · Items · % complete) with the `PercentCompleteBar` (keep). 
   - Create **dialog**, improved: **Code auto-suggested** `WP-0N`; **Owner → `Select` of project team members** (from the Team tab) instead of free text; **Weight** number with a live helper "**remaining to reach 100%: {x}**" so the user never guesses the total.
   - Weights-incomplete surfaces here as the actionable place to fix it (not scattered).
2. **Allocation** — allocate BOQ leaves to packages. Improve the dialog to **multi-select unallocated leaves** in one pass, and show an "Unallocated ({n})" counter so coverage is visible. Prevent double-count (keep unique constraint; grey out already-allocated leaves).
3. **Baseline target curve (NEW editor — highest-value gap):**
   - An inline editable table of `{ date, cumulative % }` rows (add/remove row), validated non-decreasing / 0–100 / unique dates (mirrors `PUT /programme/targets`).
   - **Never start empty:** offer starters so the user picks, not guesses — "Generate monthly points (linear)" from project start→end, or "Derive from milestones". User then adjusts.
   - A tiny preview sparkline of the entered curve.
   - Once saved, the Performance S-curve's planned line becomes **real** and the "provisional" chip disappears.

**Forms strategy here:** work-package + allocation = **dialog** (discrete actions, keep the tables in view); baseline = **inline editor** (multi-row edit benefits from seeing all rows at once).

---

## 5. Forms & inputs doctrine

### 5.1 Dialog vs inline (decisions)

| Form | Pattern | Why |
|---|---|---|
| Create DPR (header) | **Dialog** | index-first; list leads, form behind the primary button |
| Add measurement | **Inline** | one-by-one additions to a table; a dialog per row is friction |
| Media evidence | **Inline** (drag-drop zone) | added continuously while drafting |
| Approve / Return / Reopen DPR | **Dialog** | high-consequence, needs confirmation / reason |
| Create work package | **Dialog** | focused; keeps roll-up metrics visible |
| Allocate BOQ | **Dialog** (multi-select) | discrete batch action |
| Baseline target curve | **Inline editor** | multi-row edit; see all points together |
| Create activity | **Inline row + drawer** | fast add in-context; drawer for full detail |
| Create milestone | **Inline** | few, added occasionally, above the table |
| Verify milestone | **Dialog** | discrete, high-stakes; default = today |

### 5.2 Structured, not free-text — "no blank guessing"

Principle: **every field is defaulted, chosen from options, or explicitly optional; the UI never presents an ambiguous blank the user has to invent an answer for.** Every empty *metric* states why it's empty (`StatTile.unavailableReason`, `—`).

**Weather** → `Select` (proposed hot-climate / Banaadir taxonomy; confirm with Eng Ahmed):
`Clear · Sunny/Hot · Partly cloudy · Overcast · Light rain · Heavy rain · Thunderstorm · Windy · Dust / haze · Fog`. Default to "Clear" or carry the previous report's value.

**Delay / disruption** → category `Select`, default **"No delay"**:
`No delay · Weather · Material shortage · Labour shortage · Equipment breakdown · Client instruction · Design change/RFI · Site access restriction · Utilities/services · Permit/authority · Other`. Free-text detail appears only when category ≠ "No delay". (This also seeds future DelayEvent/EOT analysis cleanly instead of unparseable prose.)

**Work-package owner** → `Select` of project team members (not free text).

**Defaults to add:** WP code `WP-0N`, milestone code `MS-0N`, DPR date = today (keep), verify date = today (keep), delay = "No delay", baseline starter = generated linear points.

### 5.3 Media evidence spec (photo + video)

- Component: new `MediaUpload` (`@erp/ui` or app-level, §6.3).
- Accept `image/*, video/*`; multiple; drag-drop + click.
- Per file: thumbnail (image) / poster+play (video), name, size, progress bar, remove, retry-on-fail.
- Size limits (proposed, confirm): image ≤ 15 MB, video ≤ 150 MB; reject over-limit *before* upload with a clear message.
- Flow reuses existing presign → PUT → confirm (`useFileUpload`) then `POST /progress/reports/:id/evidence { platformFileId }` per file.
- Gallery grid in DPR detail; lightbox; download retained.
- **Backend check needed:** confirm object-storage/presign allows video MIME + the proposed size ceiling; confirm the deployment note "file serving endpoint" is live (deployment memory flagged MinIO/file uploads as deferred — must verify before promising video).

---

## 6. System-design refinements (colors, states, primitives)

### 6.1 Status → tone, unified (via `StatusBadge`/`formatStatus`)
- **DPR:** DRAFT `neutral` · SUBMITTED `info` · APPROVED `live` · RETURNED `warning` · REOPENED `accent`.
- **Schedule:** AHEAD `live` · ON_TRACK `neutral` · BEHIND `warning` (→ `danger` past a larger threshold) · INSUFFICIENT_DATA `neutral`.
- **Signals:** ALIGNED `live` · COST_AHEAD `warning` · PROGRESS_AHEAD `info` · INSUFFICIENT_DATA `neutral`.
- One mapping, not per-component hand-rolling.

### 6.2 Chart series semantics (S-curve)
- Planned/baseline = `muted-foreground`, **dashed** = reference line. When **provisional**, keep dashed + lighter opacity + an "estimate" legend note; when **real** (baseline set), dashed but full opacity + "Planned (baseline)".
- Actual physical = `chart-1` solid (primary).
- Verified = `chart-2` solid, ~70% opacity (secondary).
- Single point → dots only (keep). Zero points → insufficient-data state (keep).

### 6.3 New primitives to build (3)
1. **`MediaUpload`** — multi-file image/video drag-drop with thumbnails/progress (§5.3). *No equivalent exists.*
2. **Headline `StatTile` row usage** — not new code, but a Progress-specific composition; ensure `unavailableReason` used for every empty tile.
3. **`GanttLite`** (Schedule) — SVG planned-bar timeline grouped by work package, responsive/internal-scroll. *No equivalent exists.*

Everything else reuses existing `@erp/ui` / app components.

### 6.4 State coverage to complete
Add/verify these states everywhere: **first-run/unconfigured** (`SetupChecklist`), **provisional baseline**, **insufficient data**, **weights incomplete** (single actionable location), **permission-hidden** actions (keep honest hiding), loading `Skeleton*`, error+retry.

---

## 7. Separation of duties (surface now, enforce later)

Today any `manage:project` member can raise *and* approve a DPR; workflow enforcement is optional and may be unconfigured. The document that becomes trusted verified progress + pre-fills billing should not be silently self-approvable.

**This round (UI-visible, no backend change):**
- DPR detail shows the `ApprovalChain` (Prepared → Submitted → Approved) so provenance is explicit.
- If the current user is the preparer/submitter, show a soft inline warning on the Approve dialog: *"You prepared this report. Approving your own report may need a second reviewer."* (non-blocking).

**Deferred (needs Eng Ahmed + workflow binding):** hard separation (preparer ≠ approver) enforced via the governance engine, and a first-class role split (Site engineer records · PM/QS approves).

---

## 8. Gap-closing — backend touchpoints

- **Baseline targets UI:** backend is **ready** (`GET/PUT /projects/:id/programme/targets`, validation, schedule-variance math). Pure frontend build. Wiring the real baseline also lets Performance drop "provisional" and lets `getScheduleVariance` use the real curve instead of the Option-C ramp.
- **Activities/WBS UI:** backend is **ready** (full CRUD `/programme/activities`, `/work-packages/:id/activities`). Pure frontend build + `GanttLite`.
- **Media/video:** verify storage/presign + file-serving endpoint are live in the target environment before promising video (deployment note flagged uploads deferred).
- **Period-close auto-snapshot & activity-date→planned-% derivation:** out of scope this round (ADR-021 BE-2 seams; still gated on Eng Ahmed's baseline-source decision).

---

## 9. Decisions — RESOLVED 2026-09-04

1. **Weather taxonomy** — ✅ accepted proposed hot-climate list (§5.2) + optional temperature band.
2. **Delay taxonomy** — ✅ accepted proposed category list (§5.2); seeds future delay/EOT analysis. (Eng Ahmed may refine labels later; build with these.)
3. **Baseline entry model** — ✅ `{date, cumulative %}` monthly-points editor with "generate linear / derive from milestones" starters. Option A (work-package planned dates) NOT taken this round.
4. **Media / video** — ✅ **build against MinIO now even though the deployed environment isn't wired to serve files/video yet.** The upload + attach + gallery are built and tested against MinIO; production serving is a separate deployment task, not a blocker for this work. Size ceilings: image ≤ 15 MB, video ≤ 150 MB (revisit if storage says otherwise).
5. **Separation of duties** — ✅ soft-warn now (visible chain + "approving your own report" warning); hard preparer≠approver enforcement deferred to the workflow engine.
6. **Schedule depth** — ✅ planned-bar Gantt-lite (no dependency arrows) is enough for "full schedule view" this round; dependencies deferred.

---

## 10. Proposed build slices (after design sign-off)

1. **IA shell + headline band** — reorganize `progress-tab.tsx` to Performance-default + 5 views; add the `StatTile` headline band; wire the setup-gate `SetupChecklist`.
2. **Performance polish** — chart series retune, surface both signals, provisional/insufficient copy.
3. **Record polish** — DPR create dialog with structured weather/delay + defaults; measurement `Combobox` + remaining-scope; lifecycle `ApprovalChain` + soft SoD warning.
4. **Media** — `MediaUpload` + gallery (after backend/video verification).
5. **Plan & Setup** — work-package/owner/weight improvements, multi-select allocation, and the **baseline-target editor**.
6. **Schedule** — milestones move + activities WBS + `GanttLite`.

Each slice: `pnpm --filter @erp/web type-check` before push; browser-QA at 375px + dark.

---

*End — awaiting review. Nothing built yet.*
