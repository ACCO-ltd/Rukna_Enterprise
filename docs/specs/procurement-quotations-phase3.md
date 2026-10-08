# Procurement quotations — Phase 3 spec and build tickets: paying from the award

Implements **ADR-045** (`docs/adr/ADR-045-paying-from-the-award.md`), which owns the decisions;
read it first. Builds on ADR-044 Phase 1 (award, raise order, award-covered PO confirm) and Phase 2
(NotificationWriter, `OutboundMessage` queue, dispatcher, kill switch). This document is the
testable contract and the build order. Status: **backend P1–P9 built** (branch
`feat/quotation-payment`, product-owner defaults Q1–Q4); frontend P10–P14 in progress. The
backend's deviations from this text are listed in §8 — §8 wins where they differ.

Phase 3 = after the award PO is confirmed, finance pays in one tap along the recorded path:
**BUYER_CASH** — release cash to the buyer (posted staff advance) → buyer buys and photographs the
receipt → site receives → finance records the receipt into a bill and the advance settles it →
change returned / top-up. **FINANCE_PAYS_SUPPLIER** — finance pays the store prefilled from the
award: prepayment (supplier advance) before goods, or the posted invoice after.

---

## 0. Contract summary

### Actors

| Actor | Role (ACCO) | Permissions used |
|---|---|---|
| Buyer (collector) | Procurement Manager / field buyer | `view:procurement`, `collect:quotation` (upload store documents) |
| Payer | Finance Officer (CFO, CEO) | `manage:payable` (+ `award:quotation` only to change the path) |
| Approver (bands active) | Finance Officer → CFO → CEO per supplier-payment band | existing workflow approval endpoints |
| Receiver | Site engineer / storekeeper (never the PO creator) | existing goods-receipt create/post permissions (unchanged) |
| Signatories | bank-account signatories (pay-supplier only) | existing `POST /supplier-payments/:id/release` |

### Success scenarios (test ids)

- **S1** Award (BUYER_CASH) → PO raised and issued (covered) → payers get `PAYMENT_NEEDED` (in-app +
  WhatsApp `QUOTE_PAY_NEEDED` if opted in). Request `payment.state = READY_TO_PAY`.
- **S2** Payer opens the request, taps *Release cash*: dialog prefilled (buyer = request creator,
  amount = ordered amount, account = last used cash account, date = today) → one tap → advance
  `APPROVED/POSTED`, journal EVT-AP-007 Dr Staff advances / Cr cash account on `advancedAt`; buyer
  gets `CASH_RELEASED`; state `CASH_WITH_BUYER`. (Bands inactive, or band ≤ $1k with FO releasing.)
- **S3** Same as S2 with bands active and $4,000: instance opens on FO → CFO, FO step recorded from the
  tap, 409 `{ approvalInstanceId }`, state `AWAITING_APPROVAL`; CFO approves; payer re-drives → S2.
- **S4** Buyer pays the store, taps *Photograph receipt* on the request (or the cash card), takes 1–3
  pages, sends → `StoreDocument SUBMITTED`; payers get in-app `RECEIPT_TO_RECORD`.
- **S5** Site posts the GRN (accepted = ordered). Payer opens *Record receipt*, sees the photo, types
  total 980.00, confirms date and expense account → bill created, submitted (MATCHED), approved,
  posted (EVT-AP-001), advance applied 980.00 (EVT-AP-008 Dr AP / Cr Staff advances); store document
  `RECORDED`; advance outstanding 20.00; state `SETTLING`.
- **S6** Payer records change returned 20.00 CASH into the cash box on `receivedAt` → EVT-AP-009;
  advance outstanding 0; PO settlement `SETTLED`; PO auto-closes; state `SETTLED`.
- **S7** Shortfall: receipt 1,030.00 on a PO of 1,030.00 where only 1,000.00 was released → after
  record, bill outstanding 30.00; *Top up* prefilled 30.00 → second advance released and applied in
  the same command (`applyToBillId`); bill outstanding 0.
- **S8** FINANCE_PAYS_SUPPLIER, no bill yet: *Pay supplier* prefilled (supplier, ordered amount,
  last-used account, method) → shape `PREPAY`: payment created + purchase allocation to the PO,
  approved, posted (EVT-AP-003 B: Dr Supplier advance / Cr Bank) — account without signatories.
  Collector gets `SUPPLIER_PAID`. State `WAITING_FOR_GOODS`.
