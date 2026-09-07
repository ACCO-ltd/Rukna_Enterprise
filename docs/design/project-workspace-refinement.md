# Project Workspace — shell + Overview refinement

**Status:** built, plus one review-driven refinement pass. Architecture frozen — the next
phase is the BOQ tab. **Scope:** the persistent project shell (`/projects/[id]/*`) and the
Overview tab only. **Date:** 2026-09-05.

No other project tab was redesigned. BOQ, Progress, Commercial, Procurement, Finance, Documents
and Team keep their content and inherit the new shell.

---

## 1. What the shell is for

The project is the root entity, and three operational spines hang off it:

```text
Scope     BOQ → Contract
Revenue   IPA → IPC → Invoice → Receipt
Cost      MR → PO → GRN → Bill → Payment
```

The shell exists to answer three questions on every tab and nothing else:

1. What project am I in?
2. What state is it in?
3. What should I do next?

Everything that is not one of those three was pushed down into Overview, because the shell is
rendered above eight tabs and anything it carries is a cost paid eight times.

---

## 2. Decisions

| Area | Decision |
|---|---|
| Global sidebar | Untouched |
| Breadcrumb | Kept, quiet (13px muted, leaf in foreground). Leaf names the active tab, not always "Overview" |
| Project icon | **Removed.** Every project had the same building glyph — it encoded nothing and shifted the title |
| Project title | `text-h1` (24px) at semibold, not bold. Strongest element on the page, not a marketing heading |
| Identity line | `CODE · Client · District, Location`. Icons dropped; separators already delimit |
| Commercial model | **Out of the identity line.** It is configuration, and it reads on Overview under Commercial foundation |
| Status badge | Compact, beside the title. Neutral for Preparation; colour never says "clickable" |
| Lifecycle rail | **Overview only.** Project stage is project-level context; a BOQ editor already knows the project |
| Summary tile row | **Deleted.** Main contract, programme, physical progress and current stage are each now stated once, in the Overview section that owns them |
| Header actions | Moved **into the shell** from the Overview page. They used to be portalled up, so seven tabs had an empty header |
| Primary CTA | Readiness-driven: `Continue setup` while preparation is unfinished, `Start project` once it is not |
| `Edit` button | **Removed from the header.** Ambiguous at project level; now `Edit project information` in the overflow |
| Tab order | Overview → BOQ → Progress → Commercial → **Procurement → Finance** → **Documents → Team** |
| BOQ naming | Kept as **BOQ**. It is a versioned, baselined bill of quantities; "Planning" would be less precise |
| Tab styling | 16px icons, one stroke weight in both states, 48px row, underline for active |
| Sticky compact header | **Not built.** Optional in the spec; the shell is structured so it can be added without a rewrite |

### User-facing state names

Backend states are unchanged. The UI translation stays:

```text
DRAFT → Preparation          CLOSEOUT → Closeout
ACTIVE → Active              CLOSED   → Closed
PRACTICAL_COMPLETION → Practical completion
CANCELLED → Cancelled
```

`PRACTICAL_COMPLETION` moved from the amber `warning` tone to violet `accent`. Amber read as a
warning about a project that had just achieved a milestone, and it collided with `CLOSEOUT`,
which is genuinely amber because work is still outstanding.

---

## 3. The primary action follows readiness

`getAvailableActions()` says a `DRAFT` project's forward command is `start`. The server refuses
it until the BOQ is baselined, the main contract exists and a delivery team is assigned — so a
permanent `Start project` button on a fresh draft is a button that exists to be rejected.

```text
DRAFT + readiness unfinished  →  [Continue setup]  → first open step
DRAFT + readiness complete    →  [Start project]
DRAFT + readiness loading     →  (nothing yet)
DRAFT + readiness unreadable  →  [Start project]   → server decides
ACTIVE and later              →  that state's own command, ungated
```

The step it goes to follows the dependency order: BOQ → contract → team. The server remains the
authority (`constraints.md:299`); this only decides what to *offer*.

While readiness is loading the CTA is held back rather than rendering `Start project` and
swapping it a beat later — the reader may already have clicked.

---

## 4. Overview is lifecycle-aware

Not a fixed set of panels. Preparation and a running project ask different questions.

**Preparation** — *what is stopping this project from starting?*

```text
Project lifecycle
┌──────────────────────────────┬───────────────────────┐
│ Project readiness            │ Project information   │
│                              │ Commercial foundation │
│ Cost position                │ Recent activity       │
└──────────────────────────────┴───────────────────────┘
```

**Active and later** — the readiness checklist disappears entirely rather than standing as a
permanent "4 of 4 complete", and physical progress plus the revenue chain take the lead:

