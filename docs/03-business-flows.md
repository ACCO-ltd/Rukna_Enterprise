# Rukna — Business Flows

Three flows describe almost everything the system does. Each step notes its implementation
status; the authoritative status is `docs/01-capability-matrix.md`.

## Flow A — Scope & Revenue (client-facing)

> What did we promise the client, what work did we perform, and how much can we bill?

```
Client ✓
  → Project ✓
  → BOQ ✓                     (scope, quantity, rate — the priced schedule)
  → Contract ✓               (value, retention, advances, guarantees, milestones)
  → Work performed           (Programme/Progress — NOT BUILT)
  → IPA ✓                    (our valuation / claim)
  → IPC ✓                    (client's certificate)
  → AR Invoice ✓             (posted to GL → revenue recognised)
  → Receipt ✓               (cash collected + allocated)
```

The Commercial workspace (ADR-017) presents Overview, Contract & Security, Applications &
Certificates, and Billing & Collection as one guided surface. **Gap in this flow:** there is no Programme/Progress domain, so "work
performed" is not an authoritative fact — valuation relies on manual IPA entry rather than
measured progress.

## Flow B — Procurement & Cost

> What do we need, what did we order, what arrived, what do we owe, what did it cost?

```
Need
  → Material Request ✓        (dual-scope PROJECT | ORGANIZATION, DOA approval)
  → Purchase Order ✓         (immutable revisions, MR↔PO allocation)   → COMMITTED
  → Goods Receipt ✓          (accept/reject, over-receipt tolerance)   → ACCRUED
  → (Inventory / stock issue — NOT BUILT — where project CONSUMPTION happens)
  → Supplier Bill ✓          (2-way/3-way match, tolerance policy)     → ACTUAL + GL
  → Supplier Payment ✓                                                → GL Dr AP / Cr Bank
```

Financial progression on the **Commitment Ledger** (separate from GL):

```
PO approved       → COMMITTED cost
Goods received    → ACCRUED cost
Supplier bill     → ACTUAL cost
```

**Gap:** the physical-to-financial loop is open — there is no warehouse/stock ledger, so
"issue 100 bags to Project P1" (the event that turns a purchase into project consumption) cannot
be recorded yet.

## Flow C — Accounting

> What is the legally/accountingly correct financial position of the company?

```
Business event
  → Posting rule           (PostingProfile / PostingRule)
  → Journal Entry ✓
  → Journal Lines ✓        (∑ Dr = ∑ Cr enforced)
  → General Ledger ✓
  → Trial Balance ✓
  → P&L / Balance Sheet ✓
```

Posted business events (see `docs/reference/accounting-event-catalog.md`):
`CLIENT_INVOICE.POSTED`, `PAYMENT_RECEIPT.POSTED`, `SUPPLIER_BILL.POSTED`,
`SUPPLIER_PAYMENT.POSTED`, `MANUAL_JOURNAL.POSTED`.

Two project financial views sit on top of the GL:
- **Project Actual P&L** (`GET /projects/:id/pl`) — posted GL only; excludes commitments.
- **Project Financial Position** (`GET /projects/:id/financial-position`) — actual cost +
  remaining committed cost (COMMITTED + ACCRUED) + forecast margin. Backend built, no UI yet.

## Flow D — Change (not built)

> A Variation keeps original scope/price/time and current values consistent.

```
Variation
  → BOQ (sourceType = VARIATION, sourceChangeOrderId)
  → Contract value
  → Programme
  → Forecast
```

Designed only: `BoqNode` carries `sourceType`/`sourceChangeOrderId` provenance fields, but there
is no `ChangeOrder` aggregate. BLOCKED pending Eng Ahmed's decision (#51).

## How the flows meet

```
ALL FINANCIAL EVENTS  →  GL  →  P&L / Balance Sheet / Project Actuals
Flow A revenue  ─┐
Flow B cost     ─┼─►  GL
Flow D change   ─┘
GOVERNANCE (RBAC + DOA + Audit) wraps every sensitive command in all flows.
```
