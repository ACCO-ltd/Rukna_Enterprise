# Rukna visual design QA — Projects foundation

## Evidence

- Source visual truth: `C:\Users\cshii\.codex\generated_images\019ff0b3-b5ce-7923-a8b8-0a8d93f786a3\exec-704cf116-0a67-42e4-b326-301dcb247367.png`
- Implementation capture: `C:\Users\cshii\OneDrive\Desktop\Asas group\Erp_platfrom\design-qa-projects-final.png`
- Supporting Project detail capture: `C:\Users\cshii\OneDrive\Desktop\Asas group\Erp_platfrom\design-qa-project-detail.png`
- Source pixels: 1487 × 1058
- Implementation pixels: 1536 × 826
- State: authenticated ACCO tenant, English locale, Projects list with one draft project
- Density normalization: both captures are 1× desktop browser captures; proportions were compared at equal displayed width because the connected browser viewport is wider and shorter than the generated source frame.
- Primary interaction tested: opened project `SWE001` from the redesigned list and verified the Project detail workspace.
- Browser console: no warnings or errors during the final Projects → Project detail flow.

## Full-view comparison

The implementation preserves the approved composition: deep navy navigation, white command bar, cool app canvas, strong sans-serif page title, one blue primary action, paired search/status controls, compact result count, and a bordered portfolio table. Navigation, filtering, record navigation, permissions, and data behavior remain unchanged.

## Focused-region comparison

- Sidebar: checked width, brand lockup, section-label rhythm, active state, text contrast, and internal scrolling.
- Page header and controls: checked title weight, action hierarchy, control height, borders, radius, and spacing.
- Project table: checked header treatment, column alignment, identifier typography, status treatment, row density, and start-date alignment.
- Project detail: checked command header, tabs, lifecycle action bar, setup panel, and overview definition grid for visual-system continuity.

## Comparison history

### Iteration 1

- P2: the initial implementation sidebar was materially narrower than the approved mock, weakening the intended enterprise composition.
- Fix: increased the persistent desktop sidebar and matching content offset from 15rem to 17rem.
- Post-fix evidence: `design-qa-projects-final.png` shows the corrected sidebar/content proportion.

### Iteration 2

- No remaining P0, P1, or P2 visual mismatches were found in the Projects foundation screen.
- The source uses a serif display heading; the implementation intentionally uses the approved bilingual-compatible Inter family to avoid an English/Arabic brand split.

## Required fidelity surfaces

- Fonts and typography: passed. Inter/IBM Plex Sans Arabic remain the product families; weight, scale, mono identifiers, and hierarchy match the selected direction while preserving bilingual consistency.
- Spacing and layout rhythm: passed after the sidebar proportion fix. Controls, page margins, table columns, panel radii, and vertical rhythm are consistent.
- Colors and visual tokens: passed. Existing Rukna navy and cobalt were preserved and centralized; semantic state colors remain separate from brand color.
- Image and asset quality: passed. The target contains no raster imagery or custom brand asset requiring reproduction; existing functional icons were preserved.
- Copy and content: passed. Existing translated product copy and record data were preserved.

## Follow-up polish

- P3: introduce a production icon package in a separately approved dependency change, then replace legacy inline icons and add consistent status icons.
- P3: add focused Arabic and 375px screenshot comparisons as the design system rolls into form-heavy screens.

final result: passed

---

# Project workspace compact-flow QA — 2026-08-11

## Evidence

- Source visual truth path: user-provided Taurus workspace screenshots in the current conversation; attachment filesystem paths are not exposed.
- Implementation screenshot path: connected-browser captures of `/projects/cmsogbdqd000ttgic54etbalk`, `/boq`, `/contracts`, and `/members` in the current session.
- Desktop viewport: 1688 × 904 CSS pixels at 1× density. Mobile viewport: 400 × 812 CSS pixels at 1× density (the browser enforced a 400px minimum when 375px was requested).
- State: authenticated ACCO tenant, English locale, draft project with BOQ, blocked contract dependency, and project member data.
- Primary interactions tested: project tab navigation, horizontally scrollable setup flow, header command placement, BOQ version actions, contract workspace, and team workspace.
- Console errors checked: no application-origin runtime errors; one hydration warning was caused by the connected browser extension injecting `data-qb-installed` before hydration.

