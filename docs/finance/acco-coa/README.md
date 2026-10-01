# ACCO chart of accounts — QuickBooks → Rukna mapping (for Finance sign-off)

**Status:** proposal, awaiting Finance / Eng. Ahmed sign-off. Nothing is installed until it is approved.
**Source:** ASAS GROUP L.T.D QuickBooks Balance Sheet, Profit & Loss and Trial Balance (all transactions,
as of 25 Aug 2026).
**File:** [`mapping.csv`](mapping.csv) — opens in Excel. One row per QuickBooks account, plus the new
accounts Rukna needs.

This is the proposed initial ACCO chart, built from the Rukna accounting architecture and ACCO's
existing QuickBooks structure. Finance decides the business-specific categories.

## How to review

Fill in the last column, **Finance decision**, on any row you want changed: "Approve", or say what
it should be instead. Rows marked **Finance to classify** need an answer, and so do rows with a
question in **Note / question for Finance**.

| Proposed action | Meaning |
|---|---|
| Keep | The account carries over with the same code and name. |
| Rename | Same code; the name is tidied (typos, capitals) or made clearer. |
| Merge into X | The account is folded into account X. Its history moves to X during migration. |
| Retire | Not carried over (e.g. "Uncategorized", "Ask My Accountant"). Any balance is moved to the right account first. |
| New | An account Rukna needs that QuickBooks does not have. |
| Finance to classify | We could not tell which category it belongs to — please say. |

## Rules applied (agreed 2026-10-01)

- **ACCO's QuickBooks codes are kept** wherever an account survives (10250, 31000, 52130…). New
  accounts get clean codes that do not collide with ACCO's.
- **A GL account is an accounting category, not a single item.** The ~80 material accounts become
  about 13 material categories, and the ~50 trade accounts about 12 trade categories. The specific
  material comes from the material catalogue on the bill line; the project is a tag on every
  transaction (so there is never a "Cement – Project A" account); department / cost centre likewise.
- **Labour and subcontractors stay separate.** QuickBooks files every trade under "Subcontractor";
  Finance says which trades are ACCO's own labour and which are subcontracted.
- **Owned trucks, tractors and vehicles are fixed assets**, grouped by type; their running costs are
  expenses.
- **Family and personal accounts are kept exactly as they are**, as expenses. Any reclassification
  is Finance's decision.
- **Input VAT is non-recoverable** (already decided): supplier bills are recorded gross; there is no
  "VAT to reclaim" account. Sales tax on client invoices is set on Accounting → Tax.
- Reporting currency is USD; no Period 13 (year-end adjustments post in December).

## New accounts Rukna needs

| Code | Account | Why |
|---|---|---|
| 13000 | Advances to suppliers | Supplier advance payments post here automatically. |
| 21000 | Advances received from clients | Client advance (mobilisation) payments. |
| 21100 | Unapplied client receipts | Client money received before it is matched to an invoice. |
| 21300 | Output VAT payable | Sales tax on client invoices. (ACCO already uses 22000 for salaries payable.) |
| 39000 | Current year earnings | Reports compute it; nothing posts to it. |
| 15500 / 15600 / 15700 / 15800 | Fixed-asset group headings | Buildings, vehicles, plant, tools. |
| 15900 | Accumulated depreciation | ACCO books depreciation expense (62400) but has only one accumulated-depreciation account. |
| 50399 / 50499 | Other materials / Other labour | Rukna headings take no postings; these take what QuickBooks posted to the headings themselves. |
| 10950, 13100, 14000 | Petty cash, staff advances, prepaid expenses | Optional — remove if not used. |

## Questions that block the final chart

1. **Banks:** the final list of active bank, wallet and cash accounts — name, provider, currency,
   purpose and account number. QuickBooks lists 15; ACCO's questionnaire says 9.
2. **Investments:** which of the nine are still held.
3. **Muraabaha (13500):** money owed to ACCO, or financing ACCO owes?
4. **Labour vs subcontract:** for each trade category.
5. **Materials:** are the ~13 categories enough, or do some materials need their own account? And the
   16 materials marked "Finance to classify".
6. **Purchase discount (42650) and customer discount (81000):** keep as income / expense, or treat as
   reductions of cost / income?
7. **Project-like expenses in G&A:** "Projects payroll payments" (64850) and "Finished projects
   expense" (64800) — project costs or overheads?
8. **Related-party balances:** confirm MHH payable (25000) and Zako payable (23000) as current
   liabilities; and what "Debt payments" (50270) records.

## After sign-off

The approved sheet becomes ACCO's chart: it is frozen, installed through Accounting → Get started,
and the QuickBooks opening balances are moved across using this same mapping. After transactions
start posting, changes go through the accounting change-control process.
