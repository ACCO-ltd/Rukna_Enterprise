# ADR-050 — No VAT on the platform

**Status:** Accepted, built 2026-10-31. Decided by Abdulsalam (owner of the repository).

**Supersedes:** ADR-006 ACC-TAX-001 and the `TaxCode` / `TaxPolicy` parts of ADR-006, ADR-041 in
full, and the tax step of ADR-040 one-step setup.

## Context

ACCO sells services and is not registered for VAT. It charges clients no VAT and cannot reclaim
the VAT suppliers charge it. Even so, the platform carried a full VAT model: tax codes and a
default sales tax policy (ADR-041), a VAT amount and rate on every client invoice and credit note,
VAT and gross amounts on supplier bills and their lines, an Output VAT account in the setup
template, a VAT report and a VAT step on the month-end checklist. The live data held one 0% "No
sales tax" code, and every invoice and bill had a VAT amount of zero.

That model gave a non-VAT business a VAT question to answer on every screen it appeared:
a "Sales tax" field on every invoice, a tax step in setup, and an Output VAT account that would
never move.

## Decision

VAT is removed from the platform, in the schema, the API and the web app.

- **Schema** (migration `20261031120000_remove_vat`): the `tax_codes` and `tax_policy` tables and
  the `TaxType`, `RecoveryMethod`, `TaxDirection` and `TaxCodeStatus` enums are dropped, along with
  `client_invoices.vat_amount`, `tax_code_id` and `tax_rate`; `credit_notes.vat_amount`;
  `supplier_bills.vat_amount`; `supplier_bill_lines.vat_amount`, `vat_code_id` and `gross_amount`;
  `journal_lines.tax_code_id` and `purchase_order_lines.tax_code_id`. The `VAT_OUTPUT_PAYABLE` and
  `VAT_INPUT_RECOVERABLE` account subtypes are removed.
- **The migration refuses to run where VAT was ever charged.** If any document carries VAT, or a
  VAT account has ledger entries, it stops: dropping those columns would lose a figure the ledger
  still holds. A VAT account that never took an entry becomes an ordinary account
  (`OTHER_CURRENT_LIABILITY` or `OTHER_CURRENT_ASSET`, open to manual entries).
- **Amounts:** a client invoice's total is its subtotal, less retention and advance recovery, plus
  any retention released. A credit note's total is its net amount. A supplier bill line posts its
  `netAmount`, and the bill total is the sum of its lines.
- **Posting:** invoices post Dr AR / Cr Revenue (EVT-AR-001). Credit notes post Dr Revenue / Cr AR
  (EVT-AR-007). Bills post Dr Expense / Cr AP (EVT-AP-001). No posting resolves a VAT account.
- **API:** `/accounting/tax-codes` and `/finance/vat-report` are gone. `taxCodeId`, `vatAmount`
  and `vatAccountCode` are no longer accepted on any request, and the setup install request has no
  `vat` block.
- **Setup template:** the construction chart has no `22000 Output VAT payable` account; it now
  lists 78 accounts without banks. The five resolver roles are AR, AP, project revenue, unapplied
  client receipts and supplier advance.
- **Month-end checklist:** the `vat` step is removed.
- **Kept:** the organisation's, clients' and suppliers' tax identification numbers (TIN). These
  identify the business to the tax authority for income tax and are printed on invoices; they
  are not VAT.
- **Photo reader:** a supplier receipt may still print a tax line. The reader uses it only to
  check that the lines add up to the total, and returns no tax figure.

## Consequences

- Invoices, credit notes and bills show Subtotal → (deductions) → Total, with no tax row.
- An organisation that needs VAT in future needs a new decision and a new design, not a setting.
  The removed code is in git history before this change.
- ACCO's existing `22000 Output VAT payable` account had no entries. The migration turned it into
  an ordinary liability account, and it was then made inactive.