## Full-view comparison evidence

- The setup area is now a single connected four-step rail rather than four large cards. It preserves explicit Complete, Pending, and Blocked states while materially reducing above-the-fold height.
- Header commands remain grouped with contract value. Overview information is consolidated into client, commercial, and schedule groups instead of repeated independent cards.
- BOQ, Contract, and Team use the same compact command header, rounded surface, icon, toolbar, table, loading, and empty-state language.
- At the mobile viewport the page has no body-level horizontal overflow; only the lifecycle and setup rails scroll within their own regions. Header actions wrap without clipping.

## Focused-region comparison evidence

- Setup rail: checked connector continuity, 24px state indicators, status text, blocked dependency copy, action visibility, truncation, and scroll containment.
- Header: checked contract-value and action alignment plus wrapped mobile behavior.
- Overview: checked grouping, RTL-aware dividers, missing-value treatment, and scan order.
- BOQ/Contract/Team: checked icon consistency, toolbar density, table framing, and empty/loading guidance.

## Comparison history

- P2, fixed: the 2 × 2 setup cards remained too tall and visually read as unrelated tiles. They were replaced with one low-height connected rail using explicit success, pending, and blocked states.
- P2, fixed: repetitive overview cards weakened scanability. Client, commercial, and schedule data now share one structured surface.
- P2, fixed: BOQ version actions and tab-level commands appeared detached from their context. They now live in compact command headers shared across the primary project tabs.
- P2, fixed: loading and empty states did not resemble their final workspaces. BOQ skeletons and empty states now mirror the final toolbar/table structure and include clear next actions.
- Post-fix browser evidence shows no clipped persistent controls, no page-level mobile overflow, and no remaining actionable P0/P1/P2 visual issue.

## Required fidelity surfaces

- Fonts and typography: passed; existing bilingual type families, weights, hierarchy, truncation, and compact uppercase state labels remain consistent.
- Spacing and layout rhythm: passed; setup height, panel padding, command headers, radii, and shadows follow the approved clean enterprise direction.
- Colors and visual tokens: passed; white surfaces, cool-gray canvas, cobalt interaction color, and semantic green/amber states use existing tokens.
- Image and asset quality: passed; no raster assets were required and all functional symbols use the installed Phosphor icon library.
- Copy and content: passed; setup states and overview group labels are translated in English and Arabic without changing domain behavior.

## Validation

- TypeScript: passed.
- Focused ESLint: passed.
- Focused Vitest: 45 tests passed across project detail, Arabic rendering, members, BOQ actions, and BOQ tree behavior.

final result: passed

---

# Compact project commands and setup rail QA — 2026-08-11

## Evidence

- Source visual truth: user-provided Project detail screenshot in the current conversation, 1877 × 998 pixels.
- Implementation: browser-rendered `http://acco.localhost:3000/projects/cmsogbdqd000ttgic54etbalk` at 1688 × 904 CSS pixels and 1× density.
- Supporting implementation capture: latest connected-browser screenshot in this build run; existing project capture path is `design-qa-project-detail.png`.
- State: authenticated ACCO tenant, English locale, draft project with 3 of 4 setup tasks complete.
- Interactions tested: Approve and Edit remained available; the icon-only Actions menu opened with Suspend and Cancel project, then closed with Escape.
- Browser console: no errors in the settled state.

## Full-view and focused comparison

- The detached action card was removed. Contract value, Approve, Edit, and the icon-only More control now form one header command cluster.
- Project setup changed from a tall 2 × 2 card grid to one low-height four-item desktop row. Completed descriptions are removed, while the blocked contract retains its dependency explanation.
- The setup header now uses a compact 75% badge and translated completion count instead of a full-width progress bar.
- Focused inspection covered action alignment, menu affordance, setup height, status/icon recognition, truncation, and spacing against the supplied screenshot.

## Comparison history

