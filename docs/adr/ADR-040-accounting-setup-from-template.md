# ADR-040 — Accounting setup from a template

**Status:** Accepted (owner: Abdulsalam, 2026-09-30). Amended by ADR-041 (2026-10-01): no input-VAT asset, and tax configured before setup is kept. Chart content pending sign-off by Eng Ahmed Shirie / ACCO's accountant — the template is data and can be revised before an organisation installs it.

## Context

ACCO's production tenant has no chart of accounts, no fiscal year, no posting profiles and no accounting policy rows. The only thing that ever created them is `apps/api/prisma/seeds/accounting-phase1.seed.ts`, a script run by hand that never ran against production. The application offers no way out:

- `POST /accounts/import` (the Import button) cannot create the AR/AP control accounts, and cannot set `SYSTEM_ONLY` / `SYSTEM_OR_APPROVED_ADJUSTMENT` posting policies, so an imported chart can never post an invoice, bill or receipt.
- Posting profiles are read-only (`GET /posting-profiles`); a supplier bill cannot be created without one ("No expense posting profile is configured").
- `POST /fiscal-years` 404s while no `FiscalCalendarPolicy` row exists, and no endpoint writes policy rows.
- The chart-of-accounts empty state claims the chart "is seeded when the organisation is provisioned". It is not.

## Decision

1. **One-step setup.** `POST /accounting/setup` installs, in a single transaction, everything an organisation needs to start posting: the six policy rows, a chart of accounts from a template, tax codes (only if the organisation charges VAT), one posting profile per posting cost/expense/revenue account, the first fiscal year with twelve open monthly periods, one bank account per bank the user names (each with its own GL account), and the document number sequences. It is allowed only while the organisation's chart is empty (`409 ACCOUNTING_ALREADY_SET_UP` otherwise); an organisation that already has accounts continues with the individual setup screens. Permission: `manage:accounting`. Audited.
2. **The template is data**, versioned in the API (`accounting-setup/templates/construction.ts`), previewable through `GET /accounting/setup/template` so the person installing it — and the owner signing it off — sees every account before anything is written.
3. **What the user decides at install time** (not baked into the template): whether VAT is charged and at what rate; which banks the company uses (name, bank, optional account number) — a petty-cash account is always added; the first fiscal year.
4. **Posting profiles become manageable**: create, re-point to another account (new version, effective-dated — history is kept), deactivate. `manage:accounting`.
5. The seed script stays for development; the empty-state text is corrected.

### Invariants the template must respect

- Exactly one ACTIVE account each of `ACCOUNTS_RECEIVABLE`, `ACCOUNTS_PAYABLE`, `PROJECT_REVENUE`, `VAT_OUTPUT_PAYABLE`, `UNAPPLIED_CLIENT_RECEIPTS`, `SUPPLIER_ADVANCE` — `PostingAccountResolver` counts every active account with the subtype, headings included, so **no heading uses one of these subtypes**.
- At least one `CASH_AND_BANK` account; every `BankAccount` points at one.
- AR and AP are control accounts (`isPostingAllowed: false`, `isControlAccount: true`, `SYSTEM_ONLY`, with their subledger type). Unapplied receipts and supplier advances are `SYSTEM_ONLY`. Bank and VAT accounts are `SYSTEM_OR_APPROVED_ADJUSTMENT`.
- Headings are `isPostingAllowed: false`; parents are created before children.
- No retention or guarantee accounts — ACCO does not use them.
- `VAT_OUTPUT_PAYABLE` exists even when no VAT is charged (the resolver and readiness require it); it simply carries no balance.

## The construction template (codes · name · class / subtype)

Headings are marked **(H)** and do not accept postings.

**Assets**
- 10000 Current assets (H) · ASSET / OTHER_CURRENT_ASSET
  - 10100–10119 one account per bank named at setup (up to 20), in order · ASSET / CASH_AND_BANK
  - 10900 Petty cash · ASSET / CASH_AND_BANK
  - 11000 Accounts receivable (control) · ASSET / ACCOUNTS_RECEIVABLE
  - 12000 Site materials inventory · ASSET / INVENTORY
  - 13000 Advances to suppliers · ASSET / SUPPLIER_ADVANCE
  - 13100 Staff advances · ASSET / OTHER_CURRENT_ASSET
  - 13200 Refundable deposits · ASSET / OTHER_CURRENT_ASSET
  - 14000 Prepaid expenses · ASSET / PREPAYMENTS
- 15000 Non-current assets (H) · ASSET / OTHER_NON_CURRENT_ASSET
  - 15100 Land and buildings · ASSET / FIXED_ASSETS
  - 15200 Plant and heavy equipment · ASSET / FIXED_ASSETS
  - 15300 Vehicles · ASSET / FIXED_ASSETS
  - 15400 Office furniture and equipment · ASSET / FIXED_ASSETS
  - 15500 Computers and IT equipment · ASSET / FIXED_ASSETS
  - 15900 Accumulated depreciation · ASSET / ACCUMULATED_DEPRECIATION (credit balance)

**Liabilities**
- 20000 Accounts payable (control) · LIABILITY / ACCOUNTS_PAYABLE
- 21000 Advances received from clients · LIABILITY / CLIENT_ADVANCE_LIABILITY
- 21100 Unapplied client receipts · LIABILITY / UNAPPLIED_CLIENT_RECEIPTS
- 22000 Output VAT payable · LIABILITY / VAT_OUTPUT_PAYABLE
- 23000 Other current liabilities (H) · LIABILITY / OTHER_CURRENT_LIABILITY
  - 23100 Accrued expenses · LIABILITY / OTHER_CURRENT_LIABILITY
  - 23200 Salaries and wages payable · LIABILITY / OTHER_CURRENT_LIABILITY
  - 23300 Staff deductions payable · LIABILITY / OTHER_CURRENT_LIABILITY
