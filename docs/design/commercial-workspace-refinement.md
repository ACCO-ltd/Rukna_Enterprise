# Commercial workspace — refinement (Phase 4)

Status (2026-09-05): **UI/interaction architecture FROZEN. Browser QA passed for every reachable
commercial state. Two integration paths remain unverified because the local tenant lacks the
required accounting and governance configuration.**

```
Product architecture          FROZEN
Desktop / mobile / dark QA    PASS
MILESTONE path                PASS through invoice creation
MEASURED_IPC UI               PASS for reachable states
Responsive controls           PASS >= 44px
Unit + integration suites     PASS (930 api / 1717 web)
Build / typecheck / lint      PASS

Deferred integration QA       invoice posting -> receipt -> allocation
                              at-risk variation commencement
Environment blockers          accounting configuration absent
                              governance binding + authority actors absent
```

The frozen decisions — billing-model-aware navigation, the two billing paths kept separate,
full-width Billing & Collection tables, the contract/security grouping, variation governance
semantics, pending variations held out of contract value, explicit invoice/payment basis, 44px
minimum controls — should not be reopened casually.

Phase 4 of the project-workspace redesign, after the shell + Overview
(`project-workspace-refinement.md`), BOQ (`boq-workspace-refinement.md`) and Progress
(`progress-workspace-refinement.md`). Sources of truth: **ADR-017** (commercial position),
**ADR-023** (billing models), **ADR-026** (variations).

## The question the workspace answers

> What is the project's commercial position, and what is the next money-in action?

Commercial owns the **client/revenue spine**: contract → entitlement → invoice → receipt, plus
the variations that change the value and the instruments that secure it. It does **not** own cost,
commitments, forecast or margin — those are Finance, and duplicating them here would create a
second answer that drifts from the first.

## 1. Navigation is billing-model aware

The platform supports `MEASURED_IPC` (certified progress: IPA → IPC → invoice) and `MILESTONE`
(a negotiated payment schedule). ACCO uses `MILESTONE`. The workspace branches rather than
exposing both mechanisms at once.

| Billing model | Views |
|---|---|
| `MILESTONE` | Overview · Contract & Security · Variations · Billing & Collection |
| `MEASURED_IPC` | + **Applications & Certification** between Contract & Security and Variations |

`commercialTabsFor()` is the single rule; the switcher and the route guard both call it, so they
cannot disagree. Deep-linking to `/commercial/applications` on a milestone contract renders an
explanation and a route to the payment plan — not a blank screen and not a 404.

Renamed **Applications & Certificates → Applications & Certification**: the tab is a process, not
a document library.

## 2. Composition

