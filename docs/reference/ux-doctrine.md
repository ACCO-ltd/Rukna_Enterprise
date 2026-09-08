# Rukna UX Doctrine — Round 2

Status: **CANONICAL** (supersedes `frontend-design.md` v2.0.0 for anything they disagree on)
Owner: Product/UX (Round 2)
Last updated: 2026-08-25

This is the source of truth for how the Rukna frontend should *feel and behave*. It replaces the
Round-1-era `frontend-design.md`, which still prescribed features the backend subtraction removed
(Exchange Rates, the 8-state project lifecycle, IPC exchange-rate fields, mandatory en/ar bilingual).
Where this doctrine and that document disagree, **this wins**; the old file is kept only for its
still-accurate screen-level build notes.

---

## 0. The three goals (everything below serves these)

1. **Enterprise feel** — calm, dense, trustworthy. Looks like a system that runs a construction
   company's money, not a CRUD form over an API.
2. **Zero-training** — a new site engineer or accountant can sit down and operate it without a
   manual. The screen tells them what state a thing is in and what to do next.
3. **Not messy** — density without clutter. More information per screen, *fewer* boxes, borders,
   colours, and competing actions.

The tension is always **#1/#2 vs #3**: the instinct to "make it enterprise" by adding cards, badges,
colours, and widgets is the thing that makes it messy. This doctrine resolves that tension in favour
of subtraction. When in doubt, remove a border before adding one.

---

## 1. What we keep (the Rukna foundation is good — codify it)

The token layer (`frontend-theme.md`) is mature and already aligned with enterprise practice. It is
**not** up for redesign. Round 2 builds *on* it, it does not replace it.

- **Closed token scales** — 8 type steps, 3 radii + pill, 3 elevations + focus ring, 3 motion
  durations, 2 densities, a 4pt space grid. eslint ratchets them. Never introduce a raw hex, pixel
  font size, or ad-hoc radius. **Preserve the Rukna brand colours** — the accent blue and its ramp
  are the product's identity and do not change.
- **Colour ownership** — `success`/`warning`/`danger`/`historical` carry *state*; `brand-primary`
  carries *interactivity only* (the one primary action, links, active tab, focus ring — and nothing
  else). Money stays neutral. A progress bar is a status carrier (`warning` < 100%, `success` at
  100%), never the accent. **One primary action per screen.**
- **Status = word + colour + icon**, never colour alone. Resolved by entity type through the status
  registry.
- **Light / dark / system** and **comfortable / compact** density are first-class, resolved
  pre-hydration. Every surface is verified in both themes and at 375px.

Round 2 changes *composition and content*, not these primitives.

---

## 2. Composition patterns adopted for Round 2

Taken from the enterprise-design-system reference (`~/.claude/skills/enterprise-design-system`) where
it improves on what we have. These are the patterns to reach for; they are already partly present.

### 2.1 Structure by hairlines and background steps, not boxes
A section is a `SectionHeader` (title + hairline rule) with content directly under it. **Panels
(bordered cards) are opt-in** — used only for genuinely bounded content (a summary rail, a side
card), never as the default wrapper for every group. *This is the single biggest lever against
"messy".* Today the dashboard wraps everything in `WidgetShell` + `KpiCard` boxes; most of those
borders should become hairline section headers.

### 2.2 Metric strips over KPI-card grids
A row of metrics separated by vertical hairlines — label (micro), value (tabular, 26px), optional
delta — reads calmer and denser than a grid of bordered cards. Reserve cards for a metric that must
be *clickable as a whole* or carries its own sub-content.

### 2.3 The "requires your action" queue is the point of a dashboard
An enterprise home screen answers one question: **what needs me right now?** A divider-separated
metric strip at the top, then a prioritised action/exception queue, then an activity feed. Not a wall
of counts. (This depends on a backend attention feed — see §6.)

### 2.4 Micro-labels
11px uppercase tracked muted-foreground for nav section labels, metric labels and section eyebrows.
Already in use; apply consistently.