```text
Project lifecycle
Contract value · Certified · Invoiced · Received · Outstanding
┌──────────────────────────────┬───────────────────────┐
│ Physical progress            │ Project information   │
│ Cost position                │ Commercial foundation │
│                              │ Recent activity       │
└──────────────────────────────┴───────────────────────┘
```

Grid is `1.4fr / 1fr` on `lg` (58/42), single column below. Not `RecordLayout`'s 1.7/1: that
ratio is tuned for a narrow summary rail beside a wide table, and here the right column carries
three full sections of label/value pairs. Widths in §11.

### One panel per region — reversed after seeing it rendered

**First build: open hairline `SectionHeader` sections.** That is the doctrine's default (§2.1),
it is what the review's own §34–§36 argued for, and it was the wrong call *here*. Rendered, the
page had no separation between areas at all.

The reason it failed is specific and worth keeping: **the review's flat sketches were all single
column.** In one column a `SectionHeader`'s rule genuinely separates what is above it from what
is below. In two columns the same treatment produces rules at six different heights across the
page, the left and right column's rules read as one long broken line, and nothing bounds any
region — so five named areas of the page dissolve into one field of text on grey.

So each region is now a `RecordPanel`: the existing shared primitive, unchanged. Bounded
surface, hairline title bar, action on the right, hint under the title.

```text
Panel per REGION   ✔  six named areas of one page
Panel per FACT     ✘  the original Overview's three identity cards — still the anti-pattern
```

That is the distinction `ux-doctrine.md` §7 is actually drawing with *no card around every
element*. Definition rows went back to hairlines, because inside an edge they read as one table
rather than as loose rules on an open page — which is the composition `DefinitionRow` was drawn
for. Per-fact boxing stays rejected.

**Region icon tiles were then adopted** (owner call, 2026-09-05), and `ux-doctrine.md` §7 was
amended rather than left contradicting the flagship page. Each panel header carries one
accent-tinted 32px tile before its title via `RecordPanel`'s new `icon` prop — Route, ListChecks,
FileText, Building2, Coins, History, Activity. The rule that survives is the one §7 should have
said in the first place: **one accent, one size, region level only, `aria-hidden`**. A grid of
multi-hued tiles one-per-metric is still the anti-pattern.

`ProjectProgressCard` was converted too. It had hand-rolled its own surface, one hairline
lighter than its neighbours, which read as a mistake once everything around it was a panel.

---

## 5. Project readiness

The horizontal four-node stepper is gone. Four equal boxes in a row is exactly the shape that
hides a dependency, and the contract genuinely is gated behind a baselined BOQ.

```text
PROJECT READINESS                                       1 of 4 complete
────────────────────────────────────────────────────────────────────────
████████░░░░░░░░░░░░░░░░░░░░░░░░                                    25%

✓  Project created            The project exists and its basic information is set.
2  Baseline Bill of Quantities                              [Open BOQ →]
   Define and baseline the BOQ for this project.
🔒 Create and execute main contract                            (Blocked)
   Issue the main contract against the baselined BOQ.
4  Assign project team                                   [Add members →]
   Add the people who will work on this project.

ⓘ The main contract becomes available once the BOQ is baselined.
```

- Step states: `complete` (green check) · `actionable` (brand-filled number) · `pending`
  (outlined number, keeps its action) · `blocked` (amber lock + Blocked badge, **no** action link
  to a screen that would reject the work).
- Only the first open step gets the brand marker. Two blue markers would be two answers to
  "what now".
- The dependency is explained **once** — the row carries the badge, the notice carries the
  reason. Not both per step.
- Internal-capital projects render three steps, matching the server's `totalSteps: 3`.

The shared `SetupChecklist` component was **not** reused: it is the horizontal form this
replaces, and it hardcodes pixel font sizes. It still serves `progress-overview-header.tsx`;
converging the two is a follow-up, not this slice.

---

## 6. Project information vs Commercial foundation

The old single "Project details" list mixed what a project *is* with how it is *configured*.

**Project information** — classification and delivery shape:
Category · Subtype (when set) · Participation model · Location · Start date · Completion date ·
Description. Contextual `Edit` link, draft only.

**Commercial foundation** — what the project stands on commercially:
Commercial model · BOQ · Main contract · Contract value (only once a contract exists) · Currency.
`Open Commercial →`.

Two rules on absence:

- **Optional and empty → drop the row.** A column of `—` is a picture of the database schema.
  Description, dates and location disappear when unset.
- **Operationally absent → say what has not happened.** `Main contract — Not created`, BOQ
  `Not started` / `Working · Not baselined` / `Baselined`. An em-dash says a value is missing;
  it does not say what to do about it.

