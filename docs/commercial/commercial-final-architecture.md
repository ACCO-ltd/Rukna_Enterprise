# Commercial Module — Final Architecture

## 1. Information Architecture (3-Tab Structure)

After Slice 8 the Commercial workspace has exactly three tabs for MILESTONE contracts (ACCO default):

| Tab | Route | Responsibility |
|---|---|---|
| **Overview** | `/commercial/overview` | Read-model snapshot: financial strip, contract position, attention items. Loads independently without the summary query. |
| **Contract & Milestones** | `/commercial/contract-milestones` | Contract header, milestone journey (ready-to-bill → issue → send), payment schedule editor, contract security details (status, guarantees, retention, advances), variation ledger. |
| **Billing & Collection** | `/commercial/billing-collection` | Issued invoices, receipts, collection events (follow-up, promise to pay, dispute), credit notes. |

`MEASURED_IPC` contracts retain the **Applications & Certification** tab in place of Contract & Milestones. The IPA/IPC backend infrastructure is intentionally preserved for this path and for future subcontract use.

### Route Redirects (Legacy URLs)

| Old route | Redirects to |
|---|---|
| `/commercial/contract-security` | `/commercial/contract-milestones` |
| `/commercial/payment-schedule` | `/commercial/contract-milestones` |
| `/commercial/variations` | `/commercial/contract-milestones` |

---

## 2. BOQ vs Contract Boundary (ADR-029)

- **BOQ** (`BoqVersion`) = **internal budget** — what ACCO will spend to deliver the project. Managed by the PM/QS. Never shared with the client.
- **Contract** = **external commitment** — what the client will pay ACCO. Managed by Commercial.

These are deliberately separate aggregates. A BoqVersion is **SNAPSHOT**-ed when a contract is created; the contract's `boqVersionId` always points to a SNAPSHOT. Subsequent BOQ edits create new DRAFT versions; they do not affect the live contract value.

**Contract Value** = original contract value ± adopted variation orders. It is computed in the `ContractValuePolicy` domain service, not stored denormalised.

---

## 3. Extra Work (Absorb / Variation / Separate Charge)

All extra work originates from the **BOQ "Add Extra Work" drawer**. The type determines the commercial treatment:

| Type | BOQ Impact | Contract Value | Billing |
|---|---|---|---|
| **ABSORBED** | Consumes available scope budget | Unchanged | Rolled into the milestone invoice |
| **VARIATION** (raise & adopt) | New BOQ line, adopted immediately | Increases by VO net price | Billed as a separate VO invoice OR as a stage reduction |
| **SEPARATE_CHARGE** | New BOQ line | Unchanged | Separate invoice, not milestone-linked |

After Slice 8 / variation-collapse:
- There is no separate "New Variation" entry point on the Variations tab — variations are created only from the BOQ drawer.
- Approval workflow for variations is removed; a raised variation is immediately `CLIENT_APPROVED` and adopted.
- The extra-work command resolves the project's active client contract on the server. A caller does not enter or send an internal contract ID. Exactly one active client contract is required; zero or multiple matches return a clear validation error.
- An unbilled variation can be **Reversed** (un-adopted): this soft-deletes the BOQ node (`isActive = false`) and restores the contract value.

---

## 4. Milestones and Readiness

The billing path for a MILESTONE contract:

1. **Programme milestone verified** (Progress workspace): the physical work is complete.
2. **Mark Ready to Bill** (`POST /commercial/installments/:id/mark-ready-to-bill`): commercial team confirms the installment is eligible for invoicing. Sets `readyToBillAt`.
3. **Revoke Readiness** (`DELETE /commercial/installments/:id/mark-ready-to-bill`): available until the installment is billed.

The `billStage` gate enforces `readyToBillAt IS NOT NULL` before any invoicing action. There is no gate that prevents a later milestone being issued while an earlier one has an outstanding balance.

For a milestone-triggered installment, a linked `VERIFIED` programme milestone is required before the current-cycle ribbon offers commercial review. A missing link is treated as blocked rather than silently bypassing physical verification.

---

## 5. Billing Package (Atomic Path)

`issuePackage` is the single command that covers the whole issuance flow:

```
issuePackage(projectId, installmentId, opts)
  → creates ClientInvoice rows (milestone + any VO lines in scope)
  → posts JournalEntry (DR: AR / CR: Revenue)
  → returns billing package read model
```

This is **atomic**: either all invoices are created and posted, or none are. There is no separate approve/post step visible to the user. The invoice `status` seen in the UI reflects the document state (`ISSUED`, `PARTIALLY_PAID`, `PAID`) derived from the posting status and allocation state.

