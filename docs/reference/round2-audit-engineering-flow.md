# Round 2 — Stage 1 Audit: Engineering Delivery Flow

Status: Findings (pre-proposal). Method: heuristic grill against `ux-doctrine.md` + Nielsen
heuristics, grounded in the actual components (not the stale `frontend-design.md`), and
confirmed by a live walk of an Active seeded project (**Hodan District Office Tower**,
`PRJ-V26NG`, contract `ACCO-2026-V26NG`) at 1280px and 633px, logged in as `admin@acco.com`.
Captures: `docs/qa/round2-engineering/` (Overview desktop + mobile, BOQ, Progress, Commercial
applications). Two deep screens — the **IPA detail** and the **IPC issuance wizard** — were
grilled from code only; live confirmation of their rendering is still owed (see the owed-work
note at the end).

Scope: the daily construction chain — project workspace shell + Overview
(`project-workspace-shell.tsx`, `features/projects`), BOQ (`features/boq`, the reference tab),
Progress/DPR (`features/progress`), IPA (`features/ipa`), IPC (`features/ipc/wizard`). Plus the
cross-tab interaction language.

Severity: **S1** blocks the goal (enterprise / zero-training / not-messy) · **S2** meaningful
friction · **S3** polish. Each finding names the *decision behind it*, per the grill method.

---

## Verdict up front

The flow has **one genuinely excellent tab and a chain that drifted around it.** BOQ is the
reference the brief promised — `resolveNextStep`/`NextStepButton` gives it exactly one primary
that is never disabled, a status-carrying progress bar, a readiness banner that *is* its
attention queue, neutral money, an overflow menu instead of a button row, and strict token
discipline (**zero** raw `rounded-lg`/`shadow-sm`/`text-[..]` in the whole feature). Confirm it
and hold it up as the pattern.

The rest of the chain is not broken, but it drifted in three consistent directions. **First,
composition:** the project Overview is a *strip done right followed by five bordered cards done
wrong* — a hairline metric strip (good) sitting on top of six panels that restate the same
facts (Programme appears three times: strip, lifecycle, and a card). The IPC wizard, IPA detail,
progress sections, and Step-3 review all reach for "a bordered box around every group", the
single anti-pattern the doctrine calls the main source of mess. **Second, tokens:** the
IPA/IPC/progress feature set carries **40 raw-utility occurrences across 11 files** (`rounded-xl`,
`shadow-[var(--shadow-panel)]`, `text-[26px]`, `text-2xl`) where BOQ and the shell use tokens —
so the same "card" renders at a different radius and elevation depending on which tab you are on.
**Third, one-primary and next-step:** BOQ answers "what do I do next"; Progress opens with an
always-expanded create form and no next-step, and the two application list UIs disagree.

Two things are better than the shell/dashboard audit feared. The **project-scoped attention feed
already exists and renders** — `GET /projects/:id/workspace-guidance` backs the "Setup and
control guidance" panel on Overview (it showed "No immediate attention required" live). And the
top bar now carries a real **⌘K "Search or jump to"** entry, not the dead bell. The Overview's
attention panel is the model the *portfolio* dashboard (D1) still needs.

> **Money format — resolved by decision (2026-08-26), not a defect.** This audit originally flagged
> the leading-symbol form (`$4,500,000.00`) as a doctrine violation. The owner chose to **keep the
> `$` prefix** (USD-only, reads lighter); the doctrine §3 was corrected to match, and `formatMoney`
> is already correct. The former P3/X6/B2 "money" findings are struck below. Money is correctly
> **neutral** everywhere (never heat-mapped) — that stays.

---

