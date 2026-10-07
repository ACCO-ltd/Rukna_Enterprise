# Procurement quotations — Phase 1 spec and build tickets

Implements **ADR-044** (`docs/adr/ADR-044-procurement-quotations.md`). Read the ADR first: it owns
the aggregate, invariants, state machine, SoD, DoA and API decisions. This document is the testable
contract and the build order. (`docs/specs/` is new; earlier specs live in `docs/design/` and
`docs/reference/`.)

Phase 1 = collect photos → finance types totals and chooses → award (= PO approval) → raise the
order, with in-app notifications and SLA colouring. Not Phase 1: WhatsApp, SLA reminders and
escalation, executing the payment path, partial awards, OCR.

---

## 0. Contract summary

### Actors

| Actor | Role (ACCO) | Permissions used |
|---|---|---|
| Collector | Procurement Manager (field buyer) | `view:procurement`, `collect:quotation`, `create:purchase-order` (raise order only) |
| Selector | Finance Officer, CFO, CEO | `view:procurement`, `award:quotation`, `manage:payable` (to register a new store) |
| Approver (bands active only) | role holders of the award chain step | existing workflow approval endpoints |
| Requester | whoever raised the MR | — (barred from selecting) |

### Success scenarios (numbered for test traceability)

- **S1** An APPROVED MR with no PO allocation → collector taps *Get quotes* → request `COLLECTING`
  (repeat taps return the same request).
- **S2** Collector photographs three stores' quotes (one or more pages each), picks a store chip per
  quote, taps *Send to finance* → `AWAITING_DECISION`; photos `IMMUTABLE`; every award holder (minus
  the barred) gets `QUOTES_READY`.
- **S3** Collector with 1 quote on an MR estimated > $100 must pick an exception chip before send.
- **S4** Selector opens the link, types each total, sees the lowest highlighted, taps *Choose* on the
  lowest, picks the pay-by option → `AWARDED` (bands inactive) and collector gets `QUOTATION_AWARDED`.
- **S5** Choosing a non-lowest quote requires a reason chip (OTHER requires text).
- **S6** *Ask for another quote* with a note → `RETURNED`; collector notified; collector adds a quote
  and sends again → `AWAITING_DECISION` (new `QUOTES_READY` cycle).
- **S7** Collector taps *Raise the order* → DRAFT PO with the awarded supplier, MR lines, pro-rata
  prices, Σ ≤ award, winning photos attached; *Issue order* confirms without any approval instance.
- **S8** Bands active: award of $5,000 by a Finance Officer → instance opens on chain CD → FO → CFO;
  the FO step is recorded as the selector's approval; CD and CFO approve; re-drive → `AWARDED`; the
  PO confirm is covered.
- **S9** An unregistered store wins → the award registers the supplier (createdBy = selector); the
  collector can raise and confirm the PO (vendor-maintainer SoD passes).

### Refusal scenarios

- **R1** Uploader or MR requester attempts to enter a total / award → 403 `QUOTE_UPLOADER_CANNOT_SELECT`
  / `REQUESTER_CANNOT_SELECT`.
- **R2** Adding a photo in `AWAITING_DECISION` → 409 `QUOTATION_FROZEN`.
- **R3** Same photo hash on two quotes of one request → 409 `QUOTE_PHOTO_DUPLICATE`.
- **R4** Award with a quote lacking a total → 409 `QUOTE_TOTALS_MISSING`.
- **R5** Fewer distinct stores than required without exception + acceptance → 409
  `QUOTE_COUNT_EXCEPTION_REQUIRED`.
- **R6** Raise-order lines summing above the award → 422 `PO_EXCEEDS_AWARD`; a confirm whose draft
  exceeds the award → 409 `PO_EXCEEDS_AWARD`.
- **R7** A second live request on the same MR → returns the existing one (no duplicate row).
- **R8** Opening a request on a non-APPROVED MR or one with PO allocations → 409.
- **R9** An approver on the award instance who uploaded a quote → re-drive 403, instance voided.
- **R10** Money-blind caller (no `view:commitment-ledger`, no `award:quotation`) → money fields
  `null`, photos 403.

---

## 0a. API as implemented (backend Q1–Q8, 2026-10-07)

The binding wire contract for the frontend tickets. Base path `/procurement/quotation-requests`.
Money values are 2-dp strings (unit prices 4-dp), `null` unless `moneyVisible`
(`view:commitment-ledger` ∨ `award:quotation`). Dates are ISO strings. `Person = { id, name }`.

### Errors

Standard envelope `{ success: false, error: { code, message, details } }`. The machine code is
always in **`error.details.code`** (403s keep `error.code = "FORBIDDEN"`, as SoD 403s already do;
409/422 also repeat it in `error.code`). 404 for an unknown or other-org id. Codes:

