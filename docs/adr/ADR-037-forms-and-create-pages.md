---
Status: proposed
Date: 2026-09-27
Owner approval: pending (Abdulsalam). The domain decisions in "Design conflicts resolved" were approved in conversation on 2026-09-27.
Builds on: ADR-034, ADR-035, ADR-036
---

# Forms and create pages

## Context

Batch 4 of the Claude Design system covers forms:

- field states and input types
- the combobox and radio cards
- a line-items editor
- the record-create header, form action bar and error summary
- create pages for client, supplier, project, supplier bill and client invoice

The frontend audit had found the underlying problems:

- Create and edit forms were built in three ways: about 7 with react-hook-form and zod, and about 35 with hand-written `useState`.
- They opened three different ways: a full page, a centred dialog named a "drawer", and a side sheet.
- Line items came in four shapes.

A field-by-field check against the API found that several designed fields contradict recorded domain rules. They are listed under "Design conflicts resolved" below.

## Decision

### Components (`@erp/ui`)

- **`FormField` warning state.** A warning is announced politely, marks the control's border and never sets `aria-invalid`. **Errors block saving; warnings don't.** When both are set, the error wins.
- **`MoneyInput`**:
  - It shows a `$` currency mark by default (USD only, ADR-024) and right-aligns its digits.
  - Negatives are opt-in with `allowNegative`, for credits. `sanitizeMoney` keeps a leading minus only when that is on.
- **`QuantityInput`**: three decimals, no currency mark, and the unit inside the field.
- **`Switch` / `SwitchField`**: for an on/off setting. A checkbox is still the control for agreeing to something or for picking items.
- **`RadioGroup` card variant**: each option can take an icon, and the group can be marked required.
- **`RecordCreateHeader` + `RECORD_NAME_INPUT`**: the record's icon tile beside a large name field.
- **`FormActionBar`**: a sticky bar with back, one Save, Discard, and a save-state dot ("Not saved yet", "Unsaved changes", "All changes saved"). A new document also shows its `LifecycleStepper` at the first step. Save makes a Draft; submitting, approving and posting are separate commands afterwards.
- **`FormGroup`**: a titled hairline section with a one-line purpose, and two-column fields from `sm`.
- **`LineItemsEditor`**:
  - There is **one set of controls per line**. CSS lays each line out as a table row from `md` and as a labelled card below it.
  - It is deliberately not a table plus a card copy, which would have put every input in the DOM twice, with duplicate ids and double form registration.
  - Columns are configuration, so a PO bill and a direct expense use the same component.
  - It supports per-cell errors, a row note (for example "billing more than received"), add/remove, and read-only lines for lines that come from a source document.
- **`FormErrorSummary`**: a counted title ("Fix 3 fields before saving") with each field name as a link that focuses the field.

### Container rule

Use a **full page** for anything with line items and for master-data creation. Use a **centred dialog** for confirmations and actions of one to four fields. Use a **side sheet** for quick edits of a related record and for previews.

> **Amended 2026-09-29 — superseded by [ADR-039](ADR-039-dialogs-inline-editing-no-side-sheets.md).**
> Side sheets are retired. Quick edits of a record and previews now open in a `FormDialog`
> (sized `md` / `lg` / `xl` / `2xl`, full screen on phones); values already in a table are edited
> inline; the full-page rule for line items and master-data creation is unchanged. The sentence
> above is kept as the record of what was decided on 2026-09-27.

### Design conflicts resolved (approved 2026-09-27)

| Designed | Decision | Rule |
|---|---|---|
| Client short code typed by hand | Keep the server-generated `CLI-000001` code | Sprint-6 spec |
| District on client and supplier | Not added | ADR-025: district belongs to the project |
| Client payment terms, receivable account, "email invoices" toggle | Not added. Each would be a new backend feature | Not in the API; Sprint-6 removed payment terms from clients |
| Contract value on New project | Not added | CONST-CONTRACT-003: the contract owns the value |
| Free-form New invoice with editable lines, discount and client reference | Built as a **source picker** instead: choose an IPC, milestone or separate charge, and the source's line is read-only | Invoices are source-bound and their amounts are immutable (ADR-029 CONST-BOQ-030/033) |
| Reject bill dialog | **Decided 2026-09-27 (owner):** both *Return for correction* and *Reject (final)*, each with a required reason — see the amendment below | No reject endpoint existed; REJECTED was never set |
| Supplier type, spend category, contacts, payable account | Not added | Not in the API |
| Discount on invoices and bills | Not shown | No discount in the model |
| "Waiting for your approval, step 1 of 2" on a submitted bill | Not shown; the Approvals tab carries the chain | Bill approval gates *submit* |

### Backend fix

`POST /bills` with a supplier invoice number that is already recorded for that supplier used to hit the unique constraint on (organisation, supplier, normalised number) unhandled. It now returns **409** with a message naming the bill that already holds the number. The bill form also warns before saving.

## Implementation notes (2026-09-27)

### New supplier bill (`/finance/accounting/bills/new`)