- P2, fixed: the first portal pass temporarily left actions below the header when the shell query was still loading. A DOM-backed header slot subscription now moves actions into place as soon as the header becomes available.
- P2, fixed: setup cards consumed excessive above-the-fold height. The new horizontal rail exposes all four tasks in roughly one quarter of the previous vertical space.
- No actionable P0, P1, or P2 findings remain in the inspected desktop state.

## Required fidelity surfaces

- Fonts and typography: passed; hierarchy and bilingual product font choices remain unchanged.
- Spacing and layout rhythm: passed; actions align with contract value and setup is a compact single row.
- Colors and visual tokens: passed; existing brand, success, warning, border, and surface tokens are reused.
- Image and asset quality: passed; all functional icons use Phosphor and no image assets were required.
- Copy and content: passed; existing translated lifecycle and dependency copy is preserved.

## Follow-up polish

- P3: capture dedicated 375px English and Arabic states to tune horizontal-scroll affordance and RTL ordering.

final result: passed

---

# Projects daily-workspace redesign QA — 2026-08-11

## Evidence

- Source visual truth: user-provided Taurus sidebar and enterprise workspace screenshots in the current conversation.
- Implementation: `http://acco.localhost:3000/projects` and the linked `SWE001` project workspace, captured through the connected browser at 1536 × 826 CSS pixels and 1× density.
- Existing implementation captures: `design-qa-projects-final.png` and `design-qa-project-detail.png`.
- State: authenticated ACCO tenant, English locale, one draft project with setup and commitment data.
- Primary interactions tested: opened the project row, verified workspace navigation, lifecycle presentation, command availability, setup actions, and filter controls.
- Browser console: no errors in the final Projects → Project detail flow.

## Comparison findings

- P2, fixed: the first detail pass placed lifecycle actions in an oversized full-width strip. It was replaced with a compact right-aligned command group while retaining the independently testable `ProjectDetail` boundary.
- No remaining P0, P1, or P2 mismatch was found in the inspected desktop state.
- P3: a dedicated 375px Arabic screenshot comparison remains useful as follow-up regression coverage.

## Required fidelity surfaces

- Fonts and typography: passed. Existing bilingual product fonts, compact labels, strong project identity, and readable metric hierarchy are retained.
- Spacing and layout rhythm: passed. Search/filter controls are unified, rows are denser, lifecycle and setup regions are compact, and card spacing follows the reference direction.
- Colors and visual tokens: passed. White surfaces, cool-gray canvas, restrained cobalt accents, and semantic success/warning colors remain token-driven.
- Image and asset quality: passed. No raster imagery was required; standard UI symbols use the installed Phosphor icon package rather than handcrafted icons.
- Copy and content: passed. Existing translated business copy, permissions, lifecycle commands, and API-backed values are unchanged.

final result: passed

---

# Sidebar interaction QA — reference-led shell polish

## Evidence

- Source visual truth: two user-provided sidebar reference images in the current conversation (attachment paths are not exposed to the workspace).
- Expanded implementation: `design-qa-sidebar-expanded.png`
- Compact implementation: `design-qa-sidebar-compact.png`
- Implementation pixels: 1536 × 826 at 1× browser density.
- State: authenticated ACCO tenant, English locale, Dashboard route.
- Primary interactions tested: domain accordion toggle, desktop collapse, desktop expand, content reflow, and persisted compact preference through the component store.

## Full-view comparison

The implementation now carries the reference's strongest qualities: a stable enterprise shell, dense but legible navigation, prominent active state, compact icon rail, smoothly reflowing content, and a restrained white/navy/cobalt palette. Rukna's existing information architecture, permission gates, tenant identity, and mobile drawer remain intact.

## Focused-region comparison

- Brand/header: logo mark, tenant label, and collapse affordance remain aligned in both widths.
- Navigation: domain icons, active state, nested-item hierarchy, accordion motion, and RTL-aware chevrons were checked.
- Compact rail: active icon treatment, content offset, footer avatar, and expand control were checked.
- Header/content: the top bar and dashboard reflow correctly without overlap at both sidebar widths.

## Required fidelity surfaces