| HTTP | `details.code` |
|---|---|
| 400 | `STORE_REQUIRED` · `PHOTO_REQUIRED` · `FILE_NOT_ATTACHABLE` (bad mime/size/checksum) · `CAPTURED_AT_INVALID` · `STORE_NAME_TOO_LONG` · `TOTAL_INVALID` · `NOTE_REQUIRED` · `REASON_REQUIRED` · `QUOTE_REQUIRED` · `PAYMENT_PATH_REQUIRED` · `AWARD_SUPPLIER_OVERRIDE_NOT_ALLOWED` · `ORDER_LINE_INVALID` · `EXPECTED_DELIVERY_DATE_INVALID` |
| 403 | `MISSING_PERMISSION` · `QUOTE_UPLOADER_CANNOT_SELECT` · `REQUESTER_CANNOT_SELECT` · `SUPPLIER_REGISTRATION_REQUIRES_PAYABLES` · `FILE_NOT_ATTACHABLE` (not your upload) |
| 409 | `QUOTATION_CANCELLED` · `QUOTATION_FROZEN` · `QUOTATION_NOT_COLLECTING` · `QUOTATION_NOT_AWAITING_DECISION` · `QUOTATION_NOT_PENDING_APPROVAL` · `QUOTATION_NOT_AWARDED` · `QUOTES_REQUIRED` · `QUOTE_TOTALS_MISSING` · `QUOTE_NOT_ACTIVE` · `QUOTE_PHOTO_DUPLICATE` · `QUOTE_COUNT_EXCEPTION_REQUIRED` (`details.required`, `details.distinct`) · `NON_LOWEST_REASON_REQUIRED` · `NON_LOWEST_NOTE_REQUIRED` · `AWARD_PENDING_DIFFERENT_CHOICE` · `AWARD_PENDING_APPROVAL` (`details.approvalInstanceId`) · `SUPPLIER_INACTIVE` · `MATERIAL_REQUEST_NOT_APPROVED` · `MATERIAL_REQUEST_ALREADY_ORDERED` · `PURCHASE_ORDER_LIVE` · `PURCHASE_ORDER_CONFIRMED` · `FILE_NOT_ATTACHABLE` (not uploaded / already bound) · `QUOTATION_CHANGED` (also: the award's proposal or approval no longer matches — reload) · `CLIENT_REF_CONFLICT` (a different upload under an existing clientRef) |
| 422 | `PO_EXCEEDS_AWARD` · `ORDER_LINES_REQUIRED` · `ORDER_LINE_NOT_ON_REQUEST` · `ORDER_LINE_DUPLICATED` · `ORDER_LINE_QUANTITY_INVALID` · `ORDER_LINE_AMOUNT_INVALID` |

Quote photo files (`GET /files/:id…`) answer 403 unless the caller holds view:procurement AND
view:commitment-ledger — as a QUOTATION_PHOTO and also as the PO's quotation evidence.
`GET /procurement/purchase-orders/:id/revision-attachments` rows gain `quotationEvidence: boolean`
and omit quotation-evidence rows for callers who may not download them.

Manual PO guard (review M1): `POST /procurement/purchase-orders` and `POST …/:id/revise` refuse a
line that allocates to an MR covered by any non-cancelled quotation round —
409 `QUOTATION_IN_PROGRESS` while a round is live (collecting → awarded with its order not yet
confirmed): "Order it from QR-… (Raise the order)"; 409 `QUOTATION_ROUND_REQUIRED` once every round
is closed: "Quantity left must go through a new quotation round (Get quotes)". Both carry
`details: { code, quotationRequestId, quotationNumber, materialRequestId }`. Raise-order is exempt.

Rounds: a round is **closed** (`closedAt`) when the PO raised from its award is confirmed. One live
(not cancelled, not closed) round per MR. `POST /` opens a new round on an MR with a closed round
when some quantity is still unordered (its estimate covers only what is left); an MR with nothing
left, or with manual orders and no closed round, answers 409 `MATERIAL_REQUEST_ALREADY_ORDERED`.
The MR detail's `quotation` summary shows the live round only (null after a round closes).

PO confirm (`POST /procurement/purchase-orders/:id/confirm`) adds 409 `PO_EXCEEDS_AWARD`
(`details.quotationRequestId`) and 409 `AWARD_CHANGED`.

### Endpoints

| Method & path | Gate (all + view:procurement) | Body → response |
|---|---|---|
| `GET /` | collect ∨ award | query `queue=collect\|returned\|waiting\|decide\|awarded\|all` (default `all`), `projectId`, `q`, `mine` (bool; default true for `waiting`), `page` (1), `limit` (25, ≤ 100) → **`{ items: Row[], page, limit, total }`** |
| `GET /:id` | collect ∨ award | → `Detail` |
| `POST /` | collect | `{ materialRequestId }` → `Detail`; **201** new, **200** the existing live request |
| `POST /:id/quotes` | collect | `{ clientRef: uuid, supplierId? \| storeName? (≤120), replacesQuoteId?, photos: [{ platformFileId, capturedAt, source: CAMERA\|GALLERY\|UNKNOWN }] (1–10) }` → 200 `Detail` (a repeated `clientRef` returns 200 with no new quote) |
| `POST /:id/quotes/:quoteId/photos` | collect | `{ platformFileId, capturedAt, source }` → 200 `Detail` (same file twice = no-op) |
| `POST /:id/quotes/:quoteId/withdraw` | collect | — → 200 `Detail` |
| `POST /:id/send` | collect | `{ exceptionReason?: ONLY_ONE_SUPPLIER\|URGENT\|FRAMEWORK_SUPPLIER }` → 200 `Detail` |
| `POST /:id/reopen` | collect | `{ reason }` → 200 `Detail` |
| `PUT /:id/quotes/:quoteId/total` | award | `{ total: "1234.50" }` → 200 `Detail` |
| `POST /:id/quotes/:quoteId/reject` | award | `{ reason: ILLEGIBLE\|WRONG_ITEMS\|INCOMPLETE\|OTHER, note? }` → 200 `Detail` |
| `POST /:id/ask-another` | award | `{ note }` → 200 `Detail` |
| `POST /:id/award` | award | `{ quoteId, paymentPath: BUYER_CASH\|FINANCE_PAYS_SUPPLIER, nonLowestReason?, nonLowestNote?, acceptException?, awardSupplierId? }`; re-drive with the same body or `{}` → 200 `Detail` (AWARDED) or 409 `AWARD_PENDING_APPROVAL` with `details.approvalInstanceId` |
| `POST /:id/withdraw-award` | award | — → 200 `Detail` |
| `POST /:id/request-redecision` | collect ∨ award | `{ reason }` → 200 `Detail` |
| `GET /:id/order-draft` | collect + create:purchase-order | → `OrderDraft` |
| `POST /:id/raise-order` | collect + create:purchase-order | `{ lines?: [{ materialRequestLineId, quantity: "50", amount: "1147.50" }], expectedDeliveryDate?, deliveryAddress? }` → **201** `{ purchaseOrderId }` |
| `POST /:id/cancel` | collect ∨ award | `{ reason }` → 200 `Detail` |

`Row = { id, number, mr: { id, number, title }, project: { id, code, name } | null, status,
quoteCount, distinctSupplierCount, requiredQuoteCount, exceptionReason, urgent, sentAt,
waitingWorkingMinutes: number | null, slaTone: none|amber|red, estimateAmount*, lowestTotal*,
awardedTotal*, moneyVisible }` (`waitingWorkingMinutes` is null unless AWAITING_DECISION /
AWARD_PENDING_APPROVAL).

`Detail = { id, number, status, urgent, currencyCode,
materialRequest: { id, number, title, priority, status, requestedBy: Person, requiredByDate }, project | null,
estimateAmount*, requiredQuoteCount, quoteCount, distinctSupplierCount, exceptionReason,
exceptionAccepted: { by: Person, at } | null, returnNote, returnedBy: Person | null, returnedAt,
sendCount, firstSentAt, sentAt, decidedAt, waitingWorkingMinutes, slaTone, lowestTotal*,
proposal: { quoteId, proposedBy, proposedAt, paymentPath, nonLowestReason, nonLowestNote, supplierId, acceptException } | null,
award: { quoteId, total*, supplier: { id, code, name } | null, awardedBy, awardedAt, approvalInstanceId, finalApprover: Person | null, paymentPath, nonLowestReason, nonLowestNote } | null,
purchaseOrder: { id, poNumber, status } | null, cancelledBy, cancelledAt, cancelReason,
createdBy: Person, createdAt, updatedAt,
lines: [{ id, lineNumber, description, quantity, uom: { code, name } | null, estimatedUnitPrice*, estimatedAmount* }],
quotes: [{ id, store: { supplierId, name, registered }, status, rejectReason, rejectNote, replacesQuoteId, uploadedBy: Person, createdAt,
  photoCount, photos: [{ id, fileId, pageNumber, capturedAt, receivedAt, source, sha256, reusedOn: string[] }],
  enteredTotal*, enteredBy: Person | null, enteredAt, isLowest: boolean | null }],
supplierMatches: [{ quoteId, suppliers: [{ id, code, name }] }],
approval: { instanceId, status, currentStepOrder, currentStepRole, steps: [{ stepOrder, roleRequired, approvedBy: Person | null, approvedAt }] } | null,
allowedActions: [{ action, enabled, reasonCode }], moneyVisible, photosVisible }`.
**`photosVisible`** = the caller holds `view:procurement` AND `view:commitment-ledger` (the same rule
as downloading the photo). When false every quote's `photos` is `[]` (no file ids, hashes or reuse
links) and `photoCount` still gives the page count — show "Quote photos are hidden for your role".
Note `moneyVisible` can be true while `photosVisible` is false (an `award:quotation` holder without
cost visibility).
`allowedActions[].action` ∈ `ADD_QUOTE · ADD_PAGE · WITHDRAW_QUOTE · SEND · REOPEN · ENTER_TOTAL ·
REJECT_QUOTE · ASK_ANOTHER · AWARD · WITHDRAW_AWARD · REQUEST_REDECISION · RAISE_ORDER · CANCEL`;
`reasonCode` is one of the codes above (a SoD rule code for a barred selector). A command whose
action is disabled is refused with exactly that code.

