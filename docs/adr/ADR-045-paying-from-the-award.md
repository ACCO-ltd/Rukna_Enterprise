# ADR-045 — Paying from the award: buyer cash and supplier payment as posted finance documents

**Status:** Proposed (owner: Abdulsalam; product owner decisions pending — see "Open questions").
Phase 3 of competitive quotations (ADR-044 §11). Spec and tickets:
`docs/specs/procurement-quotations-phase3.md`.

**Why a new ADR and not an ADR-044 section.** Phase 2 lived inside ADR-044 because it only added
delivery (WhatsApp) to events ADR-044 already defined. Phase 3 changes Accounts Payable for every
caller, not only quotations: a buyer advance starts posting to the general ledger (today it posts
nothing), three new AP journal events appear, the advance gets a DoA gate and SoD rules, and the
supplier-payment post stops trusting GL codes from the client. Those are accounting decisions that
must be findable without reading a procurement ADR. ADR-044 §11 now points here.

*Numbering note:* the uncommitted branch `docs/platform-multi-entity` also carries an
`ADR-044-tenant-group-legal-entity-division-model.md`. Main's ADR-044 is quotations; that branch must
renumber (to ADR-046 or later) before it merges.

## Context

After finance awards a quotation, someone has to pay the store. The award already records how
(`QuotationRequest.paymentPath`, `BUYER_CASH | FINANCE_PAYS_SUPPLIER`, ADR-044 §11) but nothing acts
on it. In Mogadishu's markets the buyer usually pays cash (or EVC/Zaad mobile money) at the counter
and carries the goods away; for some stores finance pays the supplier by bank or mobile money,
sometimes before the goods leave the store. The buyer is standing in the store while this happens,
so finance must be able to act in seconds.

Locked earlier: payments stay canonical in Finance/Accounting (procurement round-2 A4); ADR-022
SoD (bill approver ≠ payment approver/releaser; vendor maintainer ≠ PO creator/payment processor);
supplier payment DoA bands ≤ $1k FO / $1k–$10k +CFO / > $10k +CEO, seeded inactive
(`apps/api/src/platform/workflows/seeders/acco-value-bands.ts:112-128`); source-document dates for
every posting, never `new Date()` (feedback-accounting-date-rule).

### What exists today (verified 2026-10-08 on main `3d3a7c7a`)

**Buyer advances** (`BuyerAdvance`, `AdvanceReturn`, `BuyerAdvanceEvidenceAllocation`,
`apps/api/prisma/schema.prisma:3364-3441`, migration `20260919065930_procurement_v2_model`;
service `apps/api/src/business/accounting/accounts-payable/application/buyer-advance.service.ts`;
`/buyer-advances`, class-gated `manage:payable`, `presentation/buyer-advance.controller.ts:290`):

- **CONTRADICTED — an advance never reaches the GL.** `post()` (`buyer-advance.service.ts:192-214`)
  only flips `postingStatus` to `POSTED` with `postedAt = new Date()`; its comment says the bank
  journal is "deferred to the SupplierPayment.post() path … the underlying bank payment was already
  posted via SupplierPayment". No code links a supplier payment to an advance, and a supplier
  payment needs a `supplierId` and debits that supplier's advance (`supplier-payment.service.ts:357-364`)
  — it cannot represent cash handed to an employee. `postedJournalEntryId` exists on the model and is
  never written. Returns and evidence allocations also post nothing.
- **Disbursement:** `BuyerAdvancePaymentMethod = BANK | MOBILE_MONEY` (`schema.prisma:5324-5327`),
  always from a `BankAccount` (`schema.prisma:3366`: "no cash disbursement"). ACCO's chart has
  `10900 Petty cash` (CASH_AND_BANK) but setup creates `BankAccount` rows only for named banks
  (`accounting-setup/templates/construction.ts:114,126`; `accounting-setup.repository.ts:296-317`),
  so petty cash cannot fund an advance today.
- **No controls on create:** no transaction, no audit, no DoA gate, no SoD, recipient not checked
  (any string), no cap against the PO, any `advancedAt` (`buyer-advance.service.ts:48-81`).
