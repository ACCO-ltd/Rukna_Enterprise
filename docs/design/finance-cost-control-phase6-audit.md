# Phase 6 — Project Finance & Cost Control: grounded codebase audit

> # PHASE 6 — FROZEN 2026-09-06
>
> This document is the record of what was found. It is not a to-do list, and Finance is not
> reopened by anything on the deferred list below.
>
> | | |
> |---|---|
> | Financial correctness | **PASS** |
> | REC-01 · MJ-05 · YE-05 | **PASS** |
> | Finance IA | **FROZEN** |
> | Overview · Cost Control · Profit & Loss · Ledger | **COMPLETE** |
> | Budget lifecycle | **COMPLETE** |
> | Project cost reconciliation | **COMPLETE** |
> | Accounting setup states | **COMPLETE** |
> | Chart semantics | **LOCKED** (ux-doctrine §8) |
> | Sequential palette · categorical palette | **VALID** |
> | Meter edge cases | **PASS** |
> | Runtime browser QA · responsive · dark mode | **PASS** |
> | Accessibility encoding | **PASS** |
> | Build · typecheck · lint | **PASS** |
>
> **Fixed since the audit:** P0-1, P0-2, P0-3, P1-1, P1-2, P1-3, P1-5, P1-7, P2-1..P2-5, P3-1.
>
> **Deferred, legitimately open, and NOT a reason to reopen Finance:**
>
> - **P1-4** — IPC retention / advance-recovery treatment on the client invoice. Needs Eng
>   Ahmed's ruling before any code.
> - **P1-6** — journal approval is optional server-side.
> - Real bank reconciliation.
> - The remaining P2 / P3 accounting backlog (P2-6..P2-11, P3-2..P3-7).
> - **Shared heading hierarchy** — a cross-module UI debt, not a Finance one. See
>   `ux-doctrine.md` §9.
>
> **One question the audit did not settle and the implementation deliberately routed around:**
> which tax basis the commitment stages report in. Slice B releases the accrual at exactly what
> was accrued, which nets ACCRUED to zero under either answer — so REC-02 holds without it being
> decided. It is a reporting-basis question for Cost Control, not a ledger-integrity one. See §8.
>
> **Runtime proof:** `apps/web/e2e/project-finance-qa.spec.ts` — 28 cases across 1440-dark,
> 375-light and 375-dark.

**Date:** 2026-09-06 · **Branch:** `feat/project-workspace-shell-overview` · **Method:** read of the
actual backend, schema, migrations, tests and frontend. No code was changed. Where a prior design
document or the capability matrix disagrees with the code, **the code is reported as the truth and
the contradiction is named** (§18).

---

## 1. Executive verdict

**A truthful project Finance workspace cannot be built on the current backend. Not because the
architecture is wrong — it is largely right — but because three specific defects make the numbers it
would display false.**

The good news first, because it is substantial and load-bearing:

- The commitment ledger is genuinely authoritative. Signed rows, idempotency keys, cost-target
  inheritance from PO line → GRN → bill, correct `asOf` semantics on `accountingDate`. Procurement
  Overview and Cost & Commitments read it and cannot disagree.
- `ProjectCostBudget` is a real, correctly-versioned aggregate with an immutable baseline and
  separate `manage`/`baseline` permissions.
- The posting engine is real: double-entry validation, period validation, account-version snapshots,
  source-document idempotency, a DB-level balance trigger.
- `JournalLine` carries `projectId`, `boqNodeId` and `contractId`. A project-dimensioned P&L is a
  legitimate read model, and `PLReportService` implements it correctly, with the right sign
  convention and `CLOSING` exclusion.
- The **year-end net-P&L sign bug is fixed.** Net income is computed once as Σ(credit − debit) and the
  retained-earnings direction is derived from its sign.
- The **fabricated journal approval is fixed.** `approvedBy`/`approvedAt` are no longer written
  unconditionally; `submit()` routes through the ADR-011 governance seam.

Now the three defects that block Phase 6:

**P0-1 — Project ACTUAL cost is structurally unreachable through the product's own UI.**
`SupplierBillService.post()` correctly stamps `projectId`/`boqNodeId` onto the expense journal lines
— from `billLine.projectId ?? bill.projectId`. But neither bill form
(`apps/web/src/features/procurement/components/bill-form.tsx:135-150`,
`po-bill-form.tsx:206-224`) sends a `projectId`, on the header or on any line, and `boqNodeId` is not
even present in the web payload type. **Every supplier bill entered through the app posts with
`projectId = null`.** Therefore, today: Project Actual P&L cost = $0,
`ProjectFinancialPosition.actualCost` = $0, and the procurement `ACTUAL` stage (which *is* correctly
attributed, because it reads the matched PO line) **cannot reconcile to the GL by construction**. The
two paths are independent and only one of them is wired.

**P0-2 — Every manual journal is posted twice.**
`ManualJournalService.post()` calls the posting port, which **creates a new `JournalEntry` with a full
copy of the lines**, and then also flips the original draft record to `status: 'POSTED'`
(`manual-journal.service.ts:262-266`). Two POSTED entries, identical lines. Every report filters on
`entry.status = 'POSTED'`, so Trial Balance, P&L, Project P&L, Balance Sheet, account ledger and
`sumActualCost` all **double-count manual journals**. The behaviour is asserted as correct in
`mj.spec.ts` MJ-01 ("The original draft must also be marked POSTED"). Debits and credits both double,
so the trial balance still balances and the balance sheet still ties — the error is invisible to every
existing check. Worse: the draft copy has `accountingPeriodId = null`, while `YearEndCloseService`
scopes by `accountingPeriodId`, so year-end close zeroes only *one* of the two and leaves a permanent
residual in every P&L account touched by a manual journal.

**P0-3 — "Forecast cost" and "Forecast margin" are not forecasts, and the metric derived from them is
mathematically indefensible.**
`forecastCost = actualCost + COMMITTED + ACCRUED` (`financial-position.policy.ts:36`). Uncommitted
remaining scope is not in it at all. A project 10% through its spend with no open POs reports
`forecastCost = actual`, i.e. **cost at completion equals cost to date**. The physical-vs-financial
early-warning banner then computes `costConsumedPercent = actualCost ÷ forecastCost` — which is
**100% whenever there are no open commitments**, regardless of how much of the project remains. That
banner is on the Finance tab today, telling PMs "cost is ahead of progress" on healthy projects.

Two further material problems, one severity down:

- **P1 — Year-end close cannot post.** `closeYear` requires Period 12 `LOCKED`, then posts a journal
  with `journalCategory: 'YEAR_END_CLOSE'`. `PeriodValidator` rejects everything except
  `CLOSING_ADJUSTMENT` in a LOCKED period. The year-end unit test mocks the posting port entirely, so
  this has never executed against the real validator. Year-end close is **non-functional end-to-end**.
- **P1 — Bank reconciliation is presentation-only.** `ReconciliationService` compares the bank GL
  balance *to itself* and hardcodes `variance: '0.00', reconciled: true`. There is no statement, no
  statement line, no matching aggregate, no unreconciled-item concept.

**Recommendation:** Phase 6 is a two-stage program. Stage 1 fixes P0-1, P0-2 and removes the fake
forecast (backend + a bill cost-coding UI). Stage 2 builds the Finance workspace. Building the
workspace first would ship a screen whose headline number is $0 and whose secondary number is a
fiction.

---

## 2. Current Finance architecture map

```
apps/api/src/business/accounting/
├── accounting-core/         Account/AccountVersion, FiscalYear, Period, PostingProfile (read-only),
│                            AccountingPostingService (the ONLY writer of JournalEntry+lines),
│                            validators (double-entry, period, control-account),
│                            OpeningBalanceService, ReconciliationService, PostingAccountResolver
├── accounts-payable/        Supplier, SupplierBill (+post/reverse), SupplierPayment
├── accounts-receivable/     ClientInvoice (+generate from IPC / installment, post, reverse),
│                            CustomerReceipt (+post, allocate, reverse)
├── general-ledger/          LedgerService, TrialBalanceService, PLReportService,
│                            BalanceSheetService, SnapshotService, PeriodManagementService,
│                            YearEndCloseService, ProjectReportController (/projects/:id/pl)
├── manual-journals/         ManualJournalService (DRAFT→SUBMITTED→APPROVED→POSTED→REVERSED)
└── financial-position/      ProjectFinancialPositionService  (/projects/:id/financial-position)

apps/api/src/business/procurement/
├── commitment-ledger/       CommitmentLedgerWriter (committed/accrued/actual), repository, controller
├── purchase-orders/         PO revision approve/cancel → COMMITTED; cost-target policy
├── goods-receipts/          GRN post → COMMITTED(−) + ACCRUED(+).  No GL posting.
├── bill-matching/           3-way match; gate on bill posting.  Does NOT validate cost coding.
└── project-procurement/     ProjectProcurementService (overview, cost), ProjectCostBudgetService
```

Frontend today:

| Surface | Route | Component |
|---|---|---|
| Project "Finance" tab | `/projects/[id]/pl` | `ProjectFinancialPositionCard` + 2 signal banners + `ProjectPlContent` |
| Project Procurement tab | `/projects/[id]/procurement` | `ProjectProcurementTab` → `CostPositionBand`, `cost-commitments-view`, `cost-charts` |
| Org accounting | `/finance/accounting/*` | CoA, periods, journals, ledger, TB, P&L, BS, monthly comparison, bills, invoices, payments, bank accounts, opening balance |

There is **no** project Finance overview, **no** project ledger, and **no** cost-budget authoring UI
(the budget API exists and is unreached from any screen — `CostPositionBand` renders a `setBudget`
link to a `budgetHref` that no caller currently supplies with a real route).

---

## 3. Accounting data-flow map