**Amended 2026-09-08 — table headers are excluded, and are sentence case.**

They were in this list, and the rule could not survive contact with a sortable column.
`text-transform` inherits, but a sortable header renders its label inside a `<button>`, and form
controls do not take the inherited transform. So a real header row read

> `Project · STAGE · CATEGORY · Project manager · PROGRAMME · Contract value · ATTENTION`

— shouting at exactly the columns that happened not to sort. The casing was announcing
sortability, which is the arrow's job.

The fix could have gone in the sort button. It did not, because the rule was wrong on its own
terms: a column header is *read as words* while scanning a grid, not glanced at as a label
marking a region. Uppercase costs legibility where the eye moves fastest, and 13px sentence case
measures about the same as 12px uppercase, so no dense table pays for the change.

Micro-labels keep uppercase everywhere else — `DropdownMenuLabel`, nav section labels, metric
labels, eyebrows. The distinction is: **a label naming a region shouts; a column header does
not.**

### 2.5 Lifecycle as small dots + connectors
Completed / current / upcoming / blocked / cancelled — small, never oversized. Use for project and
document lifecycles instead of a row of big status pills.

### 2.6 Command menu (⌘K)
A keyboard-first jump-to-anything is the highest-leverage zero-training affordance we can add
*without a backend* — it can navigate to any screen/section from the existing nav map today. (Record
search across data waits for a backend search endpoint; navigation does not.)

---

## 3. Content rules (how text reads)

- **Tone:** plain, operational, factual. State facts and consequences: "Approving this routes it to
  the project director." No exclamation marks, no marketing adjectives, **no emoji anywhere**.
- **Casing:** sentence case for buttons, labels, titles, tabs. UPPERCASE only for the 11px
  micro-label style. Never Title Case.
- **Buttons are verb-first and specific:** "Approve certificate", "Add BOQ item", "Return for
  changes" — never "OK" / "Submit" / "Yes".
- **Numbers:** thousands separators, two decimals for money, **currency symbol prefix**
  (`$4,500,000.00` — decided 2026-08-26). ACCO is USD-only (ADR-024), so `$` is unambiguous and
  reads lighter than a code suffix; `formatMoney` already does this. Real minus sign (−) for
  negatives, tabular numerals, right-aligned in tables. Money stays **neutral** — never coloured.
- **Empty values** render `—`, never blank. IDs/codes in mono (`PO-2214`, `IPC-0088`).
- **English only.** Arabic was removed end-to-end (PR #73). The `next-intl` seam stays so strings are
  never hardcoded in JSX, but there is one catalogue (`en`) and no RTL requirement. Do not build
  RTL-specific layout or an ar catalogue.

---

## 4. The one honesty rule (learned from Round 1)

**Never ship a disabled control that advertises an unbuilt feature.** A greyed-out "Search (coming
soon)" or a dead notification bell earns a support question on every screen and pays nothing back —
nobody misses a feature they were never shown. If the endpoint isn't there, the control isn't there.
The top-bar search was correctly removed for this reason; the attention bell (currently a disabled
stub) must follow the same rule until its endpoint exists.

Corollary for docs: a design doc that describes removed features is the same bug at the doctrine
level. Keep the source of truth honest as the system changes.

---

## 5. Navigation model (confirmed, Round 2)

**Domain → destination** in the global sidebar; **project workspace tabs** inside a project.
Domain-specific configuration lives inside its domain.

**Navigation-depth rule (revised 2026-08-26 — supersedes the crude "no third nesting level").**
The real enemy is *unclear hierarchy*, not depth per se. An information-dense ERP workspace legitimately
needs local view-switching:

> **Avoid more than two _persistent_ navigation layers within one entity workspace. Contextual
> view-switching is permitted when the views are peer workflows in one domain. Go deeper only by
> transitioning to an entity/detail screen — never by stacking another persistent tab bar.**

- **Allowed:** module tabs (level 2) → a *local view switcher* inside a module (Progress: Daily Reports /
  Work Packages / Verified / Milestones / Performance; Commercial: Overview / Contract / Applications /
  Billing). One route, in-place swap.