- Fonts and typography: passed; the existing Inter/IBM Plex Sans Arabic pairing remains consistent and readable.
- Spacing and layout rhythm: passed for the inspected desktop states; sidebar transitions between 17rem and 5rem without clipping the main content.
- Colors and visual tokens: passed; Rukna navy and cobalt remain token-driven and distinct from semantic status colors.
- Image and asset quality: no raster product imagery was introduced; the existing vector UI icon treatment remains consistent.
- Copy and content: passed; all new accessibility labels are translated in English and Arabic.

## Comparison history

- P2: the first integration tied compact mode to a parent shell file being edited elsewhere. Fix: isolated persistence and width synchronization in a dedicated sidebar store, preventing collision while retaining smooth content reflow.
- Post-fix evidence: both expanded and compact captures show aligned shell/content geometry and working controls.

## Remaining blocker

The visual comparison cannot be certified as a fully normalized side-by-side pass because the user-provided source attachments have no local path exposed to the workspace. The running development browser also recorded transient Next.js HMR initialization errors from live file updates; type checking, focused lint, and the shell test suite pass.

final result: blocked

---

# Phase 6 release-hardening QA - 2026-08-13

## Automated coverage delivered

- Project IPC workspace added to desktop and 375px horizontal-overflow coverage.
- Existing Arabic RTL navigation updated for the current account-menu language control.
- Explicit light/dark selection, persistence across navigation, and root theme application covered.
- Keyboard skip-link focus transfer to `#main-content` covered.
- Client creation to preselected project wizard covered as one real user journey.
- Project IPC workspace to payment-application creation covered.
- Certificate issue, replacement issue, and effective-certificate supersession covered.
- E2E scenario discovery repaired so a clean checkout does not require a stale `.scenario.json`.

## Verification evidence

- Playwright discovery: 58 cases in desktop and mobile projects.
- Full monorepo production build: passed, including `/projects/[id]/ipc`.
- Browser startup probe: harness loaded and reached the API transport.

## Remaining evidence dependency

Authenticated screenshots cannot be captured in this shell because
`RUKNA_DEMO_PASSWORD` is not set and the local API is stopped. Run the command documented
in `docs/02-architecture/phase6-release-hardening.md`, then retain Playwright screenshots
under `output/playwright/`.

final result: implementation passed; authenticated visual evidence pending environment setup

---

# Phase 3A visual design QA — Project forms and BOQ

## Evidence

- Project form capture: `design-qa-project-form.png`
- BOQ workspace capture: `design-qa-boq-workspace.png`
- Source visual truth: approved Modern Rukna command direction and uploaded Rukna design-system references.
- State: authenticated ACCO tenant, English locale, new-project form and editable draft BOQ.

## Review result

- Project form: passed after replacing the viewport-obscuring sticky action bar with a stable form footer. Identity, details, and programme groups now have clear hierarchy without changing fields or submission behavior.
- BOQ workspace: passed. Version context, lifecycle actions, editor tools, column headers, hierarchy, and total treatment are visually distinct and retain the existing BOQ workflow.
- Shared foundations: passed. Form sections, fields, text areas, badges, buttons, borders, radii, shadows, and semantic colors use centralized design tokens.
- Behavior preservation: passed. Routes, API calls, permissions, validation rules, and workflow transitions were not redesigned.
- Responsive and bilingual readiness: logical layout and existing translated strings are preserved; dedicated Arabic/mobile visual regression coverage remains a later rollout task.

final result: passed

---

# BOQ workspace QA — ADR-016 rebuild, 2026-08-14

## Result — pass

## Evidence

- `docs/qa/boq/boq-desktop-en-light.png` — 1440 × 5936, English, light
- `docs/qa/boq/boq-desktop-en-dark.png` — 1440 × 5936, English, dark
- `docs/qa/boq/boq-desktop-ar-rtl.png` — 1440 × 5920, Arabic, RTL
- `docs/qa/boq/boq-mobile-375-en.png` — 375 × 6945, English
- `docs/qa/boq/boq-mobile-375-ar-rtl.png` — 375 px, Arabic, RTL
- State: authenticated ACCO tenant, project `PRJ-A2SBM` "Hodan District Office Tower",
  BOQ Version 2 (draft revision off baselined Version 1) — **24 sections, 43 items,
  38 priced, 5 blockers, USD 13,638,194.00**. Seeded over the HTTP API so every row passed
  the same validation a user's would.