- **One page, two kinds.** The two previous forms (PO and non-PO) become one page with a card choice. `?po=1` still opens the PO kind.
- **Due date** fills in from the supplier's `paymentTermsDays` until the user edits it.
- **Line amount is calculated, but can be overridden** (Eng Ahmed, 2026-09-27):
  - By default Amount = qty × unit price, worked out in integer minor units with the existing `extendedAmountMinor` helper, and shown as the Amount field's placeholder.
  - The clerk can type a different net, for example when the supplier's invoice rounds or takes a discount on the total. The row then warns "Amount is $95.00 more than 200 × $9.50 ($1,900.00)", and "Use qty × price" clears the override.
  - Whatever the line shows is sent as `netAmount`, alongside `quantity` and `unitPrice`. The server takes each line's net as given, so it is what posts.
  - The difference is recorded: the saved line keeps quantity, unit price and net, and the bill's Lines tab notes any line whose net differs from qty × price. Editing a draft brings the override back into the form.
- **Expense profile is a column on PO lines too.** The API requires `expenseProfileCode` on every line.
- **Direct-expense bills require a project**, with a "No project — company overhead" option. A real project needs a cost line on each bill line, per the cost-target rule (D7).
- **PO bills send no header project.** Cost coding comes from the PO lines.
- **Over-billing note** reads "…will *likely* raise an exception", because tolerance and earlier bills also count.
- **Detail-page action is labelled "Resolve exception"**, not "Approve exception", because the same dialog can also dispute the exception or require a PO revision.

### New client and New project

- **Client:** Tax ID and address are now shown and sent, on both create and update.
- **Project:** Client is now a searchable picker. Its "New client" row is gated by `create:client`. "Expected completion" is renamed "Planned completion".

### New invoice (`/finance/accounting/invoices/new`)

- **IPC** creates a DRAFT via `POST /invoices/from-ipc`.
- **Separate charge** creates a DRAFT via `POST /invoices/from-separate-charge`. This is the first screen that calls it.
- **Milestone** opens the existing `PrepareInvoiceDialog`, which calls `issue-package`. That endpoint enforces the ready-to-bill gate and approves and posts in one step. `/invoices/from-installment` skips the gate, so it is not used.
- **Where the source lists come from:** existing commercial read models — applications, current cycle and separate charges.
- **VAT is added by the server on create**, so the page shows "Amount before VAT".

### New supplier (`/procurement/suppliers/new`)

- A full page replaces the create dialog.
- Fields: code, name, Tax ID, and payment terms as a select mapped to days. USD is fixed.

## Amendment: return for correction and reject (2026-09-27)

**The problem.** A submitted bill with a mistake had no way out:

- There was no reject, return, cancel or edit command.
- The duplicate-number rule stopped a corrected bill from being entered, because the wrong bill still held the number.

**Decision (owner):**

- **Return for correction:** `POST /bills/:id/return {reason}` moves the bill from SUBMITTED back to DRAFT.
  - The PO match is discarded, and runs again when the bill is resubmitted.
  - The latest return is kept on the bill in `returnedAt`, `returnedBy` and `returnReason`.
- **Reject (final):** `POST /bills/:id/reject {reason}` moves the bill from SUBMITTED to REJECTED.
  - The bill stays on record, is never posted, and frees its supplier invoice number.
- **Edit a draft:** `PATCH /bills/:id` accepts the create payload and runs the same rules, through a shared `prepareBill`.
  - It works on a new draft or a returned one. The lines are replaced.
- **A reason is required** for both return and reject.
  - The audit interceptor now stores a command's `{ reason }` in `AuditLog.reason`, and the bill's Activity shows it.
  - So every return and rejection is on record, not only the latest.
- **The invoice number is freed by rejection.** The unique index on (organization, supplier, normalised number) becomes a **partial** index, `WHERE document_status NOT IN ('REJECTED','CANCELLED')`, in migration `20260927120000_bill_return_reject`.
- **Same permission as approve** (`payables:manage`).

**Review hardening (PR #221):**

- **An edit respects the approval gate.** A draft whose approval is PENDING cannot be edited (409), because approvers must see what they approve. Editing a draft whose approval was granted but not yet used voids that approval, so resubmitting opens a fresh one; an approval covers the content it evaluated.
- **Every bill status transition is guarded on its expected status:** submit, approve, return, reject and edit each add `where: { id, documentStatus }`. A command that loses a race gets a 409 instead of overwriting. For example, a bill approved or posted a moment ago can never be marked rejected, which would free its invoice number while a journal exists.

**Not decided / not built:**

- Clerk self-cancel.

**Segregation of duties for return and reject (Eng Ahmed, 2026-09-27):**

- The person who entered a bill (`createdBy`) **may return** it for correction, because correcting their own bill is harmless.
- They **may not reject** it. A rejection is final, so someone else must make it: `POST /bills/:id/reject` answers 403 to the author, and the bill page does not offer them Reject.
- The rule is always on in `SupplierBillService.reject`, not a policy-toggled segregation-of-duties code.

When an approval policy gates *submit* and an approver rejects the approval instance, the bill stays DRAFT, which is unchanged. It can now be edited and resubmitted.

## Consequences

- New create pages are built from these components. Remaining `useState` forms and dialog-hosted create forms migrate as they are touched.
- The form migrations are recorded, with their tests, in the commits that implement them.
