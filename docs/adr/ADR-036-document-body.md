---
Status: proposed
Date: 2026-09-27
Owner approval: pending (Abdulsalam)
Builds on: ADR-034 (foundations), ADR-035 (shell, list page, document action bar)
---

# Document body: facts, tabs, totals, summary rail; the client invoice list

## Context

Batch 3 of the Claude Design system covers the body of a document page and the client invoice
list. ADR-035 already built the document's action bar, identity and notice. This batch adds
everything below them:

- `DocumentIdentity` facts
- `DocumentTabs`: Lines, Journal items, Approvals, Activity
- `TotalsBlock`
- a money-blind state for the totals
- `SummaryRail`
- the invoice list with its row kebab (Open, Open PDF, Copy link)

A read of the API before building found that some of what the design shows has no data behind
it yet:

- **Approvals.** A bill or invoice stores no `approvalInstanceId`, and no endpoint finds a
  document's approval chain or history. Only `approvedBy` and `approvedAt` exist.
- **Activity.** `GET /audit-logs` has no per-record filter, is capped at 50 rows and is
  admin-only.
- **Payments against a bill.** There is no list or count of allocations per bill, only
  `outstandingAmount`. The frontend does no money arithmetic, so "amount paid" cannot be
  derived as `total − outstanding`.
- **Journal lookup.** There is no journal-by-source endpoint. The bill row already carries
  `postedJournalEntryId`, and `GET /journals/:id` works for any journal, but only for users with
  `manage:journal`.
- **Invoices.** There is no create endpoint, and no overdue flag.

## Decision

### Components (`@erp/ui`)

- **`DefinitionGrid`** shows label/value facts in two columns, stacking to one below `sm`.
  Source documents (project, purchase order, goods receipt) are links. `DocumentIdentity` takes
  them as `facts`.
- **`DocumentTabs`** keeps the same order on every document: Lines, Journal items, Approvals,
  Activity, then Attachments or Other info only where the API has them. Each tab can show a
  count chip.
- **Data-honesty rule:** a tab whose data the API cannot supply is left out, never drawn empty
  or filled with placeholder rows.
- **`TotalsBlock`** shows the breakdown rows the document actually has, then **Total**, then
  **Amount due** in the largest type. For a money-blind viewer the whole block becomes one
  "Amounts are hidden for your role" line.
- **`SummaryRail`** holds computed facts about the document (balance due, due date, posted),
  never inside a tab. It sits beside the body from `lg` and below it on smaller screens.
- **`ActivityTimeline`** shows actor, what happened, when, and the event code. It is built and
  shown in the gallery, but no live page uses it yet.

### Supplier bill pilot

- **Facts:** supplier, supplier invoice, project (link), purchase order (link), posted goods
  receipts (links), bill date and due date.
- **Lines tab:** item, expense profile, quantity, unit price and amount, then the totals.
  **Amount due** appears only once the bill is posted.
- **Journal items tab:**
  - Before posting, it shows one sentence saying journal items are created on posting.
  - After posting, it loads the posted journal (`postedJournalEntryId` → `useJournal`) as a
    read-only debit/credit table linked to the journal.
  - A user without `manage:journal` is told the journal exists, not shown an empty table.
- **Summary rail:** balance due (posted bills only), due date, and when the bill was posted.
- **Blocked-posting notice:** gains a **Review match** action that jumps to the Matching
  section. Resolving a match exception stays there, under its own permission and dialog.
- **Web type:** `SupplierBill` now declares `postedJournalEntryId`, `postedAt`,
  `reversalJournalEntryId`, `reversedAt` and `approvedAt`. The API already returned them.
- **Not on the live page yet:** Approvals, Activity, and the payments count, until the backend
  items below exist.

### Client invoice list pilot

- **Columns:** invoice number (the row link) with its source underneath, client, due date,
  total, balance due and status.
  - The Overdue flag under the due date comes from `isInvoiceOverdue`: posted and approved, past
    its due date, with money still outstanding. These are the same facts the server's
    `CLIENT_INVOICE_OVERDUE` notification uses.
  - Balance due shows "—" on cancelled or reversed invoices, where a zero would read as "paid".
- **Filters:** a Filter panel for approval status, posting status and client.
- **Phone layout:** row cards below 640px.
- **Row kebab:** Open, Open PDF (the existing lazily generated PDF) and Copy link.
- **No create action.** Invoices are raised from certificates, milestones and separate
  charges on the screens where those happen.

## Backend requests: delivered 2026-09-27

All four were built without a database migration, because the data already existed and was
indexed. Every endpoint is guarded by the bill's own permission (`payables:manage`). Each
one first loads the bill within the caller's organisation, so another organisation's bill
returns a 404 before any related record is read.

1. **`GET /bills/:id/approvals`** returns the approval chain.
   - `ApprovalHistoryService` (platform/workflows) reads the approval instances by
     transaction, and the pure `deriveApprovalSteps` gives each step one state.
   - When no approval policy applied, it returns `directApproval` from the bill's
     `approvedBy` and `approvedAt` instead.
2. **`GET /bills/:id/activity`** returns the history, merged from three sources:
   - the audit log for the bill's own ID, via `RecordActivityService` (platform/audit-logs)
     and the pure `activityCode`: `POST /api/v1/bills/:id/approve` becomes `bills.approve`;
   - approval decisions, which the audit log files under the approval instance instead;
   - creation, which the audit log records before the bill has an ID, so it is taken from the
     bill's `createdBy` and `createdAt`.

   Per-record reads no longer need the organisation-wide `view:audit-log`.
3. **`GET /bills/:id/payments`** returns payment allocations with server-computed totals:
   - `paidAmount` counts POSTED allocations only.
   - `pendingAmount` is money allocated by payments that are not yet posted. It is already
     taken off `outstandingAmount` when the payment is created.
   - `paymentCount` counts distinct payments.
   - Buyer-advance evidence allocations do not change the balance and are not included.
4. **Journal numbers.** `GET /bills/:id` now includes `postedJournalNumber` and
   `reversalJournalNumber`.

The web app now shows the Approvals and Activity tabs, Amount paid, In unposted payments and
Payments in the summary rail, and names the journal for viewers without `manage:journal`.

**Known limit.** The audit log records commands, not field changes, so Activity shows what
happened rather than before/after values. Client invoices can reuse the same readers next.

## Consequences

- Every document type built from now on uses the same body components.
- **Not handled at 375px:** the lines table scrolls sideways at phone width. A phone card
  layout for lines belongs with the line-item editor batch.
