# ACC-SET-001 — Receipt settlement migration plan

**ADR:** ADR-024 (accepted) · **Status:** plan for review · **Owner:** Abdulsalam

Retire the legacy receipt→IPC allocation ledger and make **one invoice-based
settlement ledger** the sole money-truth. This is the third and largest ADR-024
sub-part (after #80 ACC-DEAD-001 and #81 ACC-POST-001).

---

## 1. The situation (why this is bigger than a cleanup)

There is **one `PaymentReceipt` table** and **two systems that operate on it**:

| | `/receipts` (finance module) | `/customer-receipts` (AR module) |
|---|---|---|
| Create receipt | ✅ `POST /receipts` | ❌ (no create) |
| List / get | ✅ | ✅ |
| Allocate | to **IPC certificate** → `ReceiptAllocation` | to **ClientInvoice** → `ClientReceiptAllocation` |
| **Posts to the GL?** | **❌ never** | ✅ `post()` → Dr Bank / Cr AR |
| IPC payment-status | ✅ from `ReceiptAllocation` aggregate | — |
| **Frontend** | ✅ the whole live receipts UI | ❌ never built |

**The defect this exposes:** the receipts users actually record and allocate in
the UI go through the finance path, which **never posts to the general ledger**.
The GL-posting path (`/customer-receipts`) has no frontend. So today a recorded
receipt is commercial tracking only — the cash never reaches the books, and the
IPC "payment status" is computed from allocations that aren't backed by a journal.

So ACC-SET-001 is really: **move receipts onto the invoice-based, GL-posting
ledger, and retire the shadow one.** It is money-critical and spans backend +
a frontend build.

Key existing seam: `ClientInvoice.sourceIpcId` links an invoice to the IPC that
generated it — this is how IPC payment-status will be re-derived.

---

## 2. Target state

- Receipts are created, posted to the GL (Dr Bank / Cr AR), and allocated to
  **ClientInvoices** — one flow, one ledger (`ClientReceiptAllocation`).
- IPC payment-status is **derived**: IPC → its invoice (`sourceIpcId`) → posted
  receipt allocations against that invoice.
- The `ReceiptAllocation` (receipt→IPC) model, the finance allocate endpoints,
  and the finance module's IPC-status query are gone.
- The receipts frontend drives the `/customer-receipts` flow.

---

## 3. Backend work

### 3a. Receipt creation
`POST /receipts` (finance) is the only create. Decide (see §7-D1) whether to:
- **Keep it** as the create endpoint and only remove its allocation routes, or
- **Move create to `/customer-receipts`** and retire the finance module wholesale.
Recommended: **move create into the AR module** so there is one receipts module,
and delete the finance module. `create` is a thin insert (PaymentReceipt with
`unallocatedAmount = totalAmount`) — cheap to relocate.

### 3b. Retire the receipt→IPC ledger
- Remove `finance` allocate: `POST /receipts/:id/allocations`,
  `DELETE /receipts/:id/allocations/:allocationId`, and the repo methods that
  read/write `receiptAllocation`.
- Drop the **`ReceiptAllocation`** model + migration (`DROP TABLE`). Re-seed dev
  (ACC-SET-001 CONST decision: existing data is dev-only).

### 3c. Re-derive IPC payment-status
Rewrite `getCertificatePaymentSummary(certificateId)` to:
1. Find `ClientInvoice` where `sourceIpcId = certificateId`.
2. If none → `{ totalAllocated: '0.00', netCertified, status: 'UNPAID' }`
   (certified but not yet invoiced).
3. If found → `totalAllocated` = Σ **POSTED** `ClientReceiptAllocation.allocatedAmount`
   against that invoice; compute status.
Return the enriched response in §7a (`netCertified`, `vatAmount`, `invoiceTotal`,
`totalReceived`, `outstanding`, `paidPercent`, `status`). Per **D2 (locked)**:
`status` and `paidPercent` compare `totalReceived` against the **VAT-inclusive
`invoice.totalAmount`** — never against `netCertified`. `netCertified` (pre-VAT),
`vatAmount`, `invoiceTotal`, `totalReceived` and `outstanding` are reported as
distinct figures. `PAID` when `totalReceived ≥ invoiceTotal`; `NOT_INVOICED` when
no live invoice exists yet.

---

## 4. Frontend work (the build)

The live receipts UI must move from allocate-to-IPC (GL-less) to
post-and-allocate-to-invoice (GL). Files in `apps/web/src/features/receipts/`:

- **`receipt-form.tsx`** — create stays; after create the receipt is DRAFT/NOT_POSTED.
- **New: post step** — `POST /customer-receipts/:id/post` (Dr Bank / Cr AR, with
  optional at-post allocations). Needs a **bank picker** (which account received
  the cash). Account codes are no longer sent — ACC-POST-001 resolves AR/unapplied
  server-side; only the bank is chosen.
- **`receipt-allocations-panel.tsx`** — re-point from certificates to **invoices**:
  `POST /customer-receipts/:id/allocations` (`clientInvoiceId`), and reverse via
  `POST /customer-receipts/:id/allocations/:id/reverse`. The picker lists the
  client's **posted, unpaid invoices** (not IPCs). The existing allocation guards
  (client match, ≤ outstanding, positive) already live server-side (hardened
  earlier) — mirror them client-side.
- **`receipts-api.ts` / `use-receipts.ts` / `types.ts`** — swap endpoints and shapes
  to `/customer-receipts`; add post + reverse.
- **IPC settlement panel** (`features/ipc/settlement.ts`, `ipc-billing-card`) —
  unchanged if the payment-status response shape is preserved (§3c); update only if
  we add `invoicedTotal`.
- Remove the `exchangeRate`/currency remnants already handled; ensure `$`-only.

Reference spec already written: `docs/reference/commercial-workspace-refinement-spec.md`
(milestone billing) and the A12 notes in `apps/web/CLAUDE.md`.

---

## 5. Data migration
Dev-only data (per ADR-024): drop `ReceiptAllocation` outright and re-seed. No
production backfill. Any seed that creates receipt→IPC allocations moves to
receipt→invoice (or is removed).

---

## 6. Sequencing (small, verifiable PRs)
1. **BE-1** — re-derive IPC payment-status from invoices (keep response shape,
   implement the §7-D2 VAT decision). Ship first; it's independently testable and
   de-risks the panel before anything is removed.
2. **BE-2** — retire the finance allocate endpoints + `ReceiptAllocation` model
   (+ migration), relocate/settle `create` per §7-D1.
3. **FE-1** — build the `/customer-receipts` post + invoice-allocation UI; retire
   the certificate-allocation panel.
4. **FE-2** — cleanup: delete dead finance-receipts types/hooks; ACC-POST-001
   Phase 2 (stop sending account codes) can ride along.

Each PR: api `tsc`/`eslint`/jest green, web `tsc`/`eslint`/vitest green, CI, browser-QA the receipt→invoice→GL→IPC-status loop.

---

## 7. Decisions — LOCKED (2026-08-21)
- **D1 ✅** — **Fold receipt `create` into Accounts Receivable; retire and delete the
  legacy finance receipt module** after callers/data are migrated. One receipt
  aggregate, one settlement path. No two-writer state past BE-2.
- **D2 ✅** — **Settlement status and paid-% are computed against the VAT-inclusive
  `ClientInvoice` total, never `netCertified`.** Report net certified, VAT, invoice
  total, receipts, and outstanding **separately**. Never compare VAT-inclusive cash
  against a pre-VAT certification amount. (Matches the worked example: certified
  100,000 + VAT 5,000 = invoice 105,000; received 105,000; outstanding 0; PAID.)
- **D3 ✅** — **Allow invoice allocations as part of receipt posting**, transactionally
  atomic and idempotent; **also preserve posting genuinely unapplied receipts** and
  allocating them later.

## 7a. Senior-engineer refinements & one challenge (for confirm)
Building on the locked decisions:

- **CHALLENGE — add a `NOT_INVOICED` status.** The current enum
  `UNPAID | PARTIALLY_PAID | PAID` cannot tell *"certified but not yet billed"* from
  *"billed, client hasn't paid."* In this domain those are different operational
  states (the QS certified; has finance raised the invoice?). Add **`NOT_INVOICED`**
  (a.k.a. AWAITING_INVOICE) for an IPC with no `sourceIpcId` invoice yet. Without it
  a freshly-certified IPC shows "UNPAID", which reads as *the client is late* when in
  fact *we haven't billed them.* Recommend adding it.

- **Enrich the payment-status response to report every figure separately** (D2):
  ```
  { netCertified,   // pre-VAT (IPC items − deductions)
    vatAmount,      // from the invoice; 0 when not invoiced
    invoiceTotal,   // VAT-inclusive; null when not invoiced
    totalReceived,  // Σ POSTED receipt allocations against the invoice
    outstanding,    // invoiceTotal − totalReceived (≥ 0); null when not invoiced
    paidPercent,    // totalReceived / invoiceTotal × 100 (0 when not invoiced)
    status }        // NOT_INVOICED | UNPAID | PARTIALLY_PAID | PAID
  ```
  This changes the response shape (adds fields) — the IPC settlement panel updates to
  show the breakdown. Worth it: it *is* D2 ("report separately").

- **Derive only from live invoices.** Ignore reversed invoices; if the sole invoice
  for an IPC is reversed, status falls back to `NOT_INVOICED`. Only POSTED, non-reversed
  `ClientReceiptAllocation` rows count toward `totalReceived`.

- **Receipt lifecycle, explicit.** DRAFT (created, NOT_POSTED) → POSTED (GL) → allocated.
  Unposted receipts may be edited/deleted; **a POSTED receipt is never hard-deleted** —
  it is reversed (audit trail), per the DB soft-delete rule. The UI exposes both.

- **Idempotency, concretely.** `post()` is guarded by `postingStatus` (re-post →
  409, no double journal); post + at-post allocations run in one `$transaction`
  (already so). Subsequent allocate/reverse are individually guarded by
  `assertAllocatable` (already hardened).

## 7b. Sequencing refinement (avoid a broken-endpoint window)
Reordered from §6 so the frontend never calls a deleted endpoint:
1. **BE-1** — re-derive + enrich payment-status (D2 + NOT_INVOICED). Non-destructive.
2. **FE-1** — build the `/customer-receipts` post + invoice-allocation UI and switch
   the receipts feature onto it. Both backends still exist → non-breaking.
3. **BE-2** — now that the FE is off `/receipts`, fold `create` into AR, remove the
   finance allocate endpoints + module, drop `ReceiptAllocation` (+ migration).
4. **FE-2** — cleanup + ACC-POST-001 Phase 2 (stop sending account codes).

---

## 8. Risks
- **Money misreport via VAT** — the central risk; §7-D2 is the guard. Add explicit
  tests comparing a fully-paid VAT invoice's IPC status.
- **Two-writer window** — while both modules exist, a receipt could be allocated on
  both ledgers. BE-2 closes it by removing the IPC ledger; until then the new FE
  only uses `/customer-receipts`.
- **Reversal ordering** — invoice reverse already guards against active receipt
  allocations (verified). Keep that guard.