- **Settlement links are unchecked:** an evidence allocation does not check the bill belongs to the
  advance's PO or supplier, nor caps the amount by the advance's outstanding or the bill's total
  (`:125-153`); a return is not capped by outstanding (`:83-123`). `outstanding = amount − Σevidence
  − Σreturns` is computed at read time (`:155-175`).
- **Read model:** the PO settlement (`purchase-orders/application/settlement-query.service.ts:121-330`)
  counts only `POSTED` advances as funding (`settlement-query.repository.ts:129-140`), raises
  `OUTSTANDING_ADVANCE` while an advance is not fully evidenced/returned (`:249-256`), and
  `autoCloseIfSettled` closes the PO when SETTLED (`purchase-order.service.ts:777-795`).
- **UI:** `/procurement/advances` list + detail with a Post button
  (`apps/web/src/features/procurement/components/buyer-advance-screens.tsx`).

**Supplier payments** (`supplier-payment.service.ts`, `/supplier-payments`, `manage:payable`):

- `create` (`:100-193`) — SoD `PROCESS_SUPPLIER_PAYMENT` against the supplier's `createdBy` (vendor
  maintainer, `:114-124`); bill allocations only to POSTED/OPENING_BALANCE bills; an unallocated
  remainder is a **supplier advance** (prepayment).
- `approve` (`:195-232`) — SoD `BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT`, then the DoA gate
  `SupplierPayment DRAFT → APPROVED` valued at `totalAmount`. The bands are seeded on exactly that
  transition (`acco-workflows.seed.ts:469-475`). *Contradiction (minor):* the policy registry lists
  `SUPPLIER_PAYMENT: ['DRAFT:SUBMITTED']` (`policy-transition-registry.ts:7`), so the in-app policy
  authoring screen offers a transition the service never evaluates. Fixed in passing (P1).
- `signRelease` (`:240-288`) — dual control: ≥ 2 signatories when the bank account has any.
- `post` (`:295-410`) — EVT-AP-003: Dr AP (allocated) / Dr Supplier advance (unallocated) / Cr Bank,
  dated `payment.accountingDate`. **The client supplies `apAccountCode`, `bankGlCode`,
  `supplierAdvanceCode`** (`:318-325`) — the bank GL is not derived from the payment's bank account.
- `allocateAdvance` (`:415`) — EVT-AP-005 Dr AP / Cr Supplier advance, dated the payment's
  accounting date; `createPurchaseAllocation` (`:740-770`) links a payment to a PO as pre-bill
  funding, uncapped.

**Bills:** a PO bill's quantities must match **accepted** GRN quantity at 0 % tolerance
(`bill-matching.service.ts:42-50`), so a PO bill cannot post before goods are received; submit runs
the match automatically (`supplier-bill.service.ts:260-296`); approve checks
`GOODS_RECEIVER_CANNOT_APPROVE_BILL` (`:439-470`); post is EVT-AP-001 Dr Expense / Cr AP on
`billDate` (`:472-640`).

**SoD/award interplay:** all seven ADR-022 rules are active (`acco-workflows.seed.ts:45-56`). The
award registers a new store with `createdBy = selector` (`quotation-award.service.ts:338-350`), so
the selector is that supplier's vendor maintainer and **cannot create a supplier payment to it**.
`PO_CREATOR_CANNOT_RECEIVE_GOODS` means the collector who raised the order cannot post its GRN.

**Chart:** `13000 Advances to suppliers` (SUPPLIER_ADVANCE, a resolver role) and `13100 Staff
advances` (OTHER_CURRENT_ASSET, not a resolver role) exist in the template (`construction.ts:131-132`).
`PostingAccountResolver` resolves the six roles (`posting-account-resolver.service.ts:27-68`).

## Decision

### 1. Two paths, both owned by finance, both started from the award

The quotation request detail (finance and procurement) gains a **Payment** section that drives the
recorded `paymentPath`. All money commands live in Accounts Payable and require `manage:payable`;
procurement only uploads photos and receives goods. Preconditions for any payment command: request
`AWARDED`, its `purchaseOrderId` PO is `OPEN` (confirmed — covered by the award, ADR-044 §7), same
currency as the award.