The sub-tabs use the **underline** `ViewSwitcher` appearance, matching the Progress sub-tabs
(owner's instruction, 2026-09-05) — glyph on the active view only, so the row is separable from
the level-2 project tabs directly above it.

The workspace's old boxed header (building icon, contract number, value, client, status badge)
is **gone**. The project shell above already names the record and its state; the module now opens
with a heading and a subtitle, exactly as Progress does. Contract identity reads once, on
Contract & Security.

## 3. Overview — the revenue control centre

```
┌ Contract position ─────────────┐ ┌ Other commercial items ──────┐
│ Value · Invoiced · Collected · │ │ Pending variations ·         │
│ Outstanding                    │ │ Retention held · Advance out │
└────────────────────────────────┘ └──────────────────────────────┘
┌ Current payment cycle ─────────┐ ┌ Payment plan  /  Certification┐
│ Installment 3 of 6 · $480,000  │ │ 1 Mobilization  10%  Paid     │
│ Ready to invoice [Generate]    │ │ …            Σ 100% ✓         │
│ ● ─ ● ─ ◉ ─ ○ ─ ○ ─ ○ (rail)   │ └──────────────────────────────┘
└────────────────────────────────┘ ┌ Recent commercial activity ──┐
┌ Needs attention ───────────────┐ └──────────────────────────────┘
```

- **Contract value is the *governing* value** — original + client-approved variations
  (CONST-VAR-005). Every share below is a share of it. When variations have moved it, the cell
  says so in one clause (`Incl. −$20,000.00 approved variations`).
- **The current payment cycle is the only primary action on the screen.** It is a *cycle*, not
  the project lifecycle: it resets per installment/application, which is why the rail is scoped
  to this card rather than sitting permanently across the top.
- **Before the contract is ACTIVE** the cycle card is replaced by a readiness prompt. Four zeros
  would describe a project that has failed to bill rather than one that has not started.
- The plan panel becomes the **certification chain** on a measured contract.

## 4. Hard invariants the UI enforces

| Invariant | How it shows |
|---|---|
| Pending variations are **never** added to contract value (CONST-VAR-006a) | Separate band, `Not in contract value`; a unit test asserts the sum appears nowhere |
| Proposed time impact ≠ approved EOT ≠ completion date (CONST-VAR-003/009) | Three separate facts; the completion date moves only via the Extension of Time section |
| Internal workflow state ≠ client approval | Two columns. `INTERNAL_APPROVED` is the only state that reads "Pending client" |
| Settlement is measured on the **invoice total**, VAT included | Every ratio in Billing has an invoice total as denominator; `subtotal`/`vatAmount` are carried and labelled. Backend test pins it |
| At-risk work is exposure, not approved scope (CONST-VAR-011) | Row badge + its own summary figure, never folded into approved |
| Money is neutral | No heat-mapped figures; state is carried by badges and by the due-date column |
| Withheld ≠ zero ≠ broken ≠ not applicable | Four distinct renderings; a restricted or failed figure never falls back to `0` |

## 5. Backend changes this phase required

The frontend spec asked for several things the read models could not answer honestly. Rather
than fabricate them:

1. **`GET /projects/:id/commercial/billing`** — new read model. Project-scoped invoices (with
   source provenance, tax split, settlement status and server-measured `daysOverdue`), the
   receipts allocated to this contract with their allocations, ageing buckets, and the
   client-level unapplied total. Everything on the invoice-total basis.
2. **`capabilities.canRecordReceipt` / `canAllocateReceipt` were hardcoded `false`** — a
   leftover from before the AR receipt endpoints existed. Now derived from `create:receipt` /
   `allocate:receipt`.
3. **`securityPosition`** on the summary — retention held and advance recovered, summed from the
   `RETENTION` / `ADVANCE_RECOVERY` slices of the same effective-certificate deductions that
   drive certified net, so the two can never disagree. `applicable: false` on a MILESTONE
   contract (ADR-023 CONST-COM-013/014) rather than three zeros.
4. **`atRiskAuthorisationCount` / `atRiskExposure`** on the variation list row, via one grouped
   query — a per-row fetch would have been an N+1 on a screen that already loads every VO.
5. `ContractDetail.paymentInstallments` was missing from the **web** wire type, though the API
   has always returned it. The negotiated terms were unreadable anywhere in the app.

## 6. Deliberately not built, and why

- **Aging beyond due-date buckets** (dunning levels, promised-to-pay). No data model behind it.
- **A receipt allocation screen inside Commercial.** Allocation lives in Accounting; Commercial
  reports the unapplied balance and hands over. Two allocation interactions would have to stay
  in step with each other forever.
- **An invoiced-vs-collected chart.** Correct, but the ageing panel and the position band already
  answer the question; a chart would be the third telling.
- **Advance outstanding for a percentage-only advance term.** No stored principal to count down
  from; the server returns `null` rather than deriving one from the contract value.
- **"Project currency" selector** shown in the source mockup. The contract carries exactly one
  currency; a picker would imply a conversion the system does not do.

## 7. Files

Backend — `commercial.service.ts` (+`getBilling`, `securityPosition`, capabilities fix),
`commercial-prisma.repository.ts` (+3 reads), `commercial.controller.ts` (+`billing`),
`variation-order.service.ts` / `variation-order-prisma.repository.ts` (at-risk totals).

Types — `packages/types/src/construction.ts`: `CommercialBillingResponse` and its row types,
`CommercialSecurityPosition`, at-risk fields on `VariationOrderListItem`.

Frontend — `commercial-nav.tsx` (model-aware, underline), `commercial-workspace.tsx` (heading +
route guard), `overview-tab.tsx`, `contract-position.tsx` *(new)*, `current-payment-cycle.tsx`,
`payment-plan-panel.tsx` *(new)*, `contract-security-tab.tsx`, `variations-tab.tsx`,
`variations-summary.ts` *(new)*, `billing-collection-tab.tsx`, `payment-schedule-panel.tsx`.

Deleted as dead: `main-contract-tab.tsx`, `guarantees-tab.tsx`, `retention-advances-tab.tsx`,
`commercial-metric-tile.tsx`, `commercial-next-step.ts` (a browser re-derivation of a rule the
server now owns).

## 8. What browser QA found

`e2e/commercial-workspace-qa.spec.ts` ran against a live API over a seeded MILESTONE contract
(payment plan, retention, advance, two guarantees, three variations, one invoice) and the
seeder's MEASURED_IPC contract. Five specs, four modes (1440/375 × light/dark). Run it with:

```
E2E_SKIP_SEED=1 RUKNA_DEMO_PASSWORD=… QA_PROJECT_ID=… QA_IPC_PROJECT_ID=…   pnpm --filter @erp/web exec playwright test commercial-workspace-qa --project=desktop
```

Defects it caught, all now fixed — none of which the unit suite could see:

1. **Nine controls under 44px at 375px.** "View the BOQ baseline" was a bare inline anchor at
   **15px**; eight `size="sm"` buttons sat at 36px. All now `min-h-11 sm:min-h-0`.
2. **Billing & Collection's 2fr/1fr split starved the tables.** At 1440 the invoice table lost
   three of its eight columns behind its own scroll container. The three small readings moved to
   a row of their own; the tables now get the full width.
3. **An ADVANCE installment rendered " days after commencement" with the number missing** —
   `dueOffsetDays` arrives as `null`, and the guard tested `!== undefined`.
4. **The guarantee status/attention badges pushed the column past the panel edge.** Stacked.
5. **"Recovered to date: No certificates yet" on a milestone contract** — true-sounding and
   wrong; no certificate will ever exist there. Now "Not applicable".
6. **The governing-value support line wrapped to five lines** in a quarter-width cell and
   dragged the band taller than the three figures beside it. Cut to one clause.
7. **The payment plan totals the original contract value while the position band shows the
   governing value.** Both correct — an approved omission moves the contract value without
   re-cutting the plan — so the panel now says which basis it is on rather than leaving a
   reader to decide one of them is a bug.

Measured, all modes: `scrollWidth === clientWidth` on every page, zero controls under 44px,
zero console errors, zero commercial 4xx.

## Not yet verified

**Posted-invoice money and receipts.** The local tenant has no chart of accounts and no fiscal
year, so `POST /invoices/:id/post` answers `POSTING_ACCOUNT_NOT_CONFIGURED`. Everything downstream
of a posted invoice — a populated position band, the ageing buckets, a receipt with a partial
allocation, unapplied cash — is covered by backend unit tests but has never been seen in a
browser. Seeding an accounting foundation is the prerequisite, and is out of this phase's scope.

**At-risk commencement in the list.** Recording one needs the Construction Director / CFO / CEO
identities (CONST-VAR-011); the QA admin is none of them, so the row badge and the exposure
figure are unit-tested only.

**Two pre-existing e2e problems surfaced on the way**, both fixed in passing because they blocked
any run at all: `tools/seed-scenario.mjs` posted a project without the now-required `category`,
and `global-setup.ts` had no way to skip seeding (`E2E_SKIP_SEED=1` now does). The seeder still
dies later, at `POST /ipa/:id/submit-for-approval` → 422, because this tenant has no active
workflow binding for that transition. That is a tenant-configuration gap, not a code defect, and
is left alone.

`e2e/commercial-mobile.spec.ts` has been **deleted**, and `apps/web/design-qa.md` reduced to a
superseded pointer. Both asserted an Arabic/RTL capability removed in PR #73 and an IA this phase
replaced; the new gate covers everything they did and more. A permanently dead test erodes trust
in the whole suite faster than it documents anything.

### Two integration gates to close later

These are **QA-environment tasks, not redesigns.** Neither should reopen the architecture above.

1. **Posted-invoice → receipt → allocation.** Build a minimal QA accounting fixture — chart of
   accounts, fiscal year with an open period, posting profiles, a bank account — then walk one
   complete commercial transaction in the browser: post the invoice, record a receipt, allocate
   it, and read the invoice balance, position band, ageing and unapplied cash. Backend tests
   cover the arithmetic; for a revenue path they do not replace one browser-level happy path.
2. **At-risk variation commencement.** Seed real QA identities matching the configured authority
   chain (Construction Director, CFO, and CEO above the cap) rather than making the QA admin
   omnipotent — the point of CONST-VAR-011 is who authorised it. Then walk: variation created →
   internal approval → at-risk authorisation → work may commence → **commercial value stays
   pending**. That last assertion is the governance test.

### QA data hygiene

This phase left fixtures in the local tenant (`CT-0001` on *office building*, and the seeder's
`ACCO-2026-PRVRE`). Acceptable for now, but browser-QA fixtures must not become semi-permanent
mystery business records. The standing principle, worth tooling as `qa:seed` / `qa:reset` before
Procurement and Finance QA start mutating ledgers:

> QA data is deterministic, identifiable, and disposable.