Project code and client are **not** repeated — both are in the shell header, two lines up.
Billing model is hidden entirely rather than shown empty: the workspace summary does not carry
it, and inventing a row for it would be fabricating a field.

### Currency belongs to the contract

Audited after the Overview showed `Currency —`. `toCreateProjectPayload` deliberately never
sends a currency:

> *"Commercial value and currency intentionally do not travel through this workflow. The main
> Contract owns those values; legacy Project columns remain read-compatible only."*

So `Project.currency` is a nullable legacy column that is **NULL on every project the app
creates**, and there is no organisation-level default anywhere in the codebase (`defaultCurrency`
exists only on `Supplier`). Before a contract exists there is genuinely no answer.

The row is therefore **dropped until something authoritative defines it** — contract currency
first, the legacy project column second — on exactly the same rule as contract value above it.
It is emphatically not defaulted to USD: ACCO being USD-only (ADR-024) is a tenant fact, not a
licence for the UI to state a currency nobody chose.

---

## 7. Cost position — and the warning that came down

`ProjectCommitmentsCard` gained a `presentation` prop: `panel` (the Procurement tab's bounded
card, unchanged) and `section` (Overview's hairline metric strip — Committed · Accrued · Actual
with a one-line explanation under each, and `Open Procurement →`).

**The standing accuracy warning was removed from both surfaces.** It claimed committed cost may
overstate because cancelling a PO writes no reversal (P12) and superseding over-reverses (P11).
Both are fixed on the server:

- `PurchaseOrderService.cancel()` writes a `PO_CANCELLED` reversal per active line inside a
  transaction.
- Supersede reverses only the net `COMMITTED` balance, summed per line via
  `queryByPoLineAndStage()`.
- `frontend-blockers.md` marks P11 and P12 **fixed**, along with the whole P-series.

A permanent notice about a defect that no longer exists trains people to distrust figures that
are now correct. This was verified against the service before removal, not assumed.

---

## 8. Recent activity

A feed, not a table: what happened on line one, who and when on line two. Activity labels became
noun phrases (`Project created`) so they read as titles rather than sentence fragments.

**No "View all" link.** The API returns five events (`take: 5`) and there is no project-scoped
history endpoint behind them; `/admin/audit-logs` is org-wide and permission-gated, so pointing
at it would send most readers to someone else's records or to a 403. Same reason there is no
"View history" on the lifecycle rail. `ux-doctrine.md` §4: if the endpoint isn't there, the
control isn't there.

---

## 9. Deliberate deviations from the review

| Review said | What was built | Why |
|---|---|---|
| Summary money as `$0` / `$1.2M` | `$0.00` via `formatMoney` | `ux-doctrine.md` §3 locked two decimals + `$` prefix on 2026-08-26. One card formatting money differently from the rest of the product is worse than a slightly longer figure |
| Panel radius → 8px | Left at the `--radius-panel` token (10px) | Radius is a global token encoding nesting depth. Changing it is a design-system change, not a project-workspace one |
| Every Overview group as a bordered card (mockup) | Hairline sections | See §4 |
| Overview max-width ~1400–1500px | Already 1440px in `AppShell` | No change needed |
| Sticky compact header | Not built | Explicitly optional; deferred with the structure left able to take it |

---

## 10. Backend asks this leaves open

Neither blocks anything shipped here.

| Need | Endpoint | Why |
|---|---|---|
| Project activity beyond five events | `GET /projects/:id/activity` (paged) | Would earn the "View all" link on Recent activity |
| Project lifecycle history | project-scoped audit read | Would earn "View history" on the lifecycle rail |

The project attention feed (`GET /projects/:id/attention-items`, `ux-doctrine.md` §6) remains the
gating dependency for the Active-Overview "needs attention" queue sketched in the review §45.
That composition is deliberately **not** built yet.


---

## 11. Refinement pass (post-review)

Architecture approved unchanged; this pass was polish only. Nothing in §2's decision table moved.

| # | Refinement |
|---|---|
| 1 | **Currency** — audited and fixed. See §6. |
| 2 | **Casing** — audited, no code change. See below. |
| 3 | **Divider density** — see the correction below. |
| 4 | **Readiness action priority** — the current step keeps the outlined button; a later open step drops to `ghost`. |
| 5 | **`Continue setup` destination** — verified; already optimal. |
| 6 | **Lifecycle weight** — upcoming labels to `muted-foreground/70`, dots to `border/70`, connectors to `success/40` and `border/60`. |
| 7 | **Column balance** — `1.6fr/1fr` → `1.4fr/1fr`. |
| 8 | **Section rhythm** — page and column gaps `6` → `7` (24 → 28px); shell bottom margin `4` → `6`. |
| 9 | **Cost position** — metric values `text-h2` → `text-h1`. |
| 10 | **Long names** — `min-w-0` + `truncate` + `title` on the metadata line and breadcrumb. |
| 11 | **RBAC** — a gap, not a preservation. See below. |

