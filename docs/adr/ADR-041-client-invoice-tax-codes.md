# ADR-041 — Client invoice tax from configured tax codes

**Status:** Accepted (owner: Abdulsalam, with ACCO management direction, 2026-10-01).
Supersedes the fixed rate in `client-invoice-tax.ts` (`CLIENT_INVOICE_SALES_TAX_RATE = '0.05'`).
Builds on ADR-006 (ACC-TAX-001, `TaxCode`, `TaxPolicy`) and corrects ADR-040.

## Context

- Every client invoice is raised at a fixed 5% sales tax written into the code. Nobody can change it,
  charge another rate, or raise an invoice without tax. `TaxCode` and
  `TaxPolicy.defaultOutputTaxCodeId` exist (ADR-006) but AR invoicing never reads them.
- ACCO has VAT / other tax obligations (management, 2026-10-01). Input VAT is NON_RECOVERABLE
  (ACC-TAX-001): supplier bills post gross to cost, with no "VAT to reclaim" asset.
- ADR-040's accounting setup adds `14100 Input VAT recoverable` when VAT is charged. That account
  contradicts ACC-TAX-001 and is never posted to.
- ADR-040's setup refuses to run (`PARTIAL_SETUP`) when any tax code exists. Tax now has to be
  configurable before ACCO's chart of accounts is signed off, so that rule would lock ACCO out.

## Decision

1. **Tax codes say which side they apply to.** `TaxCode.direction`: `OUTPUT` (sales — client
   invoices) or `INPUT` (purchases). Existing rows are backfilled: non-recoverable or
   input-account codes → `INPUT`, the rest → `OUTPUT`.
2. **Rates are data, never free text.** Finance maintains tax codes on Accounting → Tax
   (`manage:accounting`): create (code, name, rate %, direction, effective from), deactivate,
   reactivate, and choose the organisation's default sales tax code. A code's rate never changes
   once created; a new rate is a new code (e.g. `VAT6_OUT`) made the default. "No tax" is an
   OUTPUT code at 0% (e.g. `EXEMPT`). Every change is audited.
   - Only an ACTIVE OUTPUT code **in force today** can be made the default — a future-dated default
     would stop every invoice until its start date. A new rate is made the default on or after the
     day it takes effect.
   - The first sales code an organisation creates becomes its default when it has none.
3. **Every client invoice records the tax it was raised at.** `ClientInvoice.taxCodeId`
   (nullable — invoices raised before this ADR have none) and `ClientInvoice.taxRate` (percent,
   snapshot, required). `vatAmount = round2(subtotal × taxRate / 100)`. A posted or issued invoice
   never changes when a code or the default changes.
4. **Which code an invoice uses.** Each generation path (IPC, installment, separate charge,
   variation standalone, and the commercial billing action that wraps them) accepts an optional
   `taxCodeId`:
   - omitted → the organisation's default sales tax code;
   - the default → anyone who may raise the invoice;
   - any other code → only `manage:accounting` (Finance). Others get
     `403 TAX_CODE_OVERRIDE_FORBIDDEN`;
   - the code must be ACTIVE, `OUTPUT`, and in force on the invoice date
     (`422 TAX_CODE_NOT_APPLICABLE`);
   - no default configured and none given → `409 TAX_NOT_CONFIGURED` ("Set the default sales tax
     on Accounting → Tax"). There is no silent fallback rate.
   One billing action applies one code to every invoice it raises.
5. **Posting is unchanged.** The tax amount still credits the account in the `VAT_OUTPUT_PAYABLE`
   role (resolved at post time); a 0% invoice posts no tax line. Credit notes keep deriving their
   rate from the invoice they credit.
6. **Existing organisations keep today's behaviour as data.** The migration:
   - gives every organisation with no ACTIVE OUTPUT code a "Sales tax 5%" code (`VAT5_OUT`, or
     `SALES5` if that code name is taken) in force from 2000-01-01;
   - sets the default where it is missing or unusable (inactive, or a purchase code): the 5% sales
     code if there is one, else the oldest active sales code; a usable existing default is kept;
   - extends the chosen default back to 2000-01-01 (the seed's codes start 2026-01-01): invoicing
     ignored dates until now, so a back-dated invoice keeps working;
   - gives existing invoices `taxRate = 5` when their tax is within a cent of 5%, 0 when untaxed,
     else the rate their figures imply (capped to the column).
   Finance can then switch the default or add codes without a release.
7. **Accounting setup (ADR-040) is corrected.**
   - `14100 Input VAT recoverable` is removed from the template (ACC-TAX-001).
   - Existing tax codes no longer count as a partial setup. When the organisation already has a
     default sales tax code, setup leaves tax as configured (it creates no tax codes and the VAT
     step says tax is already set up). Otherwise "VAT charged" creates the VAT codes as before, and
     "no VAT" creates a 0% `EXEMPT` "No sales tax" default — without one no invoice could be raised.
     A code of the same name that already exists is reused (and reactivated). Setup links the new
     Output VAT account to OUTPUT codes that have none.

## Who can do what

| Action | Permission |
|---|---|
| See tax codes (to pick one) | `view:accounting` or `manage:receivable` |
| Raise an invoice at the default code | the invoice's existing permission (`manage:receivable`) |
| Raise an invoice at another code, incl. no tax | `manage:accounting` |
| Create / deactivate tax codes, set the default | `manage:accounting` |

No new permission: in ACCO's role scheme invoice preparers hold `manage:receivable`, and Finance
holds `manage:accounting`.

## Consequences

- The fixed 5% is gone; the rate an invoice is raised at is visible on it and in its PDF label.
- An organisation that deactivates its default without choosing another cannot raise invoices until
  it does — deliberate: an invoice at an unknown rate is worse than a clear error.
- Supplier-side tax codes (`INPUT`) are maintained on the same screen; bills still post gross
  (ACC-TAX-001) and do not yet select a code. Wiring input codes into bills is out of scope.