`OrderDraft = { quotationRequestId, number, supplier: { id, code, name }, currencyCode,
awardedTotal*, paymentPath, splitMode: ESTIMATE|SINGLE_LINE|MANUAL, lines: [{ materialRequestLineId,
lineNumber, description, quantity, maxQuantity, uom, amount*, unitPrice* }], moneyVisible }`
(only lines with quantity still to order; `amount`/`unitPrice` null in MANUAL mode).

`GET /procurement/material-requests/:id` gains `quotation: { id, number, status, quoteCount,
distinctSupplierCount, requiredQuoteCount } | null` (the live request).

Notifications: kinds `QUOTES_READY` (→ `/finance/quotes/:id`), `ANOTHER_QUOTE_REQUESTED` and
`QUOTATION_AWARDED` (→ `/procurement/quotes/:id`); `contextData = { number, mrNumber,
projectName?, quoteCount, note? }` (`@erp/types` `QuotationNotificationContext`).

### Deviations from §1 / ADR-044 (recorded with the build)

1. **List envelope.** `GET /` returns `{ items, page, limit, total }` (the ADR listed bare rows);
   added `limit` and `mine` params. `collect` = all COLLECTING requests (pass `mine=true` for "mine").
2. **Error code location** is `error.details.code` (see above), the existing SoD convention.
3. **Award 409** carries `details.code = AWARD_PENDING_APPROVAL` alongside `approvalInstanceId`.
4. **Self-approval** happens when the proposer's step is the instance's *current* step (the engine
   approves steps in order). In S8 (CD → FO → CFO) the FO's step is recorded when the FO re-drives
   after the CD approved; a proposer holding several consecutive step roles walks them in one call.
5. **Re-decision with a live draft PO** is refused (`PURCHASE_ORDER_LIVE`): cancel the draft PO
   first. The UI's "Send back to finance" after a confirm-time `PO_EXCEEDS_AWARD` must cancel the
   draft, then call `request-redecision`. A request whose PO was confirmed and later cancelled cannot
   raise again (`PURCHASE_ORDER_CONFIRMED`); it can be cancelled and a new request opened.
6. **Model:** two extra columns on `quotation_requests` — `proposed_supplier_id` (the supplier a
   pending proposal awards to; null = register the store on completion) and
   `proposed_accept_exception`. A store registered by an award becomes that quote's `supplierId`
   (store name cleared), so a re-award cannot register it twice.
