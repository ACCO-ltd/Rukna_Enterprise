# BOQ Workspace Redesign — Frontend Design (R11)

**Status:** DESIGN — 2026-09-10, chosen via `/design-an-interface` (design-it-twice, 4 parallel
concepts → synthesis). Owner-approved direction. Builds R11 (#201) against the R10 read models.
Supersedes the "first idea" UI proposal in `boq-workspace-redesign.md` §4.

## 0. The principle (governs every decision below)

> **Excel-level speed, ERP-level control.**

The screen must feel like **"a professional BOQ workspace,"** never **"four design concepts glued
together."** Synthesis is a **hierarchy**, not a feature pile:

| Layer | Role | Source concept | Attention |
|---|---|---|---|
| **PRIMARY** | the spreadsheet BOQ grid — the one interaction surface | C | ~80% |
| **SECONDARY** | a **compact, sticky financial strip** (one line, not a dashboard) | A | support |
| **STATE** | WORKING vs COMMITTED are genuinely different modes | B | support |
| **ON DEMAND** | Compare-to-Signed + Timeline/History — a lens / a drawer, never permanent chrome | D | summoned |

## 1. Frozen decisions (owner-locked)

1. **The grid is the primary interaction surface.** Everything else supports it.
2. **The money strip is compact and sticky, not a dashboard** (Excel frozen-header feel; one line).
3. **WORKING and COMMITTED are genuinely different modes** (chrome, primary action, edit rules differ).
4. **Committed monetary cells cannot be directly overwritten** (the pin).
5. **Value-changing edits trigger the who-pays decision** (Absorb / Variation / Separate classifier).
6. **Compare-to-Signed is one click away** (a diff *lens over the grid*, not a separate screen).
7. **Timeline/history is a drawer / secondary view** — never permanently occupying ~320px.
8. **Sensitive money obeys the visibility tiers** already built (`canViewCost` / `canViewMargin`).
9. **No v1/v2/v3 vocabulary** for normal users — say **Working, Signed, Changed, Variation**.
10. **Support Excel muscle memory without becoming an uncontrolled spreadsheet** (the "control" half of the principle).

## 2. Layout

### 2a. COMMITTED · Commercial-Exec tier
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ● Committed   Contract $2,412,000 ▲+$72k (signed $2,340k) · Contingency $78k left · Rev $2,562k │ ← compact STICKY strip (A)
├───┬────────┬──────────────────────────────┬──────┬───────┬──────────┬──────────┬───────────┤
│ ⌘ │ Code   │ Description                  │ Unit │ Qty   │ Rate     │ Amount   │ Tag / ⚑   │ ← GRID (C) = 80% of the screen
├───┼────────┼──────────────────────────────┼──────┼───────┼──────────┼──────────┼───────────┤
│ ▾ │ 2      │ Superstructure               │      │       │          │ $1,052k  │  §        │
│   │ 2.1    │ Columns C1–C8                │ m³   │ 320   │ $850 🔒  │ $272,000 │           │ ← 🔒 pinned value cell
│   │ 2.4    │ Steel canopy                 │ m²   │ 80    │ $900     │ $72,000  │  ⬦ VAR-3  │ ← variation-tagged
│   │ 2.5    │ Extra rebar                  │ kg   │ 1,500 │ $4       │ $6,000   │  ⊙ Absorb │ ← funded from contingency
│ ▾ │ 9      │ Contingency                  │      │       │          │ $78,000  │  ◆ −$42k  │
│   │ ⊕ type code to add extra work…                                             │           │ ← ghost row → classifier
├───┴────────┴──────────────────────────────┴──────┴───────┴──────────┴──────────┴───────────┤
│ Selected 0    [ Compare to signed ]  [ Timeline ]              [ + Add extra work ▸ ]        │ ← action bar; D is summoned here
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ⌘K commands · ⇥ next cell · ⏎ next row · ⌃D fill-down · right-click row actions
```

### 2b. WORKING · Commercial-Exec tier
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◐ Working · draft   Planned $2,340,000 · 94% priced (6 unpriced ⚑) · Contingency $120k       │ ← strip: working total + priced%
├───┬────────┬──────────────────────────────┬──────┬───────┬──────────┬──────────┬───────────┤
│ ⌘ │ Code   │ Description                  │ Unit │ Qty   │ Rate     │ Amount   │ ⚑         │
│   │ 2.3    │ Blockwork          ⚑ no rate │ m²   │ 2,100 │ — ✎      │ —        │  ⚑        │ ← flagged; rate cell primed
│   │ ⊕ type code to add a line…                                                 │           │ ← ghost row (free add)
├───┴────────┴──────────────────────────────┴──────┴───────┴──────────┴──────────┴───────────┤
│ 148 lines · 138 priced        [ Import ]                       [ Commit to contract ▸ ]      │ ← primary = Commit (enabled at tie-out)
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Same grid skeleton; only the **strip contents**, the **primary action**, the **cell edit rules**, and
the **Tag column's existence** change between modes.

## 3. Interaction model

- **Build & price (grid, keyboard-first).** Ghost row at the bottom of each open section: `code ⇥
  desc ⇥ unit ⇥ qty ⇥ rate ⏎` → row commits, fresh ghost row appears, cursor back to Code. `⌃D`
  fill-down; paste a TSV block from Excel (same per-cell validation as typing — a bad rate lands as a
  flagged cell, never a silent 0). Amount is derived (`qty×rate`), never typed. Collapse sections
  (`▾/▸`, `⌃←/⌃→`) to fold the BOQ to its section shape.
- **Compact sticky strip (A).** One line, frozen like an Excel header. Shows only the tier-appropriate
  `BoqMoneyBand` figures. It is a *status readout*, not a dashboard — editing a cell nudges the
  relevant figure so cause→effect stays legible, but it never grows into cards.
- **Commit (WORKING→COMMITTED).** Primary `Commit to contract`, enabled only when the tie-out/readiness
  passes (disabled state names the first blocker; `⌃⚑` jumps to flagged cells). A **governed confirm
  strip** slides from under the money strip (not a heavy typed-ceremony) stating exactly what freezes:
  "Pins the contract value at $2,340,000 — this drives the milestone schedule; later value changes go
  through a variation." A `409` reads as "sent for sign-off," not an error.
- **Inline edit + the pin (COMMITTED).** Money-neutral cells (description, code, reorder, reallocation)
  stay freely editable. A **value-changing cell (Qty/Rate) is pinned** — it shows `🔒` and does not
  accept a direct overwrite; the attempt opens the **who-pays classifier** pre-set to Variation, or
  offers Absorb. The rule is taught at the cell, not by a banner.
- **Add extra work — the who-pays classifier (all four concepts agreed on this).** From the ghost row
  (post-commit), `+ Add extra work`, or a pinned-cell block. A **decision-first** chooser that previews
  the exact money consequence of each route:
  - **Absorb** → ABSORBED leaf funded net-zero from contingency ("Contingency → $72k left"). Contract unchanged.
  - **Variation** → client pays; raises the contract ("$2,340k → $2,342k"); creates a DRAFT VO for approval.
  - **Separate charge** → one-off; contract unchanged; "Total client revenue → $2,342k."
- **Draw contingency.** An over-cell popover (Excel data-validation-bubble feel) on the contingency line
  or any overrun: amount + reason → the strip's contingency figure ticks down; draws listed under the
  contingency line.
- **Compare-to-signed (on demand, D).** One click (`Compare to signed`, enabled when
  `compareToSignedAvailable`) toggles a **diff lens over the same grid** — changed rows get a gutter mark
  (neutral for MONEY_NEUTRAL, amber for VALUE_CHANGING); a "changed only" filter; the strip shows
  `signed → live · Δ`. Toggling off keeps scroll + column config. Never a separate route.
- **Timeline (on demand, D).** A right-docked **drawer** (not permanent) rendering `BoqTimelineResponse`
  newest-first: "Committed to contract · Ayaan · 15 Aug", "Variation VO-3 adopted · +$72k". Clicking an
  entry scrolls the grid to the line. No version numbers.

## 4. Life-stage modes (Decision 3)

| | WORKING | COMMITTED |
|---|---|---|
| Strip | working total + `% priced` + contingency (planned) | contract axis: current (+Δ vs signed) · contingency remaining · revenue |
| Primary action | **Commit to contract** (enabled at tie-out) | **+ Add extra work** (classifier) |
| Cells | all free-edit | money-neutral free; value-changing **pinned** → classifier |
| Tag column | absent (no classifications yet) | present (⬦ Variation / ⊙ Absorb / ↗ Separate) |
| Ghost row | "add a line" | "add extra work" (classifier on ⏎) |
| Compare / timeline | timeline = build-log; compare dormant ("after you sign") | both active |

Driven off `BoqMoneyBand.lifeStage` — never re-derived client-side; re-fetch on focus.

## 5. Visibility tiers (Decision 8)

Fields arrive `null` server-side; the grid **omits the column / strip figure**, never a blur or a "—"
placeholder, and never a lock icon on money the user can't have:

| | Operational (`canView`) | Cost-control (`canViewCost`) | Commercial-Exec (`canViewMargin`) |
|---|---|---|---|
| Code/Desc/Unit/Qty/⚑ | ✓ | ✓ | ✓ |
| **Rate, Amount** columns | hidden | ✓ | ✓ |
| Strip: in-contract / separate totals | hidden | ✓ | ✓ |
| Strip: contract value, contingency $, revenue, margin | hidden | hidden | ✓ |
| Contingency line | named, no amount | with amount | with amount |
| Compare Δ | counts only | Δ shown | Δ shown |

Operational degrades to a clean **scope-and-progress sheet** (same grid muscle memory, no money). A
withheld figure is always a labelled "restricted"/absent — a hidden contingency and a zero contingency
must never look the same.

## 6. Vocabulary (Decision 9)

Use **Working · Signed · Changed · Variation · Absorb · Separate charge · Contingency · Commit to
contract**. Never surface `v1/v2/v3`, `DRAFT/BASELINED/SUPERSEDED/COMMITTED/SNAPSHOT` enums,
`versionId`, "baseline," or "snapshot." Retire the version panel entirely.

## 7. Read-model binding & component plan

- **Bind to (R10, backend-owned):** `BoqMoneyBand` (+`lifeStage`), `BoqCapabilities`
  (`canViewCost`/`canViewMargin`/`canEdit`/`canCommit`), `BoqCompareToSignedResponse`
  (`changeClass` MONEY_NEUTRAL|VALUE_CHANGING), `BoqTimelineResponse`, the node tree. Never re-sum a
  total client-side — render the read-model figures verbatim.
- **Evolve, don't rebuild:** `boq-grid.tsx` + `boq-editable-cell.tsx` (the grid + ghost row + pin),
  `boq-status-bar.tsx` → the **compact sticky strip** (retire its version/baseline vocabulary),
  `boq-compare-panel.tsx` → the **diff lens** (grouped by `changeClass`), `boq-history-panel.tsx` →
  the **timeline drawer**, `boq-workspace.tsx` → the shell composition, the extra-work classifier drawer.
- **Retire:** `boq-version-panel.tsx` (no user-facing versions).
- **Fix the R8 fallout:** the new required `BoqCapabilities` fields broke ~2 `@erp/web` test literals —
  update them here.

## 7a. Design-review revisions (2026-09-10, verdict REVISE 81 → resolved)

Folded in from the adversarial review; these are binding for the build.

- **Pending-variation feedback (H1) — no dead-ends.** The classifier's **Variation** branch creates a
  DRAFT VO that is approved+adopted elsewhere (R6); variation leaves only appear in the grid *on adopt*.
  So the moment a Variation is created the UI MUST give feedback and a track-back:
  - a toast + a **strip/action-bar affordance** "N variations pending approval →" (links to
    Commercial → Variations), and
  - the intended line rendered as a **pending, non-editable ghost row** tagged `⬦ Pending VO-x`
    (visually distinct, excluded from totals) until it adopts, at which point it becomes a normal
    `⬦ Variation` leaf and the contract figure moves. Never "click Create → nothing happens."
  - **Absorb** and **Separate** apply immediately (they write BOQ nodes now) — no pending state.
- **Empty / first-run / loading / error (H2).** Restated here (not inherited):
  - **Empty BOQ** (no lines): two doors — **Import a priced bill** (primary) / **Start blank** — the
    grid renders as a single ghost row under an empty strip. Only shown if `canEdit`.
  - **Loading**: skeleton rows in the grid + a skeleton strip.
  - **Read-model error**: an inline error panel with retry; never a blank grid.
  - **Restricted (no edit / no money)**: the grid renders read-only; the ghost row is absent.
- **Contingency draw framing (M1) — no fabricated overrun data.** Actual cost/overrun lives in
  `ProjectCostBudget`, NOT the BOQ, so the grid must NOT imply it detects overruns. A draw is initiated
  **from the contingency line** (or the classifier's Absorb) and funds a **chosen** target line + a
  reason. Remove all "cover an overrun" language that implies the grid knows costs.
- **Absorb vs Draw (M2) — crisp split.** **Absorb** = add *new* `ABSORBED` scope, funded net-zero from
  contingency (a classifier branch). **Draw / reallocate** = move contingency budget onto an *existing*
  line, from the contingency line's menu. Same backend net-zero mechanic; two clearly-labelled entries.
- **Commit consequence copy (M3).** Keep the light confirm strip (owner's call), but its copy carries
  the weight: "This fixes the contract value at $X and sets the milestone schedule. After committing,
  changes that move the client's money must go through a variation." Show the tie-out check inline.
- **Tag vs validity (M4).** **Two separate columns/affordances**: a **Source** tag (⬦ Variation / ⊙
  Absorb / ↗ Separate / pending) and a **⚑ validity** flag (readiness blockers). Never merged. The
  one-line strip leads with **Contract value** as the headline; contingency + revenue are subordinate.
- **Icons (L1).** All glyphs → the codebase lucide set at build; wireframe symbols are indicative only.
- **View-signed (L2).** Provide a lightweight **"View signed BOQ"** read-only affordance (from the
  timeline's commit entry) in addition to the compare-to-signed diff.

## 8. Out of scope / open

- Full column-config persistence, drag-reorder polish, and virtualization for 1000+ line BOQs are
  build-time concerns, not design blockers (virtualize; keep strip/header/footer frozen).
- **375px / site:** degrade to a read-only stacked list (Code · Desc · Qty · flag) + a 2-figure strip;
  disable inline money edit on phones (fat-finger safety). Keyboard-first == desktop-first, owned.
- **Open policy (Eng Ahmed):** whether the commit confirm relaxes for repeat committers (learnability/
  safety vs power-user speed). Default: keep the light confirm strip for everyone.
- Next steps: design-review this against the enterprise rubric, then implement (frontend-engineer),
  after (or alongside) the R1/R7 migration dry-run.