**Funding cap (new invariant).** For a PO raised from an award, `funded ≤ PO ordered amount`
(which is ≤ the award, ADR-044 §8), where `funded` = Σ live buyer advances (amount − returns) +
Σ live supplier-payment purchase allocations to the PO + Σ live payment allocations to the PO's
bills made by payments that have no purchase allocation to this PO (so a prepayment later applied to
the bill is counted once). Live = the document is not REVERSED/CANCELLED. Evaluated under the PO's
row lock (`SELECT … FOR UPDATE` on `purchase_orders`), which every payment command from the award
takes first. 409 `FUNDING_EXCEEDS_ORDER` with `{ orderedAmount, funded, requested }`. Not applied to non-award POs in Phase 3 (no
regression for existing data); recorded as a candidate general rule.

### 2. BUYER_CASH — the buyer advance becomes a posted cash document

**Release (one tap).** `POST /quotation-requests/:id/payment/release-cash` (AP controller, see
spec) creates, approves and posts a `BuyerAdvance` in one command:

- Prefill: `recipientUserId` = the request creator (picker of the request's collectors), `amount` =
  PO ordered amount minus live advances (default the whole order), account = the user's last-used
  cash account, `advancedAt` = today (Africa/Mogadishu) — editable, period must be open.
- **Accounts that may fund an advance:** an ACTIVE `BankAccount` with `allowsPayments` and **no
  active signatories**. ACCO registers its cash box (GL `10900 Petty cash`) and its EVC/Zaad float as
  ordinary `BankAccount` rows (`bankName` "Cash box" / "EVC Plus"). An account under dual control is
  refused (409 `ACCOUNT_REQUIRES_DUAL_CONTROL`) — a buyer cannot wait for two signatures, and the
  dual control is not weakened. `BuyerAdvancePaymentMethod` gains `CASH` (handed over from the cash
  box). Currency of the account = the PO's.
- **DoA:** new governed transition `BuyerAdvance DRAFT → APPROVED`, valued at the advance amount,
  bound to the **supplier-payment bands** (`accoSupplierPaymentBands()` verbatim, transaction type
  `SUPPLIER_PAYMENT` — no enum migration, the VariationOrder precedent). Seeded inactive; the
  activation seed activates and deactivates it together with the SupplierPayment bands (one control).
  Bands inactive → no gate. Bands active → the releaser's tap counts as their approval of the current
  step if they hold its role (the ADR-044 §7 pattern); ≤ $1k (FO only) completes in the same request;
  above, 409 `{ approvalInstanceId }` and the CFO/CEO approve through the existing workflow screens,
  then any `manage:payable` holder re-drives the same command (ADR-015).
- **SoD:** new `SodAction` `RELEASE_BUYER_ADVANCE`, context `advanceRecipientUserId`, new rule
  `ADVANCE_RECIPIENT_CANNOT_RELEASE` (seeded active): nobody releases cash to themselves, and an
  approver on the advance's instance may not be its recipient (checked on re-drive over the
  instance's `ApprovalAction` actors, as ADR-044 §6 does for awards). The vendor-maintainer rule is
  **not** applied: the money goes to an employee, not to the vendor, and the vendor is then paid
  against a receipt photo and a GRN posted by a third person (§2 settle). Recorded consciously; the
  fake-store scenario needs selector + buyer + receiver collusion.
- **GL — EVT-AP-007 `BUYER_ADVANCE_DISBURSED`:** Dr Staff advances / Cr the account's GL
  (`BankAccount.glAccountId`), `accountingDate = documentDate = advancedAt`, source
  `BUYER_ADVANCE`, journal category `CASH_AND_BANK`, origin `SYSTEM_CASH`. The Staff-advances
  account is resolved through a **posting profile `STAFF_ADVANCE`** (effective-dated, the AP line
  pattern) rather than a new `AccountSubtype` (no enum migration, no change to the six resolver
  roles; `13100` is OTHER_CURRENT_ASSET alongside `13200`, so a subtype lookup would be ambiguous).
  Missing profile → 409 `POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE` before any write. Each line
  carries the PO's `projectId` as a dimension; employee identity stays on the advance (no employee
  subledger in Phase 3).