## Project workspace shell + Overview

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| P1 | **S1** | Overview is a metric strip (good) followed by **six bordered cards that restate the strip**: "Client information", "Programme", "Responsibility", then "Delivery progress", "Commercial snapshot", "Cost Commitments". Programme is shown three times (strip tile, lifecycle strip, card); Current stage twice; Main contract twice. For an Active project the question "is this healthy / what needs attention" is answered by the one guidance panel — the rest is a field dump wrapped in the "card around everything" anti-pattern (§2.1, §7). | Built as a reference layout before the guidance feed existed; every fact got its own panel. | Lead with the guidance panel + strip. Demote the three identity cards (`project-detail.tsx` `groups[]`) to a single hairline `SectionHeader` "Project details" with a 2-col definition list — no per-group borders. Keep Delivery/Commercial/Commitments as cards only because each owns a link and sub-content, but drop the duplicated rows already in the strip. |
| P2 | S2 | The shell renders a 4-tile summary `<dl>` **and** the Overview body renders its own card rows — the shell's own code comment admits this is "a second, competing tile row" and suppresses it on non-Overview tabs, but on Overview both still show. | Two authors: the shell added the strip; `project-detail.tsx` predates it and kept its cards. | Make the shell strip the single summary. Overview body should assume the strip exists and not restate contract/programme/PM/stage. |
| ~~P3~~ | — | ~~Money renders `$4,500,000.00` (symbol prefix) not the doctrine suffix.~~ **STRUCK — resolved by decision (2026-08-26): keep the `$` prefix; doctrine §3 corrected to match. `formatMoney` is already correct.** | — | No change. Money is correctly neutral — keep. |
| P4 | S3 | `LifecycleStrip` (dots + connectors, green/blue/grey) is **correct** and matches §2.5. Header = one primary + overflow. Breadcrumb derives the active crumb. ⌘K present. | — | **Keep.** These are the shell's strengths; they are already doctrine-aligned. |
| P5 | S3 | Dead `rtl:` handling throughout the shell (`rtl:rotate-180`, `rtl:` translate) and a `locale as 'en' \| 'ar'` cast, though Arabic is removed (§3). Same dead weight the shell/dashboard audit flagged (N5). | Built bilingual; Arabic removed PR #73. | Remove as its own broad pass across the flow, not inline. |

## BOQ (reference tab)

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| B1 | S3 | **Reference-grade.** One primary that is never disabled (`boq-next-step.ts`), status-carrying progress bar (green at 100%), readiness banner as the attention queue, overflow menu not a button row, tokens only (0 raw utilities), sticky action bar, mirror-shaped skeletons. Confirmed live. | ADR-016 rebuild. | **Keep and hold as the pattern** every other tab is measured against. |
| B2 | S3 | Money shows **both** a `$`-prefixed header total (`$409,400.00`) and `(USD)`-suffixed column headers — internally inconsistent even here. | `formatMoney` prefix (P3) vs. hand-written column labels. | Resolved by P3: once money is suffix-formatted, drop the `(USD)` from the column labels or keep it — but pick one. |
| B3 | S3 | Dead ternary `mode: canManage ? 'edit' : 'edit'` in the grid `onSelect` (`boq-workspace.tsx`). Harmless, but a smell. | Leftover from a view/edit split. | Simplify to `'edit'`. |

## Progress / Daily Progress Reports (ADR-021)

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| PR1 | **S1** | Progress introduces a **third navigation level**: an inner tab bar (Daily Reports / Verified / Milestones / Work Packages / Performance) inside the workspace tab bar — exactly the nesting §5 forbids ("no third nesting level"). Confirmed live. Commercial does the same (see X-series). | ADR-021 packed four truths into one route with client sub-tabs. | Accept the four truths, reject the tab-in-tab. Either split into peer workspace tabs, or present as anchored sections down one scroll (a `SectionHeader` per truth) so there is one level of chrome, not two. Needs a product call — flag, do not guess. |
| PR2 | **S1** | The Daily Reports surface **opens with an always-expanded "New daily report" form** above the list, and the tab has **no page-level next-step**. The eye lands on an empty form, not on "which DPRs are waiting on me to approve/return". A site engineer's actual daily question — what needs verifying — is unanswered. | The list and create form were built together; create was placed first for convenience. | Collapse create behind a single "New daily report" primary (BOQ pattern). Lead with the list, sorted/summarised by status (SUBMITTED-awaiting-me first). The reopen/return/approve lifecycle (ADR-021) is already correct in `dpr-detail.tsx` — surface *which* reports sit in each state. |
| PR3 | S2 | Every section is a bordered panel (`daily-reports-section`, `dpr-detail` header / measurements / evidence each in their own `rounded-panel border`). Card-around-everything (§2.1). | Each sub-section authored independently. | Convert to hairline `SectionHeader`s; reserve a panel only for the create form when expanded. |
| PR4 | S2 | Two list styles already diverge inside one flow: DPR list is a real `Table` (good, right-aligned numeric labour count); the IPA list is a `<ul>` divide-y. Same "list of records" job, two components. | Grew separately. | Standardise on `Table` for record lists (see X2). |
| PR5 | S3 | `mode: canManage ? 'edit' : 'edit'`-class casts and dead `rtl:` also present here. | Bilingual legacy. | Fold into the P5 RTL pass. |

