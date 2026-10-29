# ADR-048: Hand-typed invoices for non-contract sales

**Status:** Accepted. Owner decision (Abdulsalam), 2026-10-28, from the grill on the approved list
and invoice-form mockups. Backend built 2026-10-28; the web form follows.

## Context

ADR-037 made every client invoice come from a source (a certified IPC, a billing stage, a
retention release or a BOQ separate charge), and there is deliberately no blank-invoice
endpoint. That keeps contract billing tied to what was certified or scheduled, so an amount can
never drift from the contract.

The approved mockups (ADR-047) include a quick-add row and a New invoice form with free lines
(description, qty, rate, tax). A construction company also sells outside its contracts: equipment
hire, surplus materials, consultancy. Today those sales cannot be invoiced at all.

## Decision

1. **Hand-typed invoices are allowed only for sales outside a construction contract.** Such an
   invoice has no project, no contract and no source tag (`client_invoices.is_manual = true`).
   Contract billing stays source-only, so ADR-037 still holds for every contract.
2. **Lines:** 1–50 lines, each with a description (up to 300 characters), a quantity (above 0, up
   to 3 decimals), a rate (above 0, up to 2 decimals) and an **income account**. The amount is
   quantity × rate rounded half-up to cents and is stored as `client_invoice_lines`. The subtotal
   is the sum of the lines.
3. **Income account per line, explicit:** an active, posting-allowed, non-control account of
   class INCOME (for example 42100 Equipment hire income). The server never guesses one.
4. **Tax:** the same tax-code rule as every invoice (ADR-041), with one tax code per invoice.
5. **Lifecycle:** unchanged. The invoice is a DRAFT until approved, then posted, then reversed or
   credited. A DRAFT can be rewritten in full (`PUT /invoices/:id/manual`); once approved it is
   frozen.
6. **Posting:** Dr AR for the total; Cr each income account for the sum of its lines; Cr output
   tax. Posting is refused (`MANUAL_LINES_MISMATCH`) if the lines no longer add up to the subtotal.
   Reversal mirrors the posted journal, so it needs no special case.
7. **Clients created inline:** anyone holding `manage:receivable` may add a client without leaving
   the invoice. The duplicate-name warning shows first.
8. **Errors:** `MANUAL_INVOICE_INVALID` lists every problem in `details.problems`.

## Consequences

- Non-contract sales are invoiced in Rukna instead of outside it.
- Contract revenue and other income stay apart in the ledger, because each line names its income
  account.
- Credit notes against a hand-typed invoice use the existing credit-note posting, which credits
  the revenue role. Splitting a credit note per line is deferred until it is needed.