- `documentStatus DRAFT → APPROVED`, `postingStatus POSTED`, `postedJournalEntryId` set, all in one
  transaction with the audit event `BUYER_ADVANCE_RELEASED`, the in-app notification and the
  WhatsApp alert row (§5). Idempotent on a client `idempotencyKey` (new nullable column, partial
  unique `(organization_id, idempotency_key)`): a double tap returns the first advance.
- **Reverse** (`POST /buyer-advances/:id/reverse`, `{ reason, reversalDate }`): only while nothing
  is applied or returned; mirror journal on `reversalDate ≥ advancedAt`; `postingStatus REVERSED`.

**Store document (the receipt photo).** New aggregate `StoreDocument` (procurement context,
`store_documents` + `store_document_photos`): the buyer photographs the store's paper receipt or
invoice with the Phase 1 capture library (downscale, SHA-256, IndexedDB queue, `clientRef`
idempotency). Fields: `purchaseOrderId`, `quotationRequestId?`, `kind RECEIPT | INVOICE`, `status
SUBMITTED | RECORDED | REJECTED`, `uploadedBy`, `rejectReason?`, `supplierBillId?`. The buyer types
**no amount** (ADR-044 principle 2). New file owner kind `STORE_DOCUMENT_PHOTO`, same read rule as
`QUOTATION_PHOTO` (procurement + cost visibility + project access); photos become IMMUTABLE when the
document is recorded into a bill, and are attached to the bill as its evidence. Duplicate SHA-256
within the org → 409 `STORE_DOCUMENT_PHOTO_DUPLICATE` (a receipt cannot be claimed twice).

**Settle (one screen, after the site receives the goods).** `POST /store-documents/:id/record`
(`manage:payable`) — finance types the receipt total (and the receipt number if printed; otherwise
`SD-<number>` is used as `supplierInvoiceNumber`), picks one expense profile (defaulted to the last
used), and the server, in order and resumably:

1. creates the PO bill: one line per PO line with accepted GRN quantity, line amounts split from the
   typed total by the PO line amounts with the ADR-044 §8 floor-to-4-dp rule (rounding remainder on
   the largest line so Σ = total exactly), `billDate` = the receipt date finance confirms;
2. submits it (auto-match runs, existing D6); a price above the PO lands as `EXCEPTION` and stops
   here — the existing exception approval path decides (FO ≤ $1k, CFO above), then finance resumes;
3. approves it (existing SoD `GOODS_RECEIVER_CANNOT_APPROVE_BILL`) and posts it (EVT-AP-001, AP
   account resolved server-side);
4. **applies the advance** — EVT-AP-008 `BUYER_ADVANCE_APPLIED`: Dr AP (supplier subledger) / Cr
   Staff advances, amount = min(bill outstanding, advance outstanding), `accountingDate =
   max(bill.billDate, advance.advancedAt)` (both source-document dates), bill `outstandingAmount`
   reduced. Implemented by upgrading `BuyerAdvanceEvidenceAllocation` into a posted application
   (new columns `allocationDate`, `postingStatus`, `journalEntryId`, `reversalJournalEntryId`) with
   checks the current endpoint lacks: same PO, same supplier, same currency, ≤ both outstandings,
   under the advance's and the bill's row locks.

The store document records `supplierBillId` after step 1; a re-tap continues from the first
unfinished step (each step checks state, never repeats a done one). Requires a POSTED GRN covering
the receipt — before that the action is disabled with "Waiting for the site to receive the goods".

**Change returned / shortfall.**
- **Change:** `POST /buyer-advances/:id/returns` (existing route, hardened): capped at outstanding;
  method `CASH | BANK | MOBILE_MONEY` into a cash/bank account (destination now required for every
  method, since cash lands in the cash box); **EVT-AP-009 `BUYER_ADVANCE_RETURNED`** Dr account GL /
  Cr Staff advances on `receivedAt`. Finance counts and types it — the buyer never types it.