- **Allowed:** Progress → Work Package **WP-014 detail** (a real entity/detail screen, which may carry its
  own local nav — that's navigation, not a nested tab-in-tab).
- **Avoid:** stacking 3+ persistent tab bars (Progress → Work Packages → Active → Labour → Attendance).

**Make the level visually distinct.** Level-2 module tabs use the underline-tab treatment; a **level-3
local view switcher uses a quiet segmented control** (selected = subtle fill), so the eye reads "still
inside this module, switching views" rather than "a second global tab bar." Use the shared `ViewSwitcher`,
not another underline `Tabs`.

> **Narrowed 2026-09-05 (owner call).** `ViewSwitcher` now also has an `underline` appearance, used by
> Progress. The rule it relaxes is real, so the exception carries its own separation: a shorter row
> (44px vs 48px), `font-medium` vs `font-semibold`, and a glyph on the **active tab only** — which is
> also a non-colour signal of which view is current. Segmented stays the default and Commercial stays on
> it; `underline` is opt-in per call site, not a new default.

Standing anti-patterns for nav: no generic "Change status" control anywhere (lifecycle is business-action
commands — see ADR-019); no decorative sidebar cards that don't do a job; a level-3 switcher must never
*look* like the level-2 module tabs.

---

## 6. Backend dependencies this doctrine introduces

These are the only backend asks; everything else consumes what Sprints 1–7 already shipped.

| Need | Endpoint | Why |
|---|---|---|
| Attention feed (portfolio) | `GET /attention-items` | The dashboard action queue (§2.3) and the top-bar indicator. Without it, both are honest-omitted per §4. |
| Attention feed (project) | `GET /projects/:id/attention-items` | The project Overview action queue. |

Both were specified in the old plan and never built. They are the gating backend work for a real
command-center dashboard. Until they exist, the dashboard ships as a metric strip + portfolio table
(no fake queue), and the bell stays absent.

---

## 7. Anti-patterns (blacklist — reject in review)

No gradients (except the one documented skeleton shimmer) · no hero headings · no card around every
element · **no icon tile below region level** (revised — see below) · no illustrations · **no sequential ramp used
categorically** (§8.1) · no rainbow charts · no pills for plain text · no coloured table-header fills · no icon-only ambiguous actions ·
no wizard where a form works · no page-specific button styles · no fake metrics or placeholder
analytics · no converting tables to card lists · no shadows for page structure · no emoji · no
disabled control for an unbuilt feature (§4) · no second colour competing with the accent · no money
coloured as a heat map.

**Revised 2026-09-05 — "no coloured icon tiles" was too broad.** It was written against the pattern
it should have named: a *grid* of tiles in assorted hues, one per metric or per row, where the colour
carries no meaning and the icons compete with the numbers. That stays banned.

A **single accent-tinted tile marking where a region begins** is a different thing and does a real
job: on a multi-panel page it is what lets the eye find a panel's start without reading its title.
`RecordPanel`'s `icon` prop is the only sanctioned form, and it is deliberately narrow:

- **One accent, one size.** The brand tint only — never a second hue, never a per-status colour.
- **Region level only, with one exception.** A panel header. Never per fact, per metric or per
  status.

  **Amended 2026-09-08 — an entity list's primary column may carry one.** Clients and Projects
  put a single brand-tinted tile beside the record's name. It is the same tile doing the same
  job one level down: it gives the eye a fixed left edge to run down a list of records, and it
  binds the two-line name/code pair into one record rather than two rows. The conditions that
  make it legitimate rather than the banned grid-of-tiles are strict, and all four must hold:

  - **One accent, one size, one glyph for the whole column** — it marks *"a record starts
    here"*, never what kind of record it is. The moment it varies by row it is encoding status
    in colour, which is the original anti-pattern.
  - **Primary column only**, and only in a list of records people navigate into.
  - **`aria-hidden`** — the record's name is the accessible name.
  - **Never alongside a per-row status tint.** The status column already carries that meaning.

  A tile that varies per row, or a second one in another column, is the banned pattern returning
  and the answer is still no.
- **Decorative, so `aria-hidden`.** The `<h2>` beside it is the accessible name; the tile adds
  nothing a screen reader needs.

If a page ever wants more than one tint across its tiles, that is the original anti-pattern coming
back and the answer is no.

---

## 8. Chart encoding

Added 2026-09-06, from the Phase-6 Finance build. The trigger was a real defect: `ShareRing` in
Procurement cycled `--chart-1/2/3` — a *sequential* ramp — across unrelated cost areas, so two
neighbouring slices differed only in lightness and the ring read as a gradient rather than as
categories. The palette validator caught it; nothing in this doctrine had forbidden it.

### 8.1 Two palettes, two jobs — never swapped

| Palette | Tokens | Encodes | Example |
|---|---|---|---|
| **Sequential** | `--chart-1` → `--chart-5` | one quantity, ordered, light → dark | Committed → Accrued → Actual: three stages of one number |
| **Categorical** | `--series-1` → `--series-5` | identity, unordered | Cost areas, expense accounts, suppliers |

A sequential ramp used categorically says "these differ by degree" about things that differ in
kind. A categorical set used sequentially says "these are unrelated" about a progression. Both are
lies about the data, and both are invisible in review unless you know to look — hence the table.

`--series-*` was validated with the `dataviz` validator against both surfaces before it was
adopted; do not add a hue to it by eye.

### 8.2 Maximum five visible identities

Five categorical slots, assigned in fixed order, **never cycled**. A sixth generated hue is not
distinguishable from one already on screen. The tail folds into **Other** — grouped, never dropped,
and its total still reconciles to the whole.

### 8.3 Form follows question

- **Part-to-whole** → horizontal stacked bar. Long labels ("Project-level (non-BOQ)") do not fit
  around a ring, and arc-length comparison is measurably worse than length comparison. Donuts are
  permitted, not the default.
- **A ratio against a limit** → a meter, not a two-slice pie and not two bars sharing no baseline.
- **A single figure** → not a chart at all. A metric.

### 8.4 Every charted value is also text

The chart carries the proportion; the number carries the fact. Every segment is named and valued
in the legend beside it, and the precise table is on the same screen. This is also the relief the
palette's contrast warning requires: **label + value is the primary identification, colour is
secondary.** Nothing — identity, state, or severity — may be encoded by colour alone.

### 8.5 An undefined ratio is reported, not drawn

Extends §4's honesty rule to charts. When the denominator is zero the ratio does not exist, and
both plausible fudges are false statements:

| State | Wrong | Right |
|---|---|---|
| Revenue 0, cost > 0 | `100%` (claims the project consumed all its revenue) or `∞%` | *No posted revenue* + the cost figure, no bar |
| Revenue 0, cost 0 | a meter at 0% | empty state — nothing has been posted |

A meter at 0% claims a measurement that was taken and came back zero. Draw no bar rather than a
bar that means nothing.

### 8.6 Name a ratio as a division, not as a verb

"Revenue consumed" invites a finance reader to hear cash collection or revenue-recognition
mechanics. **`Project cost / Revenue`** says exactly which number is over which, and the figures
beneath it — Revenue (posted), Project cost (posted), and the remainder — let the reader check the
arithmetic instead of trusting the bar.

Name the remainder for what was actually subtracted. On the P&L meter the fill is *all* project
cost, so the remainder is **Net project income** and ties to the statement's own last line. Calling
it "Gross profit" would put that label on two different figures on one screen — the statement's
gross profit stops at cost of sales.

---

## 9. Shared workspace UI debt

Cross-module defects that are real, are **not** any one workspace's to fix, and must be fixed once
in the shared primitives rather than patched per module. A slice that trips over one of these works
around it and adds a line here; it does not fix it locally.

### 9.1 Heading hierarchy is inconsistent across workspaces

Found 2026-09-06 by the Phase-6 browser QA, which could not anchor on a heading because the four
Finance views do not name themselves the same way:

```text
Finance shell            h1
Overview                 no local heading
Cost Control             h3   (the first SectionPanel's title)
Profit & Loss            h2
Ledger                   h2
```

Two views title themselves at `h2`; one has no title of its own and opens straight into a panel at
`h3`, skipping a level; one is only named by the shell. A screen reader's document outline is
therefore wrong on half the workspace, and the same pattern is used by Procurement and the other
rebuilt modules, so this is not a Finance bug.

**The rule to converge on:**

```text
Page shell title         h1
Internal workspace view  h2
Section headings         h3
Subsections              h4
```

**Do not patch one workspace.** `SectionPanel` and `MetricBand` hard-code `h3`, and every rebuilt
module renders them; fixing Finance alone would make Finance the outlier instead of the norm. The
fix is a heading-level prop (or a heading-level context) on those primitives plus a view-title slot
in each workspace shell, done once across Procurement, Progress, Commercial, Finance and the rest.

Until then: **anchor tests and automation on `aria-current`, not on headings.** Finance's browser QA
does this (`nav[aria-label="Finance"] a[aria-current="page"]`).

---

### 9.2 App-shell controls are below the 44px touch minimum

Found 2026-09-07 by the Phase-7A browser QA, which is the first gate in the product to assert the
44px rule `apps/web/CLAUDE.md` has always mandated. Scanning the whole document at 375px, every
failure came from the shell rather than from the workspace under test:

```text
skip link                 A.sr-only focus:not-sr-only
sidebar collapse toggle   h-9  (36px)
sidebar item control      h-9  (36px)
breadcrumb project link   unconstrained, ~20px
breadcrumb "Projects"     unconstrained, ~20px
sidebar domain row        min-h-10 (40px)   ← added to this list 2026-09-08
```

(The TanStack devtools button also fails and is dev-only — not debt, ignore it.)

The sidebar domain row was added to the list on 2026-09-08 by the Administration workspace
slice (ADR-028). That slice did not introduce the height — every row in the sidebar has been
`min-h-10` — but it did make one of those rows the *only* way to reach Administration, since the
six child rows underneath it are gone. Raising that one row to 44px was considered and rejected
for the reason below: it would have made Administration 4px taller than its five siblings while
leaving every one of them still unhittable.

**Do not patch this from a feature branch.** These controls are rendered by `AppShell` and
`ProjectWorkspaceShell` on *every* screen in the product. Fixing them inside Documents would make
Documents the outlier and leave the other nine workspaces failing the same rule, which is the exact
shape of the heading-hierarchy problem in §9.1. The fix is one pass over the two shells.

The underlying cause is worth naming, because it will recur: **`Button size="sm"` is `h-9` (36px)
and fails the touch rule by construction.** The default size is `h-control`, which resolves to 44px
at comfortable density and follows the user's own density preference. `sm` is legitimate only where
a control is never the primary tap target on a touch viewport. Phase 7A removed all twelve uses of
it from the Documents views for this reason.

**Until the shell pass happens: scope touch-target assertions to the workspace under test.** The
Documents gate does this — the workspace root carries `data-qa="documents-workspace"` and the
assertion queries inside it. A gate that fails on another module's debt gets disabled rather than
fixed, and then it protects nothing.

## 10. Definition of done (every Round-2 slice)

A slice is done when, verified in the running app:
1. Light **and** dark theme correct (WCAG AA contrast on all status tokens).
2. 375px mobile: usable, touch targets ≥ 44px, no horizontal scroll on core content.
3. One primary action; accent used only for interactivity; state carried by status tokens.
4. Loading (skeleton), empty (`—` / EmptyState), error, and restricted (permission) states all
   represented — not just the happy path.
5. No raw hex / ad-hoc radius / hardcoded font size (eslint clean).
6. No disabled stub for an unbuilt feature.
7. Reviewed against this doctrine by the `reviewer` axis before merge.