- Captures are full-page at real viewport widths, taken with Playwright rather than a
  browser window: Chrome on Windows refuses to size below its minimum, which is why 375px
  had been unverifiable in earlier phases.

## Automated gates

| Gate | Result |
|---|---|
| `apps/api` suite (real Postgres `rukna_acco`, `--runInBand`) | **33 suites / 235 tests** green, incl. 34 new BOQ tests |
| `apps/web` typecheck | clean |
| `apps/web` lint over the BOQ feature, workspace shell, `api-types.ts`, `format.ts` | clean — **zero token-rule warnings**, where the old BOQ files warned on radius, elevation and type |
| `apps/web` unit/component suite | **87 files / 1288 tests** green |
| `apps/web` production build | succeeds |
| i18n | 197 `platform.boq` keys per locale, en/ar parity asserted before writing |

## Measured in the browser, not eyeballed

`document.documentElement.scrollWidth - clientWidth` was read on every capture:

| Capture | `dir` | `data-theme` | Document overflow | Console |
|---|---|---|---|---|
| desktop en light | ltr | light | **0px** | clean |
| desktop en dark | ltr | dark | **0px** | clean |
| desktop ar | **rtl** | light | **0px** | clean |
| mobile 375 en | ltr | light | **0px** | clean |
| mobile 375 ar | **rtl** | light | **0px** | clean |

`dir` and `data-theme` are read off the DOM rather than assumed. A first pass invented a
`NEXT_LOCALE` cookie and a `rukna-theme` storage key — neither is what the app uses — and
produced five English light-mode screenshots that would have been filed as a passing RTL and
dark-mode run. Locale is the `lang` cookie (`user-menu.tsx`); theme is
`rukna.theme.preference` (`theme-store.ts`). **Assert the switch took; do not assume it.**

## What the captures confirm

- **Navigation reads BOQ.** Tab 2 is "BOQ" / "جدول الكميات", and the breadcrumb ends in the
  active tab rather than "Overview" on every screen.
- **The header states the contractual position before offering a choice of version** —
  title, Draft badge, "Version 2 · Based on approved Version 1 · 45 changes · $13,228,764.00".
  Version switching moved to the history panel, where the facts that inform it are visible.
- **The facts strip is rule-separated, radius-free and shadow-free**, matching the polished
  shell. In RTL the `sm:odd:border-e` dividers land on the correct edge with no rtl: variant.
- **Readiness is the server's verdict**, rendered: "5 items require attention", "5 items
  missing rate", and a Review control that filters the grid to those rows. The Submit for
  baseline button is disabled because the server would refuse it.
- **Section rows carry computed totals in Decimal** — `$207,600.00`, `$1,062,960.00`,
  footer `$13,638,194.00` — summed bottom-up as strings, not floats.
- **Numbers survive RTL.** In the Arabic capture every quantity, rate and amount reads
  left-to-right (`4,250.000`, `12.00`, `51,000.00 US$`). `LtrValue` is doing this;
  `tabular-nums` alone does not fix bidi, and BOQ is the most number-dense screen shipped.
- **Indentation is logical**, flowing from the trailing edge in RTL, and chevrons rotate.
- **375px scrolls the grid inside its own region.** The document does not scroll sideways in
  either direction; the tab bar collapses to a native select; the facts strip stacks.
- **Dark mode works with no `dark:` class anywhere** — semantic tokens only.
- **One row menu, not six buttons.**

## Follow-ups, not blockers

- The disabled primary button ("Submit for baseline") is low-contrast against the dark
  surface. That is `packages/ui` Button's disabled state, not BOQ's, and affects every
  screen with a gated primary action — worth a separate look.
- The dev tenant now carries a seeded draft revision (Version 2) on `PRJ-A2SBM`. It is a
  draft, so "Discard draft" removes it and returns the project to baselined Version 1.

---

# BOQ workspace — decision clarity and semantic colour, 2026-08-14

## Why a second pass