- **Shortfall** (receipt above the cash released, within the PO): the buyer paid the difference;
  finance releases a **top-up advance** to the same buyer (same command, capped at `bill outstanding`
  once the bill is posted, else PO ordered − live advances) and it is applied in step 4. Paying above
  the PO is not a cash problem but a price exception: the bill's match exception decides it; without
  an approved exception there is nothing to reimburse against (product question Q3).
- **Write-off** of an advance the buyer cannot account for: out of scope (manual journal + HR).
- The PO settles when received, funded and every advance is fully applied/returned; the existing
  `autoCloseIfSettled` closes it.

### 3. FINANCE_PAYS_SUPPLIER — reuse supplier payments, prefilled from the award

No new money document. `POST /quotation-requests/:id/payment/pay-supplier` composes the existing
`SupplierPaymentService` (create → approve → post) in one command with an `idempotencyKey`
(new nullable column on `supplier_payments`, partial unique), prefilled: supplier = awarded
supplier, currency = award, account = last used, method from `BANK | MOBILE_MONEY`, amount =
remaining to fund. Two shapes, chosen by the server from the PO's state and shown to finance:

- **Pay the invoice (default once a bill exists):** a POSTED bill on the PO with outstanding →
  allocate to it (EVT-AP-003 branch A). Safest — goods received, matched, certified.
- **Pay now, before goods (default when no bill):** prepayment — unallocated payment (Dr Supplier
  advance / Cr Bank, EVT-AP-003 branch B) plus a `SupplierPaymentPurchaseAllocation` to the PO in
  the same transaction; later, when the store invoice photo is recorded into a bill (§2 settle steps
  1-3 with a `StoreDocument` of kind INVOICE), step 4 applies the supplier advance with the existing
  EVT-AP-005 instead of EVT-AP-008. Chosen as the market default because many stores release goods
  only against payment, and the supplier advance (`13000`) keeps the asset visible until goods and
  invoice arrive; the settlement read model already reports such a PO as funded with
  `EVIDENCE_MISSING`.

Controls are the existing ones, unchanged: vendor-maintainer SoD at create, bill-approver SoD at
approve, the SupplierPayment DoA bands at approve (with the selector-counts-as-approval step
pattern of §2), dual control at release when the account has signatories (then the command stops at
APPROVED and returns `{ awaiting: 'RELEASE_SIGNATURES' }`; signatories use the existing release
action and post finishes it). Consequence recorded: **a selector who registered a new store at award
cannot pay that store** (`VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT`); the screen says
so and names who can (product question Q4). For BUYER_CASH this does not apply (§2).

`SupplierPaymentService.post` and `SupplierBillService.post` resolve GL accounts server-side when
codes are omitted: bank GL = the payment's `BankAccount.glAccountId`; AP and Supplier advance through
`PostingAccountResolver.resolveByCodeOrRole` (the ADR-024 AR precedent). A supplied `bankGlCode`
that differs from the bank account's GL is refused (409 `BANK_GL_MISMATCH`) — a payment must credit
the account the money left.

### 4. Changing the path

`POST /quotation-requests/:id/payment-path` (`award:quotation` + `manage:payable`) switches
`BUYER_CASH ↔ FINANCE_PAYS_SUPPLIER` while no live advance or payment funds the PO; audited
`QUOTATION_PAYMENT_PATH_CHANGED` with a reason. The store said "no cash" or "only cash" — this must
not need a re-decision.

### 5. Notifications and WhatsApp (Phase 2 seam)

