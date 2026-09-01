# Accounting / Finance workspace — Round 2 UX proposal (Stage 3, low-fidelity)

Status: **REVIEW ARTIFACT** — workflow, IA, state coverage. Not production React, not final pixels.
Owner: Product/UX (Round 2) · Scope: `apps/web` Finance area · Pilot tenant: ACCO (governance OFF, USD-only, English-only, dark, 375px)
Grounded in: `apps/web/src/features/accounting/*`, routes under `apps/web/src/app/(app)/{accounting,finance/accounting}/*`, `docs/reference/ux-doctrine.md`, `apps/web/src/features/accounting/types.ts` (backend-truth annotations).

This proposal **refines** the existing Sprint-4 accounting surface to realise the seven locked
decisions (JD1–JD7). It is deliberately subtractive where the current build over-exposes machinery
(the 6-state journal lifecycle, the 11-field CoA form) and additive only where a first-class workflow
is genuinely missing (bank reconciliation, guided year-end close, Project P&L).

Legend: **NEW** · **REFINED** (exists, changes) · **REMOVED-as-primary** (stays reachable, demoted) ·
⛔ **BLOCKED-ON-BACKEND** (needs an endpoint/field the API does not have yet).

---

## 0. What exists today (baseline, so we refine not reinvent)

| Area | Today | File |
|---|---|---|
| Nav | Accounting domain: Chart of accounts, Journals, Client invoices, Receipts, Supplier bills, Supplier payments, General ledger, Reports (hub), Fiscal periods | `components/layout/nav-groups.ts:101` |
| Journals | Full 6-state badge `DRAFT/SUBMITTED/APPROVED/POSTED/REJECTED/REVERSED`; create form with live Dr/Cr balance strip; **no posting preview panel, no collapse** | `components/journal-form.tsx`, `journal-status-badge.tsx` |
| Periods | Per-year panel, per-period `OPEN/LOCKED/CLOSED/REOPENED` rows; lock/close/reopen buttons; close-gate fetched only inside the confirm dialog and shown as a **flat joined sentence** | `components/fiscal-periods.tsx`, `period-actions.tsx` |
| Year-end | One `Close year` button, disabled until all periods CLOSED, then a single confirm dialog — **no pre-flight, no closing-journal preview** | `period-actions.tsx:117` |
| Opening balance | Single screen: trial-balance paste → one `SYSTEM_OPENING` journal → migration report with AR/AP reconciliation. **Open-item AR/AP import deliberately omitted** ("cannot express clientId/supplierId in a paste box") | `components/opening-balance-wizard.tsx`, `opening-balance.ts` |
| CoA | Read-only list + create sheet with **11 fields** (code, name, class, subtype, normal balance, posting policy, 2 flags, subledger, parent, effectiveFrom); no edit, no retire | `components/create-account-form.tsx`, `coa-setup.ts` |
| Reports | Hub of 5 cards: Trial Balance, P&L, Balance Sheet, Monthly Comparison, Account Ledger. **No Project P&L** | `app/(app)/accounting/reports/page.tsx` |
| Bank | Bank-account setup list + create only. **No reconciliation match workspace** anywhere | `components/bank-accounts.tsx` |
| Reconciliation | Only the control-account check `POST /accounting/reconcile` (AR=GL, AP=GL, optional bank), surfaced inside opening-balance + balance-sheet. **Not a bank-line matching tool.** | `api/accounting-api.ts:96` |

Two systemic truths from the code that constrain everything below:

1. **The API has no authorization** (#25): period/year-end endpoints carry `JwtAuthGuard` only. Every
   permission gate here is **presentation-only** until a guard lands. Screens must keep the honest
   `unauthorizedNote` warning the current periods screen shows. The permission keys are real
   (`ACCOUNTING_PERMISSIONS` in `features/auth/permissions/can.ts`); the enforcement is not.
2. **Money is decimal strings out / JS numbers in**; parse via `lib/money.ts`, format via `lib/format`.
   Never `Number()`. This is unchanged and every screen below inherits it.

---

## 1. Refined information architecture (Finance area)

The current flat list of 9 accounting nav items mixes daily operations, period control, and reporting
into one undifferentiated column. Round 2 groups by **job to be done**, using the existing `groupKey`
micro-label divider mechanism (already in `nav-groups.ts`) — a visual grouping, not a second
collapsible level, and not a nested tab bar (doctrine §5).

```
Accounting  (domain header → /accounting → redirect to Journals, unchanged)
│
├─ Operate                         ← the daily spine
│   Journals
│   Client invoices
│   Receipts
│   Supplier bills          (cross-link, canonical route stays here)
│   Supplier payments
│
├─ Books & reporting
│   General ledger
│   Reports          → hub: Trial Balance · P&L · Balance Sheet · Account Ledger
│                              · Project P&L (NEW) · Monthly comparison (secondary)
│
├─ Period & year control           ← close discipline lives together
│   Fiscal periods           (period close gate + snapshot)
│   Year-end close      NEW   (guided fiscal-year close, distinct from period close)
│   Bank reconciliation NEW
│
└─ Setup                           ← tenant bootstrap, set-aside like Procurement's Setup group
    Chart of accounts
    Bank accounts
    Opening migration
```

Rationale, decision by decision:

- **Reports is the home of Project P&L (JD4).** It joins the four core reports as a first-class card.
  Monthly comparison is explicitly labelled secondary and drops below the fold. Core order:
  Trial Balance → P&L → Balance Sheet → Account Ledger → **Project P&L** → Monthly comparison.
- **Bank reconciliation and Year-end close live under "Period & year control" (JD7), not Setup and
  not Reports.** They are recurring close-discipline workflows an accountant runs on a cadence, beside
  Fiscal periods — the pre-close gate (JD2) literally reads the reconciliation result, so they belong
  together. Bank *account setup* stays in Setup; bank *reconciliation* is an operation.
- **Chart of accounts moves to Setup** with Bank accounts and Opening migration. It is tenant-bootstrap
  master data, not a daily destination — same reasoning Procurement uses for its Setup group.
- **"Opening balance" is renamed "Opening migration"** to signal the two-layer scope (GL + open items),
  per JD3.
- Depth stays within doctrine: two persistent nav layers (domain → item). The Reports hub is a
  destination page, not a third tab bar. The Bank reconciliation match/summary split and the Year-end
  guided steps are **in-page step/segmented switching on one route**, not nav levels.

---

## 2. Screen inventory (tagged vs today)

| # | Screen | Tag | Route (proposed) | Notes |
|---|---|---|---|---|
| S1 | Journal create | **REFINED** | `/finance/accounting/journals/new` | Collapse to `DRAFT→POSTED`, single "Post journal", add Dr/Cr **posting preview** before post |
| S2 | Journal detail | **REFINED** | `/finance/accounting/journals/[id]` | Governance-collapsed lifecycle; never render APPROVED in pilot; reversal path |
| S3 | Period close | **REFINED** | `/finance/accounting/periods` | Gate split **BLOCKERS vs warnings**; snapshot confirmation; controlled reopen as audited action |
| S4 | Opening migration | **REFINED (2-layer)** | `/finance/accounting/opening-migration` | Layer 1 GL paste (exists) + Layer 2 **open-item AR/AP import** (new) + reconciliation |
| S5 | Project P&L | **NEW** | `/finance/accounting/reports/project-pl` | Portfolio job-costing table → per-project revenue/cost/margin → drill to journal lines |
| S6 | CoA create + edit/retire | **REFINED** | `/finance/accounting/chart-of-accounts` | **4-field create** (advanced disclosure); edit-by-posting-state; retire flow |
| S7 | Bank reconciliation | **NEW** | `/finance/accounting/bank-reconciliation` | Match workspace + reconciliation summary; ⛔ mostly blocked-on-backend |
| S8 | Year-end close | **NEW** | `/finance/accounting/year-end-close` | Guided: pre-flight → compute → preview `SYSTEM_YEAR_END_CLOSE` → confirm → carry forward |
| — | Monthly comparison | **REMOVED-as-primary** | `/finance/accounting/monthly-comparison` | Stays reachable; demoted to secondary card on Reports hub |
| — | Trial Balance / P&L / Balance Sheet / Ledger | unchanged | existing | Core reports; only Reports-hub ordering changes |

---

## 3. Per-screen low-fi layouts + state/action matrices

ASCII is structure only — box borders here are **not** a directive to draw borders. Per doctrine §2.1
most groupings are hairline `SectionHeader`s, not panels. One primary action per screen (the accent
button); everything else is `outline`/`ghost`.

Convention in the matrices: **P?** = permission-gated (presentation-only until #25).

---

### S1 — Journal create (collapsed governance + Dr/Cr preview) · REFINED

**Workflow.** An accountant records a manual adjustment. In the pilot (governance OFF) there is no
enforced approval, so the only real transition is `DRAFT → POSTED`. The screen must never show an
APPROVED state or an "approved by" line the system cannot back with a real gate (JD1, doctrine §4).
The one addition over today's form is an explicit **Dr/Cr posting preview** the user confirms before
the irreversible post — today's build only shows a running balance strip and posts from the list.

Two build modes, one component, driven by a single `governanceEnabled` flag:

- **Pilot (OFF):** stepper is `Draft ─ Post`. Primary action: **Post journal**.
- **Governance ON (future):** stepper is `Draft ─ Submitted ─ Pending approval ─ Approved ─ Post`,
  with a real approval panel on the detail screen. Designed here; **not rendered in pilot.**

#### Desktop

```
┌ Journal · New ───────────────────────────────────────── ⌘K ┐
│ ‹ Back to journals                                          │
│ New journal entry                                           │
│                                                             │
│  Draft ─────○ Post              (pilot: 2 nodes, no APPROVE) │
│                                                             │
│  Accounting date [2026-09-01]   Document date [2026-09-01]  │
│  Description      [ Reclassify site mobilisation cost     ] │
│                                                             │
│  LINES ──────────────────────────────────────────────────  │
│  Account                     Memo        Debit      Credit  │
│  [51200 · Subcontract cost▾] [ ]        1,200.00        —   │
│  [10200 · Bank — main    ▾] [ ]              —    1,200.00  │
│  [ + Add line ]                                             │
│                                                             │
│  ── running check (live) ───────────────────────────────   │
│  Debits 1,200.00   Credits 1,200.00   ✓ Balanced           │
│                                                             │
│  [ Review posting ]  (primary; disabled until balanced)    │
│  [ Cancel ]                                                 │
└─────────────────────────────────────────────────────────────┘

  Review posting  ── modal/sheet, the JD1/JD6 Dr/Cr preview ───
  ┌──────────────────────────────────────────────────────────┐
  │ This will post immediately to period 2026-09 (OPEN).      │
  │ Posted entries are immutable — correct by reversal.       │
  │                                                            │
  │ Account                         Debit        Credit        │
  │ 51200 Subcontract cost        1,200.00           —         │
  │ 10200 Bank — main                   —      1,200.00        │
  │ ──────────────────────────────────────────────────────    │
  │ Totals                        1,200.00      1,200.00       │
  │                                                            │
  │ [ Post journal ]  ← the one primary action                │
  │ [ Back to edit ]                                           │
  └──────────────────────────────────────────────────────────┘
```

#### 375px reflow

```
‹ Back
New journal entry
Draft ─○ Post

Accounting date [2026-09-01]
Document date   [2026-09-01]
Description [ Reclassify… ]

LINES
┌ Line 1 ───────────────┐
│ [51200 Subcontract ▾] │   ← lines stack as cards, not a
│ Memo [ ]              │      side-scrolling table
│ Debit  1,200.00       │
│ Credit      —         │
└───────────────────────┘
[ + Add line ]

Debits 1,200.00
Credits 1,200.00
✓ Balanced

[ Review posting ]   (full width, ≥44px)
[ Cancel ]
```

Notes to engineering: the account picker must list **postable leaf accounts only** (`postableAccounts`
already exists). The "Review posting" preview reuses the exact lines the POST will send — resolve once,
show and send the same object (mirror `planInvoicePost`'s "one resolution" rule from AR). A DRAFT's line
snapshots are empty strings until post, so the preview resolves names from `GET /accounts` client-side.

#### State / action matrix — S1

| State | What renders | Actions | Perm |
|---|---|---|---|
| Loading (accounts) | skeleton over the lines table (today's `animate-pulse`) | — | — |
| Empty chart | "No postable accounts. Add accounts in Chart of accounts." + link | Go to Setup › CoA | — |
| Editing, unbalanced | red difference in the running check | Add/remove line | P? `manage:journal` |
| Editing, balanced | ✓ Balanced; primary enabled | **Review posting** | P? `manage:journal` |
| Preview open | Dr/Cr preview + immutability warning | **Post journal** / Back to edit | P? |
| Posting | primary → spinner, disabled | — | — |
| Post success | route to detail (POSTED) | View entry | — |
| Post error (400 unbalanced/period) | inline Alert with `error.message` | fix + retry | — |
| Period LOCKED/CLOSED for the date | banner: "2026-08 is CLOSED — pick an open period date" | change date | — |
| No permission | form hidden; read-only "you can view journals but not post" | — | lacks `manage:journal` |
| Governance ON (future) | Submit → approval panel appears on detail | Submit for approval | P? |

---

### S2 — Journal detail (governance-collapsed) · REFINED

**Workflow.** Read a posted entry; reverse it if wrong. The badge today maps all six `JournalStatus`
values. In pilot we render only what the system enforces: `DRAFT`, `POSTED`, `REVERSED`. **APPROVED,
SUBMITTED, REJECTED are never shown as a pilot status** — if the API ever returns them without a real
governance run, treat as `DRAFT` (unposted) and log, don't invent an approval story (JD1, doctrine §4).

```
┌ Journal JE-000142 ─────────────────────── [POSTED] ──────┐
│ Reclassify site mobilisation cost                         │
│ Accounting date 2026-09-01 · Posted 2026-09-01 by A. Nur  │
│ Immutable — corrections are made by a reversing entry.    │
│                                                           │
│ Account                        Debit        Credit         │
│ 51200 Subcontract cost       1,200.00           —          │
│ 10200 Bank — main                  —      1,200.00         │
│ ─────────────────────────────────────────────────        │
│ Totals                       1,200.00      1,200.00        │
│                                                           │
│ [ Reverse entry ]  (outline; opens dated-reason dialog)   │
└───────────────────────────────────────────────────────────┘
```

| State | Renders | Actions | Perm |
|---|---|---|---|
| DRAFT | neutral badge, editable | Post (→ S1 preview), Delete draft | P? `manage:journal` |
| POSTED | live badge, immutability line | **Reverse entry** (reason + reversal date required) | P? |
| REVERSED | neutral badge + link to the reversing entry | — (view only) | — |
| Reversal in progress | dialog spinner | — | — |
| APPROVED/SUBMITTED returned in pilot | render as DRAFT + dev log; **no "approved by" line** | — | — |

---

### S3 — Period close (gate: blockers vs warnings + snapshot) · REFINED

**Workflow (JD2).** `OPEN → LOCKED → CLOSED`. LOCKED freezes routine posting but authorised Finance can
still post controlled close adjustments. Closing runs an automatic **pre-close gate** that must visibly
split **hard BLOCKERS** (which prevent close) from **INFORMATIONAL warnings** (which do not). On close,
an immutable balance snapshot is taken. Reopen is an exceptional, audited action with a mandatory reason
— **not** a status toggle sitting in a row.

Today's gate is a flat `blockers: string[]` shown as a joined sentence inside the confirm dialog. The
refinement is: (a) run the gate as a **visible pre-close panel** before the button, and (b) render the
blocker/warning split. See §5 for what the backend must add.

#### Desktop

```
┌ Fiscal periods ─────────────────────────────────────────┐
│ ⚠ These controls are presentation-gated only; the API    │  ← keep today's honest #25 note
│   has no authorization yet.                               │
│                                                           │
│ FY 2026  [OPEN]        Jan–Dec · 12 periods · 3 open      │
│  ────────────────────────────────────────────────────    │
│  Period        Range                Status                │
│  2026-06  Jun  01–30 Jun 2026       [CLOSED]  snapshot ✓  │
│  2026-07  Jul  01–31 Jul 2026       [CLOSED]  snapshot ✓  │
│  2026-08  Aug  01–31 Aug 2026       [LOCKED]  › Close     │
│  2026-09  Sep  01–30 Sep 2026       [OPEN]    › Lock      │
└───────────────────────────────────────────────────────────┘

  Close 2026-08  ── pre-close gate panel ───────────────────
  ┌──────────────────────────────────────────────────────────┐
  │ Pre-close checks for 2026-08                               │
  │                                                            │
  │ ✗ BLOCKERS (2) — must clear before closing                │
  │   • AR subledger $412,300.00 ≠ AR control $410,050.00      │
  │     (variance $2,250.00)                  [ View ledger ]  │
  │   • Bank — main not reconciled for Aug        [ Reconcile ]│
  │                                                            │
  │ ⚠ WARNINGS (3) — informational, close still allowed        │
  │   • 4 supplier bills overdue                               │
  │   • 1 receipt unmatched to an invoice                      │
  │   • 2 draft journals dated in this period                 │
  │                                                            │
  │ On close: an immutable balance snapshot is written.        │
  │ Reopening later requires a reason and is audited.          │
  │                                                            │
  │ [ Close period ]  (disabled while any BLOCKER present)     │
  │ [ Cancel ]                                                 │
  └──────────────────────────────────────────────────────────┘

  Reopen 2026-07  ── exceptional, audited ──────────────────
  ┌──────────────────────────────────────────────────────────┐
  │ Reopen a closed period                                     │
  │ This invalidates every downstream snapshot and must be     │
  │ justified. Recorded against your name.                     │
  │ Reason (required) [ Auditor adjustment to depreciation  ]  │
  │ [ Reopen period ]   [ Cancel ]                             │
  └──────────────────────────────────────────────────────────┘
```

#### 375px reflow — periods stack as rows with the status word + hint under each; the gate panel
becomes a full-screen sheet with the two groups stacked (BLOCKERS first). Reopen is a full sheet.

#### State / action matrix — S3

| State | Renders | Actions | Perm |
|---|---|---|---|
| Loading | skeleton year panels | — | — |
| No fiscal years | EmptyState "Create a fiscal year to begin" | Create fiscal year | P? `manage:account` |
| Period OPEN | live badge + "accepts postings" hint | **Lock** | P? `manage:period` |
| Period LOCKED | warning badge + "routine posting frozen; close adjustments allowed" | **Close** (opens gate) | P? |
| Gate loading | spinner in panel | — | — |
| Gate: blockers present | ✗ group + ⚠ group; Close disabled | View ledger / Reconcile (deep links) | P? |
| Gate: warnings only | ⚠ group; Close enabled | **Close period** | P? |
| Closing | spinner; then snapshot ✓ appears on the row | — | — |
| Period CLOSED | danger badge + "snapshot ✓" | **Reopen** (reason), Rebuild snapshot | P? |
| Reopen | reason-required dialog | **Reopen period** | P? |
| Close error (race: gate passed then 400) | Alert with server message; re-run gate | retry | — |
| No permission | badges render; no action buttons | — | lacks `manage:period` |

⛔ **BLOCKED-ON-BACKEND:** the blocker/warning **split** and the **snapshot-exists** flag on the row.
Today `CloseGate` is `{ passed, blockers: string[] }` — one undifferentiated list, no severity, and the
period row has no snapshot indicator. See §5.

---

### S4 — Opening migration (two-layer) · REFINED

**Workflow (JD3).** Cutover from legacy books. **Layer 1 (GL):** paste the trial balance → one immutable
`SYSTEM_OPENING` journal (this exists today). **Layer 2 (open items):** import outstanding customer
invoices and supplier bills as explicitly "migrated/opening" rows (posting status `OPENING_BALANCE`),
each carrying customer/supplier, invoice/ref no., original date, due date, currency, original amount,
outstanding amount — **no PO/GR/IPA/IPC reconstruction**. Then the reconciliation check must hold:
AR subledger total = AR control, AP subledger = AP control.

The current wizard omits Layer 2 for a real reason (a paste box can't express `clientId`/`supplierId`,
and the one-shot 409 means you can't top up later). The refinement introduces a **two-panel single-run**:
GL paste and the open-item grids are filled **before** one atomic run, so the 409 no longer strands you.

```
┌ Opening migration ──────────────────────────────────────┐
│ ⚠ Runs once per organisation. Reverse to re-import.       │
│                                                           │
│ Cutover date [2026-08-31]   Batch ref [ MIG-2026-08 ]     │
│ AR control [12100 Accounts receivable ▾]                  │
│ AP control [21100 Accounts payable    ▾]                  │
│                                                           │
│  ─ Layer 1 · General ledger (trial balance) ───────────   │
│  Paste columns: code ⇥ debit ⇥ credit                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 10100  0.00      50,000.00                         │    │
│  │ 12100  410,050.00     0.00                         │    │
│  │ …                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│  42 lines · Dr 1,204,300.00 · Cr 1,204,300.00 · ✓ Balanced│
│                                                           │
│  ─ Layer 2 · Open items (AR) ──────────────────────────   │
│  Customer      Inv/ref    Orig date  Due date  Outstanding│
│  [Acme Ltd ▾]  [INV-9001] 2026-05-02 2026-08-02  12,000.00│
│  [Beta Co ▾]   [INV-9002] 2026-06-11 2026-09-11  30,050.00│
│  [ + Add AR item ]  ·  [ Import CSV ]                      │
│  AR open-item total  42,050.00                            │
│                                                           │
│  ─ Layer 2 · Open items (AP) ──────────────────────────   │
│  Supplier      Bill/ref   Orig date  Due date  Outstanding│
│  [Zephyr ▾]    [BILL-330] 2026-07-01 2026-08-30  18,900.00│
│  [ + Add AP item ]  ·  [ Import CSV ]                      │
│  AP open-item total  18,900.00                            │
│                                                           │
│  ─ Reconciliation preview ─────────────────────────────   │
│  Control     GL          Subledger    Variance            │
│  AR 12100    410,050.00   42,050.00   368,000.00  ✗       │
│  AP 21100     18,900.00   18,900.00        0.00   ✓       │
│  ⚠ AR variance must be $0.00 before this ties. Either the │
│    GL AR line or the AR open items are incomplete.        │
│                                                           │
│  [ Run migration ]  (disabled: GL unbalanced OR AR/AP     │
│                      subledger ≠ control OR unknown code) │
└───────────────────────────────────────────────────────────┘
```

375px: each layer becomes its own collapsible section; open-item rows stack as cards
(Customer, Inv/ref, dates, outstanding); reconciliation preview is a 2-line summary per control.

#### State / action matrix — S4

| State | Renders | Actions | Perm |
|---|---|---|---|
| Fresh | empty paste + empty grids + "runs once" warning | fill Layer 1/2 | P? `manage:account` |
| GL unbalanced | red totals; blocker text | fix paste | — |
| Unknown GL code | Alert naming the code(s) | fix / add account | — |
| AR/AP subledger ≠ control | ✗ in reconciliation preview; run disabled | fix items or GL | — |
| Ready | all ✓; primary enabled | **Run migration** | P? |
| Running | spinner | — | — |
| Success | migration report (journal no., counts, final reconciliation, CFO-approval instruction) | Done | — |
| 409 already migrated | "Opening balance already imported. Reverse EVT-OPB-001 to re-import." | Reverse (→ journal) | P? |
| No permission | form hidden; read-only note | — | lacks `manage:account` |

⛔ **BLOCKED-ON-BACKEND (partial):** Layer-2 open-item import. `RunOpeningBalanceDto` **accepts**
`openArInvoices` / `openApBills` (the wizard file confirms this), so the field plumbing exists — but
verify server-side: (a) each AR row resolves a real `clientId`, each AP row a `supplierId` **and**
`expenseProfileCode`; (b) the run is atomic across GL + both open-item sets so a partial 409 cannot
strand the operator; (c) CSV import shape. Until (a)/(b) are confirmed, ship Layer 1 + the reconciliation
preview and mark the Layer-2 grids ⛔. Layer 1 and the reconciliation preview are **buildable now**.

---

### S5 — Project P&L / job costing · NEW

**Workflow (JD4).** A commercial/finance user asks "which projects make money?" A portfolio table lists
every project with revenue, cost, and margin from **posted GL truth**, filtered by the `projectId`
dimension; drilling a project reveals its P&L sections and, from any line, the contributing journal
lines. This is GL actuals only — it must **not** claim to be the full cost picture (committed/forecast
cost is the separate Project Financial Position, `getProjectFinancialPosition`), and the screen says so.

```
┌ Reports › Project P&L ──────────────────────────────────┐
│ Posted actuals only. Committed cost is not included —    │
│ see a project's Financial position for the full picture. │
│                                                          │
│ Period [ 2026-01-01 ] → [ 2026-09-01 ]     [ Export ]    │
│                                                          │
│ Project                  Revenue     Cost      Margin   %│
│ WBR-26-0065 Banaadir Rd  620,000    471,000   149,000 24 │
│ WBR-26-0071 Clinic       310,000    288,400    21,600  7 │
│ WBR-26-0088 School       —          42,300   −42,300  —  │  ← negative margin, neutral money,
│ ────────────────────────────────────────────────────    │     real minus sign, not red heat-map
│ Total                    930,000    801,700   128,300 14 │
└──────────────────────────────────────────────────────────┘

  WBR-26-0065 · drill ──────────────────────────────────────
  ┌──────────────────────────────────────────────────────────┐
  │ Revenue                                         620,000    │
  │   Project revenue (41000)                       620,000    │
  │ Cost of sales                                   471,000    │
  │   Subcontract cost (51200)          310,000  › journals    │
  │   Material cost (51100)             161,000  › journals    │
  │ Gross profit                                    149,000    │
  │                                                            │
  │ › journals  → contributing posted lines for 51200:         │
  │   JE-000142  2026-09-01  Subcontract cost   120,000        │
  │   JE-000131  2026-08-14  Subcontract cost   190,000        │
  │   (each links to S2 journal detail)                        │
  └──────────────────────────────────────────────────────────┘
```

375px: portfolio table keeps Project + Margin% visible, Revenue/Cost/Margin reflow to a two-line stack
per row (doctrine forbids converting a table to cards, so this is a compact row, not a card list); the
drill is a full-screen sheet with the P&L sections stacked and "› journals" expanding inline.

#### State / action matrix — S5

| State | Renders | Actions | Perm |
|---|---|---|---|
| Loading | skeleton table | — | — |
| Empty (no posted project activity) | "No posted project activity in this period." | change dates | — |
| Loaded | portfolio table + total row | sort, drill a project | P? `view:accounting` |
| Drill | per-project P&L sections | expand "› journals" per line | P? |
| Journal drill | contributing posted lines by `projectId` | open S2 detail | P? |
| Error | Alert + retry | retry | — |
| No permission | screen hidden behind `view:accounting` | — | lacks `view:accounting` |

⛔ **BLOCKED-ON-BACKEND (partial):** the **portfolio roll-up** (all projects in one call). Today only
`GET /projects/:id/pl` (per project) and `GET /reports/pl?projectId=` exist — no "list every project's
P&L" endpoint. Buildable now by fanning out per project client-side for a small portfolio, but that is
N calls; a `GET /reports/pl/by-project?from&to` roll-up is the right ask. The **journal-line drill by
`projectId`** needs confirming: `LedgerLine`/`ProfitLossLine` carry `projectId`, but there is no
"posted lines for account X where projectId = Y" endpoint — the account ledger takes an optional
`projectId` param (`getAccountLedger`), so the drill can be built on `GET /reports/ledger/:accountId?projectId=`.
Per-project single view is **buildable now**; the portfolio table and total are ⛔ until the roll-up lands.

---

### S6 — Chart of Accounts create (4-field) + edit/retire · REFINED

**Workflow (JD5).** Creating an account should ask four questions, not eleven. **Create = Code · Name ·
Class · Subtype.** Everything else is derived or advanced: normal balance defaults from class (already
in `coa-setup.ts`), control-posting policy / effectiveFrom / subledger type / parent go under an
**Advanced** disclosure. Versioning is hidden entirely. Editing is governed by posting state. A
conceptual change is not an edit — it is retire + create-new + a reclassification journal. **No delete
once referenced.**

```
Create (default view) ─────────────────────────────────────
┌──────────────────────────────────────────────────────────┐
│ Add account                                                │
│ Code   [ 51300 ]        Name  [ Plant hire cost         ]  │
│ Class  [ Cost of sales ▾]  Subtype [ Other direct cost ▾]  │
│                                                            │
│ Normal balance: Debit (from class)                         │
│ ▸ Advanced   ← disclosure, collapsed by default            │
│                                                            │
│ [ Add account ]   [ Cancel ]                               │
└──────────────────────────────────────────────────────────┘

▾ Advanced (expanded) ─────────────────────────────────────
   Normal balance   [ Debit ▾]   (⚠ contra warning if flipped)
   Posting policy   [ Unrestricted ▾]
   Effective from   [ 2026-09-01 ]
   Parent account   [ 51000 Cost of sales (optional) ]
   ☐ Control account → Subledger [ … ]
```

```
Edit — before any posting ─────────────────────────────────
  Broad edits allowed: name, class, subtype, normal balance,
  parent. Banner: "No postings yet — full edit allowed."

Edit — after postings exist ───────────────────────────────
  Descriptive only: Name / label editable.
  Class · Normal balance · Control meaning are LOCKED (shown
  read-only with a lock hint): "This account has postings.
  To change its meaning, retire it and create a new one."
  [ Retire account ]   [ Save name ]
```

```
Retire ────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────┐
│ Retire 51300 Plant hire cost                               │
│ Sets the account Inactive. It stays on past reports and    │
│ cannot be deleted (it is referenced). New postings are     │
│ blocked. If this is a re-classification, create the new    │
│ account and move the balance with a reclassification       │
│ journal.                                                    │
│ [ Retire account ]   [ Cancel ]                            │
└──────────────────────────────────────────────────────────┘
```

375px: the create form is already vertical; Advanced disclosure stacks; edit lock-hints render as
full-width read-only rows.

#### State / action matrix — S6

| State | Renders | Actions | Perm |
|---|---|---|---|
| List loading | skeleton | — | — |
| List loaded | CoA table (code, name, class, status) | Add account, open detail | P? `manage:account` to add |
| Create (default) | 4 fields + Advanced disclosure | **Add account** | P? |
| Create validation | missing-field Alert (all at once) | fix | — |
| Create 409 code exists | inline "Code already exists" | change code | — |
| Create 404 parent | "Parent code not found" | fix parent | — |
| Edit, no postings | broad edit; "full edit allowed" banner | **Save**, Retire | P? |
| Edit, has postings | name-only; class/balance/control locked with hint | Save name, **Retire** | P? |
| Retire | Inactive confirmation; reclass guidance | **Retire account** | P? |
| Contra balance flip | ⚠ warning (not a block) — legitimate for Accumulated depreciation | proceed | — |
| Inactive account | read-only; "Inactive — no new postings" | reactivate? (see below) | P? |
| No permission | list read-only; no Add/Edit | — | lacks `manage:account` |

⛔ **BLOCKED-ON-BACKEND:** there is **no `PATCH /accounts/:id`** and **no status-change endpoint** —
today `POST /accounts` creates, `GET` reads, nothing edits or retires. Edit-by-posting-state and Retire
need: (a) a name/label update endpoint, (b) an Active→Inactive transition, (c) a **has-postings** flag
(or count) on `Account` so the UI can pick broad-vs-descriptive edit without guessing. The **4-field
create + Advanced disclosure is buildable now** (pure re-composition of the existing create form). Edit
and Retire are ⛔ until the endpoints exist.

---

### S7 — Bank reconciliation (match workspace + summary) · NEW

**Workflow (JD7).** Pick a bank account + statement date/balance → import/enter statement lines → match
them against GL cash movements (matched / unmatched / partial) → record bank charges & interest as
adjusting entries → show the reconciliation **difference** (statement balance vs reconciled GL balance)
→ reconciled-by / approved-by → immutable history → controlled reopen.

This is the largest net-new surface and the most backend-dependent. Two in-page views on one route,
switched by a quiet **segmented control** (doctrine §5 level-3 pattern), not a nav level:
**Match** and **Summary**.

#### Match workspace (desktop)

```
┌ Bank reconciliation ────────────────────────────────────┐
│ Bank [10200 Bank — main ▾]  Statement date [2026-08-31]  │
│ Statement closing balance [ 48,120.00 ]                  │
│ View: ( Match ) ( Summary )        ← segmented, level-3  │
│                                                          │
│  STATEMENT LINES                 GL CASH MOVEMENTS        │
│  ┌───────────────────────┐  ┌──────────────────────────┐ │
│  │ 03 Aug  −1,200.00  ✓  │  │ JE-131 03 Aug −1,200.00 ✓│ │
│  │ 09 Aug  +30,000.00 ✓  │  │ RCP-88 09 Aug +30,000  ✓ │ │
│  │ 14 Aug    −45.00  ⚠   │  │ JE-142 14 Aug   −190.00  │ │
│  │  (bank charge, no GL) │  │  (unmatched)             │ │
│  │ 28 Aug   −8,900.00 ⚠  │  │                          │ │
│  └───────────────────────┘  └──────────────────────────┘ │
│  [ Match selected ]  [ Unmatch ]  [ Auto-match by date ] │
│                                                          │
│  ADJUSTMENTS (charges / interest → an adjusting journal) │
│  [ + Bank charge  45.00 → 52400 Finance cost ]           │
│  [ + Interest earned … → 42100 Other income ]            │
│                                                          │
│  ── Reconciliation difference (live) ──────────────────  │
│  Statement closing        48,120.00                      │
│  GL cash per matched       48,120.00                     │
│  Difference                     0.00   ✓ reconciled      │
│                                                          │
│  [ Record reconciliation ]  (disabled unless diff = 0)   │
└──────────────────────────────────────────────────────────┘
```

#### Summary view

```
┌ Bank reconciliation · Summary ──────────────────────────┐
│ 10200 Bank — main · as of 2026-08-31                     │
│ Statement 48,120.00  ·  GL 48,120.00  ·  Diff 0.00  ✓    │
│ Reconciled by A. Nur · 2026-09-01                        │
│ Approved by  (pending)          [ Approve ]              │
│                                                          │
│ HISTORY (immutable)                                      │
│ 2026-07-31  reconciled  diff 0.00   A. Nur   [ view ]    │
│ 2026-06-30  reconciled  diff 0.00   A. Nur   [ view ]    │
│  (a locked reconciliation can be reopened with a reason) │
└──────────────────────────────────────────────────────────┘
```

375px: the two match columns **stack** (statement lines above GL movements); matching is line-tap →
"match to…" picker rather than side-by-side selection; adjustments and the difference summary are
full-width sections; Summary is a vertical list.

#### State / action matrix — S7

| State | Renders | Actions | Perm |
|---|---|---|---|
| No bank selected | picker + empty prompt | select bank | P? `manage:period` (treasury) |
| Non-reconcilable account picked | "This account is not marked reconcilable." | pick another | — |
| Loading statement + GL | skeleton both columns | — | — |
| Empty (no GL movements) | "No cash movements for this account in range." | change range | — |
| Matching | matched ✓ / unmatched ⚠ / partial markers | Match, Unmatch, Auto-match | P? |
| Adjustment add | charge/interest → adjusting journal preview (Dr/Cr, JD6) | add adjustment | P? |
| Difference ≠ 0 | red difference; Record disabled | keep matching | — |
| Difference = 0 | ✓ reconciled; primary enabled | **Record reconciliation** | P? |
| Recording | spinner | — | — |
| Recorded | Summary view, reconciled-by stamped | Approve (if separate approver) | P? |
| Approve | approved-by stamped; entry locked | — | P? |
| Reopen locked reconciliation | reason-required dialog (audited) | **Reopen** | P? |
| Error | Alert + retry | retry | — |
| No permission | read-only summary/history | — | lacks perm |

⛔ **BLOCKED-ON-BACKEND (mostly):** there is **no bank-reconciliation domain** in the current API.
`POST /accounting/reconcile` only compares control-account balances (AR=GL, AP=GL, optional bank total)
— it does **not** import statement lines, match transactions, record charge/interest adjustments, hold
reconciled/approved-by, keep immutable history, or reopen. The whole match workspace, adjustments, the
difference calc, and history are **⛔ blocked** on a new backend surface (statement-line import, a
match/unmatch model, an adjusting-journal hook, a reconciliation record with lifecycle). **Buildable
now:** the bank-account picker, the reconcilable-vs-not gate (`isReconcilable` exists on `BankAccount`),
and a read-only control-account "bank reconciles to GL" check reusing `POST /accounting/reconcile` as an
interim summary — but not the JD7 match tool.

---

### S8 — Year-end close (guided) · NEW

**Workflow (JD7).** Distinct from monthly period close. Fiscal year `ACTIVE → CLOSING → CLOSED` (the
schema's `FiscalYearStatus` is `DRAFT/OPEN/LOCKED/CLOSED`; "CLOSING" is the guided-flow's in-progress
state). The final period must be CLOSED first. Guided steps: **pre-flight checks → compute P&L closing
balances → preview the `SYSTEM_YEAR_END_CLOSE` journal (zero temp revenue/expense → net result to
retained earnings) → confirm → carry BS forward + open next year.** Prevent duplicate close; record
initiator/authorizer; controlled reopen/re-close.

Today this is a single `Close year` button + one confirm dialog with **no preview** (`period-actions.tsx`).
The refinement is a linear guided flow (in-page step switcher, one route):

```
┌ Year-end close · FY 2026 ───────────────────────────────┐
│ Step ①Pre-flight ─ ②Preview ─ ③Confirm ─ ④Done           │
│                                                          │
│ ① PRE-FLIGHT                                             │
│   ✓ All 12 periods CLOSED                                │
│   ✓ Trial balance ties ($0.00)                          │
│   ✓ Retained-earnings account set (31000)               │
│   ✗ Bank — main reconciled through Dec   [ Reconcile ]   │
│   ⚠ FY 2026 not yet closed elsewhere (no duplicate)      │
│   [ Continue ]  (disabled while any ✗)                   │
│                                                          │
│ ② PREVIEW  — SYSTEM_YEAR_END_CLOSE journal               │
│   Zeroing temp accounts into retained earnings:          │
│   Account                        Debit        Credit      │
│   41000 Project revenue     930,000.00            —       │
│   51xxx Cost of sales             —        801,700.00     │
│   5xxxx Expenses                  —         52,300.00     │
│   31000 Retained earnings         —         76,000.00     │
│   ─────────────────────────────────────────────────      │
│   Net result to retained earnings:  +76,000.00           │
│   [ Back ]   [ Confirm close ]                           │
│                                                          │
│ ③ CONFIRM                                                │
│   Closing FY 2026 posts this journal, freezes the year,  │
│   carries balance-sheet balances forward, and opens FY   │
│   2027. This cannot be undone except by a controlled      │
│   reopen. Recorded against your name.                    │
│   Initiated by A. Nur · Authorised by [ CFO ▾ ]          │
│   [ Post year-end close ]                                │
│                                                          │
│ ④ DONE                                                   │
│   FY 2026 CLOSED · journal JE-YE-2026 · FY 2027 opened   │
│   [ View closing journal ]                               │
└──────────────────────────────────────────────────────────┘
```

375px: steps become a vertical progress list; the preview journal reflows to stacked Dr/Cr rows; each
step is a full-screen section with one primary action.

#### State / action matrix — S8

| State | Renders | Actions | Perm |
|---|---|---|---|
| Entry, periods not all closed | "Close all 12 periods first" + link to S3 | go to periods | P? `manage:fiscal-year` |
| Pre-flight loading | skeleton checklist | — | — |
| Pre-flight, a check fails | ✗ rows with deep links; Continue disabled | fix (reconcile, etc.) | P? |
| Pre-flight passes | all ✓/⚠; Continue enabled | **Continue** | P? |
| Preview | closing journal Dr/Cr + net result | Back, **Confirm close** | P? |
| Duplicate-close attempt | blocked: "FY 2026 is already CLOSED" | view journal | — |
| Confirm | initiator + authoriser; immutability warning | **Post year-end close** | P? |
| Posting | spinner | — | — |
| Done | CLOSED + journal ref + next-year opened | View closing journal | — |
| Close error | Alert with server message; stay on Confirm | retry | — |
| Reopen a closed year | reason-required, audited (exceptional) | **Reopen year** | P? |
| No permission | flow hidden; read-only status | — | lacks `manage:fiscal-year` |

⛔ **BLOCKED-ON-BACKEND (partial):** `closeFiscalYear` exists (`POST /periods/fiscal-year/:id/close`) and
does the posting, but it is **fire-and-forget**: no pre-flight endpoint, **no closing-journal preview**
before commit, no `CLOSING` in-progress state, no initiator/authoriser capture, and **no year reopen**.
Buildable now: the pre-flight *checks* can be composed client-side from existing reads (all-periods-closed
from `FiscalYear.periods`, trial-balance-ties from `getTrialBalance().balanced`, retained-earnings-set
from the FY record). The **closing-journal preview** (step ②) is ⛔ — it needs a `POST
/periods/fiscal-year/:id/close?dryRun=true` (or a compute endpoint) that returns the journal without
posting. The **duplicate-close guard** is buildable from `FiscalYear.status === 'CLOSED'`. **Year reopen**
is ⛔ (no endpoint).

---

## 4. Cross-screen state model (governance & lifecycles)

```
Journal (pilot, governance OFF)      Journal (governance ON, future — designed not shipped)
  DRAFT ──post──▶ POSTED               DRAFT ─submit▶ SUBMITTED ─▶ PENDING_APPROVAL
    │               │                                    │ approve         │ reject
  delete          reverse                                ▼                 ▼
                    ▼                                  APPROVED ─post▶ POSTED   (back to DRAFT)
                 REVERSED

Period:   OPEN ─lock▶ LOCKED ─close(gate)▶ CLOSED ─reopen(reason,audited)▶ REOPENED ─lock▶ …
                       └ close adjustments allowed while LOCKED
Fiscal year: ACTIVE ─(all periods CLOSED)▶ CLOSING ─post close journal▶ CLOSED ─reopen(reason)▶ …
Account:  ACTIVE ─(has postings)▶ descriptive-edit-only ─retire▶ INACTIVE   (never deleted once referenced)
Bank recon:  DRAFT match ─diff=0▶ RECORDED ─approve▶ APPROVED(locked) ─reopen(reason)▶ …
```

The **honesty rule (doctrine §4)** governs the whole document: no screen renders a status, an
"approved by", or an action the server does not actually enforce. In the pilot that means the journal
lifecycle is visibly two states, and every governance/reopen/approval affordance that lacks a backend
is either omitted or explicitly tagged ⛔ here — never shipped as a disabled stub.

---

## 5. Edge & exception coverage

| Exception | Where | Behaviour |
|---|---|---|
| **Unreconciled bank at close** | S3 gate | Appears as a hard **BLOCKER** with a **Reconcile** deep link to S7 for that account. Per JD7 an unreconciled *reconcilable* bank account blocks close; a non-reconcilable one does not. ⛔ needs the gate to emit this as a typed blocker (today it is a plain string, if present at all). |
| **Out-of-balance subledger (AR≠GL / AP≠GL)** | S3 gate, S4 recon preview | Hard BLOCKER with variance amount + **View ledger** link. In S4 it blocks the migration run. Reuses the `reconciled`/`variance` fields on `ControlAccountCheck`/`ReconciliationLine`. |
| **Duplicate year-end close** | S8 | Guarded from `FiscalYear.status === 'CLOSED'` before the flow starts; step ① shows "already closed"; the primary is replaced by **View closing journal**. |
| **Reopen (period / year / reconciliation)** | S3, S8, S7 | Always an **exceptional, audited** action behind a **mandatory reason** dialog — never a status toggle in a row. Reopen invalidates downstream snapshots (period) and is recorded against the actor. Period reopen exists (`reopenPeriod`); ⛔ year reopen and reconciliation reopen need endpoints. |
| **Migrated open-item settlement** | S4 → AR/AP screens | An `OPENING_BALANCE` posting-status row is a **settled historical item**, not an error, and is excluded from the close gate's "unposted approved documents". Screens must render it as a normal outstanding item (with an "opening" tag) that receipts/payments can settle — never as a FAILED/unposted exception. (Called out in `types.ts` `PostingStatus`.) |
| **Contra account on CoA create** | S6 | Flipping normal balance against the class (e.g. Accumulated depreciation = ASSET/CREDIT) **warns, never blocks** — blocking would make depreciation un-modellable. |
| **Posting to a LOCKED/CLOSED period** | S1 | The date picker's period state is surfaced; a date in a closed period is refused with a plain message, not a silent 400. |
| **Ambiguous / not-configured control account** | S1, S4, S7 | If two accounts share a control subtype, resolution returns AMBIGUOUS (per `posting-accounts.ts`) — the screen tells the user to fix the chart, it never guesses the first match. |
| **Reversed-then-reposted invoice/journal** | S2 | UI stays stricter than the server (which will re-post a reversed doc) — reversed entries are view-only; no re-post affordance. |
| **Gate race (passed, then 400 on close)** | S3 | The close still runs the server gate; a race produces an Alert with the server message and re-runs the pre-close panel rather than failing silently. |

---

## 6. Buildable now vs ⛔ blocked-on-backend (summary)

**Buildable now (re-composition / existing endpoints):**
- S1 Journal create collapse to `DRAFT→POSTED` + Dr/Cr **posting preview** (reuses `createJournal`,
  `postJournal`, `postableAccounts`).
- S2 Journal detail governance-collapse + reverse (existing `reverseJournal`).
- S3 Period close **panel** presentation of the existing `checkCloseGate` (as a pre-flight, not just
  inside the dialog) + reopen reason (existing `reopenPeriod`).
- S4 Opening migration **Layer 1** (GL paste → `SYSTEM_OPENING`) + reconciliation preview (all exist).
- S5 Project P&L **single-project** view + journal-line drill via `getAccountLedger(...projectId)`.
- S6 CoA **4-field create + Advanced disclosure** (pure re-layout of the existing create form).
- S7 bank picker + `isReconcilable` gate + interim read-only control-account check
  (`runReconciliation`).
- S8 pre-flight **checks** composed from existing reads; duplicate-close guard from `FiscalYear.status`.
- IA/nav regrouping (uses the existing `groupKey` mechanism).

**⛔ Blocked-on-backend (needs new endpoints/fields — raise as issues, do not stub):**

| Need | For | Ask |
|---|---|---|
| Close-gate **severity split** + typed blockers (incl. unreconciled-bank) + **snapshot-exists** flag on period | S3 | `CloseGate` → `{ passed, blockers: {code,message,link}[], warnings: {...}[] }`; period carries `hasSnapshot` |
| Open-item **AR/AP import** run atomicity + `clientId`/`supplierId`/`expenseProfileCode` resolution + CSV | S4 | confirm `RunOpeningBalanceDto.openArInvoices/openApBills` server behaviour; atomic multi-set run |
| **Project P&L roll-up** (all projects, one call) | S5 | `GET /reports/pl/by-project?from&to` |
| **Account edit / retire** + **has-postings** flag | S6 | `PATCH /accounts/:id` (name), status transition Active↔Inactive, `postingCount`/`hasPostings` on `Account` |
| **Bank reconciliation domain** (statement lines, match/unmatch, charge/interest adjusting journal, reconciled/approved-by, immutable history, reopen) | S7 | a whole new module — the single biggest backend ask in this proposal |
| Year-end **closing-journal preview** (dry-run), `CLOSING` state, initiator/authoriser capture, **year reopen** | S8 | `POST /periods/fiscal-year/:id/close?dryRun=true`; reopen endpoint |
| Real **authorization** on period/year/journal endpoints (#25) | all | the permission gates here are presentation-only until this lands — keep the honest warning note |

---

## 7. Doctrine compliance checklist (self-review before design-review)

- One primary action per screen — the accent button (Post journal / Close period / Run migration /
  Record reconciliation / Post year-end close). ✔
- Money is neutral, right-aligned, tabular, real minus sign; negative margins are **not** heat-mapped. ✔
- Status = word + colour + icon via the existing badge registry; period/journal tones already defined. ✔
- No disabled stub for an unbuilt feature — everything unbuilt is ⛔-tagged and **omitted from the UI**,
  not greyed out. ✔ (doctrine §4)
- Nav stays two persistent layers; level-3 view switching (Bank recon Match/Summary) uses a segmented
  control, not a second tab bar. ✔ (doctrine §5)
- All operational states covered per screen: loading / empty / partial / error / permission-gated /
  terminal / large-data (portfolio table, ledger drill). ✔
- English-only, dark-first, 375px reflow specified for every screen. ✔
- No open product-policy guessed into the design — the governance-ON journal flow, the gate severity
  model, and the reconciliation lifecycle are **named and scoped**, with the pilot showing only what the
  backend enforces today. ✔

---

## 8. Open product-policy decisions (name, don't guess)

1. **Bank-reconciliation approval separation.** Is "reconciled by" the same person as "approved by", or
   a two-role control? S7 designs for two stamps; confirm whether the pilot needs the approver at all.
2. **Year-end authoriser.** JD7 says "record initiator/authorizer" — is the authoriser a real second
   person (segregation of duties) or the same actor? Affects step ③ of S8.
3. **CoA reactivation.** Retire is Active→Inactive; is reactivation ever permitted, or is a retired
   account permanent (create-new only)? S6 currently shows Inactive as terminal.
4. **Migrated open-item edit.** After the one-shot migration, can an individual mis-entered open item
   be corrected, or only reversed with the whole batch? Drives whether S4's open-item rows are editable
   post-run.
5. **"Close adjustment" definition (JD2).** While LOCKED, exactly which categories may still post
   (`CLOSING_ADJUSTMENT` journal category exists) — and does S1 need a distinct "close adjustment"
   entry mode, or is a normal journal with that category enough?

These are for Eng Ahmed / product, not to be resolved in the wireframe.