`sendPackage` records a `PackageDelivery` event (delivery method + timestamp). It does not change the invoice's financial state.

The Contract & Milestones UI rebuilds the issued/sent journey from the Billing Package read model. Invoice numbers and delivery state therefore survive navigation and page reloads; they are not browser-only state.

**Idempotency**: calling `issuePackage` when the installment already has a posted invoice returns the existing package read model without creating a duplicate (Slice 8 guard).

---

## 6. Collections (AR Lifecycle)

After an invoice is issued, the AR lifecycle continues on the **Billing & Collection** tab:

| Step | Command | Effect |
|---|---|---|
| **Record payment** | `POST /commercial/billing/payment` | Creates `PaymentReceipt`, allocates to invoices, posts journal (DR: Bank / CR: AR) |
| **Follow-up** | `POST /commercial/invoices/:id/follow-ups` | Audit event only — no financial change |
| **Promise to pay** | `POST /commercial/invoices/:id/promises` | Records date + amount — no financial change |
| **Dispute** | `POST /commercial/invoices/:id/disputes` | Flags invoice — no financial change |
| **Credit note** | `POST /commercial/invoices/:id/credit-notes` | Reduces `netAmount`, posts reversal journal, updates `outstandingAmount` |

**`recordProjectPayment` idempotency**: callers may supply an optional `idempotencyKey` string. A second call with the same key returns the existing receipt without creating a duplicate (safe for network retries). Keys are stored in the `payment_receipts.idempotency_key` column.

After a payment is recorded, the client invalidates the complete project commercial read-model tree and the project financial-position query. Billing & Collection, Commercial Overview, and Project Overview consequently refetch the same posted receipt and outstanding balance.

---

## 7. Finance Boundary

| Belongs in Commercial | Belongs in Global Finance (Accounting) |
|---|---|
| Contract lifecycle commands | Chart of Accounts management |
| Milestone readiness | Period open/close |
| `issuePackage` (invoice creation + posting) | Trial balance / P&L / Balance Sheet |
| `recordProjectPayment` (receipt + allocation + posting) | Journal entry approval |
| Collection events (follow-up, promise, dispute) | Bank reconciliation |
| Credit notes | Supplier bills and payments |
| Commercial read model (Overview, per-project AR) | Organisation-wide AR subledger |

The AR subledger is the source of truth for outstanding balances. The Commercial module writes to it via `ClientInvoiceService` and `CustomerReceiptService`; the Finance module reads from it via the trial balance and account ledger.

---

## 8. Retained but Hidden

The following infrastructure exists in the codebase and is intentionally preserved for future use. It is not visible to ACCO users under the current MILESTONE billing model:

| Surface | Status | When it becomes visible |
|---|---|---|
| IPA / IPC chain (applications, certifications) | Backend + frontend routes present | When a `MEASURED_IPC` contract is created |
| `ApplicationsTab` component | Present, shown for MEASURED_IPC | Billing model gate |
| Retention / advance detail screens (inside Contract Security) | Now inside Contract & Milestones | Always visible when a contract exists |
| DRAFT / APPROVED / POSTED as user-visible terms | Internal backend states only | Not exposed in UI; UI uses "Issued", "Paid", "Outstanding" |

---

## 9. Permission Matrix

| Action | Required Permission | Endpoint |
|---|---|---|
| View any commercial tab | `contractsView` | All GET endpoints (enforced at controller level) |
| View financial amounts | `financialPositionView` | Gated in read model via `canViewFinancials` flag |
| Mark ready / revoke | `receivablesManage` | POST/DELETE `/installments/:id/mark-ready-to-bill` |
| Issue billing package | `receivablesManage` | POST `/installments/:id/issue-package` |
| Send invoice | `receivablesManage` | POST `/installments/:id/package-deliveries` |
| Record payment | `receivablesManage` | POST `/billing/payment` |
| Collection events (follow-up, promise, dispute) | `receivablesManage` | POST `/invoices/:id/follow-ups` etc. |
| Credit note | `receivablesManage` | POST `/invoices/:id/credit-notes` |
| Raise variation / reverse variation | `contractsManage` | Routed through BOQ extra-work commands |
| Advance / close contract lifecycle | `contractsManage` | POST `/commercial/contracts/:id/activate` etc. |

The `canViewFinancials` flag is returned in the commercial summary. The Overview and Contract & Milestones tabs gate all `formatMoney()` calls behind this flag — users without it see "—" in place of amounts.