## IPA — Interim Payment Applications

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| A1 | **S1** | Raw internal **cuid leaked as a user-facing value**: the Commercial applications table renders the certificate as `cmssv27jp004wtgaosje3ajxc` in the CERTIFICATE column instead of a human ref (IPC-0001). Confirmed live. §3 says IDs/codes are human refs in mono, never raw database ids. | The read model returns the cert id and the cell prints it directly. | Show `certificateRef` (fall back to `#certificateNumber`, as `ipc-list-panel` already does). If no ref until issued, show `—`. |
| A2 | S2 | **Two different application-list UIs** in the same flow: the Commercial workspace applications table (read-only, not clickable — a row shows a cuid but you cannot open the cert or the application) vs. the contract-scoped `IpaList` (`<ul>`, clickable `<Link>` rows). A user meets both and they behave differently. | Commercial workspace (ADR-017) added a summary table; `IpaList` is the older per-contract list. | Pick one interaction model. The Commercial table should drill through to the application/certificate detail; or `IpaList` should be the single list and the Commercial tab embed it. |
| A3 | S2 | IPA detail uses **raw utilities, not tokens**: `rounded-xl`, `shadow-[var(--shadow-panel)]`, `text-[26px]`, a hand-rolled `ChevronStartIcon` SVG, and a 4-tile stat grid built from `bg-border` gap-px hairlines instead of the shell's strip primitive. Part of the 40-occurrence drift. | Authored before the token scale hardened / before the shell strip existed. | Re-skin onto tokens (`rounded-panel`, `shadow-e1`, `text-h1`) and reuse the shell's metric-strip and a Lucide chevron. No layout change needed, just token substitution. |
| A4 | S3 | `IpaActionsPanel` is genuinely good — regressive commands never take primary style, three "why is there no button" states (frozen / final / stuck-after-return) are explained in prose, approve states its numbering consequence beside the button. | Deliberate. | **Keep** as the lifecycle-action pattern for the flow. |

## IPC — Interim Payment Certificates (the wizard)