The first pass was correct and matched the design language, and it still left a user asking
"where do I start". Reviewed against the shipped screenshots:

- **The action hierarchy was inverted.** The only enabled forward action, "Review 5 blockers",
  was a small outline button inside a *dismissible* banner. The visual primary, "Submit for
  baseline", was disabled — the one element drawing the eye was the one that could not be
  pressed. "Add section" was a second blue primary. Four buttons, none saying *do this next*.
- **Colour carried no meaning.** Blue was the active tab, links, both primaries, the progress
  bar and the selected row. A fully priced BOQ looked identical to a half-priced one, because
  the completeness bar was `brand-primary`.
- **The page repeated itself.** The number 5 appeared three times in one banner, "38 of 43"
  twice within 100px, and the version relationship in three places.
- **Two visually identical 4-tile rows** (project, then BOQ) left no way to tell context from
  subject.

## Evidence

- `docs/qa/boq/boq-fold-1440x900.png` — **what a laptop actually sees**, viewport-sized
- `docs/qa/boq/boq-sticky-scrolled.png` — the sticky context bar, scrolled 1400px in
- `boq-desktop-en-light.png` · `boq-desktop-en-dark.png` · `boq-desktop-ar-rtl.png`
- `boq-mobile-375-en.png` · `boq-mobile-375-ar-rtl.png`

State: `PRJ-A2SBM`, BOQ Version 2 draft — 24 sections, 43 items, 5 unpriced, USD 13,638,194.

## Measured, not eyeballed

| Check | Result |
|---|---|
| `dir` / `data-theme` read off the DOM | ltr/light, ltr/dark, **rtl**/light, 375 ltr, 375 **rtl** |
| Document horizontal overflow, all five | **0px** |
| Console, all five | clean |
| Sticky bar after a 1400px scroll | present at `top: 0` — `BOQ ǀ V2 ǀ Draft ǀ $13,638,194.00 ǀ Price 5 items` |
| Table header top at 1440×900 | **818px** (visible) |
| First data row top at 1440×900 | **862px** (partially visible; was 934px) |

## Two faults the screenshots hid, found by measuring

**The sticky bar never appeared.** `useIsOffScreen` took a `RefObject` and observed
`ref.current` in an effect keyed on the ref's identity. The workspace renders a skeleton
while its query is pending, so on the first commit `current` was null, the effect bailed —
and a ref's identity never changes, so it never ran again once the real element mounted. It
is now a **callback ref**, keyed on the node. A full-page screenshot is taken at scroll zero
and could never have caught this.

**Zero *complete* data rows above the fold**, then and now. See the outstanding item below.

## What changed

- **One primary, resolved from state, never disabled** — `features/boq/boq-next-step.ts`,
  13 unit tests. Unready draft → "Price 5 items" (amber); ready → "Submit for baseline"
  (blue); baselined → "Start revision". The fix steps carry the blocking node ids, so the
  button is the navigation as well as the instruction. Everything else moved to a `⋯` menu,
  and "Add section" dropped to outline.
- **The BOQ band is a status bar, not a second tile row** — state-coloured leading edge,
  value dominant, counts on one line. Absorbed the old header and summary strip.
- **The progress bar is amber below 100% and green at 100%.** A status carrier has to look
  different when it reaches its finished state; brand blue could not.
- **Unpriced rows carry an amber leading edge** instead of a 6px dot — visible in
  `boq-sticky-scrolled.png` while scrolling, which is exactly when a dot is not.
