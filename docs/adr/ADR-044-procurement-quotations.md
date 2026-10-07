# ADR-044 — Competitive quotations between an approved Material Request and the Purchase Order

**Status:** Proposed (owner: Abdulsalam; product decisions locked by ACCO's product owner,
2026-10-07). Phase 1 is specified in `docs/specs/procurement-quotations-phase1.md`. Phase 2
(WhatsApp alerts to staff + SLA reminders/escalation) was built 2026-10-07 — see "Phase 2" below.
Phase 3 (executing the chosen payment path) is designed as a seam here and is not built.

## Context

ACCO buys most site material in the open market in Mogadishu. Today an approved Material Request
(MR) goes straight to a Purchase Order (PO); the price on the PO is whatever procurement types. No
record shows that alternatives were sought, and the person who negotiates the price also enters it.
The owner wants competitive quotations with three properties:

1. **Fast in the field.** The procurement person is in a market, on a phone, with weak signal and
   about 30 seconds per MR. They photograph each store's paper quote; they never type a price.
2. **The photo is the source of truth; the numbers come from finance.** Finance views the photos
   side by side, types each quote's total, and chooses. The procurement person therefore never
   creates a number that money flows from.
3. **The choice is the approval.** The selector's choice, made under the existing PO delegation of
   authority (ADR-022 CONST-DOA-005), is the PO approval — the PO raised from it must not ask for a
   second DoA approval.

### What exists today (verified 2026-10-07)