| # | Sev | Finding | Decision behind it | Direction |
|---|---|---|---|---|
| C1 | **S1** | **Wizard where a form works** — the §4/§7 anti-pattern by name. Three steps (Context → Items → Review) each wrapped in its own bordered box, plus a separate title box and step-heading box: **five stacked panels**. Step 1 collects one required field (status); Step 2 is the line grid; Step 3 is the summary. This is a long form with a review, not a multi-system flow that needs gating. | Modelled as a wizard early; the `set-state-in-effect` draft bugs (since fixed) entrenched the step machinery. | Collapse to a single scrolling form with a sticky summary/issue rail (mirror BOQ's status bar + sticky bar). Keep the REJECTED short-circuit as a branch, not a separate route through step chrome. Highest-value redesign in the flow, but also the most load-bearing (money) — do it behind tests, last in the slice. |
| C2 | **S1** | The step **progress bar uses `brand-primary` as a fill on completed/among non-interactive step markers** (`bg-brand-primary` done-circle, `border-brand-primary` current). Brand = interactivity only (§1); a lifecycle indicator must be dots + status colour (§2.5), which the shell's `LifecycleStrip` already does correctly two panels above it. Two lifecycle treatments on one screen. | Built before the lifecycle-dot pattern was codified. | If a form (C1) it disappears. If kept short-term, restyle to the `LifecycleStrip` dot pattern (neutral/green/grey), not brand fill. |
| C3 | S2 | Step-3 renders a **float-computed money summary** as the review headline — `estimateGross` does `parseFloat(qty) * parseFloat(rate)`, then estimates retention/advance/net in JS, for figures the server computes. It is labelled "estimated" with a `serverComputeNote`, which keeps it honest, but §7 forbids fake/placeholder metrics and this is client arithmetic on the product's most expensive number. | Gives the surveyor a preview before issue; the real numbers only exist post-issue. | Keep a preview, but source it from the server (a dry-run/preview endpoint) or present it explicitly as "your inputs" not "net certified". If it stays client-side, never let its styling read as authoritative (it currently bolds the net like a final figure). Backend dependency if a real preview is wanted — file it. |
| C4 | S2 | Raw utilities throughout the wizard and its steps (`rounded-lg`, `shadow-sm`, `text-2xl`, `rounded-lg border` on every AdHoc row) — the bulk of the 40-occurrence drift (6 in `ipc-wizard.tsx` alone). | Same era as A3. | Token re-skin, folded into the C1 rework. |
| C5 | S3 | Draft-restore, effective-cert warning, REJECTED branch, and variance-reason-required validation are all correct and well-reasoned (the `loadDraft`-at-first-render comment is exemplary). | Hard-won (the set-state-in-effect fix). | **Keep** the logic; only the presentation is in scope. |

---

## Cross-tab consistency

The five surfaces do **not** share one interaction language yet — inconsistency across a daily
flow is itself the enemy of "zero training", so these rank S1/S2, not polish.

| # | Sev | Finding | Direction |
|---|---|---|---|
| X1 | **S1** | **Token discipline splits the flow in two.** BOQ + shell: 0 raw utilities, tokens only. IPA + IPC + progress: **40 raw `rounded-lg`/`rounded-xl`/`shadow-sm`/`shadow-[..]`/`text-[26px]`/`text-2xl` across 11 files.** The same conceptual "card" has a different radius and shadow depending on the tab. | One pass to re-skin the IPA/IPC/progress features onto the token scale (`rounded-panel`, `shadow-e1`, `text-h1/h2/h3`). eslint should then ratchet raw utilities off (DoD §5). |
| X2 | **S1** | **Composition splits the flow.** BOQ structures by hairlines + status bar; Overview, IPA detail, IPC wizard, progress structure by bordered boxes. A user crossing tabs re-learns the page each time. | Adopt BOQ's model everywhere: `SectionHeader` + hairlines as default, panels opt-in for bounded/clickable content. |
| X3 | **S1** | **Third-level nav appears on Progress and Commercial** (tab-in-tab), absent on BOQ/Overview/IPA. Nav depth is inconsistent and violates §5. | One rule for sub-surfaces: peer tabs or anchored sections, never a second tab bar. Product call needed (PR1). |
| X4 | S2 | **Primary-action model is inconsistent.** BOQ: one computed never-disabled next-step. IPA: adaptive CTA + regressive-safe command row (also good). Progress: no primary, an always-open form. IPC: step Next/Back buttons. | Give every tab one obvious primary. Progress especially needs a next-step (PR2). |
| X5 | S2 | **Record lists disagree**: DPR = `Table`; IPA = `<ul>`; IPC cert list = `Table`; Commercial applications = `Table` but non-clickable. | Standardise: record lists are `Table`, rows drill through. |
| ~~X6~~ | — | ~~Money `$`-prefix is uniformly wrong per §3.~~ **STRUCK — `$` prefix kept by decision (2026-08-26).** The `$`-prefix is now uniformly *correct* and consistent across all five surfaces. Money is neutral everywhere — keep. | No change. |

---

## Sequenced fixes for the first Engineering slice (Stage 2 will wireframe)

Smallest blast radius first; each is independently shippable and testable.
*(Former fix #1 "money-format root fix" removed — money format resolved by decision, no change needed.)*

1. **cuid leak fix (A1)** — one cell, use `certificateRef`. Correctness bug, trivial.
2. **Token re-skin pass (X1/A3/C4)** — mechanical substitution of the 40 raw utilities onto
   tokens across IPA/IPC/progress; then turn on the eslint ratchet so it can't regress.
3. **Overview reshape (P1/P2)** — demote the identity cards to one hairline detail block; let the
   shell strip + guidance panel lead. No backend needed (guidance feed already exists).
4. **Progress reshape (PR1/PR2/PR3)** — collapse the create form behind a primary, lead with a
   status-led DPR list, decide the tab-in-tab question. Needs the PR1/X3 product call.
5. **IPC wizard → form (C1/C2/C3)** — the largest and most load-bearing; do it **last, behind
   tests**, once the token layer and BOQ pattern are the established target.

### Recommended pilot sub-slice

**Pilot the project workspace shell + Overview reshape (P1/P2, plus the trivial A1 cuid fix).**
Rationale: it is the entry point every Engineering tab inherits, the
project-scoped attention feed it needs already exists (no backend gate), it demonstrates the
strip-over-cards and hairline-over-boxes composition the other four tabs must then copy — the
same reason shell+dashboard was the cross-cutting pilot in Round 2. It proves the pattern
cheaply before the expensive IPC-wizard rework commits to it.

---

## Backend dependencies

- **None gating the pilot.** Unlike the portfolio dashboard (which is still waiting on
  `GET /attention-items`, doctrine §6 / issue #105), the **project-scoped** attention feed
  `GET /projects/:id/workspace-guidance` **is built and wired** (`projects-api.ts:76`,
  `useProjectWorkspaceGuidance`) and renders on Overview. This is the project half of the §6
  ask already delivered — note it against #105 so the portfolio half isn't assumed missing-both.
- **Optional (C3):** a server-side IPC preview/dry-run endpoint would let the wizard's Step-3
  net figure come from the server instead of float arithmetic. File it if a real preview is
  wanted; otherwise the estimate stays client-side and must not be styled as authoritative.

---

## Owed live confirmation

Confirmed live: shell, Overview (desktop + 633px mobile), BOQ, Progress, Commercial
applications list. **Owed:** the IPA *detail* screen and the IPC *wizard* were grilled from
code only (their raw-token drift is proven by grep, but their rendered layout at 1280/375px was
not walked because the Commercial applications table rows are not clickable and the
contract-scoped detail route requires a contract id path not surfaced in the seeded UI). A
follow-up walk of `/contracts/[id]/applications/[ipaId]` and `.../certificates/new` should
confirm C1/C2/C3 visually before Stage 2 wireframes the wizard.
