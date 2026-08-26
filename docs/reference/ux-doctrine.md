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
11px uppercase tracked muted-foreground for table headers, nav section labels, and metric labels.
Already in use; apply consistently.

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
- **Numbers:** thousands separators, two decimals for money, explicit currency suffix on totals
  (`184,200.00 USD`), real minus sign (−) for negatives, tabular numerals, right-aligned in tables.
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

Two levels, no deeper: **Domain → destination** in the global sidebar; **project workspace tabs**
inside a project. Domain-specific configuration lives inside its domain. This is already built and
correct — Round 2 refines its *presentation* (one consistent active-state treatment; collapse-to-rail
with flyouts; a command menu on top), not its structure.

Standing anti-patterns for nav: no third nesting level; no generic "Change status" control anywhere
(lifecycle is business-action commands — see ADR-019); no decorative sidebar cards that don't do a
job.

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
element · no coloured icon tiles · no illustrations · no rainbow charts · no pills for plain text · no
coloured table-header fills · no icon-only ambiguous actions · no wizard where a form works · no
page-specific button styles · no fake metrics or placeholder analytics · no converting tables to card
lists · no shadows for page structure · no emoji · no disabled control for an unbuilt feature (§4) ·
no second colour competing with the accent · no money coloured as a heat map.

---

## 8. Definition of done (every Round-2 slice)

A slice is done when, verified in the running app:
1. Light **and** dark theme correct (WCAG AA contrast on all status tokens).
2. 375px mobile: usable, touch targets ≥ 44px, no horizontal scroll on core content.
3. One primary action; accent used only for interactivity; state carried by status tokens.
4. Loading (skeleton), empty (`—` / EmptyState), error, and restricted (permission) states all
   represented — not just the happy path.
5. No raw hex / ad-hoc radius / hardcoded font size (eslint clean).
6. No disabled stub for an unbuilt feature.
7. Reviewed against this doctrine by the `reviewer` axis before merge.