- **S9** After S8: buyer photographs the store INVOICE (or the delivery's invoice), site receives, payer
  records it → bill posted; step 4 applies the supplier advance (existing EVT-AP-005); state `SETTLED`.
- **S10** FINANCE_PAYS_SUPPLIER with a posted bill on the PO: *Pay supplier* → shape `PAY_BILL`
  (allocation to the bill, EVT-AP-003 A).
- **S11** Account with signatories: *Pay supplier* stops at `APPROVED`, returns `{ awaiting:
  'RELEASE_SIGNATURES' }`; state `AWAITING_SIGNATURES`; after two signatures, *Finish* posts.
- **S12** Store will not take cash: payer switches path → FINANCE_PAYS_SUPPLIER (reason) before
  anything is released; `PAYMENT_NEEDED` stays open.
- **S13** Double tap on *Release cash* / *Pay supplier* (same `idempotencyKey`) → one document; the
  second response is the first document (200).

### Refusal scenarios

| Id | Situation | Result |
|---|---|---|
| R1 | Release / pay when the request is not AWARDED, or the PO is DRAFT/CLOSED/CANCELLED | 409 `PAYMENT_PO_NOT_OPEN` |
| R2 | Release on a FINANCE_PAYS_SUPPLIER request (or pay-supplier on BUYER_CASH) | 409 `PAYMENT_PATH_MISMATCH` |
| R3 | Amount would make funded > ordered | 409 `FUNDING_EXCEEDS_ORDER {orderedAmount, funded, requested}` |
| R4 | Payer is the recipient | 403 `ADVANCE_RECIPIENT_CANNOT_RELEASE` |
| R5 | Recipient not an ACTIVE member of the org, or not a collector of this request | 422 `ADVANCE_RECIPIENT_INVALID` |
| R6 | Cash account has active signatories / is not ACTIVE / `allowsPayments=false` / other currency | 409 `ACCOUNT_REQUIRES_DUAL_CONTROL` / 422 `ACCOUNT_NOT_USABLE` / 422 `CURRENCY_MISMATCH` |
| R7 | `STAFF_ADVANCE` posting profile missing on `advancedAt` | 409 `POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE` (nothing written) |
| R8 | `advancedAt` / `receivedAt` / `billDate` in a closed or locked period | 409 `PERIOD_CLOSED` / `PERIOD_LOCKED` (existing posting policy) |
| R9 | Record a store document before a POSTED GRN covers the PO lines | 409 `GOODS_NOT_RECEIVED` |
| R10 | Receipt total above the PO → bill match EXCEPTION | 200 with `step: 'MATCH_EXCEPTION'`; stops; resumes after exception approval |
| R11 | Return above advance outstanding; application above either outstanding; bill of another PO/supplier/currency | 422 `RETURN_EXCEEDS_OUTSTANDING` / `APPLICATION_EXCEEDS_OUTSTANDING` / `APPLICATION_MISMATCH` |
| R12 | Same receipt photo hash already on another store document in the org | 409 `STORE_DOCUMENT_PHOTO_DUPLICATE` |
| R13 | Pay-supplier by the store's vendor maintainer (selector registered it at award) | 403 `VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT` (existing) — UI pre-empts with "another finance user must pay this store" |
| R14 | Path change after any live advance/payment | 409 `PAYMENT_PATH_LOCKED` |
| R15 | Reverse an advance with applications or returns | 409 `ADVANCE_HAS_SETTLEMENTS` |
| R16 | A buyer (no `manage:payable`) calls any money command | 403 |
| R17 | Supplied `bankGlCode` ≠ the payment's bank-account GL | 409 `BANK_GL_MISMATCH` |
| R18 | Approver on the advance's instance is its recipient (re-drive) | 403 `ADVANCE_RECIPIENT_CANNOT_RELEASE`, instance voided |

---

## 1. API

All money commands are in Accounts Payable controllers, class-gated `manage:payable`; store
document capture is in procurement. Money in requests is a string with 2 dp (`"980.00"`), as the
quotation total endpoint does. Commands return the request's `payment` read model (§1.4) unless
stated. Errors carry a machine `code`.

### 1.1 Buyer cash (`/buyer-advances`)

| Method & path | Body → result |
|---|---|
| `GET /buyer-advances/release-draft?quotationRequestId=` | `{ purchaseOrder {id, poNumber, orderedAmount}, currencyCode, remainingToFund, recipients [{userId, name, isRequestCreator}], accounts [{bankAccountId, name, glCode, method: CASH\|MOBILE_MONEY\|BANK, lastUsed}], defaultAdvancedAt, bandHint? {name, steps[]} , blockers[] }` |
| `POST /buyer-advances/release` | `{ idempotencyKey (uuid), quotationRequestId? \| purchaseOrderId, recipientUserId, amount, bankAccountId, paymentMethod: CASH\|MOBILE_MONEY\|BANK, advancedAt (date), reference?, note?, applyToBillId? }` → 201 `{ advance, payment }` · 409 `{ approvalInstanceId }` when gated · re-drive = same body |
| `POST /buyer-advances/:id/reverse` | `{ reason, reversalDate }` |
| `POST /buyer-advances/:id/returns` (hardened) | `{ amount, returnMethod: CASH\|BANK\|MOBILE_MONEY, destinationBankAccountId, receivedAt, reference?, note? }` → posts EVT-AP-009 |
| `POST /buyer-advances/:id/applications` (replaces `evidence-allocations`, which stays as an alias) | `{ supplierBillId, amount }` → posts EVT-AP-008 |
| `POST /buyer-advances/:id/applications/:appId/reverse` | `{ reason }` → mirror of EVT-AP-008 on the application's date |
| `POST /buyer-advances` / `POST /buyer-advances/:id/post` (existing) | unchanged shape; now posts EVT-AP-007 through the same gate + SoD + checks |

### 1.2 Supplier payment from the award (`/supplier-payments`)

| Method & path | Body → result |
|---|---|
| `GET /supplier-payments/award-draft?quotationRequestId=` | `{ supplier {id, name, isVendorMaintainer: boolean, maintainerName}, shape: PREPAY\|PAY_BILL, bills [{id, number, outstanding}], remainingToFund, accounts [{bankAccountId, name, underDualControl, lastUsed}], methods, defaultPaymentDate, bandHint?, blockers[] }` |
| `POST /supplier-payments/from-award` | `{ idempotencyKey, quotationRequestId, bankAccountId, paymentMethod, paymentDate, amount, shape, supplierBillId?, bankReference?, note? }` → `{ payment, awaiting?: 'APPROVAL'\|'RELEASE_SIGNATURES', approvalInstanceId? }`; re-drive with the same body continues approve → post |
| `POST /supplier-payments/:id/post` (existing) | `apAccountCode`, `bankGlCode`, `supplierAdvanceCode` become optional (server-resolved); a mismatching `bankGlCode` → R17 |
| `POST /supplier-bills/:id/post` (existing) | `apAccountCode` optional (server-resolved by role) |

### 1.3 Store documents (`/procurement/store-documents`)

| Method & path | Permission | Body → result |
|---|---|---|
| `POST /procurement/store-documents` | `view:procurement` + `collect:quotation` | `{ clientRef, purchaseOrderId, kind: RECEIPT\|INVOICE, photos: [{platformFileId, capturedAt, source}] }` → idempotent on `clientRef`; PO must be an award PO the caller collected for |
| `POST /procurement/store-documents/:id/photos` | same | extra page while SUBMITTED |
| `POST /procurement/store-documents/:id/withdraw` | same (uploader) | while SUBMITTED |
| `GET /procurement/store-documents?purchaseOrderId=` | `view:procurement` | rows; photo ids only when the caller passes the photo rule |
| `POST /supplier-bills/from-store-document` | `manage:payable` | `{ storeDocumentId, total, documentDate, supplierInvoiceNumber?, expenseProfileCode, note? }` → `{ storeDocument, bill, step: 'DONE'\|'MATCH_EXCEPTION'\|'WAITING_APPROVAL', applied? }`; re-tap with `{ storeDocumentId }` resumes |
| `POST /procurement/store-documents/:id/reject` | `manage:payable` | `{ reason: ILLEGIBLE\|WRONG_PO\|DUPLICATE\|OTHER, note? }` → buyer notified in-app |

### 1.4 Quotation request additions

| Method & path | Permission | Body → result |
|---|---|---|
| `GET /procurement/quotation-requests/:id` | unchanged | detail gains `payment` (below) |
| `GET /procurement/quotation-requests?queue=pay\|settle` | `award:quotation` ∨ `manage:payable` | new finance queues |
| `POST /procurement/quotation-requests/:id/payment-path` | `award:quotation` + `manage:payable` | `{ paymentPath, reason }` |

```
payment: {
  path: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER',
  state: 'AWAITING_ORDER' | 'READY_TO_PAY' | 'AWAITING_APPROVAL' | 'AWAITING_SIGNATURES'
       | 'CASH_WITH_BUYER' | 'WAITING_FOR_GOODS' | 'RECEIPT_TO_RECORD' | 'SETTLING' | 'SETTLED',
  purchaseOrder: { id, poNumber, status } | null,
  orderedAmount*, funded*, remainingToFund*, withBuyer*,            // money: null unless visible
  advances*: [{ id, recipientName, amount, advancedAt, applied, returned, outstanding, legacy }],
  payments*: [{ id, number, amount, shape, documentStatus, postingStatus }],
  storeDocuments: [{ id, number, kind, status, uploadedByName, createdAt, photos? }],
  receivingStatus: 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED',
  approval?: { instanceId, status, currentStepRole },
  allowedActions: [{ action: 'RELEASE_CASH'|'TOP_UP'|'RECORD_RETURN'|'PAY_SUPPLIER'|'FINISH_PAYMENT'
                    |'PHOTOGRAPH_RECEIPT'|'RECORD_RECEIPT'|'CHANGE_PATH', enabled, reason? }],
  moneyVisible
}
```

State derivation (pure, `payment-state.policy.ts`), first match wins: no OPEN PO → `AWAITING_ORDER`;
pending approval instance on an advance/payment → `AWAITING_APPROVAL`; APPROVED payment on a
dual-controlled account → `AWAITING_SIGNATURES`; funded = 0 → `READY_TO_PAY`; PO SETTLED/CLOSED →
`SETTLED`; a SUBMITTED store document and goods received → `RECEIPT_TO_RECORD`; advance outstanding
> 0 and no store document → `CASH_WITH_BUYER`; receiving not RECEIVED → `WAITING_FOR_GOODS`;
else `SETTLING`.

---

## 2. Backend tickets (build order)

Every command: one transaction; row locks in the order **PO → advance/payment → bill**; audit via
`TransactionalAuditOutboxService.record(tx, …)` with idempotency keys carrying `updatedAt`; DB tests
(`*.db.spec.ts`) against the real schema, as Phase 1.

### P1 — Schema, migration, seeds

Migration `2026101xxxxxxx_quotation_payment` (additive):
- `BuyerAdvancePaymentMethod` + `CASH`; `NotificationKind` + `PAYMENT_NEEDED`, `CASH_RELEASED`,
  `SUPPLIER_PAID`, `RECEIPT_TO_RECORD`; `MessagePurpose` + `QUOTE_PAY_NEEDED`, `QUOTE_CASH_RELEASED`,
  `QUOTE_SUPPLIER_PAID`; new enums `StoreDocumentKind`, `StoreDocumentStatus`,
  `StoreDocumentRejectReason`.
- `buyer_advances` + `idempotency_key`, `approved_by`, `approved_at`, `approval_instance_id`,
  `reversed_at`, `reversed_by`, `reversal_reason`, `reversal_journal_entry_id`, `quotation_request_id`;
  partial unique `(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `buyer_advance_evidence_allocations` + `allocation_date` (date), `posting_status` (default
  `NOT_POSTED`), `journal_entry_id`, `reversal_journal_entry_id`, `reversed_at`, `reversed_by`.
- `supplier_payments` + `idempotency_key` (same partial unique), `quotation_request_id`.
- `store_documents` (`id, organization_id, number SD-00001, purchase_order_id, quotation_request_id?,
  kind, status, client_ref uuid unique per org, uploaded_by, supplier_bill_id? unique, document_date?,
  entered_total?, entered_by?, recorded_at?, reject_reason?, reject_note?, rejected_by/at?,
  created_at, updated_at`), `store_document_photos` (`platform_file_id unique, page_number, sha256
  char(64), captured_at, received_at, source, uploaded_by`), index `(organization_id, sha256)`.
- Seeds (targeted + idempotent for the live tenant, and in the full seeds for new tenants):
  SoD rule `ADVANCE_RECIPIENT_CANNOT_RELEASE` (active); BuyerAdvance band set (`entityType
  'BuyerAdvance'`, `DRAFT → APPROVED`, `SUPPLIER_PAYMENT`, `accoSupplierPaymentBands()`, inactive);
  activation script couples it with the SupplierPayment set (refuse one without the other); posting
  profile `STAFF_ADVANCE` → `13100` added to the construction template and seeded for orgs whose
  chart has `13100`; registry `SUPPLIER_PAYMENT` gains `'DRAFT:APPROVED'` (fixes the registry/seed
  contradiction); `GovernedEntity` + `'BuyerAdvance'`; `SodAction` + `RELEASE_BUYER_ADVANCE`;
  `riskFor` unchanged (no new permission).

Tests: migration applies on a copy of prod schema; partial uniques reject a duplicate key and allow
nulls; seeds idempotent (run twice); activation refuses a lone set; template spec still passes its
invariants with the new profile.

### P2 — Pure domain policies (no I/O)

`accounts-payable/domain/`: `fundingCap(ordered, advances, purchaseAllocs, billAllocs)`;
`advanceOutstanding(advance, applications, returns)` (legacy rows keep evidence arithmetic);
`applicationAmount(billOutstanding, advanceOutstanding, requested?)`;
`applicationDate(billDate, advancedAt) = max`; `splitReceiptTotal(total, poLines, acceptedQty)` (floor
4 dp, remainder on the largest line, Σ = total); `releaseBlockers(...)` returning ordered blocker
codes for the draft endpoints. `procurement/quotations/domain/payment-state.policy.ts` (§1.4).

Tests (unit, table-driven): cap equality allowed, +0.01 refused, returns lower funded, reversed
documents ignored, a prepayment later applied counted once; split on 1/3/7 lines with awkward
totals sums exactly and never yields a negative line; date = later of the two; every state reached
by exactly one fixture.

### P3 — Server-side GL resolution for AP posting

`SupplierPaymentService.post`: bank GL from `BankAccount.glAccountId`; AP / Supplier advance via
`PostingAccountResolver.resolveByCodeOrRole`; R17. `SupplierBillService.post`: AP by role when the
code is omitted. DTO fields optional. Web keeps sending codes until P11 removes them.

Tests: post without codes produces the same journal as with correct codes; wrong `bankGlCode` 409;
`POSTING_ACCOUNT_AMBIGUOUS` surfaces when two AP accounts exist; existing AP spec suite green.

### P4 — Buyer advance release, GL posting, reverse, hardened return

`BuyerAdvanceService.release(identity, cmd)`: lock PO; load request (via repository read of
`quotation_requests`, no module import — the Phase 1 pattern) and check AWARDED + path + PO OPEN;
recipient ACTIVE member and a collector of the request (non-award: any ACTIVE member with
`view:procurement`); account rules (R6); SoD `RELEASE_BUYER_ADVANCE`; funding cap; resolve
`STAFF_ADVANCE` on `advancedAt`; idempotency lookup; create DRAFT; `evaluateStateTransition(identity,
'BuyerAdvance', 'DRAFT', 'APPROVED', id, amount)` with the selector-counts-as-approval step (reuse
the award's helper, extracted to `platform/workflows` if not already shared); on clear: APPROVED,
post EVT-AP-007 (`accountingDate = documentDate = advancedAt`, `sourceDocumentType BUYER_ADVANCE`),
`postingStatus POSTED`, `postedJournalEntryId`, `postedAt = now` (audit timestamp only), audit
`BUYER_ADVANCE_RELEASED`, notifications (P9). Re-drive: SoD re-checked over the instance's approvers
(R18). `applyToBillId` (top-up) applies in the same transaction via P6's application routine.
`reverse`: R15; mirror journal on `reversalDate`. `createReturn`: cap, destination required for all
methods, EVT-AP-009 Dr destination GL / Cr Staff advances on `receivedAt`, then
`autoCloseIfSettled`. Existing `create` + `post` routed through the same checks; `post` posts EVT-AP-007.

Tests (DB): S2 journal lines/dates/dimensions exact; S3 gated → 409 → CFO approve → re-drive posts
once; S13 double tap; R3–R8, R15, R18; return S6 posts and closes the PO; return R11; legacy POSTED
row without journal is never re-posted and keeps its outstanding; `advancedAt` yesterday posts
yesterday (never today); concurrent releases on one PO cannot exceed the cap (two transactions).

### P5 — Store documents (capture)

Procurement `store-documents/` module: create (idempotent on `clientRef`), add page, withdraw,
list; file owner kind `STORE_DOCUMENT_PHOTO` in `file-authorization.service.ts` with the
`QUOTATION_PHOTO` rule; duplicate hash R12 (org-wide, ACTIVE documents); `RECEIPT_TO_RECORD`
notification on create; reject command (finance). Buyer never sends an amount (DTO has none).

Tests (DB): S4; idempotent `clientRef`; R12; money-blind user cannot read the photo bytes; a
collector of another request cannot upload against this PO; reject resolves the notification and
notifies the uploader.

### P6 — Record receipt → bill → settle (EVT-AP-008)

`StoreDocumentSettlementService.record(identity, cmd)` (AP): lock PO → store document; R9 (accepted
GRN quantity ≥ bill quantity per line, from the settlement repository); step 1 create the PO bill
(lines from `splitReceiptTotal`, `billDate = documentDate`, `supplierInvoiceNumber = given ??
SD-number`, photos attached to the bill and frozen IMMUTABLE), store `supplierBillId`; step 2
`submit` (auto-match); if `EXCEPTION` return `MATCH_EXCEPTION`; step 3 `approve` + `post` (existing
services; SoD as today); step 4 apply: BUYER_CASH → `applyAdvance` across the PO's advances oldest
first (EVT-AP-008, `allocationDate = max(billDate, advancedAt)`, bill outstanding reduced, application
POSTED); FINANCE_PAYS_SUPPLIER prepayment → existing `allocateAdvance` (EVT-AP-005). Mark the
document RECORDED, resolve notifications, `autoCloseIfSettled`. Every step is idempotent: re-tap
skips completed steps by reading state. Steps 1–3 call the existing services (their own transactions
and gates); the orchestrator holds no transaction across them and writes progress after each.
Application reverse: mirror journal on the application's date; bill outstanding restored.

Tests (DB): S5, S7 (top-up applies), S9 (EVT-AP-005 path), R9, R10 then resume after
`approveException`, R11 (other PO's bill, other supplier, over-outstanding), re-tap after a crash
between steps 2 and 3 completes without a second bill, the GL nets: Staff advances balance = cash
released − applied − returned per PO; AP for the supplier = 0 after S6.

### P7 — Pay supplier from the award

`SupplierPaymentService.payFromAward(identity, cmd)`: lock PO; request AWARDED + path + PO OPEN;
shape check (PAY_BILL requires a posted bill on this PO with outstanding ≥ amount); funding cap;
idempotency; `create` (vendor-maintainer SoD as today) + purchase allocation (PREPAY) in one
transaction; `approve` (bands; payer's tap counts as the FO step); if the account is under dual
control return `awaiting: RELEASE_SIGNATURES`; else `post` (P3 resolution). Re-drive continues from
the document's state. Audit `SUPPLIER_PAID_FROM_AWARD`; notification `SUPPLIER_PAID` on post (also
from the existing post endpoint when the payment carries `quotationRequestId`).

Tests (DB): S8, S10, S11 (+ finish after two signatures), S13, R2, R3, R13 (selector registered
the store), bands active > $1k → 409 then re-drive; bill approver cannot approve the PAY_BILL
payment (existing rule still fires); prepayment + later bill → settlement shows FUNDED and then
SETTLED.

### P8 — Path change, read models, settlement upgrade

`changePaymentPath` (R14, audit, resolves/re-targets `PAYMENT_NEEDED`); `payment` block on the
request detail (repository reads of AP tables + settlement); queues `pay` / `settle` with SLA-style
age (working hours, the Phase 1 function); settlement read model: advance outstanding from posted
applications + returns, bill `settled` includes advance applications, `billPaymentState` gains
`PAID_BY_BUYER_CASH`, legacy label; `getBillPayments` lists advance applications.

Tests: every `payment.state` from a DB fixture; money null for a money-blind viewer;
`allowedActions` reasons (e.g. `RECORD_RECEIPT` disabled with `GOODS_NOT_RECEIVED`); queue membership
and ordering; settlement before/after S5–S6 matches the hand-computed figures; legacy advance
arithmetic unchanged.

### P9 — Notifications + WhatsApp

`PAYMENT_NEEDED` written in PO `confirm`'s covered branch (`purchase-order.service.ts:336-495`) via
`NotificationWriter` + `QuotationWhatsAppAlerts` (SAVEPOINT, `ON CONFLICT DO NOTHING`; key
`quotation-wa:<requestId>:<purpose>:<poId>:<userId>` / `…:<advanceId>…` / `…:<paymentId>…`).
`QuotationAlertGuard` extended: pay-needed still unfunded and path unchanged; cash-released advance
still POSTED; supplier-paid payment still POSTED; recipient checks as Phase 2. Templates added to
`docs/integrations/whatsapp-templates.md` §10–12 (texts in §4 below) with env overrides
`WHATSAPP_TEMPLATE_QUOTE_PAY_NEEDED|CASH_RELEASED|SUPPLIER_PAID`.

Tests: S1 rows written once per payer; kill switch off → nothing queued; guard drops a pay-needed
alert once cash is released; delivery log shows the new purposes; no template param contains a
digit sequence resembling an amount (unless Q2 is answered "yes").

## 3. Frontend tickets

### P10 — Types, API, hooks, permissions
Types for §1; hooks with optimistic disable + `idempotencyKey` generated once per dialog open;
`canPay = manage:payable`.
Tests: hook unit tests (key reused on retry, new key on reopen); permission helpers.

### P11 — Finance: Payment section, Release cash, Pay supplier, inbox queues
Payment section on `/finance/quotes/[id]` (wireframes A–C, F); dialogs prefilled from the draft
endpoints; one primary button; 409 approval → "Waiting for CFO" state with the instance link; inbox
tabs *To pay* / *To settle*. Removes the GL-code fields from the existing payment/bill post flows
(server resolves).
Tests (RTL): prefill renders; one tap posts and the section moves to *Cash with Ahmed*; blockers
render as disabled reasons (dual-control account, vendor maintainer, missing STAFF_ADVANCE); 375 px
snapshot; Playwright journey S1→S6 (seeded).

### P12 — Procurement: cash card + receipt capture
On `/procurement/quotes/[id]`: *Cash released* card (amount visible to the recipient — they hold
`view:commitment-ledger` as Procurement Manager; otherwise "Open to see") and *Photograph receipt*
using the Phase 1 capture library and queue (wireframe D); status chips for the store document.
Tests: queue retry with the same `clientRef`; offline → online resend; capture screen at 375 px; no
amount input exists.

### P13 — Finance: Record receipt, return change, top up
Record screen (wireframe E): photo left / form right (stacked on phone), total, date, receipt no.,
expense account (remembered); result banner per `step`; *Change returned* and *Top up* dialogs.
Tests: MATCH_EXCEPTION banner links to the bill's exception; resume button after exception; change
dialog caps at outstanding; Playwright S7.

### P14 — Setup + advances screens
Accounting readiness lists `STAFF_ADVANCE` profile and at least one cash account without
signatories (link to bank accounts with "Add cash box / EVC float" preset); `/procurement/advances`
shows the GL journal link, applications, reverse, and the legacy label.
Tests: readiness item toggles; legacy label rendering.

## 4. WhatsApp templates (Somali drafts — owner to review wording)

Category UTILITY, language `en` (as Phase 2), one dynamic URL button, no amounts.

- **`quote_pay_needed_so`** → payers: "Dalabka {{1}} ee dukaanka {{2}} (mashruuca {{3}}) waa la
  ansixiyay. Lacag bixinta: {{4}}. Fadlan bixi." Button *Bixi* → `/finance/quotes/{{1}}`.
  ({{4}} = `Iibsaduhu kaash ayuu bixinayaa` / `Maaliyadda ayaa bixinaysa`.)
- **`quote_cash_released_so`** → buyer: "Lacag caddaan ah ayaa laguu sii daayay dalabka {{1}} ee
  dukaanka {{2}}. Fur si aad u aragto qadarka, kadibna sawir rasiidka marka aad iibsato." Button
  *Fur* → `/procurement/quotes/{{1}}`.
- **`quote_supplier_paid_so`** → collectors: "Maaliyaddu waxay lacagta u bixisay dukaanka {{1}}
  dalabka {{2}}. Alaabta qaado oo sawir rasiidka/invoice-ka." Button *Fur* → `/procurement/quotes/{{1}}`.

## 5. Wireframes (375 px unless stated)

### A. Finance — Payment section, READY_TO_PAY (BUYER_CASH)
```
┌───────────────────────────────────┐
│ QR-00007 · MR-00042 · Hodan Tower │
│ Awarded: Bakaara Steel  $1,000.00 │
│ PO-00311 · Issued                 │
├───────────────────────────────────┤
│ PAYMENT          Buyer pays cash ▾│
│ Ordered     $1,000.00             │
│ Released        $0.00             │
│ ┌───────────────────────────────┐ │
│ │   Release cash to Ahmed  ▶    │ │  ← primary, one tap opens B
│ └───────────────────────────────┘ │
│ Store won't take cash? Change path│
└───────────────────────────────────┘
```

### B. Release cash dialog (prefilled; one tap)
```
┌ Release cash ─────────────────────┐
│ To        [Ahmed Ali (buyer)   ▾] │
│ Amount    [ 1,000.00 ] USD        │
│ From      [Cash box · 10900    ▾] │
│ Method    (•) Cash  ( ) EVC       │
│ Date      [08 Oct 2026]           │
│ Approval: ≤ $1,000 — you approve  │
│ ┌───────────────────────────────┐ │
│ │      Release $1,000.00        │ │
│ └───────────────────────────────┘ │
└───────────────────────────────────┘
 gated:  "Sent to CFO for approval — we'll release when approved"  [View approval]
 blocked: "Main bank needs two signatories — choose Cash box or EVC float"
```

### C. Finance — CASH_WITH_BUYER → RECEIPT_TO_RECORD
```
│ PAYMENT                Buyer cash │
│ With Ahmed   $1,000.00  · 2 h ago │
│ Receipt      ● Sent by Ahmed 10:42│
│ Goods        ● Received (GRN-118) │
│ ┌───────────────────────────────┐ │
│ │        Record receipt  ▶      │ │  ← opens E
│ └───────────────────────────────┘ │
│ Top up · Change returned · Reverse│
```

### D. Procurement — cash card + capture
```
┌───────────────────────────────────┐
│ ✓ Cash released to you  $1,000.00 │
│   Pay Bakaara Steel, then         │
│ ┌───────────────────────────────┐ │
│ │   [cam] Photograph the receipt│ │  (Phase 1 camera; pages strip)
│ └───────────────────────────────┘ │
│ [p1][p2][+]          Send receipt │
│ Receipt SD-00019 · Waiting finance│
└───────────────────────────────────┘
```

### E. Finance — Record receipt (desktop: two columns; phone: stacked)
```
┌──────────────────────┬──────────────────────────┐
│  [receipt photo]     │ Total on receipt [ 980.00]│
│  zoom · page 1/2     │ Receipt no.  [ 4471     ]│
│                      │ Date         [08 Oct 2026]│
│                      │ Expense      [Materials ▾]│
│                      │ PO total $1,000 · ✓ goods │
│                      │ Paid from Ahmed's cash    │
│                      │ [ Record and settle ]     │
└──────────────────────┴──────────────────────────┘
 after: "Settled $980.00 from Ahmed's cash · $20.00 still with Ahmed  [Change returned]"
 exception: "Receipt is above the order — approve the price exception on BILL-0091 first"
```

### F. Finance — Pay supplier (FINANCE_PAYS_SUPPLIER)
```
┌ Pay Bakaara Steel ────────────────┐
│ ( ) Pay the invoice BILL-0091 $980│
│ (•) Pay now, before goods         │
│ Amount   [ 1,000.00 ]             │
│ From     [Salaam Bank · 10100  ▾] │
│ Method   (•) Bank ( ) EVC         │
│ Date     [08 Oct 2026]            │
│ Needs 2 bank signatures to release│
│ [        Pay $1,000.00          ] │
└───────────────────────────────────┘
 vendor maintainer: "You registered this store, so another finance user must pay it."
```

## 6. Definition of done

All S/R scenarios covered by named tests; AP suite green; journals for S2–S9 asserted line by line
including `accountingDate`; no `new Date()` used as an accounting date anywhere in the new code
(grep in review); legacy advances untouched; migration additive; seeds idempotent; WhatsApp off by
default; Playwright journeys S1→S6 and S8→S9 green in CI; prod pre-deploy check of
`buyer_advances` row count recorded in the PR.

## 7. Ticket list

| # | Ticket | Depends on |
|---|---|---|
| P1 | Schema, migration, seeds (CASH, new enums, store documents, idempotency keys, STAFF_ADVANCE profile, SoD rule, BuyerAdvance bands, registry fix) | — |
| P2 | Pure policies (funding cap, outstanding, split, dates, payment state) | P1 |
| P3 | Server-side GL resolution for payment/bill post | — |
| P4 | Buyer advance release + EVT-AP-007 + reverse + hardened return EVT-AP-009 | P1, P2, P3 |
| P5 | Store documents capture + photo owner kind | P1 |
| P6 | Record receipt → bill → settle, EVT-AP-008 applications | P4, P5 |
| P7 | Pay supplier from the award (prepay / pay bill) | P1, P2, P3 |
| P8 | Path change, payment read model, finance queues, settlement upgrade | P4, P6, P7 |
| P9 | Notifications + WhatsApp purposes, guard, templates | P4, P7, P8 |
| P10 | Web types/API/hooks | P8 |
| P11 | Finance payment section, release, pay supplier, queues | P10 |
| P12 | Procurement cash card + receipt capture | P10 |
| P13 | Finance record receipt, change, top-up | P10 |
| P14 | Setup readiness + advances screens | P10 |

## 8. Backend build notes — deviations from the text above (P1–P9)

Product-owner decisions: **all defaults** (Q1 cash box / mobile-money float without signatories;
Q2 no amount in WhatsApp; Q3 top-up only up to the PO, above it only after the bill's price
exception is approved; Q4 vendor-maintainer rule kept).

**Routes.** New routes are exactly as §1 (`/buyer-advances/release-draft`, `/buyer-advances/release`,
`/buyer-advances/:id/reverse|applications|applications/:appId/reverse`,
`/supplier-payments/award-draft`, `/supplier-payments/from-award`,
`/supplier-bills/from-store-document`, `/procurement/store-documents…`,
`/procurement/quotation-requests/:id/payment-path`). The *existing* post routes the spec calls
`/supplier-payments/:id/post` and `/supplier-bills/:id/post` are, as before, `POST /payments/:id/post`
and `POST /bills/:id/post` (now with optional GL codes).

**Responses.**
- Release cash → `{ advance, payment }` (`payment` = the request's §1.4 block). Pay supplier →
  `{ payment, awaiting?: 'RELEASE_SIGNATURES', paymentSummary }` (`payment` = the supplier payment
  document with `shape`; `paymentSummary` = the §1.4 block). Record receipt →
  `{ storeDocument, bill, step, applied: [{ kind: 'BUYER_ADVANCE'|'SUPPLIER_PAYMENT', id, amount }],
  approvalInstanceId? }`.
- **Gated (DoA) money commands answer 409** `{ details: { code: 'APPROVAL_REQUIRED',
  approvalInstanceId, advanceId | paymentId } }` for both release cash and pay supplier (the
  spec's `awaiting: 'APPROVAL'` 200 is not used); re-drive with the same body (same
  `idempotencyKey`).
- Reusing an `idempotencyKey` with a different body → 409 `IDEMPOTENCY_KEY_REUSED`.
- R8 (closed / locked / missing period) is checked before anything is written and answers
  409 with `code` `PERIOD_CLOSED` | `PERIOD_LOCKED` | `NO_PERIOD`.
- 422 `AMOUNT_INVALID` / `DATE_INVALID` for malformed money / dates; 400 `DESTINATION_REQUIRED`
  for a return without an account.
- `payment` block: `advances` / `payments` are `null` (not filtered) for a money-blind viewer;
  `storeDocuments[]` adds `supplierBillId`, `photoCount`, `photos` only when photos are visible;
  allowed-action reasons used: `MISSING_PERMISSION`, `PAYMENT_PO_NOT_OPEN`, `NOTHING_TO_FUND`,
  `NOTHING_WITH_BUYER`, `NOTHING_TO_FINISH`, `NO_RECEIPT_TO_RECORD`, `GOODS_NOT_RECEIVED`,
  `PAYMENT_PATH_LOCKED`, `VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT`. RELEASE_CASH is
  offered until the first live advance, TOP_UP after it.
- State order: a CLOSED / settled order is `SETTLED` (checked before `READY_TO_PAY`); a pending
  *or granted-not-consumed* approval counts as `AWAITING_APPROVAL`.
- Queue rows (`pay`, `settle`) add `paymentWaitingWorkingMinutes`; `pay` = award order OPEN with
  remaining-to-fund > 0; `settle` = a SUBMITTED receipt or cash still with the buyer. List and
  detail are also open to `manage:payable` holders.

**Model.**
- `StoreDocumentStatus` has `WITHDRAWN` (for `/withdraw`). New `NotificationKind`
  `RECEIPT_REJECTED` (the "buyer notified in-app" on reject). `SourceDocType` gains
  `BUYER_ADVANCE`. `advance_returns.journal_entry_id` and
  `buyer_advance_evidence_allocations.reversal_reason` added (not in P1's list).
- Reversal events are named `EVT-AP-010` (advance) and `EVT-AP-011` (application).
- `POST /buyer-advances/:id/reverse` on a DRAFT advance (e.g. stuck awaiting approval) cancels it
  (`documentStatus CANCELLED`, approval voided, no journal) so it stops holding funding room.
  `reversalDate` is required only for a posted advance.
- Legacy advances (POSTED, no journal): evidence links and returns on them are recorded without a
  journal (old arithmetic); reverse refused (409 `ADVANCE_LEGACY`).
- Funding cap = max(PO ordered, Σ POSTED bills on the PO) — a bill above the order can only be
  posted after its price exception is approved (Q3), and then the buyer can be reimbursed up to it.
  The settlement read model uses the same target (a PO whose posted bill exceeds what was funded
  shows `FUNDING_GAP` and does not auto-close), and counts bills paid directly by a payment that
  does not also fund the PO.
- Bill recorded from a store document: lines = PO lines with accepted − already-billed quantity
  > 0 (copying line type, unique material, UoM, `purchaseOrderLineId`); a partial receipt is
  accepted only when every billed line has a unique material, else 409 `GOODS_NOT_RECEIVED`.
  `dueDate = billDate`. Line amounts are split on the 2-dp grid, unit price = amount ÷ qty (4 dp).
- `SupplierBillPaymentState` gains `PAID_BY_BUYER_CASH`; bill-payment rows add
  `paidByBuyerCashAmount` and `advanceApplications[]` (**web: `po-bill-payments.tsx` STATE_TONE
  needs the new key**). `QuotationNotificationContext` gains optional `poNumber`, `storeName`,
  `paymentPath`, `storeDocumentNumber`, `rejectReason`.
- STAFF_ADVANCE is the only posting profile allowed to point at an ASSET account (create / re-point
  validate it); bill lines still refuse it (expense profiles only) — the bill expense-profile
  picker should hide it.

**Added for P14.** `GET /buyer-advances/readiness` (`manage:payable`) → `{ ready,
staffAdvanceProfile, cashAccountsWithoutSignatories, cashAccounts: [{ bankAccountId, name, glCode,
currencyCode }] }` — the buyer-cash setup items, kept out of `/accounting/readiness` because they
do not block the ledger.

**Review fixes (2026-10-09).**
- `payment.pending[]` on the request detail: `{ kind: 'BUYER_ADVANCE'|'SUPPLIER_PAYMENT', id,
  idempotencyKey, amount (money-gated), awaiting: 'APPROVAL'|'RELEASE_SIGNATURES'|'POSTING',
  approvalInstanceId, continue: { method: 'POST', path } }` — finish from any device with **no
  body**: `POST /buyer-advances/:id/post` (re-drives a DRAFT advance; the stored top-up target is
  honoured) or new `POST /supplier-payments/:id/continue` (same response as `from-award`).
- Pay supplier: both shapes are capped; PAY_BILL is refused with 409 `PREPAYMENT_NOT_APPLIED
  { unappliedPrepayments }` while a posted prepayment on the order is unapplied. `award-draft`
  adds `unappliedPrepayments[]` and the blocker; the payment block adds action `APPLY_PREPAYMENT`
  (apply with the existing `POST /payments/:id/allocations { supplierBillId, amount }`) and
  PAY_SUPPLIER's reason `PREPAYMENT_NOT_APPLIED`.
- `POST /buyer-advances/:id/returns` and `/applications` accept an optional `idempotencyKey`
  (replay → the first row; different body → 409 `IDEMPOTENCY_KEY_REUSED`). Release / pay replays
  compare every field (paymentMethod, applyToBillId, shape, supplierBillId).
- Posting a waiting DRAFT re-runs the release checks (order OPEN, path, account, recipient, cap);
  approvals are consumed in the posting / approving transaction (409 `APPROVAL_ALREADY_USED` if a
  concurrent re-drive used it). DoA bands use the order's cumulative funding.
- EVT-AP-005 (prepayment applied) is dated max(bill date, payment date) for every caller; its
  reversal EVT-AP-006 on the allocation's date.
- Record receipt requires the order OPEN; the bill detail returns `evidence { storeDocumentId,
  number, kind, photos[{ fileId, pageNumber }] }`.
- Settlement: `UNBILLED_RECEIPT` exception (a PO auto-closes only when fully billed).
- `SUPPLIER_PAYMENT_APPROVED` audit on every supplier-payment approval.

**Fixes found while building.** A failed posting attempt no longer flips an already POSTED
supplier payment / bill to FAILED (two concurrent posts — the loser used to overwrite the
winner). Bill reverse is refused while buyer cash is applied to it.