- 24000 Loans payable · LIABILITY / OTHER_NON_CURRENT_LIABILITY

**Equity**
- 30000 Share capital · EQUITY / SHARE_CAPITAL
- 31000 Retained earnings · EQUITY / RETAINED_EARNINGS
- 32000 Current year earnings · EQUITY / CURRENT_YEAR_EARNINGS — `SYSTEM_ONLY`, accepts no postings (the balance sheet computes current-year earnings from the P&L and year-end close rolls it into 31000, so a posting here would double-count)
- 33000 Shareholder current account · EQUITY / OTHER_EQUITY

**Income**
- 40000 Contract revenue · INCOME / PROJECT_REVENUE
- 42000 Other income (H) · INCOME / OTHER_INCOME
  - 42100 Equipment hire income · INCOME / OTHER_INCOME
  - 42200 Sale of scrap and surplus materials · INCOME / OTHER_INCOME
  - 42900 Miscellaneous income · INCOME / OTHER_INCOME

**Direct project costs (cost of sales)**
- 51000 Materials (H) · COST_OF_SALES / MATERIAL_COST
  - 51100 Cement and concrete · 51200 Steel and reinforcement · 51300 Blocks, sand and aggregates · 51400 Timber and formwork · 51500 Finishing materials · 51600 Electrical materials · 51700 Plumbing and sanitary materials · 51900 Other materials — all COST_OF_SALES / MATERIAL_COST
- 52000 Subcontractors (H) · COST_OF_SALES / SUBCONTRACT_COST
  - 52100 Civil and structural subcontract · 52200 Mechanical and electrical subcontract · 52300 Finishing subcontract — COST_OF_SALES / SUBCONTRACT_COST
- 53000 Direct labour (H) · COST_OF_SALES / DIRECT_LABOUR
  - 53100 Site labour (daily and casual) · 53200 Site staff salaries — COST_OF_SALES / DIRECT_LABOUR
- 54000 Plant and equipment (H) · COST_OF_SALES / OTHER_DIRECT_COST
  - 54100 Equipment hire · 54200 Fuel and lubricants · 54300 Equipment repairs and maintenance — COST_OF_SALES / OTHER_DIRECT_COST
- 55000 Site overheads (H) · COST_OF_SALES / OTHER_DIRECT_COST
  - 55100 Transport and delivery · 55200 Site water and power · 55300 Site security · 55400 Permits and inspection fees · 55500 Site camp and accommodation · 55900 Other site costs — COST_OF_SALES / OTHER_DIRECT_COST

**Operating expenses**
- 60000 Administrative expenses (H) · EXPENSE / ADMINISTRATIVE_EXPENSE
  - 61000 Office salaries · 61100 Office rent · 61200 Office utilities and internet · 61300 Telephone and communication · 61400 Office supplies and stationery · 61500 Vehicle running costs · 61600 Travel · 61700 Professional and legal fees · 61800 Insurance · 61900 Tendering and marketing · 62000 Office repairs and maintenance · 62900 Other administrative expenses — EXPENSE / ADMINISTRATIVE_EXPENSE
- 65000 Depreciation · EXPENSE / DEPRECIATION_EXPENSE
- 66000 Finance costs (H) · EXPENSE / FINANCE_COST
  - 66100 Bank charges · 66200 Interest expense — EXPENSE / FINANCE_COST
- 69000 Other expenses · EXPENSE / OTHER_EXPENSE

**Posting profiles.** One per posting account in INCOME (`PROJECT_REVENUE` → 40000 keeps the code the seed and revenue flows already use), COST_OF_SALES and EXPENSE, named after the account; codes derived from the account (e.g. `COST_51100`). Supplier bill lines pick from the cost and expense ones.

## Findings recorded during implementation

- **Superseded by ADR-041:** the template no longer adds `14100 Input VAT recoverable` (ACCO's input VAT is non-recoverable, ACC-TAX-001); existing tax codes no longer block setup (`PARTIAL_SETUP`), and when a default sales tax code exists setup keeps it and creates none. Invoices now take their tax from tax codes.
- **Client invoices ignore tax codes** *(historical — fixed by ADR-041)*. Every client invoice applies a fixed 5% sales tax (`CLIENT_INVOICE_SALES_TAX_RATE`). The VAT answer at setup creates tax codes (`VAT{rate}_OUT` / `VAT{rate}_IN`) and the TaxPolicy defaults, but does **not** change what an invoice charges; the setup dialog says so. Making invoices use the organisation's tax code is a separate decision (owner: Eng Ahmed — does ACCO charge VAT, and at what rate?).
- **Fiscal years created through `POST /fiscal-years` start as DRAFT**, and nothing moves a year out of DRAFT while year-end close requires OPEN. Setup creates its first year OPEN. The DRAFT path is left as is and flagged.
- `FiscalYearService` stored the wrong end date for a January-start year (30 November); both paths now share `buildFiscalYearPlan` (UTC).
- Posting-profile versions use an exclusive `effectiveTo`: re-pointing sets the old version's `effectiveTo` to the new `effectiveFrom`, so the old account's last day in force is the day before.

## Consequences

- A new organisation — and ACCO today — goes from empty to posting in one step, from the Get started page.
- The Import button remains for adding accounts to an existing chart; it still cannot create control accounts, which is now fine because setup creates them.
- Changing the template later affects only organisations that install it afterwards; installed charts are ordinary data, edited through the chart-of-accounts screens.