- **Banner deduplicated**: the specific line is the headline ("5 items need a rate before
  this BOQ can be baselined"), with a consequence line, and it is **not dismissible while it
  owns the only next step**.
- **Footer disambiguated**: "Showing 26 of 67 rows" and "BOQ total", with a "Visible" subtotal
  only while filtered — the count and the figure now describe the same set of rows.
- Colour semantics written into `docs/02-architecture/frontend-theme.md`, so this is a rule
  rather than a one-screen choice.

## Outstanding

**No *complete* BOQ row is visible at 1440×900.** The first row begins at 862px against a
900px viewport, so it is cut. This pass reclaimed 147px (1042 → 862) from the BOQ's own
bands; the remaining ~530px is the project shell — breadcrumb, project header, lifecycle
strip, tab bar and the four project tiles — which renders on every project tab and was
deliberately left alone.

Closing it needs a shell decision, not a BOQ one: collapse the four project tiles on
sub-tabs, or make them collapsible with a remembered preference. That affects Overview,
Commercial and Team as well, so it is not the BOQ feature's call to make unilaterally.

**Minor:** TYPE and UNIT still read faintly cool. They are now `text-foreground/55` rather
than `text-muted-foreground` (`#667085`), but `--foreground` is itself a navy (`#172033`),
so any tint derived from it keeps a slight blue cast. Genuinely neutralising them would mean
adding a colour outside the closed token set, which the theme rules forbid.

## Colour-consistency review, same day

Reviewed the shipped result against the semantics table it was supposed to follow, measuring
computed styles rather than judging from screenshots. Five contradictions, four of them
introduced by the pass that was meant to fix colour:

| Fault | Measured / seen | Fix |
|---|---|---|
| The primary action was filled with `warning` | `rgb(154, 91, 19)` — **brown**, not amber. `--warning` is sized for text contrast on a light surface, so as a fill it renders mud. It also contradicted the rule that brand is the interactive colour and nothing else. | Primary is always `brand-primary`. Urgency stays on the banner and the row edges, where state belongs. |
| "Contract baseline" wore `accent` | Accent maps to the **historical purple**, which SUPERSEDED wears in the same list — a live contractual reference and a dead version in one colour. | `info` |
| `DRAFT` was amber in the status bar and blue in the version panel | Two colours for one badge | Both amber; the maps now carry a note to stay in step |
| A blue ✓ sat beside a "Draft" badge | A tick reads as approved | Replaced with a "Viewing" label; the row is already tinted and carries `aria-current` |
| The revision delta was amber | A warning colour on a figure that is a fact — a revision adding scope is not a problem | Neutral, with an explicit `+` sign |

**Not fixed, and why.** TYPE and UNIT measure `oklab(0.245, −0.004, −0.039)` — genuinely
blue-shifted. That is the product's grey ramp, not a BOQ choice: `--foreground` is the navy
`#172033`, so every grey derived from it carries the cast. An earlier attempt at
`text-foreground/55` only produced an off-system value on one screen and did not change the
hue. These are back on `text-muted-foreground`, the sanctioned token. A warmer ramp is a
token decision for the whole product.

## Shell pass — completed stages read green, and the BOQ clears the fold

Two faults raised in the review were in the project shell rather than the BOQ, so they were
put to the owner before being touched. Both approved.

**Completed lifecycle stages are green.** The strip was brand blue from Draft up to the
current stage, which made the colour say "brand" rather than "done" — and blue is the
interactive colour everywhere else. Now: green circle, tick and connector for a stage already
passed; blue ring for the stage in progress; grey ahead. Applies to every project tab.

**The four project tiles show on Overview only.** MAIN CONTRACT / PROGRAMME / PROJECT MANAGER
/ CURRENT STAGE are the project's headline facts and Overview is where they are read. Above a
working tab they were a second, competing tile row — on BOQ that meant eight visually
identical boxes. Identity, lifecycle and tabs stay on every tab, so nothing about *which*
project or *where it stands* is lost; the facts are one tab away.

Guarded by two tests in `project-workspace-shell.test.tsx` — present on Overview, absent on
BOQ, heading still rendered — so the rule cannot revert silently.

### Fold, measured at 1440×900

| Pass | First data row | Complete rows above the fold |
|---|---|---|
| Original rebuild | 1042px | 0 |
| Decision-clarity pass | 862px | 0 |
| **Shell pass** | **765px** | **1** |

Evidence: `docs/qa/boq/boq-fold-1440x900.png` (BOQ, tiles absent) and
`docs/qa/boq/project-overview-tiles-retained.png` (Overview, tiles present).

All five captures re-taken: `dir` and `data-theme` verified off the DOM, document overflow
0px, console clean. 88 test files / 1303 tests, typecheck, lint on the touched files, and the
production build green.
