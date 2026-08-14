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

## Result

**Automated gates: pass. Browser visual pass: not run — blocked on the demo tenant password.**

Recorded honestly rather than marked complete, following the pattern the Phase 3B entry set:
a QA section that claims a browser pass it did not perform is worse than one that names what
is outstanding.

## What was verified

| Gate | Result |
|---|---|
| `apps/api` integration suite (real Postgres `rukna_acco`, `--runInBand`) | **33 suites / 235 tests** green, incl. 34 new BOQ tests |
| `apps/web` typecheck | clean |
| `apps/web` lint over `features/boq`, the workspace shell, `lib/api-types.ts`, `lib/format.ts` | clean — **no token-rule warnings**, which the old BOQ files produced on radius, elevation and type |
| `apps/web` unit/component suite | **87 files / 1288 tests** green |
| `apps/web` production build | succeeds; `/projects/[id]/boq` compiles |
| i18n | 197 `platform.boq` keys per locale, en/ar parity asserted before writing |

Backend correctness is covered by tests that could not be faked at the UI layer: decimal
line and section totals (`0.100 × 1.00` summed three times is exactly `0.30`), currency
rejection, duplicate-code rejection, transactional sibling reindex on move, subtree path and
depth rewrite, delete blocked by a real `CommitmentLedgerEntry`, org isolation, the
governance gate returning 409 and completing on re-drive, and commercial figures withheld
from a caller without `view:boq`.

## What is outstanding

The browser pass in the plan — `/design` gallery with theme, direction and density switched;
Playwright at 375px and 1440px; en and ar; light and dark; the twelve required states; and a
400-item BOQ for scroll and render — needs a sign-in. `apps/web/e2e/fixtures.ts` requires
`RUKNA_DEMO_PASSWORD`, which is not in the repo or either `.env`, and `admin@acco.com` did
not match any guessed value. Resetting that password would change the developer's own
environment, so it was left alone.

Everything the pass needs is in place: the e2e harness, `playwright.config.ts` with its
375px project, and the seeded scenario in `global-setup.ts`.

## Design decisions to check when the pass runs

- The header lost its card framing, matching `a25c3e1` — full-bleed rules, no radius, no shadow.
- Info surfaces carry `border border-border` and **no** `shadow-e1`; only the readiness panel
  is raised, because it is an interruption rather than a container.
- The facts strip is rule-separated with `sm:odd:border-e lg:not-last:border-e`; verify the
  dividers land on the correct edge in RTL, which is the whole reason they are logical.
- Every figure is wrapped in `LtrValue`. In Arabic, an unwrapped `12,585,000.00` reverses —
  `tabular-nums` does not fix bidi, and BOQ is the most number-dense screen in the product.
- The grid scrolls inside `TableScroll`. The page body must not scroll sideways at 375px.
- One row menu, not six buttons. Verify the 44px touch target on the chevron survives.