- **MR.** `MaterialRequest` (`apps/api/prisma/schema.prisma:4538-4573`), lines with
  `requestedQuantity`/`approvedQuantity` `Decimal(18,4)` and an optional `estimatedUnitPrice`
  (`:4575-4608`). Statuses `DRAFT · SUBMITTED · APPROVED · PARTIALLY_ORDERED · FULLY_ORDERED ·
  CANCELLED · CLOSED` (`:5071`); transitions in `material-request.service.ts:55-60`. **Nothing writes
  `PARTIALLY_ORDERED`/`FULLY_ORDERED`** — fulfilment is derived at read time from PO allocations
  (`project-procurement.service.ts:326-342, 772-786`). Approve is `POST
  /procurement/material-requests/:id/approve` with `approve:material-request`
  (`material-request.controller.ts:80-89`, PR #276), SoD `APPROVE_MATERIAL_REQUEST`
  (`material-request.service.ts:334-341`).
- **PO.** Header `DRAFT · OPEN · CLOSED · CANCELLED` with immutable revisions (`schema.prisma:4612-4703`).
  An MR feeds a PO only through `mrLineAllocations` on `POST /procurement/purchase-orders`
  (`create-purchase-order.dto.ts:8-16,85-90`; `wireAllocations`, `purchase-order.service.ts:570-617`),
  capped per MR line across all POs. `wireAllocations` does **not** check the MR is APPROVED or in
  the caller's organization (`:583`). There is no draft-line edit endpoint: a PO's lines are set at
  create or by a new revision (`purchase-order.controller.ts:59,125`).
- **PO DoA gate.** `confirm` (`purchase-order.service.ts:176-296`) computes `draftTotal = Σ
  unitPrice × orderedQuantity`, calls `commandGovernance.evaluateStateTransition(identity,
  'PurchaseOrder', 'DRAFT', 'SUBMITTED', po.id, draftTotal)` and `throwIfGated`
  (`command-governance.service.ts:62-123, 167-177`); re-drive per ADR-015. `approvedBy =
  consumed?.finalApproverId ?? identity.userId`. The PO bands (`acco-value-bands.ts:54-76`) are
  cumulative chains (CD → +Finance Officer → +CFO → +CEO) seeded **inactive**; with no active
  binding the resolver returns no gate and confirm proceeds on permission alone.
- **SoD.** `SegregationOfDutiesService` (`platform/workflows/application/segregation-of-duties.service.ts`)
  — a closed `SodAction` union (`:4-12`) and an explicit rule if-chain in `violation()` keyed by
  active, effective-dated `SegregationOfDutiesRule` codes. `ApprovalService.approve`
  (`approval.service.ts:39`) has no initiator ≠ approver check.
- **Files.** `PlatformFile` (ADR-014) with presigned PUT + `x-amz-checksum-sha256` + confirm; the web
  computes SHA-256 in the browser (`apps/web/src/features/files/api/files-api.ts:91-134`) and the row
  stores `checksumSha256` (`schema.prisma:2038`). Lifecycle `TEMPORARY → BOUND → IMMUTABLE`. Owner
  kinds are a closed union in `file-authorization.service.ts:40-51`. Unbound-temp cleanup has no
  caller.
- **PO evidence.** `PurchaseOrderRevisionAttachment` with purpose `QUOTATION`
  (`schema.prisma:4767-4783`), frozen IMMUTABLE on confirm. `PurchaseOrderRevision.quotationRef /
  quotationDate / quotedAmount` exist (`:4683-4685`) but nothing writes them.
- **Notifications.** ADR-031: `Notification` rows with `dedupeKey`, `actionUrl`, `resolvedAt`
  (`schema.prisma:312-337`), produced only by a **daily** flag-gated cron
  (`NOTIFICATIONS_GENERATION_ENABLED`, off in prod). `NotificationKind` has three values (`:292-296`).
  The bell polls every 60 s.
- **Money gating.** `canSeeProcurementMoney` = `view:commitment-ledger`; `moneyOrNull`
  (`business/procurement/shared/procurement-money.ts`, PR #279).
- **Suppliers.** `POST /suppliers` needs `manage:payable` and a caller-supplied unique `code`
  (`supplier.controller.ts:45-71`, `supplier.service.ts:52-53`). `Supplier.createdBy` is the vendor
  maintainer for SoD `CREATE_PURCHASE_ORDER` (vendor maintainer ≠ PO creator, checked at PO create).
- **Buyer advances.** `BuyerAdvance` (`schema.prisma:3349-3381`, migration
  `20260919065930_procurement_v2_model`, `/buyer-advances` with `manage:payable`) requires a PO.
  *Correction:* the brief calls this "ADR-043 procurement v2"; ADR-043 in this repo is the Finance /
  Construction workspaces ADR. Buyer advances have no ADR of their own; this ADR references the
  model and migration directly.
- **No quotation/RFQ concept exists** anywhere in the API.

## Decision

Introduce a **QuotationRequest** aggregate in the procurement bounded context
(`apps/api/src/business/procurement/quotations/`), sitting between an APPROVED MR and its PO.

### 1. Scope of Phase 1 — one request per MR, whole-MR award

- At most **one live QuotationRequest per MR** (live = not `CANCELLED`). Enforced by a partial
  unique index on `(organization_id, material_request_id) WHERE status <> 'CANCELLED'`.
- A request can be opened only on an MR that is `APPROVED` and has **no PO allocations yet**.
- The award covers **the whole MR**: one supplier, one total, one PO. Partial awards (different
  lines to different stores) are out of scope; the workaround is to split the MR before approval.
- The MR's stored status is not changed by this feature (it is derived from allocations today, and
  this ADR does not reopen that). The MR detail shows the request's state.

### 2. Aggregate design

```
QuotationRequest (quotation_requests)
  id, organizationId, number (QR-00001, unique per org)
  materialRequestId            → MaterialRequest (one live per MR)
  projectId?                   copied from the MR (list filters, notification context)
  currencyCode                 MR.currencyCode ?? 'USD'
  status                       COLLECTING | AWAITING_DECISION | RETURNED |
                               AWARD_PENDING_APPROVAL | AWARDED | CANCELLED
  urgent                       MR.priority = URGENT at open (SLA clock basis, Phase 2)
  estimateAmount?              Σ qty × estimatedUnitPrice when EVERY line is priced, else null
  requiredQuoteCount           3 or 1, recomputed on send and at award (§4)
  exceptionReason?             ONLY_ONE_SUPPLIER | URGENT | FRAMEWORK_SUPPLIER   (set on send)
  exceptionAcceptedBy/At?      the selector who accepted it (at award)
  returnNote?, returnedBy/At?  "Ask for another quote"
  sendCount                    increments on each send (notification dedupe, SLA cycles)
  firstSentAt?, sentAt?        sentAt = latest send; the SLA clock starts here
  decidedAt?                   award (or ask-another) time — closes the SLA clock
  proposedQuoteId?, proposedBy/At?, proposedPaymentPath?, proposedNonLowestReason?/Note?
                               the choice awaiting DoA approval (AWARD_PENDING_APPROVAL)
  awardedQuoteId?, awardedTotal? Decimal(18,2), awardedSupplierId?
  awardedBy?, awardedAt?, awardApprovalInstanceId?, awardFinalApproverId?
  nonLowestReason?             FASTER_DELIVERY | BETTER_QUALITY | HAS_STOCK | OTHER
  nonLowestNote?               required when OTHER
  paymentPath?                 BUYER_CASH | FINANCE_PAYS_SUPPLIER   (recorded only in Phase 1)
  purchaseOrderId? (unique)    the PO raised from the award
  cancelledBy/At?, cancelReason?
  createdBy, createdAt, updatedAt

Quote (quotation_quotes)
  id, organizationId, quotationRequestId
  supplierId?  XOR  storeName? (VarChar 120)    a registered supplier or a new store
  storeKey                       normalised identity for the distinct-supplier rule (§4)
  status                         ACTIVE | WITHDRAWN | REJECTED
  rejectReason?                  ILLEGIBLE | WRONG_ITEMS | INCOMPLETE | OTHER, rejectNote?
  enteredTotal? Decimal(18,2), enteredBy?, enteredAt?   — typed by FINANCE only
  uploadedBy                     the collector (procurement)
  clientRef (uuid)               idempotency key from the phone's upload queue
  replacesQuoteId?               set when a photo replacement after send creates a new quote
  createdAt, updatedAt

QuotePhoto (quotation_quote_photos)
  id, organizationId, quoteId, platformFileId (unique), pageNumber
  sha256 (char 64)               copy of PlatformFile.checksumSha256 at bind time (evidence)
  capturedAt                     device time at capture (client-reported)
  receivedAt                     server time at bind
  source                         CAMERA | GALLERY | UNKNOWN (best-effort, §9)
  uploadedBy
```

Money is `Decimal(18,2)` (header totals) per the schema convention; no quantities live on the
quote (it prices the whole MR). No soft delete: retirement is a status, as elsewhere.

### 3. State machine

```
                     add/withdraw quotes
                    ┌──────────┐
   open ──► COLLECTING ──send──► AWAITING_DECISION ──award (not gated)──────────► AWARDED
               ▲    ▲               │   │   │                                       │  │
               │    └──reopen───────┘   │   └─award (gated)─► AWARD_PENDING_APPROVAL │  │ raise order
               │      (collector)       │                     │  ├─re-drive (approved)─┘  │ (PO link)
               │                        │                     │  └─withdraw-award──► AWAITING_DECISION
            RETURNED ◄──ask-another─────┘                     │
               │  (selector)                                  │
               └──send──► AWAITING_DECISION                   │
                                                              │
   AWARDED (no confirmed PO) ──request-redecision──► AWAITING_DECISION
   any state except AWARDED-with-confirmed-PO ──cancel──► CANCELLED
```

| From | Command | To | Who |
|---|---|---|---|
| — | open | COLLECTING | collector |
| COLLECTING, RETURNED | add quote / add page / withdraw quote | same | collector |
| COLLECTING, RETURNED | send | AWAITING_DECISION | collector |
| AWAITING_DECISION | reopen (to add or replace a photo) | COLLECTING | collector |
| AWAITING_DECISION | enter total / reject quote | same | selector |
| AWAITING_DECISION | ask for another quote | RETURNED | selector |
| AWAITING_DECISION | award | AWARDED, or AWARD_PENDING_APPROVAL if the DoA gates | selector |
| AWARD_PENDING_APPROVAL | award (re-drive, ADR-015) | AWARDED once the instance is APPROVED | selector or any award holder |
| AWARD_PENDING_APPROVAL | withdraw award | AWAITING_DECISION (instance voided) | selector or any award holder |
| AWARDED (PO absent or CANCELLED, never confirmed) | request re-decision | AWAITING_DECISION | collector or selector |
| AWARDED (PO absent or CANCELLED) | raise order | AWARDED + `purchaseOrderId` | collector holding `create:purchase-order` |
| any but AWARDED with a confirmed PO | cancel | CANCELLED | collector or selector |

Every command is a compare-and-set on `status` inside one transaction that takes the request's row
lock (`SELECT … FOR UPDATE`), re-checks, writes, and records an audit event through
`TransactionalAuditOutboxService.record(tx, …)` (`QUOTATION_OPENED`, `QUOTE_ADDED`,
`QUOTE_WITHDRAWN`, `QUOTATION_SENT`, `QUOTATION_REOPENED`, `QUOTE_TOTAL_ENTERED`, `QUOTE_REJECTED`,
`QUOTATION_RETURNED`, `QUOTATION_AWARD_PROPOSED`, `QUOTATION_AWARDED`, `QUOTATION_AWARD_WITHDRAWN`,
`QUOTATION_REDECISION_REQUESTED`, `QUOTATION_ORDER_RAISED`, `QUOTATION_CANCELLED`). Idempotency keys
carry the request's `updatedAt` (the ADR-043 lesson: repeated cycles must not collide on the
outbox's unique key).

### 4. Invariants

1. **Frozen once sent.** In `AWAITING_DECISION`, `AWARD_PENDING_APPROVAL` and `AWARDED` no quote or
   photo can be added, withdrawn or replaced. Changing evidence after sending requires `reopen`
   (audited, reason required), which also resolves the selectors' "quotes ready" notification.
   Replacing a photo creates a **new** quote (`replacesQuoteId` → old, old becomes `WITHDRAWN`);
   nothing is overwritten. A quote's `enteredTotal` belongs to that quote, so a replaced quote
   starts with no total.
2. **Photos are immutable evidence.** On `send`, every photo of every ACTIVE quote moves its
   `PlatformFile` to `IMMUTABLE`. Photos of WITHDRAWN quotes stay `BOUND` and are retained.
3. **Only finance creates numbers.** `enteredTotal` is writable only through the selector's command
   (`award:quotation`), only in `AWAITING_DECISION`, and only by a user who passes the SoD rules in
   §6. No collector endpoint accepts a money field.
4. **Award preconditions.** Every ACTIVE quote has an `enteredTotal > 0`; the chosen quote is ACTIVE.
   `lowest` = minimum `enteredTotal` over ACTIVE quotes (ties: every tied quote is lowest). Choosing
   a quote that is not lowest requires `nonLowestReason` (and `nonLowestNote` for `OTHER`).
5. **Quote count rule.** `required = 3` if `(estimateAmount known and > 100.00)` or `awardedTotal >
   100.00`, else `1`; `distinct` = number of distinct `storeKey` among ACTIVE quotes. `storeKey` is
   `supplier:<id>` for a registered supplier and `name:<lower(trim(collapse-spaces(storeName)))>`
   for a new store; a new-store name equal (by the same normalisation) to a registered supplier's
   name in the org resolves to that supplier's key at add time. If `distinct < required` the request
   must carry an `exceptionReason` (chosen by the collector at send) **and** the award must set
   `acceptException = true` (recorded as `exceptionAcceptedBy/At`). On send with an unknown
   estimate the UI asks for 3; the server allows fewer only with a reason.
6. **Duplicate photo.** A `sha256` may appear on only one ACTIVE quote within a request (409
   `QUOTE_PHOTO_DUPLICATE`). The same hash on another request in the org is not refused but is
   flagged on the decision read model (`reusedOn: [QR-…]`).
7. **One live request per MR; one PO per award.** `purchaseOrderId` is unique; raise-order refuses
   when a non-cancelled PO is linked.
8. **PO total ≤ awarded total** — enforced at raise-order and again at PO confirm (§8).

### 5. Authorization — two new permissions

| Key | Meaning | Risk (`riskFor`) | Granted to |
|---|---|---|---|
| `collect:quotation` | open a request, add/withdraw quotes and photos, send, reopen, request re-decision, cancel, raise order (with `create:purchase-order`) | LOW by the verb table; set explicitly to **MEDIUM** in `riskFor` (`collect` added next to `create`) | Procurement Manager |
| `award:quotation` | enter totals, reject a quote, ask for another quote, award (incl. accept exception, pick payment path), withdraw award, request re-decision, cancel | **CRITICAL** (`award` added next to `approve`) — it sets the price money flows from | Finance Officer, CFO, CEO |

Reads: the list and detail endpoints require `view:procurement` plus either quotation permission.
Money fields (estimate, entered totals, awarded total, lowest flag) are returned through
`moneyOrNull` when the caller holds `view:commitment-ledger` **or** `award:quotation`; otherwise
`null` with `moneyVisible: false` (PR #279 pattern). Photos are money (they show supplier prices), so
the new file owner kind `QUOTATION_PHOTO` is readable only with `view:procurement` **and**
`view:commitment-ledger`, plus project access (membership or a project-access bypass role) for a
project's quotation — never by `view:procurement` alone. The same rule follows a winning photo when
it is attached to the PO as quotation evidence (other `PO_REVISION_ATTACHMENT`s keep
`view:procurement`). The detail returns photo ids only when the caller passes it (`photosVisible`).
*(Amended 2026-10-07 after review: the first draft also admitted `collect:`/`award:quotation`
without cost visibility.)*
ADMIN is re-linked to every catalogue permission on deploy, as today.

**Why not reuse `approve:material-request`?** It is held by people who approve *need* (Construction
Director, Project Manager, Finance Officer after PR #276). Awarding sets the *price* and stands in
for PO approval — a different act at a different risk. Reusing it would let money-blind Project
Managers award. **Why not reuse `create:purchase-order` for collecting?** Collecting quotes should
be delegable to a field buyer who cannot issue orders; raise-order still requires
`create:purchase-order` on top.

Role grants reach existing tenants through a targeted, idempotent seed
(`prisma/seeds/grant-quotation-permissions.seed.ts`, the `grant-finance-mr-approval.seed.ts`
pattern), and new tenants through `acco-team-roles.seed.ts` (Procurement Manager, Finance Officer)
and `scripts/governed-roles.ts` (CFO, CEO). The Construction Director is **not** granted
`award:quotation` (see Open questions).

### 6. Segregation of duties

New `SodAction` `SELECT_QUOTATION`, new context field `quoteUploaderUserIds?: string[]`, and two
new rule codes in the `violation()` chain, seeded active with the ACCO SoD policy version:

- `QUOTE_UPLOADER_CANNOT_SELECT` — the actor is not the request's creator nor the uploader of any
  quote or photo on it (including WITHDRAWN quotes: having touched the evidence is enough).
- `REQUESTER_CANNOT_SELECT` — the actor is not the MR's `requestedBy`.

`SELECT_QUOTATION` is evaluated server-side on: entering a total, rejecting a quote, ask-another,
award (propose and re-drive), and accept-exception. On award re-drive it is also evaluated for
**every approver** recorded on the award's `ApprovalInstance` (its `ApprovalAction` actors) before
the instance is consumed; a violation answers 403 and voids the instance, so a clean chain must be
re-run. This closes the gap that `ApprovalService.approve` has no initiator ≠ approver check,
without coupling the generic approval engine to procurement (the ADR-015 objection to callbacks).
The existing `CREATE_PURCHASE_ORDER` rule (vendor maintainer ≠ PO creator) still applies at
raise-order, which is why §8 makes the selector — not the collector — register a new store.

### 7. DoA — the award is the PO approval

- **New governed transition** `QUOTATION_AWARD: AWAITING_DECISION → AWARDED`
  (`WorkflowTransactionType.QUOTATION_AWARD`, registry entry in `policy-transition-registry.ts`,
  `GovernedEntity` `QuotationRequest`), valued at the chosen quote's `enteredTotal`.
- **Bands = the PO bands.** `accoQuotationAwardBands()` returns `accoPurchaseOrderBands()` verbatim
  (one source of numbers and chains) bound to the new transition, seeded **inactive** alongside the
  PO bands and activated by the same per-org step (`dev-activate-doa-bands.seed.ts` for dev; the
  owner's go-live step for prod). Activating one without the other is refused by the activation
  seed (they are one control).
- **Bands inactive (today):** no binding → no gate → the award completes on `award:quotation` + SoD.
  This is exactly the authority a PO has today (confirm proceeds on `create:purchase-order`), so
  the feature never weakens the current control; the improvement is that the price setter is now
  finance and not the buyer.
- **Bands active:** `award` persists the choice (`proposed*`, status `AWARD_PENDING_APPROVAL`) in one
  transaction, then calls `evaluateStateTransition`. If an instance opens and the selector holds the
  role of the instance's current step, the award command records the selector's approval of that
  step in the same request (**selection counts as the selector's approval**) and re-evaluates. If
  the instance is fully approved the award completes; otherwise the response is the standard 409
  `{ approvalInstanceId }`, approvers act through the existing workflow endpoints, and the selector
  (or any award holder) re-drives `award` (ADR-015). Chains are cumulative (CD → Finance Officer →
  CFO → CEO), as ADR-022 seeds them; this ADR does not change them.
- **No second approval on the PO.** PO `confirm` gains an **award-coverage check** before it calls
  governance (pure policy `awardCoverage()` in `purchase-orders/domain/`, data read by the PO
  repository from `quotation_requests` by `purchase_order_id` under the request's row lock — no
  module import cycle). The PO is *covered* when all hold:
  1. the request is `AWARDED` and its `purchaseOrderId` is this PO;
  2. this is the PO's first activation (no revision was ever ACTIVE) — amendments go through the
     normal gate;
  3. the PO's supplier is the awarded supplier;
  4. every draft line allocates to a line of the request's MR (no foreign lines);
  5. `draftTotal ≤ awardedTotal`.

  Covered → governance is **not** evaluated; the revision records `approvalInstanceId =
  awardApprovalInstanceId` (null when bands were inactive) and `approvedBy = awardFinalApproverId ??
  awardedBy`; the audit event `PO_CONFIRMED` carries `reason: "Covered by quotation award QR-…"`.
  If 1–4 hold but 5 fails → **409 `PO_EXCEEDS_AWARD`** (never a fall-back to the gate, which would
  be a no-op while bands are inactive). If 1 fails the PO is not from an award and the existing gate
  runs unchanged.
- **Effective-dating.** An award is judged by the rules in force when it was made (ADR-008); a band
  activated between award and confirm does not re-gate the covered PO.

### 8. PO from award ("Raise the order")

- **Supplier.** A registered supplier must be ACTIVE. A new store is **registered by the selector
  inside the award transaction**: `Supplier { name: storeName, code: auto 'QS-' + 5-digit sequence,
  status ACTIVE, createdBy: selector }`, audited `SUPPLIER_CREATED_FROM_QUOTATION`. This requires the
  selector to hold `manage:payable` (Finance Officer does, `acco-team-roles.seed.ts:172`); otherwise
  the award answers 403 `SUPPLIER_REGISTRATION_REQUIRES_PAYABLES`. The decision read model lists
  likely existing matches (same normalised name) so the selector can award to an existing supplier
  instead (`awardSupplierId`). Rationale: the collector registering the store would make them the
  vendor maintainer and the SoD rule `CREATE_PURCHASE_ORDER` would then block their own PO — and it
  is the right control anyway (the buyer should not create the vendor they pay).
- **Lines.** One PO line per MR line, carrying `materialId`, `description`, `unitOfMeasureId`,
  `spendCategoryId`, the MR's `projectId` + line `boqNodeId` (cost-target policy unchanged), and an
  MR allocation of the line's approved (else requested) quantity.
- **Price split.** If **every** MR line has an estimate: line amount `aᵢ = awardedTotal × eᵢ / Σe`
  where `eᵢ = qtyᵢ × estimatedUnitPriceᵢ`; `unitPriceᵢ = floor₄(aᵢ / qtyᵢ)` (4 dp, rounded down), so
  `Σ unitPrice × qty ≤ awardedTotal` by construction (the shortfall is < `qty × 0.0001` per line).
  If the MR has **one line**, it takes the whole total. Otherwise (some line unpriced, several
  lines) the server cannot split honestly — splitting by quantity share across different units is
  meaningless — so the collector enters line amounts within the total.
- **Adjustment.** There is no PO draft-line edit endpoint, so adjustment happens before the PO
  exists: `raise-order` accepts optional `lines[{ materialRequestLineId, quantity, amount }]`
  (quantity ≤ the MR line's remaining quantity; Σ amount ≤ awardedTotal; lines may be dropped, none
  added). Without `lines` the server uses the split above (one tap). To change a raised draft:
  cancel the draft PO, then raise again (allowed while the PO was never confirmed).
- **Evidence.** In the same transaction the winning quote's photos are attached to revision 1 as
  `PurchaseOrderRevisionAttachment { purpose: QUOTATION, supplierRef: QR number }` (an internal
  repository path; the public attach endpoint's "TEMPORARY and uploaded by you" rule does not apply
  to already-immutable evidence), and the revision's `quotationRef = QR-…`, `quotationDate =
  winning photo capturedAt (date)`, `quotedAmount = awardedTotal` are written — first use of those
  columns.
- **Over the cap.** Exceeding the award is refused at raise-order (422) and at confirm (409). The
  route back to finance is `request-redecision` (AWARDED → AWAITING_DECISION, award cleared,
  audited), available while no PO has been confirmed.
- **Hardening found on the way:** `wireAllocations` gains `organizationId` + `status = APPROVED`
  checks on the MR line it loads (`purchase-order.service.ts:583`). Raise-order relies on them.

### 9. Anti-fraud properties — and their limits

What the design guarantees:
- The buyer never enters a price; every number is typed by an SoD-separated selector looking at the
  photo, and both the photo and the typed total are retained and audited.
- Evidence cannot change after it is sent without an audited reopen; files are IMMUTABLE and
  SHA-256 verified by the object store on upload (`x-amz-checksum-sha256`) and recorded on the quote
  photo.
- One photo cannot pose as two quotes; one store cannot count twice; the PO cannot exceed the award;
  the PO carries the winning photo.

What it does **not** guarantee (recorded so nobody assumes otherwise):
- **Camera vs gallery cannot be enforced on the web.** `capture="environment"` *requests* the camera;
  browsers may still offer the gallery and a sent file carries no trustworthy provenance. `source`
  is best-effort: `CAMERA` when the file came through the capture input and its `lastModified` is
  within 2 minutes of the client's selection time, `GALLERY` when it came through the gallery
  picker, else `UNKNOWN`. It is shown to the selector as a hint, never as proof.
- **Client-side downscale strips EXIF**, so capture time and location are device-reported, not
  photo-embedded. The stored hash is of the downscaled bytes.
- **A quote can be fabricated on paper.** The control is the selector's judgment, the side-by-side
  view, the reused-photo flag, and the after-the-fact audit; field verification is out of scope.
- **A selector can mistype or mis-enter totals.** The photos remain beside the numbers for review;
  the PO cap is the awarded total, so understating harms nobody but the requester.

### 10. Notifications — event-driven writes, Phase 2 seam

ADR-031's generator is a daily scan behind a flag; quotations need minutes. Phase 1 adds a small
**`NotificationWriter`** (`platform/notifications/application/notification-writer.service.ts`)
that upserts `Notification` rows **inside the caller's transaction** with the ADR-031 conventions
(`dedupeKey` unique per recipient, `actionUrl`, `contextData` = interpolation values only, no
amounts) and resolves rows by `(resourceType, resourceId, kinds)`. It is not gated by
`NOTIFICATIONS_GENERATION_ENABLED`, which keeps governing the cron generator only. New kinds:

| Kind | When | Recipients | Resolved when |
|---|---|---|---|
| `QUOTES_READY` | send | active holders of `award:quotation`, minus anyone barred by §6 | award, ask-another, reopen, cancel |
| `QUOTATION_AWARDED` | award completes | the request creator + quote uploaders | order raised, cancel |
| `ANOTHER_QUOTE_REQUESTED` | ask-another | the request creator + quote uploaders | next send, cancel |

`dedupeKey` = `quotation:<id>:<kind>:<sendCount>`; `actionUrl` = `/finance/quotes/<id>` for
selectors, `/procurement/quotes/<id>` for collectors. Recipients are **all award holders**, not
band-specific: the value is unknown until finance types the totals (the buyer enters no price), so
band routing at send time is impossible; band-specific routing happens through the award's approval
instance when bands are active.

Each event is also recorded as an audit-outbox event (§3), which is the **Phase 2 seam**: a WhatsApp
dispatcher (ADR-042) consumes `QUOTATION_SENT` / `QUOTATION_AWARDED` / `QUOTATION_RETURNED` and an
SLA job (copying ADR-031 Decision 3's tenancy pattern) computes working-time waiting from `sentAt`:
reminder to award holders at 2 working hours, escalation to CFO + CEO at 4. Phase 1 ships the pure
**working-time function** (`quotation-sla.policy.ts`: Sat–Thu 07:00–17:00 `Africa/Mogadishu`;
`urgent` requests count clock hours; public holidays out of scope) because the finance inbox already
colours waiting time (amber ≥ 2 h, red ≥ 4 h). `sentAt` and `decidedAt` are stored so the SLA is
computable after the fact.

### 11. Payment path

`paymentPath` (`BUYER_CASH` | `FINANCE_PAYS_SUPPLIER`) is required on award and recorded only.
Phase 3 executes it: `BUYER_CASH` → a `BuyerAdvance` against the raised PO
(`/buyer-advances`, `manage:payable`); `FINANCE_PAYS_SUPPLIER` → the normal bill → payment path.
Phase 1 shows the choice on the request and the PO, nothing more.

### 12. API

All under `/procurement/quotation-requests`, class-gated `view:procurement`; method gates below
(method lists replace class lists — `permissions.guard.ts:22` — so each lists `view:procurement`
explicitly). Commands return the request detail read model.

| Method & path | Permission | Body → result |
|---|---|---|
| `POST /` | collect | `{ materialRequestId }` → detail; returns the existing live request (200) instead of a duplicate |
| `GET /` | view + (collect ∨ award) | `?queue=collect\|returned\|waiting\|decide\|awarded\|all&projectId&q&page` → rows `{ id, number, mr: {id, number, title}, project?, status, quoteCount, distinctSupplierCount, requiredQuoteCount, exceptionReason, urgent, sentAt, waitingWorkingMinutes, slaTone: none\|amber\|red, estimateAmount*, lowestTotal*, awardedTotal*, moneyVisible }` |
| `GET /:id` | view + (collect ∨ award) | detail: request, MR lines (qty, uom, estimate*), quotes `[{ id, store {supplierId?, name, registered}, status, photos [{ fileId, pageNumber, capturedAt, source, sha256, reusedOn[] }], enteredTotal*, enteredBy, isLowest* }]`, `supplierMatches[]` for new stores, `approval?` (instance id/status/current step), `allowedActions[]` with reasons, `moneyVisible` |
| `POST /:id/quotes` | collect | `{ clientRef, supplierId? \| storeName?, photos: [{ platformFileId, capturedAt, source }] }` → idempotent on `clientRef` |
| `POST /:id/quotes/:quoteId/photos` | collect | `{ platformFileId, capturedAt, source }` (extra page) |
| `POST /:id/quotes/:quoteId/withdraw` | collect | — |
| `POST /:id/send` | collect | `{ exceptionReason? }` |
| `POST /:id/reopen` | collect | `{ reason }` |
| `PUT /:id/quotes/:quoteId/total` | award | `{ total: "1234.50" }` |
| `POST /:id/quotes/:quoteId/reject` | award | `{ reason, note? }` |
| `POST /:id/ask-another` | award | `{ note }` |
| `POST /:id/award` | award | `{ quoteId, paymentPath, nonLowestReason?, nonLowestNote?, acceptException?, awardSupplierId? }`; re-drive with the same body (or `{}`) → 200 AWARDED, or 409 `{ approvalInstanceId }` |
| `POST /:id/withdraw-award` | award | — |
| `POST /:id/request-redecision` | collect ∨ award | `{ reason }` |
| `GET /:id/order-draft` | collect + `create:purchase-order` | `{ supplier, awardedTotal, splitMode: ESTIMATE\|SINGLE_LINE\|MANUAL, lines[{ materialRequestLineId, description, quantity, maxQuantity, uom, amount?, unitPrice? }] }` |
| `POST /:id/raise-order` | collect + `create:purchase-order` | `{ lines?, expectedDeliveryDate?, deliveryAddress? }` → `{ purchaseOrderId }` |
| `POST /:id/cancel` | collect ∨ award | `{ reason }` |

`*` = money, `null` unless visible. Errors: 404 for another org's id; 409 for state conflicts with
a machine `code` (`QUOTATION_NOT_COLLECTING`, `QUOTATION_FROZEN`, `QUOTE_PHOTO_DUPLICATE`,
`QUOTE_COUNT_EXCEPTION_REQUIRED`, `QUOTE_TOTALS_MISSING`, `NON_LOWEST_REASON_REQUIRED`,
`PO_EXCEEDS_AWARD`, …); 403 with the SoD rule code. Photos upload through the existing `POST /files`
presign → PUT → confirm, then bind via the quote endpoints (owner kind `QUOTATION_PHOTO`).

### 13. Migration plan

One additive migration `2026100xxxxxxx_procurement_quotations`: tables `quotation_requests`,
`quotation_quotes`, `quotation_quote_photos`; enums `QuotationRequestStatus`, `QuoteStatus`,
`QuoteRejectReason`, `QuoteCountExceptionReason`, `NonLowestReason`, `QuotationPaymentPath`,
`QuotePhotoSource`; `WorkflowTransactionType` + `QUOTATION_AWARD`; `NotificationKind` +
`QUOTES_READY`, `QUOTATION_AWARDED`, `ANOTHER_QUOTE_REQUESTED`; the partial unique index for one
live request per MR; indexes `(organization_id, status, sent_at)`. No change to existing tables
(the PO link lives on the request). No backfill. Seeds: SoD rule codes, award bands (inactive),
permission grants — each targeted and idempotent for the live tenant.

## Out of scope

Partial awards and multiple requests per MR · OCR of quotes · supplier-facing RFQs ·
executing the payment path (Phase 3) ·
offline-first PWA/service worker (Phase 1 keeps a page-lifetime IndexedDB upload queue, not a
service worker) · writing MR `PARTIALLY_ORDERED`/`FULLY_ORDERED` · public-holiday calendar ·
multi-currency quotes within one request · cleanup of unbound temporary files (pre-existing gap).

## Consequences

- Procurement price-setting moves from buyer to finance; the PO from an award is pre-approved by
  the award and cannot exceed it.
- The PO confirm path gains one pure check before governance; non-award POs are unchanged.
- The approval engine is untouched; the award-specific SoD is enforced in the award command,
  including over the instance's approvers.
- First event-driven notifications in the system; the `NotificationWriter` is reusable by other
  modules that need immediacy.
- First image capture/downscale path and first persistent client upload queue in the web app.
- New money-bearing file owner kind with a stricter read rule than PO attachments.

## Phase 2 — WhatsApp alerts to staff and the SLA chaser (built 2026-10-07)

Locked by the product owner 2026-10-07. Spec addendum: `docs/specs/procurement-quotations-phase1.md`
§0b. Template texts: `docs/integrations/whatsapp-templates.md` §5–9.

1. **Five staff alerts, in Somali** (registered at Meta under language `en`; Somali is not a Meta
   template language). Template names default to `quote_ready_so`, `quote_reminder_so`,
   `quote_escalation_so`, `quote_chosen_so`, `quote_another_so`, overridable by
   `WHATSAPP_TEMPLATE_QUOTE_READY|REMINDER|ESCALATION|CHOSEN|ANOTHER`; language
   `WHATSAPP_TEMPLATE_QUOTE_LANGUAGE` (default `en`). Each has one dynamic-URL button whose suffix is
   the request id; the base URL (the tenant's web address + `/finance/quotes/` or
   `/procurement/quotes/`) is part of the Meta template, so the server never builds a host name.
   **No message carries a price or a total.**

   | Purpose | When | To |
   |---|---|---|
   | `QUOTE_READY` | send; re-decision | the in-app `QUOTES_READY` audience (award holders with project access, minus SoD-barred) |
   | `QUOTE_REMINDER` | ≥ 2 working hours AWAITING_DECISION | the same selectors |
   | `QUOTE_ESCALATION` | ≥ 4 working hours | active holders of the roles named `CFO` / `CEO` who can reach the project |
   | `QUOTE_CHOSEN` | award completes | the request creator + quote uploaders (the in-app `QUOTATION_AWARDED` audience) |
   | `QUOTE_ANOTHER` | ask-another | the same collectors, with finance's note (one line, ≤ 200 chars) |

2. **Opt-in per person.** `User.whatsappPhone` (E.164, validated by libphonenumber, CHECK in SQL) and
   `User.whatsappAlertsEnabled` (default false), edited by admins in Administration → Users through
   the existing `PATCH /users/:id` (`manage:users`); alerts can only be on with a number, and the
   change is audited with the number masked. Only ACTIVE users with both get WhatsApp; the in-app
   notification is unchanged for everyone.

3. **Queue, never inline.** Alerts are `OutboundMessage` rows (channel WHATSAPP, the new purposes,
   `resourceType = quotation_request`, `recipientUserId`, `templateParams = { body, buttonUrlSuffix }`,
   `nextAttemptAt`) written by `QuotationWhatsAppAlerts` inside the quotation command's transaction
   (atomic with the event), under a SAVEPOINT so a failing insert is rolled back alone and logged —
   it can never fail or block the action. `INSERT … ON CONFLICT DO NOTHING` on the existing
   `(organization_id, idempotency_key)` unique key; key =
   `quotation-wa:<requestId>:<purpose>:<round>:<userId>`, so each person gets each alert once per
   round. Round = `<sendCount>.<sentAt ms>` for selector alerts (a re-send after ask-another and a
   re-decision each start a new round; a withdrawn award does not), `sendCount` for ask-another, the
   award instant for chosen.

4. **Background sender** (`platform/messaging/OutboundMessageDispatcher`, `@nestjs/schedule` every
   minute, every ACTIVE tenant inside `tenancyStorage.run` — ADR-031 Decision 3). Picks only rows
   with `nextAttemptAt` set (client invoices/receipts stay synchronous and are never picked up),
   claims each with a 5-minute lease (`attemptCount + 1`), then: older than 12 h → FAILED `EXPIRED`;
   the owning feature's **dispatch guard** says it is no longer wanted → FAILED `NOT_NEEDED`
   (quotation: selector alerts need AWAITING_DECISION in the same round, chosen needs AWARDED,
   another needs RETURNED, nothing for a cancelled request or when the kill switch is off) → send.
   `RATE_LIMITED` / `NETWORK` / `PROVIDER_ERROR` retry after 1, 2, 5, 15 min, FAILED after 5
   attempts; other refusals fail at once; an unanswered send is UNKNOWN and never retried (ADR-042
   item 4). Sent rows follow ADR-042's provider-id → route → SENT order, so the existing webhook moves
   them to DELIVERED / READ / FAILED. Background sends are not audited (no acting user, as for
   webhooks); the row is the record. A process dying mid-send retries after the lease (at-least-once
   in that crash only).

5. **SLA chaser** (`QuotationSlaAlertJob`, every 5 minutes, every tenant): for each request
   AWAITING_DECISION, `waitingMinutes(sentAt, now, urgent)` (the Phase 1 working-time function: Sat–Thu
   07:00–17:00 Africa/Mogadishu, urgent = clock hours) ≥ 120 → reminder, ≥ 240 → escalation. A
   non-urgent request is never chased outside working hours (also covers a missed run). Re-checked
   under a fresh read inside the job's transaction; the dispatch guard covers a decision made between
   queueing and sending.

6. **Switches.** `QUOTATION_WHATSAPP_ENABLED` (default **false**): unless `true`, nothing is queued,
   the SLA job does nothing, and queued alerts are withdrawn at dispatch. If WhatsApp itself is not
   configured (`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`), nothing is queued and the
   dispatcher skips, each with one log line.

7. **Delivery log.** The request detail gains `messages: [{ id, recipientName, recipientPhoneMasked
   ('…678'), purpose, status, queuedAt, sentAt, deliveredAt, readAt, failedAt, failureReason }]`
   (oldest first) for everyone who can open the detail (collect ∨ award holders). No full number, no
   text, no amounts. The web shows it as a compact "WhatsApp" section on the decision and capture
   screens.

**Migration** `20261011120000_quotation_whatsapp_alerts` (additive): `MessagePurpose` + 5 values;
`outbound_messages` + `recipient_user_id`, `template_params`, `attempt_count`, `next_attempt_at`,
index `(status, next_attempt_at)`; `users` + `whatsapp_phone` (E.164 CHECK), `whatsapp_alerts_enabled`.

**Not in Phase 2:** public holidays · per-person quiet hours · replies from staff (the webhook still
only reads statuses) · a retry button for FAILED alerts · a profile page for staff to set their own
number (none exists; admins set it) · rename-proof CFO/CEO matching (role names, as elsewhere).

## Open questions for the product owner

1. **Should the Construction Director hold `award:quotation`?** ADR-022's ≤ $100 band names the CD
   (or PM). Default here: no — finance selects, and the PM is money-blind. With bands active the CD
   approves every award anyway as step 1 of each chain. Grant the CD only if ACCO wants the CD to be
   able to *choose* small purchases.
2. **New-store registration by a selector without `manage:payable`** (e.g. a CEO selecting) is
   refused. Acceptable, or should the award succeed and leave registration to a Finance Officer
   before raise-order?