7. **Award bands** are the PO bands with names `Quote award …` (a band definition is found by
   name and carries its transaction type, so the PO names could not be reused verbatim).
8. **Required count at send** with an unknown estimate is 3 (the server asks for a reason when
   fewer); at award the ADR rule applies (estimate known and > 100, or award > 100).
9. **MR allocation caps** now count only live orders (not cancelled POs, not cancelled/superseded
   revisions) — needed so a cancelled draft frees its quantity for a re-raise.
10. **PO `effectiveFrom`** of a raised order is the award date (the source document's date).

---

## 1. Backend tickets (build order)

Write areas: `apps/api/prisma/` (schema, migration, seeds), `apps/api/src/business/procurement/quotations/`
(new: `presentation/ application/ domain/ infrastructure/`), `purchase-orders/` (coverage + raise),
`platform/workflows/` (SoD, registry, bands), `platform/files/` (owner kind),
`platform/notifications/` (writer), `packages/types/` (permissions, notification kinds, wire types).

### Q1 — Schema, migration, permissions, seeds

- **Scope:** Prisma models `QuotationRequest`, `Quote`, `QuotePhoto` and enums exactly as ADR-044 §2
  (snake_case `@map`, `cuid`, `organizationId` on every table, money `Decimal(18,2)`); partial unique
  index (raw SQL in the migration) `quotation_requests (organization_id, material_request_id) WHERE
  status <> 'CANCELLED'`; unique `(organization_id, number)`, unique `purchase_order_id`, unique
  `quotation_quote_photos.platform_file_id`, unique `(quotation_request_id, client_ref)` on quotes;
  `WorkflowTransactionType.QUOTATION_AWARD`; three `NotificationKind` values. Permissions
  `collect:quotation`, `award:quotation` in `packages/types/src/permissions.ts` (`PERMISSIONS`,
  `DESCRIPTIONS`, domain map → Procurement, `riskFor`: `collect` → MEDIUM, `award` → CRITICAL).
  Seeds: `acco-team-roles.seed.ts` (Procurement Manager +collect; Finance Officer +award),
  `scripts/governed-roles.ts` (CFO, CEO +award); targeted idempotent
  `prisma/seeds/grant-quotation-permissions.seed.ts` + `quotation-permissions.ts` (pattern:
  `grant-finance-mr-approval.seed.ts`); SoD rule codes `QUOTE_UPLOADER_CANNOT_SELECT`,
  `REQUESTER_CANNOT_SELECT` added to the ACCO SoD policy seed and a targeted
  `grant-quotation-sod-rules.seed.ts` for the live tenant; `accoQuotationAwardBands()` (returns
  `accoPurchaseOrderBands()`), bound to `QUOTATION_AWARD AWAITING_DECISION:AWARDED`, seeded
  inactive; `dev-activate-doa-bands.seed.ts` activates PO and award bands together.
- **Acceptance:** migration applies on a clone of prod; `prisma validate` passes; re-running each
  seed is a no-op; the catalog/seed consistency test passes with the new keys.
- **Tests:** permission catalogue spec (keys, descriptions, risk); seed idempotency (DB); bands spec —
  award bands partition the amount axis identically to PO bands; migration test — two live requests
  on one MR violate the index, a CANCELLED one does not.

### Q2 — Pure domain policies

- **Scope (`quotations/domain/`, no I/O):**
  - `quotation-state.policy.ts` — the transition table of ADR-044 §3; `allowedActions(request,
    caller)` returning `{ action, enabled, reasonCode }` (used by commands *and* the read model —
    one source for "why can't I").
  - `quote-count.policy.ts` — `storeKey(supplier|name)`, `distinctCount`, `requiredCount(estimate,
    awardTotal)` (> 100.00 → 3), `countBlock(...)`.
  - `quote-selection.policy.ts` — `lowestQuoteIds`, `awardBlock(...)` (totals present, active,
    non-lowest reason, exception acceptance).
  - `order-split.policy.ts` — `splitAwardAcrossLines(total, lines)` → `{ mode: ESTIMATE | SINGLE_LINE
    | MANUAL, lines[{ amount, unitPrice }] }` with `unitPrice = floor₄(amount / qty)`;
    `validateManualLines(total, lines, remaining)`.
  - `quotation-sla.policy.ts` — `waitingMinutes(from, to, { urgent })`: Sat–Thu 07:00–17:00
    `Africa/Mogadishu` (via `Intl`; UTC+3, no DST); urgent = clock minutes; `slaTone(minutes)` →
    `none | amber (≥120) | red (≥240)`.
  - `purchase-orders/domain/award-coverage.policy.ts` — `awardCoverage({ request, po, revisions,
    lines, draftTotal })` → `COVERED | EXCEEDS_AWARD | NOT_FROM_AWARD | NOT_COVERED(reason)`.
- **Acceptance:** each function is total over its inputs and uses `Prisma.Decimal`/minor units (no
  floats).
- **Tests (unit):** every transition allowed/refused; storeKey normalisation (case, spaces, matches a
  registered supplier name); required count at 100.00 (→1) and 100.01 (→3), unknown estimate;
  lowest with ties; split — 3 priced lines sum ≤ total and within `Σqty×0.0001`, single line exact,
  one unpriced line → MANUAL; SLA — Thu 16:30 → Sat 07:30 = 60 working min, Friday ignored, urgent
  counts clock, 119/120/239/240 boundaries; coverage — each of the five conditions failing alone.

### Q3 — Open, collect, send, reopen, cancel (+ photo owner kind)

- **Scope:** `QuotationRequestService` + repository + controller for `POST /`, `POST /:id/quotes`,
  `POST /:id/quotes/:quoteId/photos`, `POST /:id/quotes/:quoteId/withdraw`, `POST /:id/send`,
  `POST /:id/reopen`, `POST /:id/cancel`. Each: org-scoped load, row lock, policy check, CAS write,
  audit outbox event (ADR-044 §3). Binding a photo: the file must be READY, TEMPORARY, uploaded by
  the caller, image MIME (`image/jpeg|png|webp|heic`), ≤ 8 MB; set `BOUND`; copy `checksumSha256`
  to `QuotePhoto.sha256` (refuse a file with no checksum). Send: recompute `requiredQuoteCount`,
  require `exceptionReason` when short, set `sentAt`/`firstSentAt`, `sendCount++`, move photos of
  ACTIVE quotes to `IMMUTABLE`. Reopen: reason required, back to `COLLECTING`. Replacement = withdraw
  + add with `replacesQuoteId`. Add `QUOTATION_PHOTO` to the `FileOwner` union and resolution in
  `file-authorization.service.ts` (read: collect ∨ award ∨ `view:commitment-ledger`). MR cancel
  (`material-request.service.ts`) cancels a live non-awarded request in the same transaction and is
  refused (409) if the request is AWARDED with a non-cancelled PO.
- **Acceptance:** S1, S2 (minus notifications), S3, R2, R3, R7, R8; `POST /:id/quotes` with a
  repeated `clientRef` returns the first quote, no duplicate.
- **Tests (DB-backed):** open idempotent + concurrent opens produce one row; open refused on
  SUBMITTED MR and on MR with an allocation; add quote with supplier XOR storeName (both/neither →
  400); duplicate hash refused; frozen after send for add/withdraw/page; send short without reason →
  409, with reason → OK; files IMMUTABLE after send; reopen → COLLECTING + audit; cancel; MR cancel
  cascade; file read authorization matrix for `QUOTATION_PHOTO`; cross-org id → 404.

### Q4 — SoD extension + selector commands (total, reject, ask-another)

- **Scope:** `SodAction` + `'SELECT_QUOTATION'`; `SodEvaluationContext.quoteUploaderUserIds`; two
  branches in `violation()`. Endpoints `PUT /:id/quotes/:quoteId/total` (positive, ≤ 2 dp, ≤
  999,999,999.99; overwrite allowed until award, each write audited with before/after),
  `POST /:id/quotes/:quoteId/reject` (reason chip; excluded from counts and lowest),
  `POST /:id/ask-another` (note required → `RETURNED`, `decidedAt` set for the cycle).
- **Acceptance:** R1 for every selector command; S6 state changes.
- **Tests:** SoD unit — each new rule fires only under its code and only for `SELECT_QUOTATION`;
  existing rule tests unchanged; DB — uploader of a WITHDRAWN quote is still barred; requester
  barred; total in COLLECTING → 409; reject removes quote from lowest; ask-another → RETURNED, then
  send → AWAITING_DECISION with `sendCount` 2.

### Q5 — Award + DoA integration

- **Scope:** `POST /:id/award`, `POST /:id/withdraw-award`. Award: lock, SoD for actor, `awardBlock`,
  count rule (exception acceptance), resolve supplier (existing / `awardSupplierId` override / new
  store → create supplier with `QS-` code sequence, `createdBy = actor`, requires `manage:payable`
  else 403 `SUPPLIER_REGISTRATION_REQUIRES_PAYABLES`), write `proposed*` +
  `AWARD_PENDING_APPROVAL` (tx 1); `commandGovernance.evaluateStateTransition(identity,
  'QuotationRequest', 'AWAITING_DECISION', 'AWARDED', id, total)`; if gated and the actor holds the
  current step role → `ApprovalService.approve(instanceId, actor, …, 'Selected in quotation QR-…')`
  then evaluate again; on re-drive, before evaluating, load the APPROVED instance's
  `ApprovalAction` actors and run `SELECT_QUOTATION` SoD for each (violation → void instance, 403);
  not gated / consumed → tx 2: `AWARDED`, `awarded*`, `awardApprovalInstanceId`,
  `awardFinalApproverId`, `decidedAt`, audit. Withdraw: void open instance (`voidOpenApproval`),
  clear `proposed*`, back to `AWAITING_DECISION`. Register the transition in
  `policy-transition-registry.ts` and `GovernedEntity`.
- **Acceptance:** S4, S5, S8, S9, R4, R5, R9; a re-drive with a different `quoteId` while pending →
  409 `AWARD_PENDING_DIFFERENT_CHOICE`.
- **Tests (DB):** bands inactive → single call AWARDED, no instance; bands active, $80 award by an FO
  (not on the CD-only chain) → 409, CD approves → re-drive AWARDED; $5k FO selector auto-approves own
  step, chain continues; approver-uploader → 403 + instance voided; withdraw → AWAITING_DECISION;
  non-lowest without reason → 409; new store creates supplier with `createdBy` = selector;
  selector without `manage:payable` on new store → 403; `awardSupplierId` override uses existing
  supplier; concurrent award + ask-another → one wins, the other 409.

### Q6 — PO from award + confirm coverage + re-decision

- **Scope:** `GET /:id/order-draft`; `POST /:id/raise-order` (lock request; AWARDED; no live PO;
  build lines via `splitAwardAcrossLines` or validated manual lines; call the existing
  `PurchaseOrderService.create` path in the same transaction with `mrLineAllocations`; insert
  `PurchaseOrderRevisionAttachment` rows for the winning photos via a repository method that
  accepts IMMUTABLE files; set revision `quotationRef/quotationDate/quotedAmount`; set
  `purchaseOrderId`; audit `QUOTATION_ORDER_RAISED`). Harden `wireAllocations` (org + APPROVED
  check). In `PurchaseOrderService.confirm`: before governance, read the linked request
  (`FOR UPDATE`) and apply `awardCoverage`: COVERED → skip governance, set
  `approvalInstanceId`/`approvedBy` from the award, audit reason; EXCEEDS_AWARD → 409; otherwise the
  existing path unchanged. `POST /:id/request-redecision` (AWARDED; PO absent or CANCELLED and never
  confirmed → clear award, `AWAITING_DECISION`, re-notify selectors). PO cancel of a raised,
  unconfirmed draft frees the request for a new raise.
- **Acceptance:** S7, S9, R6; the existing PO confirm tests pass unchanged; a non-award PO with
  bands active still opens its own instance.
- **Tests (DB):** split totals ≤ award; manual lines over the cap → 422; dropping a line OK, adding a
  foreign MR line → 422; photos attached, files remain IMMUTABLE, revision quotation fields set;
  covered confirm creates no `ApprovalInstance` and commits ledger entries; revision 2 (amend) of a
  covered PO goes through the normal gate; supplier swapped → not covered; draft above award →
  409; re-decision blocked after confirm; double raise → 409; `wireAllocations` refuses another
  org's MR line and a SUBMITTED MR's line.

### Q7 — NotificationWriter + quotation events

- **Scope:** `platform/notifications/application/notification-writer.service.ts`:
  `upsertMany(tx, rows)` (unique key upsert, never resurrects a read row's `readAt`) and
  `resolve(tx, { resourceType, resourceId, kinds })`; exported from `NotificationsModule`. Recipient
  resolution `QuotationRecipients`: active org members holding `award:quotation` via their roles,
  minus SoD-barred users; collectors = creator ∪ uploaders. Write/resolve per ADR-044 §10 table in
  the same transactions as Q3–Q6. `@erp/types` `NotificationKind` union + `contextData` shape
  `{ number, mrNumber, projectName?, quoteCount, note? }` — never amounts.
- **Acceptance:** S2/S4/S6 notifications appear within one bell poll; resolved rows leave the badge;
  generator flag off does not suppress them.
- **Tests (DB):** send creates one row per selector (barred user excluded); second send cycle creates
  new rows (`sendCount` in key), first cycle resolved; award resolves `QUOTES_READY` and creates
  `QUOTATION_AWARDED`; rollback of the command leaves no notification; `contextData` contains no
  money.

### Q8 — Read models (lists, detail, inbox)

- **Scope:** `GET /` queues — `collect` (COLLECTING, created by or uploaded by me — or all for a
  collector with no filter), `returned` (RETURNED), `waiting` (AWAITING_DECISION /
  AWARD_PENDING_APPROVAL, my requests), `decide` (AWAITING_DECISION, oldest `sentAt` first, plus
  AWARD_PENDING_APPROVAL where I hold the current step), `awarded` (AWARDED without PO), `all`.
  Batched (fixed number of queries per page). `waitingWorkingMinutes` + `slaTone` from
  `quotation-sla.policy.ts` at read time. `GET /:id` detail incl. `allowedActions` (from Q2),
  `supplierMatches`, `reusedOn` per photo, approval summary. Money through `moneyOrNull` with
  visibility = `view:commitment-ledger ∨ award:quotation`. MR detail read model gains
  `quotation: { id, status, quoteCount, requiredQuoteCount } | null`.
- **Acceptance:** R10; each queue returns exactly its states; inbox ordered by waiting time.
- **Tests (DB):** queue membership matrix; money null for a PM-like caller and present for FO; SLA
  tone at seeded times (fake clock); `allowedActions` agrees with command refusals (property: for
  each action, enabled ⇔ command does not throw the policy error); fixed query count.

---

## 2. Frontend tickets (build order)

Pattern: `features/quotations/` with `api/quotations-api.ts` (one function per endpoint via
`apiClient`) → `hooks/use-quotations.ts` (TanStack Query keys + mutations with `meta.successToast`)
→ `components/*` → thin `app/(app)/…/page.tsx`. Pure rules in `features/quotations/*.ts` with
tests. `@erp/ui` only (Button, ChoiceCards, FormDialog, StatusPill, MoneyInput, Notice, EmptyState,
Skeleton); lists use `PlatformDataGrid` with `card` roles. Every screen: 375 px, no horizontal
scroll, 44 px targets, keyboard reachable, visible focus, `aria-live` for upload/status changes.

### Q9 — Types, API, hooks, permissions, navigation

- **Scope:** wire types (hand-written in `features/quotations/types.ts`, per `lib/api-types.ts`
  guidance); API + hooks; `QUOTATION_PERMISSIONS` in `features/auth/permissions/can.ts`;
  `lib/status-registry.ts` vocabulary `quotationRequest`; nav: Procurement domain item **Quotes**
  (`/procurement/quotes`, `collect:quotation`) after Requests; Finance domain Payables group item
  **Quotes to choose** (`/finance/quotes`, `award:quotation`) with a count badge from the `decide`
  queue; i18n `messages/en/quotations.json`, notifications keys for the three kinds.
- **Acceptance:** nav items appear only with the permission; hooks invalidate list + detail + MR
  detail after each mutation.
- **Tests:** nav permission filter; status tone mapping; api functions hit the right paths.

### Q10 — Photo capture + upload queue library

- **Scope:** `features/quotations/capture/`:
  - `downscaleImage(file)` — `createImageBitmap` → canvas, long edge ≤ 2000 px, JPEG q 0.8 (keep the
    original if smaller and already JPEG); HEIC falls back to upload as-is when decoding fails.
  - `upload-queue.ts` — IndexedDB store (`idb` not added; plain IndexedDB wrapper) of pending items
    `{ clientRef, requestId, storeChoice, pages[{ blob, capturedAt, source }], state }`; per page:
    presign → PUT (with checksum) → confirm, then `POST quotes` / `photos`; retry with exponential
    backoff (1 s → 30 s cap) on network/5xx, re-presign on 403 expiry; resume on page load and on
    `online`; idempotent by `clientRef`. No service worker.
  - `source` heuristic per ADR-044 §9.
- **Acceptance:** a capture made offline uploads when the network returns without user action;
  reload mid-upload resumes; no duplicate quotes after retries.
- **Tests:** downscale dimensions/quality (canvas mocked); queue state machine (pending → uploading
  → bound | failed-retrying) with fake timers; resume after reload (fake IndexedDB); idempotent
  replay; source heuristic.

### Q11 — Procurement capture flow (mobile-first)

- **Scope:** MR detail (`mr-detail.tsx`) — APPROVED + collect permission + no request → primary
  **Get quotes**; existing request → **Quotes 2 of 3 →**. `/procurement/quotes` list (queues
  *To collect*, *Returned to you*, *Waiting for finance*, *Awarded — raise order*).
  `/procurement/quotes/[id]` capture screen: sticky counter, **Snap quote** (input
  `accept="image/*" capture="environment"`) and a secondary **From gallery** link, store chip sheet
  (recent stores as chips + "New store" text field + supplier search), page add, per-quote upload
  state, withdraw, **Send to finance** (disabled until all uploads bound; exception chips when short).
  Waiting screen after send (read-only photos, *Reopen to change* behind a confirm dialog with
  reason). Returned banner shows finance's note.
- **Acceptance:** from MR to sent with three single-page quotes in ≤ 7 taps excluding the camera
  app; no price field anywhere; works at 375 px; send blocked while any upload is pending, with the
  reason shown.
- **Tests (component):** entry button states; counter + exception chips appear only when short;
  send disabled reasons; frozen view after send; returned note banner; a11y labels on capture
  buttons. **E2E (Playwright 375×812):** S1 → S2 with fixture images; R2 via UI (no add button).

### Q12 — Finance inbox + decision screen

- **Scope:** `/finance/quotes` — `PlatformDataGrid` (card on phone): MR, project, quotes "3 of 3"
  or exception chip, waiting time with tone (amber ≥ 2 h, red ≥ 4 h, text + colour), estimate.
  `/finance/quotes/[id]` (notification deep link) — photo strip: swipe on phone (one quote per
  screen, page dots), side-by-side columns on ≥ 1024 px; tap a photo → full-screen zoom (pinch /
  double-tap / keyboard +/−, Esc closes). Under each photo a **Total** `MoneyInput`
  (`inputMode="decimal"`, `enterKeyHint="next"`); Enter / Next advances to the next quote's input;
  autosave on blur (PUT total) with saved tick. Lowest badge recomputed live. **Choose** per quote →
  confirmation `FormDialog`: non-lowest reason `ChoiceCards` (+ text for Other), exception
  acceptance (when short), **Pay by** `ChoiceCards` (Buyer pays cash · Finance pays supplier),
  supplier match picker when a new store wins. Secondary: **Ask for another quote** (FormDialog,
  note), **Reject quote** (reason chips). Pending-approval state shows the approval chain and
  *Withdraw*. Barred users see the photos read-only with the SoD reason.
- **Acceptance:** from link to award in < 1 min for three quotes (totals + choose + pay-by = 3
  inputs + 3 taps); never shows a Choose button while totals are missing (reason shown); 375 px with
  no horizontal scroll; full keyboard path.
- **Tests (component):** auto-advance; lowest recompute and ties; non-lowest requires reason;
  exception acceptance shown only when short; barred view; tone rendering. **E2E:** S4, S5, S6, R1.

### Q13 — Raise the order

- **Scope:** awarded request (collector) shows **Raise the order** (one tap → `raise-order` without
  lines when `order-draft.splitMode ≠ MANUAL`; navigates to the PO) and **Adjust lines first** →
  `/procurement/quotes/[id]/order`: line table (card on phone) with quantity and amount inputs,
  remaining-of-award meter, *Create draft order* disabled over the cap. MANUAL mode opens this page
  directly. PO detail (`po-detail.tsx` and project `purchase-detail-shell.tsx`) shows "Approved by
  quotation award QR-… (chosen by …)" and the winning photos with open/download links;
  *Issue order* confirms with no approval panel. A 409 `PO_EXCEEDS_AWARD` shows *Send back to
  finance* (request-redecision).
- **Acceptance:** S7 end to end; over-cap edits cannot be submitted; PO shows evidence.
- **Tests (component):** split prefill, meter, cap disabling, MANUAL mode; **E2E:** S7 confirm with
  no approval instance; S9 new-store path.

### Q14 — Notifications UI + release gate

- **Scope:** render the three kinds in bell/feed (`presentation.ts` mapping, copy without amounts);
  update `docs/01-capability-matrix.md` (Procurement row "Competitive quotations"),
  `docs/domains/procurement.md`, the release gate doc; Playwright scenario seed for a request in
  each state.
- **Acceptance:** clicking each notification lands on the right screen for that user.
- **Tests:** kind → copy mapping; E2E bell click → decision screen.

---

## 3. Wireframes (375 px unless stated)

### A. MR detail entry

```
┌─────────────────────────────────┐
│ ← MR-00123  Cement & rebar      │
│ Approved · Project HQ-MOG-26-01 │
│ 3 lines · needed by 12 Oct      │
├─────────────────────────────────┤
│ [ 📷  Get quotes             ]  │  ← primary (no request yet)
│   Cancel request                │
└─────────────────────────────────┘
   with a request:  [ Quotes  2 of 3  → ]
```

### B. Capture screen (COLLECTING)

```
┌─────────────────────────────────┐
│ ← QR-00041 · MR-00123           │
│ Quotes  ●●○  2 of 3 stores      │  ← sticky; turns green at 3
├─────────────────────────────────┤
│ ┌──────┐ Hodan Hardware         │
│ │ img  │ 2 pages · uploaded ✓   │
│ └──────┘          [Remove]      │
│ ┌──────┐ Bakaara Steel (new)    │
│ │ img  │ uploading… 60%  ⟳      │
│ └──────┘                        │
├─────────────────────────────────┤
│ [ 📷  Snap quote             ]  │  ← camera input
│      or choose from gallery     │
├─────────────────────────────────┤
│ [ Send to finance            ]  │  ← disabled: "1 photo uploading"
└─────────────────────────────────┘

After a snap — store sheet:
┌─────────────────────────────────┐
│ Which store?                    │
│ (Hodan Hdw) (Bakaara) (Xamar)   │  ← recent stores as chips
│ (Al-Amiin) (Search suppliers…)  │
│ New store: [______________]     │
│ [ + Add another page ]          │
│ [ Done ]                        │
└─────────────────────────────────┘

Send with 1 quote, estimate > $100:
┌─────────────────────────────────┐
│ Only 1 store. Why?              │
│ ( Only one store has it )       │
│ ( Urgent )                      │
│ ( Framework supplier )          │
│ [ Send to finance ]             │
└─────────────────────────────────┘
```

### C. Waiting / returned

```
┌─────────────────────────────────┐
│ QR-00041 · Waiting for finance  │
│ Sent 10:42 · 1 h 05 m           │
│ [img][img][img]  (read-only)    │
│ Reopen to change a photo        │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ ⚠ Finance asked for another     │
│ quote: "Check Xamar Steel too"  │
│ [ 📷  Snap quote ]              │
└─────────────────────────────────┘
```

### D. Finance inbox — "Quotes to choose"

```
phone (cards)                         desktop (grid)
┌─────────────────────────────────┐   MR       Project   Quotes   Waiting   Est.
│ MR-00123 Cement & rebar         │   MR-00123 HQ-01     3 of 3   4h 10m ● $2,400
│ HQ-MOG-26-01 · 3 of 3           │   MR-00130 Office    1 Urgent 2h 05m ● $80
│ ● 4 h 10 m waiting      $2,400  │   MR-00131 HQ-02     3 of 3   0h 20m   —
└─────────────────────────────────┘   (● red ≥4h, ● amber ≥2h, label text always shown)
```

### E. Decision screen

```
phone — one quote per swipe                desktop ≥1024 px — side by side
┌─────────────────────────────────┐   ┌──────────┬──────────┬──────────┐
│ QR-00041 · MR-00123 · 3 of 3    │   │ Hodan    │ Bakaara  │ Xamar    │
│ ┌─────────────────────────────┐ │   │ [photo]  │ [photo]  │ [photo]  │
│ │                             │ │   │ Total    │ Total    │ Total    │
│ │      [ photo, tap=zoom ]    │ │   │ [2,350 ] │ [2,410 ] │ [2,295 ] │
│ │                             │ │   │          │          │ LOWEST   │
│ └─────────────────────────────┘ │   │ [Choose] │ [Choose] │ [Choose] │
│ Hodan Hardware · camera · 10:31 │   └──────────┴──────────┴──────────┘
│ Total  [ $ 2,350.00 ] → next    │
│ ○ ● ○                           │
│ [ Choose Hodan ]                │
│ Ask for another quote · Reject  │
└─────────────────────────────────┘

Choose dialog (non-lowest):
┌─────────────────────────────────┐
│ Choose Hodan — $2,350.00        │
│ Not the lowest ($2,295). Why?   │
│ (Faster delivery)(Better quality)│
│ (Has stock)(Other: ______)      │
│ Pay by                          │
│ [ Buyer pays cash ][ Finance pays supplier ] │
│ [ Choose ]   Cancel             │
└─────────────────────────────────┘
```

### F. Raise the order

```
┌─────────────────────────────────┐
│ Awarded: Xamar Steel · $2,295   │
│ Pay by: Finance pays supplier   │
│ [ Raise the order ]             │  ← one tap → DRAFT PO
│   Adjust lines first            │
└─────────────────────────────────┘
Adjust lines:
┌─────────────────────────────────┐
│ Cement 42.5  50 bag   [1,147.50]│
│ Rebar 12mm   40 pc    [  918.00]│
│ Tie wire     10 kg    [  229.50]│
│ ▓▓▓▓▓▓▓▓▓▓ $2,295.00 of $2,295  │
│ [ Create draft order ]          │
└─────────────────────────────────┘
```

---

## 4. Definition of done (Phase 1)

- All tickets' tests green; `pnpm build` and the api/web test suites pass.
- Browser QA at 375 px and desktop for S1–S9 against a dev DB with bands inactive **and** active.
- Live-tenant rollout checklist: back up; apply migration; run `grant-quotation-permissions`,
  `grant-quotation-sod-rules`; award bands remain inactive unless the owner activates PO + award
  bands together.
- Capability matrix and procurement domain doc updated.

## 5. Ticket list

| # | Ticket | Layer | Depends on |
|---|---|---|---|
| Q1 | Schema, migration, permissions, seeds | backend | — |
| Q2 | Pure domain policies (state, count, selection, split, SLA, coverage) | backend | — |
| Q3 | Open / collect / send / reopen / cancel + `QUOTATION_PHOTO` | backend | Q1, Q2 |
| Q4 | SoD `SELECT_QUOTATION` + total / reject / ask-another | backend | Q3 |
| Q5 | Award + DoA (gate, self-step approval, re-drive, supplier registration) | backend | Q4 |
| Q6 | Raise order + confirm coverage + re-decision + allocation hardening | backend | Q5 |
| Q7 | NotificationWriter + quotation events | backend | Q3 (wire into Q4–Q6 as they land) |
| Q8 | Read models: queues, detail, SLA, money gating | backend | Q3–Q5 |
| Q9 | Types, API, hooks, permissions, nav | frontend | Q8 contract |
| Q10 | Capture + downscale + resumable upload queue | frontend | Q9 |
| Q11 | Procurement capture flow | frontend | Q10, Q3 |
| Q12 | Finance inbox + decision screen | frontend | Q9, Q4, Q5 |
| Q13 | Raise the order + PO evidence | frontend | Q6, Q12 |
| Q14 | Notifications UI, docs, release gate | frontend/docs | Q7, Q11–Q13 |