New `NotificationKind`s (NotificationWriter, in the command's transaction) and `MessagePurpose`s
(queued `OutboundMessage`, `QUOTATION_WHATSAPP_ENABLED` kill switch, dispatch guard re-checks):

| Kind / purpose | When | To | Resolved / guard |
|---|---|---|---|
| `PAYMENT_NEEDED` / `QUOTE_PAY_NEEDED` | award PO confirmed (covered branch of PO confirm) | `manage:payable` holders with project access, minus the recipient-to-be | first live advance/payment on the PO; path change; cancel |
| `CASH_RELEASED` / `QUOTE_CASH_RELEASED` | advance released (posted) | the advance recipient | advance still POSTED, not reversed |
| `SUPPLIER_PAID` / `QUOTE_SUPPLIER_PAID` | supplier payment posted from the award | request creator + uploaders | payment still POSTED |
| `RECEIPT_TO_RECORD` (in-app only) | store document submitted | `manage:payable` holders | document recorded / rejected |

Somali drafts are in the spec. **The no-amount rule (ADR-044 Phase 2 item 1) is kept by default**:
"Lacag caddaan ah ayaa laguu sii daayay … fur si aad u aragto" with the amount visible only in the
app behind login. This makes the alert less useful at the counter (the buyer must open the link to
see how much) — product question Q2.

### 6. Read models

- Request detail gains `payment: { path, state: AWAITING_ORDER | READY_TO_PAY | AWAITING_APPROVAL |
  AWAITING_SIGNATURES | CASH_WITH_BUYER | WAITING_FOR_GOODS | RECEIPT_TO_RECORD | SETTLING | PAID |
  SETTLED, orderedAmount*, released*, applied*, returned*, outstandingWithBuyer*, payments[]*,
  storeDocuments[], allowedActions[] }` (`*` money, `moneyOrNull`).
- Finance quotes inbox gains queue `pay` (award POs OPEN and not fully funded) and `settle` (store
  documents SUBMITTED, advances outstanding > 0 with age in working hours).
- PO settlement: advance funding counts `amount − reversed`; advance outstanding = amount − Σ posted
  applications − Σ returns; bill settled = Σ payment allocations + Σ posted advance applications;
  bill payment state shows "Paid by buyer cash". Legacy rows (POSTED without a journal) are shown as
  "Recorded before GL posting" and keep today's arithmetic.

### 7. Legacy buyer advances

Before deploy, count `buyer_advances` on prod. Rows with `postingStatus = POSTED AND
posted_journal_entry_id IS NULL` are legacy: never re-posted automatically (that would date them
today or double-count a manual journal). The read model labels them; finance clears them by manual
journal if needed. `POST /buyer-advances/:id/post` on a NOT_POSTED advance now posts EVT-AP-007
(through the same gate and SoD), so no new legacy rows can appear. `POST /buyer-advances` (create
without the award) keeps working for non-award POs with the hardened checks (recipient ACTIVE member,
cap, account rules).

## Consequences

- Staff advances finally appear in the GL; cash with buyers is a reportable balance; AP for cash
  purchases closes through EVT-AP-008 instead of staying open forever.
- Three new AP events (EVT-AP-007/008/009) with mirror reversals; posting profile `STAFF_ADVANCE`
  becomes a setup prerequisite for BUYER_CASH (the accounting readiness check lists it).
- Supplier-payment and bill posting stop trusting client GL codes (backward-compatible when codes are
  sent and consistent).
- A second photo-evidence aggregate (StoreDocument) reuses the Phase 1 capture and file machinery.
- Finance's fast path is one tap for ≤ $1k cash releases (bands inactive or FO band); larger
  releases wait for the CFO/CEO, as ADR-022 intends.

## Out of scope

Employee subledger / per-employee statements · advance write-off workflow · paying several POs in
one payment from the award · partial deliveries with several receipts beyond the generic loop (each
receipt is its own StoreDocument; supported but not optimised) · OCR of receipts · supplier-facing
payment advice · dual-control release of buyer advances · a general (non-award) funding cap.

## Open questions for the product owner (each has a default the build follows)

1. **Q1 Where does buyer cash come from?** Default: a cash box (petty cash 10900) and an EVC/Zaad
   float, each registered as a cash account without signatories; main bank accounts under dual
   control cannot fund buyer cash.
2. **Q2 May the "cash released" WhatsApp show the amount?** Default: no (Phase 2 rule kept); the
   buyer opens the link. Recommended to allow the amount in this one message to its recipient only.
3. **Q3 Store charges more than the award at the counter.** Default: the buyer does not pay above
   the cash released without calling finance; a top-up is possible only up to the PO; above the PO
   the bill is a price exception approved under the existing exception authority before anything is
   reimbursed.
4. **Q4 Selector registered a new store and is the only finance user.** Default: keep ADR-022 — a
   different `manage:payable` holder (or CFO) pays a store the selector registered under
   FINANCE_PAYS_SUPPLIER; BUYER_CASH is unaffected.