```
Client side
  IPA → IPC (certifiedTotal GROSS of deductions; RETENTION + ADVANCE_RECOVERY held as deduction rows)
      → ClientInvoice   subtotal = ipc.certifiedTotal        ← deductions NOT applied (§7)
                        vatAmount = subtotal × 0.05          ← rate HARDCODED
      → post  EVT-AR-001:  Dr AR (gross, no projectId)
                           Cr PROJECT_REVENUE (subtotal, projectId ✔, contractId ✔)
                           Cr VAT_OUTPUT (vat, no projectId)
  PaymentReceipt → post EVT-AR-003: Dr Bank / Cr AR / Cr Unapplied   (no projectId — all balance sheet)

Supplier side
  PO revision ACTIVE  → CommitmentLedger COMMITTED +qty×unitPrice   (NET of VAT)   [no GL]
  GRN POSTED          → COMMITTED −accepted×unitPrice, ACCRUED +same (NET)         [no GL]
  SupplierBill POSTED → GL  EVT-AP-001: Dr expense per line (GROSS, projectId/boqNodeId from the
                                          BILL LINE — null from the UI today)
                                        Cr AP (total, no projectId)
                      → Ledger: ACCRUED −grossAmount, ACTUAL +grossAmount, cost-target from the
                                MATCHED PO LINE (independent of the GL attribution above)
  SupplierBill REVERSED → GL reversal journal only. NO commitment-ledger reversal. (§6)
  SupplierPayment       → Dr AP / Dr Supplier Advance / Cr Bank  (no projectId)

Manual journal → 2 POSTED entries (P0-2).  Lines carry projectId/departmentId/costCenterId.
Opening balance → one EVT-OPB-001 journal + AR/AP open items. No project attribution at all.
Year-end close → EVT-YE-001 CLOSING journal. Blocked by PeriodValidator (§14).
```

**Note the asymmetry that matters most:** procurement `ACTUAL` and GL project cost are written in the
same transaction from **two different sources** — the matched PO line for the ledger, the hand-keyed
bill line for the GL. Nothing forces them to agree.

---

## 4. Project attribution map

| Carrier | `projectId` | `boqNodeId` | `spendCategoryId` | Populated by |
|---|---|---|---|---|
| `PurchaseOrderLine` | ✔ | ✔ | ✔ | buyer, validated by `cost-target.policy.ts` |
| `GoodsReceiptLine` → ledger | inherited | inherited | inherited | GRN post |
| `CommitmentLedgerEntry` | ✔ | ✔ | ✔ | writer, inherited read-only |
| `SupplierBillLine` | ✔ (column) | ✔ (column) | ✔ (column) | **never set by any UI path**; `spendCategoryId` isn't even in the create DTO |
| `JournalLine` | ✔ | ✔ | **absent** | posting engine, from the bill line / invoice / manual journal |
| `ProjectCostBudgetLine` | via budget | ✔ | ✔ | budget author |
| `ClientInvoice` | ✔ | — | — | derived from `contract.projectId` |

**Two findings fall straight out of this table:**

1. **`JournalLine` has no `spendCategoryId`.** Project-level non-BOQ cost (state 2 of the cost-target
   policy: transport, insurance, site overhead) **cannot survive into the GL as a category.** It
   arrives in the GL only as `projectId` with a null `boqNodeId`. The commitment ledger keeps the
   category; the GL does not. A Cost Control screen that rolls project-level cost up by category can
   therefore only ever be a *commitment-ledger* view, never a GL view.
2. The schema comment on `PurchaseOrderLine` still says "Both set … or both null; half-specified is
   rejected" — stale since 2026-09-06. `cost-target.policy.ts` implements the correct three-state
   rule. Documentation drift, not a defect.

---

## 5. Formula trace table

Legend: **VALID** · **RELABEL** (correct arithmetic, wrong or misleading name) · **AMBIGUOUS** ·
**WRONG** (mathematically indefensible) · **UNAVAILABLE** (no basis exists) · **FAKE** (presented, not
implemented).

