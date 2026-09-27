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

## Backend requests

These are what the Approvals and Activity tabs and the payments count need.

1. **Approval chain by document:** `GET /workflows/instances?transactionType=&transactionId=`,
   or `approvalInstanceId` stored on the bill, returning the full steps with actor, time and
   comment.
2. **Audit trail by record:** `GET /audit-logs?resource=&resourceId=`. It should be gated by the
   record's own view permission rather than the org-wide `auditLogsView`.
3. **Bill allocations:** `GET /bills/:id/allocations`, or `paidAmount` plus `paymentCount` on
   the bill, computed server-side.
4. **Journal number on the document**, or journal-by-source, so users without `manage:journal`
   still see which journal posted it.

## Consequences

- Every document type built from now on uses the same body components.
- The bill page shows fewer tabs than the design until the backend requests land. That gap is
  deliberate, not an oversight.
- **Not handled at 375px:** the lines table scrolls sideways at phone width. A phone card
  layout for lines belongs with the line-item editor batch.