### Divider hierarchy

The section-over-boxes doctrine had swung into line-after-line: a rule under every definition
row, every readiness step and every activity item, on top of each section's own rule. `SectionHeader`
keeps its hairline; the rows below it are now separated by space.

`DefinitionList` gained a `separator` prop (`'hairline' | 'spacing'`, default `hairline`) rather
than the callers hand-rolling it — this is a product-wide hierarchy question, not a project-page
one. `record-layout.tsx` needed `'use client'` for the context; every consumer was already a
client component, so nothing regressed.

### Casing — a data-quality finding, no code change

The lowercase values on screen (`office building`, `ministry of health`, `waabari, hotel sahafi`)
are **stored data**. There is no casing transform anywhere in the project surfaces — the only
`toUpperCase()` is on the tenant slug in the project-code preview, and the only `toLowerCase()` is
search normalisation.

No `capitalize()` was added. Title-casing a construction ERP's names corrupts `ACCO Tower`,
`UNDP Somalia`, `eCommerce Center`, `iRise Hub` — and it would be lying about what is stored.
This is a data-entry / seed-data matter, and if a display-normalisation policy is ever wanted it
belongs in the domain, not in a presentation hack.

### `Continue setup` — verified, unchanged

At 2 of 4 (BOQ baselined, no contract) it resolves to `/contracts/new?projectId=<id>`. That route
exists, and `ContractForm` reads `searchParams.get('projectId')` into its initial values — so the
reader lands on the contract creation form with the project already selected and no further
decisions. `/projects/[id]/commercial/main-contract` is only a redirect to `contract-security`,
which would show the main-contract panel and need another click. No change made.

### RBAC — a gap that was closed, not preserved

The review asked to preserve RBAC on the contextual Edit. **There was none to preserve.** Every
write route on a project carries `@RequirePermissions(PERMISSIONS.projectsManage)` — `PATCH
/projects/:id`, `start`, `practical-completion`, `closeout`, `close`, `cancel`, `suspend`,
`resume` — and the UI gated only on lifecycle status, so a read-only member saw "Start project"
and learned their own permissions by collecting a 403.

New `features/projects/permissions.ts` mirrors `progress/permissions.ts`. `ProjectActionsPanel`
renders nothing without `manage:project`; the contextual Edit link needs it too, on top of the
draft-only lifecycle rule. The API remains the security boundary.

### Column widths, computed

Sidebar `--sidebar-width: 17rem` (272px), main `lg:px-8`, `max-w-[1440px]`, grid gap 28px:

| Viewport | Right column before (1.6fr) | Right column after (1.4fr) |
|---|---|---|
| 1366 | 385px | **417px** |
| 1440 | 414px | **448px** |
| 1536 | 451px | **488px** |
| 1920 | 519px | **562px** |

`RecordLayout`'s own note puts the wrapping threshold for a definition list near 360px, so the
old ratio left the right column ~25px of headroom at 1366 while the left column had room to
spare. These are computed from the layout tokens, not measured in a browser.


---

## 12. Correction: the flat composition was reversed

Recorded because the reasoning matters more than the outcome.

**What happened.** The refinement pass reduced divider density — one rule per section, whitespace
inside it. Correct in principle, and it made the page worse: with the row rules gone and nothing
bounding a region, the whole Overview read as undifferentiated text on grey. The complaint that
came back was exactly right — *there is no separation between areas*.

**What was wrong.** Not the divider reduction. The missing half. The review's §35 model is:

```text
Page background
  → project shell header
  → open content surface        ← never built
  → hairline section separators ← built
```

Hairline separators were shipped without the surface they were supposed to separate content
*within*. And a two-column layout needs the bounding more than a one-column layout does, because
rules at mismatched heights across a gutter read as noise rather than structure.

**What changed.** Six regions → six `RecordPanel`s, reusing the shared primitive rather than
inventing panel styling. Gaps back to `5` (20px) from `7`, since panel edges now do the
separating and the gutter only has to stop them touching. Definition rows back to hairlines.

**What was reverted.** The `separator` prop added to `DefinitionList` in the refinement pass, and
the `'use client'` it forced onto `record-layout.tsx`. With rows inside panels the hairline
default is right again, so the prop had no consumer, and shipping an unused API is its own kind
of mess. `packages/ui` is untouched by this work.

**The lesson for BOQ.** *Sections over boxes* is a rule about not boxing individual facts. It is
not a rule against bounding a region, and in a multi-column layout an unbounded region is not a
section — it is just text that happens to have a label above it.