| Metric | Frontend | Backend source | Exact formula | Tax basis | Posting basis | Project attribution | Status | Risk |
|---|---|---|---|---|---|---|---|---|
| **Budget** | `CostPositionBand` (Procurement) | `findBaselinedBudget` | Σ `ProjectCostBudgetLine.budgetAmount` where budget `status = BASELINED` | undefined (author's choice) | none | budget rows | **VALID** — null, never 0, when unbaselined | Basis (VAT in/out) undocumented; author decides silently |
| **Committed** | `CostPositionBand`, cost table | `groupByStage` | Σ signed `amount` where `stage=COMMITTED` | **ex-VAT** (PO unit price) | none (no GL) | ledger `projectId` | **RELABEL** | Reduced at GRN, so this is *open* commitment. Labelled "Committed", read as "total ordered" |
| **Accrued** | same | same | Σ signed where `stage=ACCRUED` | **ex-VAT at raise, inc-VAT at release** | none | ledger | **WRONG** when VAT > 0 | GRN accrues `qty×unitPrice` (net); bill reverses `grossAmount`. Residual `−VAT` sits in ACCRUED forever |
| **Actual** (procurement) | same | same | Σ signed where `stage=ACTUAL` | **inc-VAT** (non-recoverable) | posted bill | matched PO line | **VALID** for the ledger | Does not reconcile to GL (§6); never reversed on bill reversal |
| **Uncommitted budget** | `CostPositionBand` | `buildPosition` | `budget − committed` | mixed (budget vs ex-VAT) | none | — | **WRONG** | `committed` falls at goods receipt, so *budget headroom rises as you receive goods*. Budget 1 000, PO 400, GRN 400 ⇒ uncommitted returns to 1 000 |
| **Budget less actual** | footnote | `buildPosition` | `budget − actual` | mixed (budget vs inc-VAT) | posted bill | — | **VALID** | Correctly separated from the above; good |
| **Committed not billed** | not rendered | `buildPosition` | `max(0, committed − actual)` | mixed | — | — | **RELABEL** | `committed` is already net of receipts, so subtracting `actual` double-subtracts; equals open PO value, not "received but unbilled" |
| **Forecast cost** | FP card, **emphasised** | `financial-position.policy.ts:36` | `actualCost + COMMITTED + ACCRUED` | mixed (inc-VAT GL + ex-VAT ledger) | posted GL + ledger | GL `projectId` (= ∅ today) | **WRONG** | Excludes all uncommitted remaining scope. Systematically understates cost at completion; today ≈ `−VAT` |
| **Forecast margin** | FP card, **headline** | policy:37 | `contractValue − actual − remaining` | contract ex-VAT vs cost inc-VAT | mixed | mixed | **WRONG** | Inherits the above and adds a tax-basis mismatch. Today ≈ full contract value |
| **Contract value** | FP card | `Contract.contractValue` | column | ex-VAT | none | contract | **VALID BUT INCOMPLETE** | Ignores approved variation orders. `CommercialService.deriveContractValueFigures` does the VO arithmetic — Finance does not use it |
| **Certified** | FP card | `sumCertifiedRevenue` | Σ(`certifiedTotal` − Σ deductions) over effective IPCs | ex-VAT | none | contract → project | **VALID** (= "certified net") | Labelled "Certified"; Commercial calls the same figure `certifiedNet` and also shows `certifiedGross`. Two tabs, two meanings for one word |
| **Invoiced** | FP card | `sumSettlement` | Σ `ClientInvoice.totalAmount` where `postingStatus=POSTED` | **inc-VAT** | posted invoice | contract | **AMBIGUOUS / mixed-basis** | Sits directly beneath "Certified" (ex-VAT). Invoiced reads ~5% higher than certified for the same work, permanently |
| **Received** | FP card | `sumSettlement` | Σ posted `ClientReceiptAllocation.allocatedAmount` | inc-VAT | posted receipt | contract | **VALID** | Excludes unallocated cash on account — correct, but unstated |
| **Outstanding** | FP card | policy:35 | `invoiced − received` | inc-VAT both sides | posted | contract | **VALID** | — |
| **Revenue (accounting)** | *not shown anywhere* | `PLReportService` INCOME section | Σ(credit − debit) on `INCOME` accounts, POSTED, non-CLOSING, `projectId` filter | **ex-VAT** | posted GL | `JournalLine.projectId` ✔ | **VALID and unused** | The one defensible revenue number in the system is on the Project P&L and nowhere else |
| **Project P&L revenue** | `ProjectPlContent` | as above | as above | ex-VAT | posted | ✔ | **VALID** | Doubled by P0-2 if a manual revenue journal exists |
| **Project P&L cost** | `ProjectPlContent` | `COST_OF_SALES` + `EXPENSE` sections | Σ(debit − credit) | **inc-VAT** (non-recoverable) | posted | ✔ | **VALID formula, UNAVAILABLE data** | $0 for every project because no bill carries `projectId` (P0-1) |
| **Gross profit** | `ProjectPlContent` | `revenue − costOfSales` | — | rev ex-VAT, cost inc-VAT | posted | ✔ | **VALID** | Economically right (non-recoverable VAT is a cost); worth stating |
| **Margin %** | `ProjectPlContent` subtotal | client-side | `grossProfit ÷ revenue` | as above | posted | ✔ | **VALID** | Only ratio computed in the browser; guarded on `revenue > 0` |
| **Actual cost (FP)** | FP card | `sumActualCost` | Σ(debit − credit) on accounts whose **latest** version is `COST_OF_SALES`/`EXPENSE`, POSTED, non-CLOSING, `projectId` | inc-VAT | posted | ✔ | **UNAVAILABLE in practice** | $0 (P0-1). Also uses latest account classification, not the one effective at `accountingDate` — inconsistent with the snapshot doctrine |
| **Cost consumed %** | physical-vs-financial banner | `progress.service.ts:435` | `actualCost ÷ forecastCost` | mixed | mixed | ✔ | **WRONG** | = 100% whenever no open commitments. Denominator is not a forecast |
| **Physical progress %** | both banners | `getRollup` | weighted BOQ roll-up of verified quantities | n/a | n/a | project | **VALID** | Correctly null-guarded via `weightsComplete` |
| **Collection %** | collection banner | `progress.service.ts:472` | `receivedRevenue ÷ contractValue` | **inc-VAT ÷ ex-VAT** | posted receipts | contract | **WRONG (basis)** | Structurally overstates by the VAT rate; can exceed 100% on a fully-collected job |
| **"Financial progress" %** | — | — | — | — | — | — | **NOT IMPLEMENTED** | No such metric exists. Do not introduce one |
| **Committed / Accrued / Actual of budget %** | `CostPositionBand` | `percentOf` | `stage ÷ budgetTotal`, null when budget ≤ 0 | mixed | — | — | **VALID pattern, mixed basis** | The null-not-zero discipline here is exemplary and should be the Finance standard |
| **Cost budget version `total`** | budget list | `ProjectCostBudgetService.list` | **hardcoded `'0.00'`** | — | — | — | **FAKE** | Every non-baselined version reports a $0.00 total in the list response |

---

## 6. Actual-cost reconciliation findings

**Claim under test:** `procurement ACTUAL == GL-posted procurement-originated project cost`.

**Verdict: DISPROVED, on four independent grounds.**

Trace of a supplier bill:

1. `post()` gates on `documentStatus = APPROVED`, `postingStatus ≠ POSTED`, and — for PO-backed bills
   — `matchStatus ∈ {MATCHED, MATCHED_WITH_TOLERANCE, APPROVED_EXCEPTION}`.
2. Per line, `expenseProfileCode` → `PostingProfile` → the `PostingProfileVersion` effective on
   `bill.billDate` → `accountId`. A missing profile or missing effective version is a hard 400.
3. GL lines: `Dr expense grossAmount` with `projectId: billLine.projectId ?? bill.projectId`,
   `boqNodeId: billLine.boqNodeId`; `Cr AP totalAmount`. Posted at `bill.billDate` through
   `PeriodValidator`.
4. Then, **only if `bill.purchaseOrderRevisionId` is set**, and guarded by
   `existsForSourceAndStage(SUPPLIER_BILL, billId, ACTUAL)`, per line: `ACCRUED −grossAmount` and
   `ACTUAL +grossAmount`, with `projectId/boqNodeId/spendCategoryId` taken from
   `findBillLineCostTargets` → **`SupplierBillMatchLine.purchaseOrderLine`**.

Answers to the required questions:

- **When is ACTUAL written?** On successful bill posting, inside the same transaction as the GL
  journal. Only for PO-backed bills. **A genuine non-PO project cost never produces an `ACTUAL` row at
  all** — it lands in the GL (if attributed) and is invisible to Cost & Commitments.
- **Is ACCRUED reversed?** Yes, but at the **wrong amount**. GRN accrued `acceptedQty × unitPrice` (net
  of VAT); the bill reverses `grossAmount` (inc-VAT). With VAT ≠ 0 the ledger keeps a permanent `−VAT`
  residual in ACCRUED per line. Because `sumRemainingCommitments = COMMITTED + ACCRUED`, a fully-billed
  project reports a **negative "Remaining committed"**.
- **Do signed reversals net correctly?** For COMMITTED, yes (PO cancel/supersede reverse the *net*
  outstanding, guarded and idempotent). For ACCRUED, no (above).
- **Can a posted bill create duplicate actual?** No. The stage-existence guard plus per-line
  `idempotencyKey` (`bill-actual-{billId}-{lineId}`, unique index) make it a clean no-op on retry.
- **Does cancelling/reversing a bill reverse GL *and* ledger?** **No.** `SupplierBillService.reverse`
  posts the mirror journal and flips `postingStatus = REVERSED`, and **writes nothing to the commitment
  ledger**. `ACTUAL` stays. After a reversal, GL project cost falls to zero and procurement `ACTUAL`
  still shows the full amount. `CommitmentSourceDocType.BILL_REVERSAL` exists in the enum and is
  **never used anywhere**.
- **Does spend-category attribution survive posting?** **No.** `JournalLine` has no `spendCategoryId`,
  and `CreateSupplierBillLineDto` has no `spendCategoryId` either. It survives in the ledger only.
- **Does BOQ attribution survive posting?** It *can* — `JournalLine.boqNodeId` exists and `post()`
  passes `billLine.boqNodeId`. But the web payload type has no `boqNodeId`, so in practice it is always
  null.

**Ground 4 — the two attributions are not the same variable.** The GL takes the operator's keying on
the bill line; the ledger takes the buyer's cost-target from the matched PO line. `BillMatchingService`
compares quantity and price; it never compares or copies cost coding. Even after P0-1 is fixed by
adding fields to the bill form, **nothing stops an AP clerk coding a bill to project B against a PO
raised for project A**, at which point GL and ledger disagree silently and forever.

**Can this be proven in the current environment?** Not empirically. The only accounting fixture is
`accounting-phase1.seed.ts`, which seeds FY2026 only, 4 posting profiles, 2 banks and a 17-account
chart. Nothing in it links a project. **Required fixture for a real reconciliation test:** a project
with a BASELINED BOQ (≥1 leaf) and a BASELINED cost budget; a spend category; an ACTIVE PO revision
with one BOQ-coded line and one project-level/category line; a posted GRN; a bill created *from* that
PO carrying line-level `projectId`/`boqNodeId`; and an assertion that
`Σ ledger.ACTUAL(project) == Σ JournalLine(debit−credit) on COST_OF_SALES∪EXPENSE where projectId`.
No such test exists.

---

## 7. Revenue findings

**What "revenue" means today, in five different places:**

| Basis | Where | Value | VAT |
|---|---|---|---|
| Certified gross | `CommercialService.certifiedGross` | Σ `IPC.certifiedTotal` | ex-VAT |
| Certified net | `CommercialService.certifiedNet`, FP `certifiedRevenue` | gross − retention − advance recovery | ex-VAT |
| Invoiced | FP `invoicedRevenue` | Σ posted `ClientInvoice.totalAmount` | **inc-VAT** |
| Accounting-recognised | `PLReportService` INCOME | Σ credits on INCOME accounts with `projectId` | ex-VAT |
| Cash collected | FP `receivedRevenue` | Σ posted allocations | inc-VAT |

**All five bases exist, and the platform does distinguish them.** That is genuinely good. The failure
is that the Finance card puts three of them in one column with labels that suggest a progression —
*Certified → Invoiced → Received* — while silently changing tax basis between the first and second.

**MEASURED_IPC trace:** IPA → IPC (`certifiedTotal` computed from certified item amounts) → deductions
built for RETENTION and ADVANCE_RECOVERY → `reconcileCertificate` → `generateFromIpc` sets
`subtotal = ipc.certifiedTotal`, `vat = subtotal × 0.05`.

> **This is a real commercial defect, not just a labelling one.** The invoice bills the client the
> **gross** certified total. Retention and advance recovery are computed, persisted and shown in
> Commercial — and then **not applied to the invoice**. The client is invoiced for money the contract
> says is withheld. There is also no retention-receivable or advance-recovery GL treatment: no
> `Dr Retention Receivable / Cr AR` split, no `Dr Client Advance / Cr AR`. Classify **P1**, arguably P0
> if any invoice has gone to a client this way.

**MILESTONE trace:** installment → `subtotal = contractValue × percentage` → same VAT → same posting.
Guarded by `billingModel = MILESTONE`, `contract.status = ACTIVE`, and a linked programme milestone
being `VERIFIED`. That gate is sound.

**VAT rate is hardcoded `new Decimal('0.05')` in two places** in `client-invoice.service.ts`, despite a
full `TaxCode` model and a seeded `VAT5_OUT` code. A rate change is a code change.

**What Finance should call "Revenue":** the posted credit balance on `INCOME`-class accounts carrying
the project's `projectId`, over a stated period — i.e. exactly what `PLReportService` already returns.
It is ex-VAT, it is posted, it is project-attributed, and it is the only figure that reconciles to the
ledger. `certifiedNet` and `invoiced` belong on the Commercial tab as commercial positions,
cross-linked, **not restated as revenue in Finance**.

**Existing mixed-basis comparisons to remove:** Certified(ex-VAT) beside Invoiced(inc-VAT) in the FP
card; `collectedPercent = received(inc-VAT) ÷ contractValue(ex-VAT)`.

---

## 8. Forecast findings

Exhaustive grep for `forecast|forecastCost|forecastMargin|estimateToComplete|ETC|EAC|remainingCost|costToComplete|projectedCost|projectedMargin`
across `apps/api/src`, `apps/web/src`, `packages/types/src` and the message catalogues returns exactly
**one** cost implementation:

```ts
// financial-position.policy.ts
forecastCost:   input.actualCost.plus(input.remainingCommitments),
forecastMargin: input.contractValue.minus(input.actualCost).minus(input.remainingCommitments),
```

(`programme.service.ts` `forecastDate` is a milestone schedule field — unrelated.)

> **Forecast cost is not implemented.** There is no estimate-to-complete, no estimate-at-completion, no
> productivity or earned-value model, no remaining-scope valuation, and no manual forecast entry. What
> is labelled "Forecast cost" is **cost incurred plus open commitments** — a *committed position*,
> which is a legitimate and useful number under its own name and a false one under this one.

Why it must not be preserved: the metric is not merely imprecise, it is **directionally biased**. It
can only ever understate cost at completion, therefore only ever overstate margin, and the error is
largest exactly when it matters most — early in a project, before scope has been committed. "Forecast
margin" is the emphasised headline of the Finance tab today.

**Minimum truthful near-term replacement** — five figures that all exist and all reconcile:

| Show | Source | Meaning |
|---|---|---|
| **Budget** | baselined `ProjectCostBudget` | what we planned to spend |
| **Committed (open)** | ledger `COMMITTED` | ordered, not yet received |
| **Accrued** | ledger `ACCRUED` | received, not yet billed |
| **Actual** | GL `projectId`, COST_OF_SALES+EXPENSE | posted cost |
| **Uncommitted budget** | `budget − gross ordered` | headroom left to spend |

Note `uncommittedBudget` must be redefined against **gross ordered** (Σ positive COMMITTED, or
`Σ committed + Σ accrued + Σ actual`), not the current net-of-receipt `committed`, or headroom rises
when goods arrive (§5).

**Do not introduce EAC/ETC in Phase 6.** A defensible EAC needs remaining measured scope valued at a
cost rate, and the platform has no cost rates — `BoqNode` rates are *sell* rates, and the
cost-vs-sell-rate split is an explicitly deferred decision (Eng Ahmed). Naming that gap honestly is
better than filling it with arithmetic.

---

## 9. Project P&L findings

`GET /projects/:id/pl` → `PLReportService.generate({...query, projectId})`.

1. **Can P&L be filtered by projectId?** Yes — `journalLine.groupBy` with a `projectId` line filter.
2. **Is projectId present on enough lines?** **No.** Revenue: yes (invoice posting stamps it on the
   revenue credit). Cost: **no** — no bill carries a project (P0-1). Manual journals: yes, if the
   preparer fills the dimension. So the report is structurally a revenue-only statement today.
3. **How is revenue assigned?** `ClientInvoice.projectId` ← `contract.projectId`, stamped on the
   revenue credit line only. Correct.
4. **How are expenses assigned?** `billLine.projectId ?? bill.projectId`, hand-keyed. Not sourced from
   the PO. Not validated. Not surfaced in the UI.
5. **Are balance-sheet accounts excluded?** Yes — the account query is restricted to
   `INCOME|COST_OF_SALES|EXPENSE`.
6. **Are VAT accounts excluded?** Yes, correctly: output VAT is `LIABILITY` (excluded), and input VAT is
   non-recoverable and posts *into* expense by design.
7. **Is "cost of project" distinct from procurement ACTUAL?** Yes, and it should be — GL cost is the
   wider set (payroll, depreciation, manual accruals). But today the wider set is empty and the
   narrower set is unreconciled.
8. **Are non-procurement costs included?** Structurally yes, via manual journals with a `projectId`
   dimension. There is no payroll module, no equipment/plant costing, no timesheet, no internal
   charge-out. **Manual journal is the only route.**
9. **Are manual journals project-attributable?** Yes — `ManualJournalLineDto` takes
   `projectId/departmentId/costCenterId`.
10. **Sign convention?** Correct. INCOME = credit − debit; COS/EXPENSE = debit − credit;
    `grossProfit = revenue − cos`; `netIncome = grossProfit − expenses`.
11. **Is the known sign bug fixed?** In **year-end close, yes** (§14). It never existed in
    `PLReportService`.
12. **Current period / YTD / project-to-date?** The endpoint takes an arbitrary `fromDate`/`toDate`. The
    UI hard-defaults to **calendar** year-to-date. For a multi-year project this silently truncates the
    P&L, and it is not fiscal-year aware (the fiscal calendar is configurable via
    `FiscalCalendarPolicy`). There is **no project-to-date mode** and no period-based selection.
13. **Closed periods?** Yes — the report reads live lines with no period-status filter, so history is
    fully readable after close. Sound.

> **The screen titled "Project Actual P&L (GL)" is a correct project-dimensioned income statement. It
> is not a job-costing P&L**, because job costing requires all project cost — labour, plant,
> subcontract, materials, overhead absorption — to be attributable, and only manually-journalled cost
> and (once P0-1 is fixed) procured materials can reach it. Say so on the screen.

---

## 10. ProjectCostBudget ownership findings

**Versioning audit:**

| Requirement | Status |
|---|---|
| Exactly one BASELINED version | Enforced in application code only (`updateMany` supersede + `update` baseline in one tx). **No partial unique index** in the migration. Race window is narrow (only one DRAFT can exist) but the invariant is not database-enforced |
| Baseline transaction safety | ✔ single `$transaction` |
| Supersede behaviour | ✔ sets `SUPERSEDED` + `supersededAt` |
| Immutable baseline | ✔ `update()` rejects non-DRAFT |
| Revision creation | ✔ new version, `derivedFromId` → predecessor, monotonic `versionNumber` per project |
| Duplicate-version prevention | ✔ `@@unique([projectId, versionNumber])`; second DRAFT refused with a clear 409 |
| Audit history | **✗ Missing.** No `auditOutbox.record` on create / update / baseline. The BOQ baseline writes audit events; the cost budget does not |
| Permission model | ✔ `manage:project-budget` / `baseline:project-budget`, correctly separated |
| Discard / delete a draft | **✗ No endpoint.** A bad draft can only be edited, never abandoned, and it blocks creating another |
| Empty-baseline guard | ✔ refuses a zero-line baseline ("division by zero dressed up as control") |
| List `total` | **✗ hardcoded `'0.00'`** for every row |

**Where should authoring live?**

| Candidate | For | Against |
|---|---|---|
| Procurement (today) | Zero-move; lives beside the ledger it is measured against | The budget is not a procurement artefact. It will hold payroll, plant and overhead lines that procurement never sees |
| **Project Finance / Cost Control** | The budget is a control instrument; the cost controller owns it; it must cover non-procurement cost; the consumers (Cost Control, Overview, P&L variance) are all Finance; `baseline:project-budget` is a Finance-weight act | Requires a route move and a cross-module read |
| BOQ / Planning | BOQ lines are a natural coding source | BOQ is the *client's* priced scope; putting cost budget there invites the exact confusion the code comment warns about ("comparing supplier cost against a BOQ rate produces a 'remaining' that is really margin") |
| Separate Cost Control workspace | Clean ownership | Premature; not enough surface to justify a top-level workspace |

**Recommendation: move authoring to Project Finance → Cost Control; keep the API where it is.**

The decisive argument is not domain tidiness, it is future cost coverage. A `ProjectCostBudgetLine`
targets a BOQ node *or a project spend category*. Spend categories will carry labour, plant hire, site
overhead and insurance long before procurement handles any of them. A budget authored inside
Procurement would be a plan for money procurement does not spend. The lifecycle (DRAFT → BASELINED →
SUPERSEDED, four-eyes-weight baseline) is also a finance-governance lifecycle, and
`baseline:project-budget` belongs with the roles that hold `view:financial-position`.

Keep `GET .../procurement/cost` reading the same baselined budget — one aggregate, two readers, no
copy. The endpoint path can stay; only the **screen** moves. (If the path is later moved to
`/projects/:id/finance/budgets`, that is cosmetic and should not be bundled with Phase 6.)

**Terminology:** the UI must say **Working / Baselined / Superseded**. Never "Approved" — the model has
no approval, and calling a baseline an approval re-introduces exactly the fake-control problem that
JD1 removed from journals.

---

## 11. Accounting setup prerequisites

Derived from what the code actually dereferences, not from a wish list.

**Hard prerequisites for any posting:**

| # | Requirement | Enforced at | Failure |
|---|---|---|---|
| 1 | An `Account` + `AccountVersion` effective on the accounting date for every line | `AccountingPostingService` | 500 `No effective account version found` |
| 2 | An `AccountingPeriod` covering the accounting date | `PeriodValidator` | 400 `No accounting period covers …` |
| 3 | That period is `OPEN` or `REOPENED` (or `LOCKED` **and** category = `CLOSING_ADJUSTMENT`) | `PeriodValidator` | 400 |
| 4 | `DocumentNumberSequence` for `JOURNAL_ENTRY` | `claimNext` | throw |
| 5 | Control-account posting policy satisfied for the origin | `ControlAccountValidator` + DB trigger | 400 |

**Per document type:**

| Document | Additionally requires |
|---|---|
| Client invoice | Unique ACTIVE account with subtype `ACCOUNTS_RECEIVABLE`; one with `PROJECT_REVENUE`; one with `VAT_OUTPUT_PAYABLE` when VAT > 0; `CLIENT_INVOICE` sequence. Zero matches → `POSTING_ACCOUNT_NOT_CONFIGURED:<subtype>`; two → `POSTING_ACCOUNT_AMBIGUOUS` |
| Receipt | `CASH_AND_BANK` account chosen by the user; `ACCOUNTS_RECEIVABLE`; `UNAPPLIED_CLIENT_RECEIPTS` when partially allocated |
| Supplier bill | An **ACTIVE `PostingProfile`** per line whose code matches `expenseProfileCode`, **with a version effective on `billDate`**; an AP account (code still passed from the client); `SUPPLIER_BILL` sequence; and for PO-backed bills a completed 3-way match |
| Supplier payment | `ACCOUNTS_PAYABLE`, `SUPPLIER_ADVANCE`, bank account, `SUPPLIER_PAYMENT` sequence |
| Year-end close | `FiscalYear.retainedEarningsAccountId`; periods 1–11 CLOSED; period 12 LOCKED |

**Not required by code** (do not put these on a setup checklist): posting *rules*
(`PostingRuleVersion`/`PostingRuleLineTemplate` are dead schema — zero code references), tax codes (the
5% is hardcoded), cost centres, departments, `FiscalCalendarPolicy` (only the seed reads it).

**Two genuine setup blockers:**

- **`PostingProfile` cannot be created in the app.** `PostingProfileController` exposes `GET` only. A
  supplier bill is unpostable without one, and the only way to create one is the seed. Every expense
  account an organisation wants to use needs a profile row created outside the product.
- **Only FY2026 exists.** `FiscalYearController` does have `POST`, so this is operable — but nothing
  warns that the calendar runs out on 2026-12-31, and posting past it fails with "No accounting period
  covers …" rather than "open FY2027".

**What Finance can show before accounting setup exists:**

| Available without GL | Because |
|---|---|
| Cost budget (all versions) | `ProjectCostBudget` has no accounting dependency |
| Committed, Accrued | Commitment ledger is written by PO/GRN, neither of which posts to the GL |
| Uncommitted budget, committed/accrued % of budget | Pure ledger + budget arithmetic |
| Supplier exposure, cost by BOQ, cost by category | Ledger groupings |
| Certified / invoiced / collected | Commercial + AR documents |

| Unavailable without GL | Because |
|---|---|
| Actual cost | Needs posted journal lines |
| Project P&L (revenue **and** cost) | Needs posted journal lines |
| Ledger | Needs posted journal lines |
| Gross profit / margin | Derived from the above |

This split is confirmed from code, and it is the correct basis for the Overview's degraded state.

---

## 12. Period-control findings

- **Post to LOCKED?** Only `journalCategory = CLOSING_ADJUSTMENT`. Everything else 400s.
- **Post to CLOSED?** Never.
- **Post to REOPENED?** Yes, unrestricted — `PeriodValidator` only names CLOSED and LOCKED, and the web
  `open-period.ts` predicate correctly treats `OPEN|REOPENED` as postable.
- **Reverse in a closed period?** No. Reversals take an explicit `reversalDate` and go through the same
  validator; a reversal dated into a closed period is rejected. Correct behaviour (reverse in the
  current period), but **no UI tells the user this** — `JournalDetail` hardcodes
  `reversalDate: today` with no picker and no period check.
- **Historical reporting after close?** Fully readable. TB uses the `PeriodAccountBalance` snapshot for
  closed periods and live lines otherwise; P&L, balance sheet and ledger always read live lines with no
  status filter.
- **Fiscal-year boundaries?** `FiscalYear` + 12 `AccountingPeriod` rows, created together.
  `YearEndCloseService` hardcodes `periodNumber === 12`; a 13-period calendar (which
  `FiscalCalendarPolicy.useAdjustmentPeriods` contemplates) would break it.
- **Is "as of" date-based or period-based?** **Date-based everywhere.** Every report and the commitment
  ledger bound on `accountingDate`. `PeriodAccountBalance` is period-keyed but is used only as a TB
  optimisation.
- **Must the UI use periods rather than dates?** For *posting*, effectively yes, and the web already
  implements a period-aware date predicate — good. For *reporting*, dates are fine, but Finance should
  offer period presets (this period / this fiscal year / project-to-date) so a reader stops hand-typing
  a range that silently excludes prior years.

---

## 13. Journal-governance findings

| Question | Answer |
|---|---|
| Real workflow state? | Yes. `JournalStatus = DRAFT\|SUBMITTED\|APPROVED\|REJECTED\|POSTED\|REVERSED`, persisted, with `submittedBy/At`, `approvedBy/At`, `rejectedBy/At/Reason`, `postedBy/At`, `reversedBy/Reason` |
| Approval enforced by server? | **Partly.** `submit()` calls `CommandGovernanceService.gateStateTransition('ManualJournal', DRAFT→SUBMITTED)`. **When no `WorkflowTriggerBinding` exists the gate returns null and submission proceeds ungoverned** — the documented default |
| Is POSTED reachable without approval? | **Yes.** `post()` accepts `status ∈ {SUBMITTED, APPROVED}`. With `manage:journal` and no binding configured, one user can create → submit → post with no second party |
| Does the UI display unbacked actors/timestamps? | **No.** `approvedBy`/`approvedAt` are written only by a real `approve()` call. The fabricated-approval defect is **fixed** |
| Is the approval UI honest? | **No, in the other direction.** `availableActions()` returns `['post']` only from `APPROVED`, so the UI *implies* approval is mandatory. The server does not require it. This is frontend-only enforcement of a financial control — bypassable by any API client |
| Self-approval? | Blocked. `SegregationOfDutiesService.assertAllowed({action:'APPROVE_MANUAL_JOURNAL', journalPreparerUserId})` |
| Immutable after POSTED? | Lines are never mutated after posting; the only path is `reverse()`. Attachments on POSTED journals are protected by a DB trigger. **But** `post()` mutates the draft entry's status to POSTED, and nothing prevents that entry from later being reversed *as if it were the posted journal* |
| RBAC granularity | **Coarse.** One class-level `@RequirePermissions(journalsManage)` covers create, submit, approve, post and reverse |

**Verdict:** the prior "fake approval" issue is **resolved**. Two live governance defects remain, both
P1: approval is optional by default and enforced only in the browser; and one permission gates all five
verbs.

---

## 14. Year-end close findings

| Check | Result |
|---|---|
| Closes revenue | ✔ posts the exact opposite of each account's residual |
| Closes expenses | ✔ same |
| Retained-earnings transfer | ✔ `netIncome = Σ(credit − debit)`; profit ⇒ credit RE, loss ⇒ debit RE; break-even adds no RE line |
| Temporary account reset | ✔ by construction |
| **Sign convention** | ✔ **the known sign bug is fixed**, unit-tested for profit, loss and break-even, with a balance assertion |
| Idempotency | ✔ pre-check on `(YEAR_END_CLOSE, fiscalYearId, EVT-YE-001)`; the posting engine's unique index is a second guard |
| Rerun protection | ✔ 409 if a closing journal exists; 409 if FY already CLOSED |
| FY lock/close | ✔ FY → CLOSED with `closedAt/closedBy`; period 12 → CLOSED |

**But it cannot execute.** Period 12 must be `LOCKED` to start, and the closing journal posts with
`journalCategory: 'YEAR_END_CLOSE'`. `PeriodValidator` admits **only** `CLOSING_ADJUSTMENT` into a
LOCKED period. The close will 400 with *"Period … is LOCKED — only CLOSING_ADJUSTMENT journals are
accepted. Received category: YEAR_END_CLOSE"*. `year-end-close.service.spec.ts` mocks
`postingPort.post` outright, so the validator has never run in a test. **Not covered by any integration
test.** Classify **P1** (P0 if a year-end is imminent).

Secondary defects:

- **Not atomic.** Only `postingPort.post` is inside `$transaction`. Snapshot generation, period close
  and FY close run outside it. A failure after posting leaves a posted closing journal with an OPEN
  fiscal year, and the idempotency guard then blocks any retry — a stuck state requiring DBA
  intervention.
- Hardcoded `periodNumber === 12`.
- `const baseCurrency = 'USD'` hardcoded rather than read from `FiscalCalendarPolicy`.
- No reopen path for a closed fiscal year.

---

## 15. Bank-reconciliation findings

> **Presentation-only. Not partial — absent.**

```ts
// reconciliation.service.ts — the "bank" branch
glBalance:        bankGlBalance.toFixed(2),
subledgerBalance: bankGlBalance.toFixed(2),   // compared to itself
variance:         '0.00',
reconciled:       true,                        // unconditionally
```

- **Matching rules:** none.
- **Unreconciled entries:** no concept, no model, no query.
- **Lifecycle:** none. No statement, no statement line, no reconciliation session, no
  `BankAccount.lastReconciledAt`.
- **Posting impact:** none. No bank charge / interest / FX adjustment postings.
- **Permissions:** `manage:accounting` on the whole controller.
- **Schema:** `BankAccount` (with `isReconcilable`) and `BankAccountSignatory` exist.
  `SubledgerControlReconciliation` exists in the schema and has **zero code references** — pure dead
  scaffolding.

**Consequence for the close gate:** `getPeriodCloseReadiness` includes bank checks that always pass, so
a period can be closed with an unreconciled bank. The AR/AP checks *are* real, but they compare a
**whole-life** GL balance against **current** outstanding subledger amounts with no date bound — so
they are not period-scoped reconciliations either, and will drift as soon as any post-period-end
document is entered.

**For Phase 6:** bank reconciliation is out of scope for a *project* Finance workspace, but the
capability matrix's "Cash & Banking — PARTIAL, basic" must be corrected to "not implemented", or someone
will build a project cash view on top of it.

---

## 16. RBAC findings

| Capability | Backend permission | Scope guard | Frontend gating | Defect |
|---|---|---|---|---|
| View project Financial Position | `view:financial-position` | ✔ `ProjectAccessGuard` + `@ProjectScoped` | ✔ card not rendered without it, query disabled | — |
| **View project P&L** | `view:accounting` | **✗ none** | none | **Any `view:accounting` holder can read any project's P&L without membership.** Inconsistent with FP on the same tab |
| View project cost / commitments | `view:commitment-ledger` (endpoint) + `view:financial-position` (money masking) | ✔ | ✔ | Two permissions gate one screen; a `commitment-ledger` holder without `financial-position` sees the structure with every amount `null` — deliberate, but undocumented |
| Create/edit cost budget | `manage:project-budget` | ✔ `assertMember` in service | **none — no UI exists** | — |
| Baseline cost budget | `baseline:project-budget` | ✔ | none | No audit event written |
| Create manual journal | `manage:journal` | org-wide | UI-only lifecycle | Same permission as approve and post |
| Approve journal | `manage:journal` | — | UI-only | SoD blocks self-approval; nothing else |
| **Post journal** | `manage:journal` | — | UI restricts to APPROVED | **Server accepts SUBMITTED — control is browser-side only** |
| Close/lock/reopen period | `manage:period` | — | `period-actions.tsx` | — |
| Year-end close | `manage:period` | — | — | Same permission as locking a month |
| View accounting setup (CoA, FY) | `manage:accounting` / `manage:fiscal-year` | — | ✔ | **Read requires a `manage:` permission** — no read-only CoA/period view for a project accountant |
| Bank reconciliation | `manage:accounting` | — | — | Nothing to run |
| Post supplier bill / invoice | `manage:payable` / `manage:receivable` | — | ✔ | Class-level: create, approve, post and reverse share one permission on each controller |

**"Learn permission by 403" defects:** the Project P&L is the clearest one — `ProjectPlContent` renders
unconditionally and surfaces a generic `loadFailed` alert on a 403. The FP card, by contrast, checks the
permission client-side and hides itself. Two different behaviours on one screen. The
`useProjectActualPl` query is not permission-gated at all.

---

## 17. Frontend truthfulness findings

**Strong patterns already in the codebase — make these the Phase 6 standard:**

- `percentOf()` returns `null`, not `0`, when the budget is absent, and `CostPositionBand` says *"Not
  baselined"* once at the top instead of showing `0.0%` five times.
- `Cell` renders **"Restricted"** for a masked money field, never `$0.00`.
- `CommercialMetric` has an explicit four-state contract: `OK | ZERO | FAILED | RESTRICTED`, with
  `sourceCount` so "zero" can be distinguished from "nothing to sum".
- `commercial.service.ts` uses `Promise.allSettled` so one failed query group renders `FAILED` rather
  than silently zeroing a metric.
- `open-period.ts` refuses non-postable dates in the picker rather than letting the server reject after
  the form is filled.
- `posting-accounts.ts` distinguishes `NOT_CONFIGURED` from `AMBIGUOUS` because the fix differs.

**Untruthful surfaces to fix:**

1. **"Forecast margin"** — the emphasised headline of the Finance tab, with a `+`/`−` badge and danger
   colouring, computed from a non-forecast. Highest-visibility falsehood in the product.
2. **"Forecast cost"** — same, marked `emphasis`.
3. **"Actual cost = $0.00"** — a valid-looking zero where the truth is "no cost has ever been coded to
   this project". Violates the codebase's own null-not-zero doctrine.
4. **"Certified" above "Invoiced"** — adjacent, differently-taxed.
5. **Physical-vs-financial banner** — `cost consumed` pinned at 100% whenever no PO is open, driving a
   `COST_AHEAD` warning tone on healthy projects.
6. **Collection banner** — inc-VAT cash over ex-VAT contract value.
7. **Journals list shows two POSTED rows per manual journal** (P0-2 is user-visible, not just internal).
8. **Cost budget version list shows `$0.00` for every version** (hardcoded).
9. **Project P&L default range = calendar YTD**, presented as "the project's P&L".
10. **`ProjectPlContent` empty state** says *"Post a supplier bill or client invoice tagged to this
    project"* — advice the UI makes impossible to follow, since no bill screen has a project field.

---

## 18. Previous assumptions disproved by code

| # | Prior assumption | Code reality |
|---|---|---|
| 1 | "Project ACTUAL flows to the GL and reconciles with the commitment ledger" | **Disproved.** No UI path sets `projectId` on a supplier bill. GL project cost is 0; ledger ACTUAL is correct. Two independent attributions with no cross-check |
| 2 | "Forecast cost exists" | **Disproved.** `actual + committed + accrued`. No ETC, no EAC, no remaining-scope model anywhere in the repo |
| 3 | "Project P&L is real" | **Half-confirmed.** The read model is real and correct; the *cost* half has no data. Revenue works. It is not a job-costing P&L |
| 4 | "Journal approval is fake / presentation-only" (accounting round-2 §JD1: *"always writes approvedBy/approvedAt"*) | **Disproved — already fixed.** The seam is wired and `approvedBy` is no longer fabricated. JD1's premise is stale. The *remaining* defect is different: approval is optional and enforced only in the browser |
| 5 | "The year-end net-P&L sign bug is still present" | **Disproved — fixed**, with unit tests for profit/loss/break-even. A *different* year-end defect is live: the period gate blocks the close from posting at all |
| 6 | "Bank reconciliation is partial / basic" (capability matrix line 79) | **Disproved.** It is a stub that compares a balance to itself and always reports reconciled |
| 7 | "Project Financial Position has no UI" (capability matrix line 82) | **Disproved.** `ProjectFinancialPositionCard` has shipped on `/projects/[id]/pl` |
| 8 | "No budget baseline" (capability matrix line 110) | **Disproved.** `ProjectCostBudget` DRAFT→BASELINED→SUPERSEDED shipped 2026-09-05 |
| 9 | "Posting rules are configurable" (`PostingRuleVersion`, `PostingRuleLineTemplate`) | **Disproved.** Zero code references. Every posting hardcodes its lines. Pure schema scaffolding |
| 10 | "A DB trigger backstops double-entry" (schema comment: *"see raw-sql-constraints.sql"*) | **Partly disproved.** The named file does not exist; an equivalent trigger does, in migration `20260806042100`, but it fires only on **UPDATE to POSTED** — engine-created journals (INSERT as POSTED) bypass it |
| 11 | "Accounting-date rule honoured; `now()` only for audit stamps" (round-2 §0) | **Disproved for procurement.** `PurchaseOrderService.cancel` writes `accountingDate: new Date()`. This corrupts `asOf` cost reporting |
| 12 | "Retention and advance recovery reduce what the client is billed" | **Disproved.** Deductions are computed and stored on the IPC, then ignored by `generateFromIpc`, which invoices `certifiedTotal` gross |
| 13 | "`SubledgerControlReconciliation` supports the close gate" | **Disproved.** Model exists; zero references. The close gate recomputes AR/AP inline, unbounded by date |
| 14 | "PO cost-target is 'both ids or neither'" (schema comment on `PurchaseOrderLine`) | **Disproved — superseded.** `cost-target.policy.ts` implements the three-state rule. Schema comment is stale |
| 15 | "One BASELINED cost budget is guaranteed" | **Weakened.** Enforced in application code only; no partial unique index |

---

## 19. Backend issues by priority

### P0 — financial correctness / posting integrity

**P0-1 · Supplier bills cannot be coded to a project through the product**
*Affected:* `apps/web/.../bill-form.tsx`, `po-bill-form.tsx`, `apps/web/.../types.ts:520`;
`CreateSupplierBillLineDto` (no `spendCategoryId`).
*Risk:* Project Actual P&L cost = $0; FP `actualCost` = $0; `forecastMargin` ≈ full contract value;
`costConsumedPercent` meaningless. Every project-level financial statement is false.
*Minimal fix:* for a PO-backed bill, **derive line cost-targets from the matched PO line inside
`post()` rather than trusting the DTO** — `findBillLineCostTargets` already returns exactly this and is
already called for the ledger write; use the same map for the GL lines. For non-PO bills, add
`projectId`/`boqNodeId`/`spendCategoryId` to the create DTO and to both forms, validated by the existing
`validateCostTarget`. Add `spendCategoryId` to `JournalLine` (+ index) so state-2 cost survives into the
GL.
*Migration:* one additive column + index; no backfill possible (historical bills have no project — say
so rather than guessing).
*Tests:* the reconciliation assertion in §24 Scenarios B and D.
*Frontend depends on it:* **yes, totally.** Nothing in Finance is true until this lands.

**P0-2 · Manual journals post twice**
*Affected:* `manual-journal.service.ts:262-266`; `mj.spec.ts` MJ-01 asserts the bug.
*Risk:* TB, P&L, Project P&L, BS, ledger and FP actual cost all double-count every manual journal.
Debits and credits both double so no balance check catches it. Year-end close (period-scoped) sees only
one copy and leaves a permanent P&L residual after close.
*Minimal fix:* the draft is a *staging record*. On post, either (a) delete the draft's lines and mark it
`POSTED` with `replacedByJournalEntryId` pointing at the engine entry, or (b) — cleaner — stop creating a
second entry: have `post()` validate and promote the draft in place. (a) is the smaller change and
preserves the audit chain the schema already models (`replacedByJournalEntryId` exists and is unused).
*Migration:* a data fix is required — every org with posted manual journals has duplicates. Identify via
`sourceDocumentType = MANUAL_JOURNAL AND accountingPeriodId IS NULL AND status = 'POSTED'`.
*Tests:* rewrite MJ-01; add "posting a manual journal moves the trial balance by the journal amount,
once".
*Frontend depends on it:* yes — the journals list currently shows both rows.

**P0-3 · Remove `forecastCost` / `forecastMargin`**
*Affected:* `financial-position.policy.ts`, `project-financial-position.service.ts`,
`ProjectFinancialPositionResponse`, `ProjectFinancialPositionCard`, `progress.service.ts`
`getPhysicalFinancialSignal`.
*Risk:* directional, one-sided bias that always flatters margin; drives a live early-warning banner.
*Minimal fix:* rename the field to `committedPosition` (= actual + open commitments) or drop it; replace
`forecastMargin` with nothing until a real forecast exists. Re-base `costConsumedPercent` on the
**baselined budget** (`actual ÷ budgetTotal`), returning `null` when no budget is baselined — which is
the honest answer and matches `percentOf`'s existing doctrine.
*Migration:* response-shape change; coordinate with the two banner consumers.
*Frontend depends on it:* yes.

### P1 — materially misleading financial reporting

**P1-1 · Bill reversal does not reverse the commitment ledger.** `SupplierBillService.reverse` writes no
ledger rows; `BILL_REVERSAL` is an unused enum member. GL falls to zero, procurement ACTUAL does not.
*Fix:* mirror the post-time block with negated amounts and idempotency key
`bill-reversal-{billId}-{lineId}`, plus re-raise `ACCRUED` if the goods are still held.

**P1-2 · ACCRUED is raised net of VAT and released gross.** Permanent `−VAT` residual per line;
"Remaining committed" goes negative on fully-billed projects. *Fix:* release the accrual at the matched
PO-line net amount (the amount that was accrued), and post the VAT delta to ACTUAL only.

**P1-3 · `uncommittedBudget = budget − committed` releases headroom on goods receipt.** *Fix:* define
committed-to-date as `Σ(COMMITTED) + Σ(ACCRUED) + Σ(ACTUAL)` (gross ordered) for the headroom
calculation, and keep the signed net as a separate, differently-named "open commitment".

**P1-4 · IPC retention and advance recovery are not applied to the client invoice.** Clients are invoiced
gross of contractual deductions; no retention-receivable or advance-recovery GL treatment. *Fix:*
`subtotal = certifiedTotal − Σ deductions`, with retention posted `Dr Retention Receivable` and advance
recovery `Dr Client Advance`. Needs a commercial ruling from Eng Ahmed before coding.

**P1-5 · Year-end close cannot post.** *Fix:* accept `YEAR_END_CLOSE` in `PeriodValidator`'s LOCKED
branch (one line), and wrap posting + snapshot + period close + FY close in one transaction.

**P1-6 · Manual journal `post()` accepts SUBMITTED.** Approval is a browser-side control. *Fix:* either
require APPROVED, or make the requirement explicit and configurable via
`PostingPolicy.requireFourEyesOnJournals` — and make the UI show which regime is active rather than
implying the strict one.

**P1-7 · GL and ledger cost attribution are independently keyed.** Even after P0-1, an AP clerk can code
a bill to a different project than its PO. *Fix:* for PO-backed bills, treat the PO line's cost-target as
authoritative and reject (or ignore) a conflicting DTO value — D7 "capture once, inherit downstream"
already says this; the bill path just doesn't enforce it.

### P2 — workflow / RBAC / data-quality gaps

- **P2-1** Project P&L endpoint has no `ProjectAccessGuard` — org-wide `view:accounting` reads any project.
- **P2-2** `ProjectCostBudgetService` writes no audit events on create/update/baseline.
- **P2-3** `ProjectCostBudgetService.list` returns hardcoded `total: '0.00'`.
- **P2-4** No "discard draft budget" endpoint; a bad draft blocks creating another.
- **P2-5** No partial unique index enforcing one BASELINED budget per project.
- **P2-6** `PurchaseOrderService.cancel` uses `accountingDate: new Date()` — breaks `asOf` reporting and
  violates the project's own accounting-date rule.
- **P2-7** A POSTED GRN cannot be cancelled or reversed; `GRN_REVERSAL` is an unused enum member. No path
  exists for returned goods.
- **P2-8** No `PostingProfile` create/update API — a setup step that can only be done by seed.
- **P2-9** VAT rate hardcoded at 5% in `client-invoice.service.ts` despite a `TaxCode` model.
- **P2-10** Journal RBAC is one permission for five verbs; year-end close shares `manage:period` with
  locking a month.
- **P2-11** AR/AP control reconciliation is date-unbounded, so it is not period-scoped.
- **P2-12** No `spendCategoryId` on `JournalLine` (blocks GL-side category reporting; also part of
  P0-1's fix).

### P3 — UX / read-model improvements

- **P3-1** No project ledger endpoint. `GET /accounting/ledger/:accountId` is account-first; Finance needs
  `GET /projects/:id/ledger`.
- **P3-2** `ledger.getAccountLedger` computes the opening balance **without** applying the dimension
  filter, so the running balance is wrong whenever `projectId` is passed.
- **P3-3** `sumActualCost` and `PLReportService` classify accounts by their **latest** version, not the
  version effective at `accountingDate` — inconsistent with the snapshot doctrine everywhere else.
- **P3-4** `sumActualCost` loads every account in the org into memory to filter by class.
- **P3-5** Project P&L has no fiscal-year or project-to-date mode.
- **P3-6** FP `contractValue` ignores approved variation orders, though
  `CommercialService.deriveContractValueFigures` computes the adjusted value.
- **P3-7** No `asOf` parameter on the FP endpoint (`asOf` is stamped as `new Date()`), while the
  procurement cost endpoint supports it. The two project cost views cannot be read at the same date.

---

## 20. Proposed Finance IA

The proposed `Overview / Cost Control / Project P&L / Ledger` is **almost right**. Tested tab by tab:

| Tab | User job | Data behind it | Belongs | Does NOT belong | Verdict |
|---|---|---|---|---|---|
| **Overview** | "Is this project financially healthy, and is anything blocking the numbers?" | Budget + ledger stages (available pre-GL) + posted revenue/cost (post-GL) + a setup-readiness check | Position band; accounting-setup state; links out | Certified/invoiced/collected restated as revenue; any forecast | **KEEP** |
| **Cost Control** | "Where is the money going against plan, and where is the overrun?" | Budget versions; ledger by BOQ / category / supplier; budget vs committed/accrued/actual | Budget authoring + baselining; the cost tree; supplier exposure | Purchase orders, GRNs, bills (org documents — link out to Procurement) | **KEEP + become the budget's home** |
| **Project P&L** | "What has this project earned and cost, in the accounts?" | `PLReportService` with `projectId` | Period selector; revenue/COS/expense sections; gross profit | Committed or accrued cost of any kind | **KEEP, RENAME → "Profit & Loss"** with a standing "posted GL only" note |
| **Ledger** | "Show me the individual postings behind that number." | **Nothing today.** Needs a new `GET /projects/:id/ledger` | Journal lines with `projectId`, source-document links, dimension columns | Journal authoring | **ADD backend first, or defer the tab** |

**One structural change I recommend against the proposal:** do not create a Finance tab that duplicates
the Procurement tab's cost tree. Today `/projects/:id/procurement` already renders `CostPositionBand` + a
BOQ cost tree + supplier and category rollups from the same ledger. If Cost Control renders the same
thing, there are two answers to "what has this project committed".

**Resolution:** *Procurement keeps the operational view* (requirements, pipeline, attention queue, recent
activity, and the position band as context). *Cost Control owns the budget and the budget-versus-cost
analysis* (versions, baseline, variance by BOQ and category, over-budget exceptions). The cost tree moves
to Cost Control with a variance column; Procurement links to it rather than repeating it. One read model,
two purposes, no duplicated number.

**Also:** the tab currently labelled "Finance" points at `/projects/[id]/pl`. Phase 6 should introduce
`/projects/[id]/finance` with the four sub-routes and redirect `/pl` → `/finance/profit-loss`.

---

## 21. UI KEEP / MOVE / RENAME / REMOVE / HIDE / ADD matrix

| Element | Where now | Action | Why |
|---|---|---|---|
| Finance tab → `/pl` | shell | **MOVE** → `/projects/:id/finance`, default `overview` | A tab named Finance that lands on a P&L is a subset presented as the whole |
| `ProjectFinancialPositionCard` | `/pl` | **REMOVE** as a unit; **rebuild** as the Overview band | Its two headline metrics are P0-3; its revenue block is mixed-basis |
| "Forecast margin" | FP card headline | **REMOVE** | Not a forecast; systematically flatters margin |
| "Forecast cost" | FP card | **REMOVE** (or **RENAME** → "Cost + open commitments") | Same |
| "Actual cost" | FP card | **KEEP + RENAME** → "Actual cost (posted)"; show **Unavailable**, not `$0.00`, when no project-attributed posting exists | Zero and no-basis are different facts |
| "Remaining committed" | FP card | **MOVE** to Cost Control, **RENAME** → "Open commitments"; split ACCRUED into its own "Received, not billed" | One label currently covers two very different stages |
| Certified / Invoiced / Received / Outstanding | FP card | **MOVE** to Commercial (already there) and **replace with a cross-link** | Finance restating Commercial numbers on a different tax basis is the mixed-basis defect |
| Physical-vs-financial banner | `/pl` | **HIDE** until `costConsumedPercent` is re-based on budget | 100% whenever no PO is open |
| Collection-vs-progress banner | `/pl` | **MOVE** to Commercial → Billing & collection, **and** fix the inc-VAT ÷ ex-VAT basis | It is a collection metric, not an accounting one |
| `ProjectPlContent` | `/pl` | **KEEP**, **MOVE** → `/finance/profit-loss`, **RENAME** → "Profit & Loss" | The report is sound; only its home and title change |
| Calendar-YTD default range | `ProjectPlContent` | **REPLACE** with period presets (This period / This fiscal year / Project to date) | Calendar YTD silently truncates multi-year projects |
| `CostPositionBand` | Procurement | **KEEP** in Procurement (context) **and reuse** in Cost Control (primary) | Same component, correct null discipline |
| BOQ cost tree, category & supplier rollups | Procurement | **MOVE** to Cost Control, with a budget-variance column; leave a link in Procurement | Cost-vs-plan is a control question |
| Cost budget authoring | **does not exist** | **ADD** to Cost Control: version list, line editor, Baseline action, version compare | The API is complete and unreachable |
| Budget version status labels | — | **ADD** as *Working / Baselined / Superseded* | Never "Approved" |
| Project ledger | **does not exist** | **ADD** after the backend endpoint exists | Every number needs a drill-down |
| Accounting-setup readiness | **does not exist** | **ADD** to Overview | Today a missing period or profile surfaces as a generic load failure |
| Reconciliation strip (procurement ACTUAL vs GL project cost) | **does not exist** | **ADD** to Overview | The one control that makes the rest trustworthy; a variance must be visible, not silent |
| Journals list | `/finance/accounting/journals` | **KEEP**, fix duplicates via P0-2 | — |
| Cost budget list `total` | budget API | **FIX** (P2-3) before any UI reads it | — |

---

## 22. Required backend changes before UI redesign

Ordered. Nothing below is optional if Finance is to be truthful.

1. **P0-1** — GL project attribution on supplier bills: inherit the PO line's cost-target in `post()`;
   extend the non-PO create DTO and both bill forms; add `JournalLine.spendCategoryId`.
2. **P0-2** — Stop double-posting manual journals; write the data-repair migration.
3. **P0-3** — Delete `forecastCost`/`forecastMargin` from policy, service, response type and card;
   re-base `costConsumedPercent` on the baselined budget with a `null` when unbaselined.
4. **P1-1** — Commitment-ledger reversal on bill reversal.
5. **P1-2** — Release ACCRUED at the accrued (net) amount.
6. **P1-3** — Redefine `uncommittedBudget` against gross ordered.
7. **P1-7** — Make the PO line's cost-target authoritative for PO-backed bills.
8. **P2-12 / P3-1** — `GET /projects/:id/ledger`: journal lines with `projectId`, paged, with
   `fromDate`/`toDate` or period, source-document type/id, account, dimensions.
9. **P2-1** — `ProjectAccessGuard` + `@ProjectScoped` on the project P&L endpoint.
10. **P2-3, P2-2, P2-4, P2-5** — Budget list `total`; audit events; discard-draft; partial unique index.
11. **A reconciliation read model** — `GET /projects/:id/finance/reconciliation` returning
    `{ ledgerActual, glProjectCost, variance, unattributedBillCount }`. Without it, "the numbers agree"
    is an assertion; with it, it is a displayed fact.

**Deferrable past the UI (not blocking):** P1-5 year-end, P1-6 journal approval enforcement, P1-4
retention-on-invoice (needs a commercial decision), P2-6 through P2-11, P3-2 through P3-7.

---

## 23. Optional backend improvements

Each earns its place; none is a refactor for its own sake.

- **`asOf` on the FP / Finance overview endpoint**, matching the procurement cost endpoint, so both
  project cost views can be read at the same date (P3-7).
- **Account classification resolved at `accountingDate`** in `PLReportService` and `sumActualCost`,
  consistent with the account-version snapshot doctrine (P3-3), plus a single set-based account query
  instead of loading the whole chart (P3-4).
- **Dimension-aware opening balance in `getAccountLedger`** (P3-2) — the running balance is wrong today
  when filtered by project.
- **Variation-adjusted contract value** in Finance, reusing `deriveContractValueFigures` (P3-6).
- **Delete dead scaffolding**: `PostingRuleVersion`, `PostingRuleLineTemplate`,
  `SubledgerControlReconciliation`. All three have zero references and all three make the system look
  more configurable than it is. (ADR-024 already set the precedent by dropping
  `AccountingMigrationBatch`.)
- **Fix the stale schema comment** on `PurchaseOrderLine`, and either write `raw-sql-constraints.sql` or
  correct the `JournalLine` comment that points at it.
- **Correct `docs/01-capability-matrix.md`** lines 79, 82 and 110 (§18 items 6–8).

---

## 24. Deterministic QA plan

Common seed for every scenario: org ACCO; `accounting-phase1.seed.ts`; project `P1` with a BASELINED BOQ
containing leaf `B-1`; spend category `TRANSPORT`; supplier `S1`; client `C1`; contract `K1`
(`CLIENT_CONTRACT`, `MEASURED_IPC`, value 1 000 000 USD, ex-VAT).

**SCENARIO A — no accounting setup**
*Setup:* fresh org, **no** CoA / fiscal year / posting profiles. Baselined cost budget (B-1: 100 000;
TRANSPORT: 20 000). PO `PO-1` approved with a B-1 line for 40 000. GRN posts 40 000.
*Expected backend:* `budgetTotal = 120 000`; `COMMITTED = 0`, `ACCRUED = 40 000`; `sumActualCost` returns
0 with **no** accounts found; bill posting 400s with `POSTING_ACCOUNT_NOT_CONFIGURED` / "No accounting
period covers".
*Expected UI:* Overview shows Budget, Committed, Accrued as real figures; Actual, Revenue, Gross profit
render **"Unavailable — accounting is not configured"** with the specific missing items listed; Project
P&L and Ledger tabs are disabled with the same reason; **no `$0.00` anywhere**.

**SCENARIO B — fully configured, procurement chain end to end**
*Setup:* seed applied; FY2026 period 9 OPEN. `PO-1` (B-1, qty 100 × 400 = 40 000). GRN accepts 100. Bill
from `PO-1`, net 40 000, VAT 2 000, gross 42 000, `expenseProfileCode = MATERIAL_PURCHASE`, line
cost-target inherited from the PO line. Approve, post.
*Expected backend:* GL — `Dr 50303 42 000 (projectId=P1, boqNodeId=B-1)`, `Cr 20000 42 000`. Ledger —
`COMMITTED: +40 000, −40 000 = 0`; `ACCRUED: +40 000, −40 000 = 0` *(after P1-2; before the fix it is
−2 000)*; `ACTUAL = 42 000`. **Assertion: `Σ ledger.ACTUAL(P1) == Σ JournalLine(debit − credit) on
COST_OF_SALES∪EXPENSE where projectId = P1` = 42 000.**
*Expected UI:* Overview Actual 42 000; Cost Control B-1 row: budget 100 000, committed 0, accrued 0,
actual 42 000, uncommitted budget 60 000 *(after P1-3)*; Project P&L Cost of Sales 42 000; Ledger shows
one line; reconciliation strip variance **0.00**.

**SCENARIO C — client invoice + receipt**
*Setup:* IPA → IPC certified 200 000, retention 10 000 (5%), advance recovery 20 000 (10%). Generate
invoice, approve, post. Receipt 100 000, fully allocated, posted.
*Expected backend (current code):* invoice subtotal 200 000, VAT 10 000, total 210 000. GL —
`Dr 11000 210 000`, `Cr 42600 200 000 (projectId=P1, contractId=K1)`, `Cr 20200 10 000`. Receipt —
`Dr 10100 100 000 / Cr 11000 100 000`. Project P&L revenue **200 000**. AR outstanding 110 000.
*Expected backend (after P1-4):* subtotal 170 000, VAT 8 500, total 178 500, plus
`Dr Retention Receivable 10 000` and `Dr Client Advance 20 000`.
*Expected UI:* Project P&L revenue 200 000 (ex-VAT). Overview shows **accounting revenue only**;
certified/invoiced/collected are a cross-link to Commercial, not restated here.
*Assertion:* AR control GL balance == Σ `ClientInvoice.outstandingAmount`.

**SCENARIO D — project-level non-BOQ cost**
*Setup:* `PO-2` line with `projectId = P1`, `boqNodeId = null`, `spendCategoryId = TRANSPORT`, 15 000.
GRN, then bill, then post.
*Expected backend:* `validateCostTarget` accepts (state 2). Ledger rows carry `spendCategoryId`. GL line
carries `projectId = P1`, `boqNodeId = null`, **and `spendCategoryId = TRANSPORT`** (after P0-1's schema
addition).
*Expected UI:* Cost Control "Project-level (non-BOQ)" parent with a **Transport** child: budget 20 000,
actual 15 000, uncommitted 5 000. Project P&L includes the 15 000 in cost.
*Negative case:* a PO line with `projectId` set and neither `boqNodeId` nor `spendCategoryId` must be
rejected with `PROJECT_WITHOUT_COST_TARGET`.

**SCENARIO E — manual project journal (non-procurement cost)**
*Setup:* manual journal, `Dr 60100 5 000 (projectId = P1)` / `Cr 10100 5 000`. Submit, approve, post.
*Expected backend:* **exactly one** POSTED `JournalEntry` (the P0-2 regression test). Project P&L expenses
+5 000. FP/Overview actual cost +5 000. **Ledger ACTUAL unchanged at 42 000** — procurement must not
absorb non-procurement cost.
*Expected UI:* the reconciliation strip shows GL project cost 47 000 vs procurement actual 42 000 with
the 5 000 difference **explained as non-procurement cost**, not flagged as a variance. This is the case
that proves the reconciliation read model must distinguish "unattributed" from "non-procurement".

**SCENARIO F — closed period**
*Setup:* close FY2026 periods 1–8; period 9 LOCKED.
*Expected backend:* a bill dated in period 8 → 400 CLOSED; dated in period 9 with category
`ACCOUNTS_PAYABLE` → 400 LOCKED; a `CLOSING_ADJUSTMENT` manual journal in period 9 → accepted. Reporting
over periods 1–8 still returns full data (live lines, no status filter); TB for a closed period reads the
snapshot.
*Expected UI:* the posting date picker greys out closed and locked dates *before* submission
(`makeClosedPeriodPredicate` already does this); Finance reports for closed periods render normally with
a "period closed" chip.

**SCENARIO G — reversals**
*G1 bill reversal:* reverse the Scenario-B bill on 2026-09-20. Expected: GL project cost → 0; **ledger
ACTUAL → 0** (requires P1-1; currently stays 42 000). Reconciliation variance 0.
*G2 manual journal reversal:* reverse Scenario E. Expected: Project P&L expenses → 0. Currently the
original flips to `REVERSED` (dropping out of every `status = 'POSTED'` filter) *and* a reversal posts,
which would net to −5 000 were it not for the P0-2 duplicate accidentally cancelling it. Both defects must
be fixed together, and this scenario is the test that catches either one alone.
*G3 PO cancellation:* cancel `PO-2` before receipt. Expected: `COMMITTED` net 0, **at the PO's effective
date, not `now()`** (P2-6), so an `asOf` report before the cancellation still shows the commitment.

**Cross-cutting assertions to add to the suite**

| ID | Assertion |
|---|---|
| REC-01 | `Σ ledger.ACTUAL(project)` == `Σ GL(debit−credit)` on COST_OF_SALES∪EXPENSE with that `projectId`, **restricted to bills** (join via `sourceDocumentType = SUPPLIER_BILL`) |
| REC-02 | `Σ ledger.COMMITTED + ACCRUED + ACTUAL` == `Σ ordered value` on active PO revisions for the project |
| MJ-05 | Posting a manual journal changes the trial balance by exactly the journal amount |
| PL-06 | Project P&L over the full project life == FP actual cost, when only procurement cost exists |
| YE-05 | `closeYear` succeeds against the **real** posting engine with period 12 LOCKED |

---

## 25. Final recommended implementation sequence

**Stage 0 — stop the bleeding (backend only, no UI)**
1. P0-2 manual-journal duplicate + data repair, with MJ-05.
2. P0-3 remove the fake forecast from the API contract and re-base `costConsumedPercent`; hide the
   physical-vs-financial banner until it lands.
3. P1-5 one-line `PeriodValidator` fix + wrap year-end in a transaction (cheap, and year-end is 3½ months
   away).

**Stage 1 — make project cost real** *(the gate for everything after it)*
4. P0-1: inherit the PO line's cost-target into the GL on PO-backed bills; add
   `JournalLine.spendCategoryId`; extend the non-PO bill DTO and both forms.
5. P1-7 make the PO cost-target authoritative; P1-1 ledger reversal on bill reversal; P1-2 net accrual
   release.
6. Build the reconciliation read model and REC-01/REC-02. **Do not start UI work until REC-01 passes on
   seeded data.**

**Stage 2 — read models the workspace needs**
7. `GET /projects/:id/ledger`; P2-1 project scoping on the P&L endpoint; `asOf` on the Finance overview.
8. P1-3 redefine uncommitted budget; P2-3/P2-2/P2-4/P2-5 budget hygiene.

**Stage 3 — the workspace** *(only now)*
9. `/projects/:id/finance` shell + Overview, with the setup-readiness and reconciliation states.
10. Cost Control: move the cost tree, add budget authoring and baselining, add the variance column.
11. Profit & Loss: move, rename, period presets.
12. Ledger tab.

**Stage 4 — deferred, tracked, not silently dropped**
13. P1-4 retention/advance on the client invoice — **needs Eng Ahmed's ruling first.**
14. P1-6 journal approval enforcement + finer journal RBAC.
15. Bank reconciliation as a real aggregate (round-2 JD7a).
16. P2-7 GRN reversal; P2-8 posting-profile administration; P2-9 tax-code-driven VAT.
17. Cost rates on BOQ nodes → the prerequisite for any genuine EAC/ETC. Until then, Finance says "no
    forecast", and that is the honest answer.

**The one-sentence sequencing rule:** *no Finance screen ships before REC-01 passes*, because every
screen in this workspace is a claim that the numbers reconcile.
