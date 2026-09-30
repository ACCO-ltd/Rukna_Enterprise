# Commercial tab — redesign implementation note

Status: built 2026-09-28 (owner approved every recommendation below on 2026-09-28).
Reference: the Rukna design-system artifact (ActionList, DocumentPaper, ContextBar, SubNav,
SegmentedControl, DataGrid, LineItemsEditor, DocumentActionBar, LifecycleStepper, SummaryRail;
CommercialPage templates). The artifact is the UX reference only — rules, states and permissions
come from the backend. `installmentBillingBlocker()` semantics (ADVANCE raise vs post) are unchanged.

## 1. Decisions (approved)

| # | Question | Decision |
|---|---|---|
| D1 | Draft vs issue | **Prepare = drafts only; Issue = approve + number + post in one command**, the same for milestone packages (stage + variation lines) and separate charges. `issuePackage` is split into `prepare-package` and `invoices/:id/issue`. The old `issue-package` route stays for one release (deprecated). |
| D2 | "Mark ready to bill" | Same permission as issuing (`view:contract` + `manage:receivable`, Finance Officer only), so the step is dropped from the UI. Preparing a stage records `readyToBillAt/By` itself (audit kept, no migration). The ready-to-bill routes remain for one release. The draft review is the human checkpoint. |
| D3 | ACTIVE contract without signed date | Legacy create→activate path, re-activation after reopen, and pre-migration contracts. **Activation now requires `signedDate`** (400 otherwise); existing gaps show "Not recorded · Add" (`PATCH /contracts/:id/signed-date`). `apps/web/tools/seed-scenario.mjs` sets the date before activating. |
| D4 | Stage expected dates | Derived in the read model: MILESTONE → linked milestone `forecastDate ?? baselineDate`; TIME_BASED → `dueDate`; ADVANCE → none (billable while the contract is active). No schema change. |
| D5 | Read-model additions | Per-installment `billingBlocker` (raise), `expectedDate`, `releasedBy`, `invoiceId`, `invoiceState`; `GET …/commercial/workspace` (bar facts, ranked To do, capabilities); `GET …/installments/:id/prepare-preview` (server tax rate); `GET …/commercial/invoices/:id` (document for the paper render: issuer = issuing organisation, current branding for drafts, frozen snapshot once issued); money-visibility leaks closed (overview contract values, attention amounts, billing-packages permission); one overdue rule (whole days past due date, server clock). |
| D6 | Client statement | Built: `GET …/commercial/statement` → the page exports CSV. |
| D7 | Order | Backend first, then the frontend commits (a)–(g). |
| D8 | Branding (ASAS logo on ACCO invoices) | Data, not code. The issue command re-snapshots the organisation branding at issue, so drafts pick up the corrected logo; already-issued invoices stay as issued. Production branding is fixed via `PATCH /organizations/:id/branding` (owner action). |
| D9 | Focused actions | Prepare invoice, Record payment, Send, Reopen, Issue confirm → **Dialogs**, not side sheets (owner preference). |

## 2. API contract (all additive; types in `packages/types/src/construction.ts`, section "Commercial tab redesign")

- `GET /projects/:projectId/commercial/workspace` → `CommercialWorkspaceResponse`
  - `todo` ranking: OVERDUE_INVOICE (days overdue desc) → READY_TO_INVOICE (stage order) → DRAFT_INVOICE (oldest first) → ISSUED_NOT_SENT → BLOCKED_STAGE (the first un-invoiced blocked stage only).
  - money null without `resolveBoqVisibility(identity).canViewMargin` (same rule as summary/billing).
- `GET /projects/:projectId/commercial/installments/:installmentId/prepare-preview` → `CommercialPreparePreviewResponse`
- `POST /projects/:projectId/commercial/installments/:installmentId/prepare-package` (`CommercialPreparePackageRequest`) → `CommercialPreparePackageResponse`. Refused (400) when `installmentBillingBlocker(at:'raise')` is not null, the contract is not ACTIVE, or the stage already has a live invoice.
- `POST /projects/:projectId/commercial/invoices/:invoiceId/issue` → `CommercialIssueInvoiceResponse`. One transaction: approve + post every draft of the package (or the lone separate-charge draft), numbers assigned at post. Posting still runs `installmentBillingBlocker(at:'post')`.
- `DELETE /projects/:projectId/commercial/invoices/:invoiceId` → cancels a NOT_POSTED draft (and its package drafts), releasing variation allocations.
- `GET /projects/:projectId/commercial/invoices/:invoiceId` → `CommercialInvoiceDocumentResponse`
- `GET /projects/:projectId/commercial/statement` → `CommercialClientStatementResponse`
- Existing, unchanged: `PATCH …/commercial/invoices/:id` (edit draft), `POST …/commercial/billing/payment` (record payment), `POST …/installments/:id/package-deliveries` (send), credit notes, follow-ups, promises, disputes, `POST /contracts/:id/reopen`, `POST /contracts/record-signed`.

## 3. Frontend structure

- Routes: `/projects/{id}/commercial/{billing|contract|applications}`; `commercial/` lands on **Billing** for `manage:receivable` holders, **Contract** otherwise. Old routes (`overview`, `billing-collection`, `contract-milestones`, `contract-security`, `payment-schedule`, `variations`, `guarantees`, `main-contract`, `retention-advances`) redirect.
- No contract → one EmptyState. With a contract → `ContextBar` (no primary; kebab: New separate charge…, Export client statement, Reopen contract to draft…) + `WorkspaceSubNav`.
- Billing: accounting-setup Notice (once), To do (`ActionList`; first row's command is the only primary), Invoices (`ViewSwitcher` Needs action / Unpaid / All + `PlatformDataGrid`), Payments received.
- Contract: facts grid, payment schedule grid (status + one-line reason), contract changes (Variations · Separate charges · Time).
- Record signed contract page (LineItemsEditor schedule with Billed on = Advance / Milestone / Date; ConfirmDialog; FileDrop; SummaryRail).
- Invoice page: DocumentActionBar + LifecycleStepper + DocumentPaper + SummaryRail; Issue / Send / Record payment by state.

### File ownership while building in parallel
- Backend agent: `apps/api/**`, `apps/web/tools/seed-scenario.mjs`, API docs/ADR.
- Frontend agent: invoice page + dialogs — `packages/ui/src/components/document-paper.tsx`, `features/commercial/components/{invoice-*, prepare-invoice-dialog*, record-payment-dialog*, send-invoice-dialog*, credit-note*}`, `features/commercial/{api,hooks}/commercial-invoice*`; i18n namespaces `commercial.invoicePage`, `commercial.prepare`, `commercial.recordPayment`, `commercial.send`, `commercial.creditNote`.
- Main session: everything else (registry, ActionList, workspace/routes, bar, Billing, Contract, record-contract form, statement).

## 4. Status vocabularies (registry → real backend values)

- `paymentInstallment` (backend derived `PaymentInstallmentBillStatus`): UPCOMING "Upcoming" (neutral) · NEXT → "Ready to bill" (progress) when `billingBlocker` is null, else "Upcoming" + reason · BILLED "Invoiced" (progress) · PARTIALLY_PAID "Partly paid" (progress) · PAID "Paid" (success). No `BILLABLE` value exists — "Ready to bill" is NEXT + no blocker.
- `invoiceCollection`: DRAFT · AWAITING_PAYMENT (backend UNPAID) · PARTIALLY_PAID · PAID · OVERDUE (UNPAID/PARTIALLY_PAID with daysOverdue > 0) · CANCELLED; backend AWAITING_POSTING → shown as "Awaiting posting" (attention).
- `variation`: the backend's six `VariationOrderStatus` values, unchanged.

## 5. Needs backend support / open

### Backend delivered (2026-09-28)

All §2 routes are live. Services: `CommercialBillingService.preparePackage / issueInvoice /
deleteDraftInvoice` and the new `CommercialWorkspaceService` (workspace, prepare-preview, invoice
document, statement). The pure rules live in `construction/commercial/domain/commercial-workspace.policy.ts`.
ADR-030 has an amendment dated 2026-09-28, and api-reference §6.9b documents the routes.

- **Permissions.** `prepare-preview`, `prepare-package`, `invoices/:id/issue` and `DELETE invoices/:id`
  need `view:contract` + `manage:receivable`. `workspace`, `invoices/:id` (GET) and `statement` need
  `view:contract`.
- **Refusal codes** are returned in `error.code`: `CONTRACT_NOT_ACTIVE`, `MILESTONE_NOT_LINKED`,
  `MILESTONE_NOT_VERIFIED`, `STAGE_ALREADY_INVOICED`, `VARIATION_NOT_BILLABLE`, `INVALID_DUE_DATE`,
  `INVOICE_CANCELLED`, `INVOICE_ALREADY_ISSUED`, `CONTRACT_SIGNED_DATE_REQUIRED`.
- **Issue** can be called with any invoice in a stage package (stage or VO) and issues the whole
  package. It is idempotent.
- **Delete** also frees the stage to be prepared again. The cancelled row keeps its description, but
  its source tag is nulled, so `billing.invoices[]` lists it as `status: CANCELLED`,
  `source.kind: NONE`. Filter cancelled rows out of the default views.
- **To do**:
  - One `DRAFT_INVOICE` row per package, amount = the package total.
  - `READY_TO_INVOICE` only on an ACTIVE contract. `unbilledVariations` is repeated on every ready row
    because any of them can carry the variations.
  - `BLOCKED_STAGE`: only the first blocked stage appears.
- **`canRecordPayment`** is `view:contract` + `manage:receivable` + contract ACTIVE, which is the guard
  on `POST …/billing/payment`. Billing's `capabilities.canRecordReceipt` (`create:receipt`) is the
  AR-receipt permission and is not the same thing; don't use it for the Record payment button.
- **`canExportStatement`** requires money visibility.
- **`releasedBy.verifiedAt`** is `ProgrammeMilestone.verifiedAt`, stamped by the verify command, with a
  fallback to `actualDate`.
- **Payments panel.** `receipts[].depositAccountLabel` is populated. `receipts[].receiptNumber` is
  always `null` because `PaymentReceipt` has no document-number column, and adding one needs a
  migration.
- **Breaking type change for the web.** `CommercialOverviewResponse.contract.baseContractValue` /
  `currentContractValue` and `OverviewAttentionItem.amount` / `disputedAmount` are now
  `string | null`.
- **Not done:** `invoices/:id` returns `createdBy` as a display name (the id if the user can't be
  resolved). `deliveries[].sentBy` is still an id.

### Frontend delivered (2026-09-28)

- Routes, bar, Billing, Contract, record-contract form, invoice page and dialogs as in §3. Prepare,
  Record payment, Send, Reopen, Edit draft and Credit note are Dialogs (D9).
- Shared `@erp/ui` changes: `ActionList` and `DocumentPaper` (new); `Notice` lets its action wrap
  under the text on a phone; `DialogContent` returns focus to whatever opened it (Radix only did this
  for a `<DialogTrigger>`, so every state-opened dialog dropped focus to `<body>`).
- The collection routes in `commercial-api.ts` (follow-ups, promises, disputes, credit notes) now
  call the invoice-scoped paths the API actually serves; they were wrong on `main` too.
- The Contract view names the signed scope "BOQ version N · signed copy": recording a contract
  snapshots the working BOQ into a new version, so the form's "version 1" becomes the contract's
  "version 2". Both screens now say so.

### Open

- **Local ledger.** The local `rukna_acco` tenant has no chart of accounts, open period or document
  sequences, so Issue / Send / Record payment were browser-checked with patched API responses; the
  commands themselves are covered by `commercial-prepare-issue.db.spec.ts` (real DB).
- **`deliveries[].sentBy`** is still a user id.
- **Date stages** have no raise blocker (`installmentBillingBlocker` unchanged), so Prepare accepts
  one early; the page keeps it Upcoming ("Expected {date}", server day) and out of To do until due.
- **Contract-changes switcher at 375px** scrolls horizontally inside its track (design-system
  behaviour), so "Time" sits just off-screen until scrolled.

### Verification

- Web: typecheck clean, lint 0 errors, 224 files / 2478 tests. API: targeted suites 42 / 575; full
  suite fails only the five suites that need the unapplied `20260927120000_bill_return_reject`
  migration locally (unrelated).
- Live (local stack): no contract → record (100% rule, confirm) → advance in To do → prepare → draft
  on paper; ledger-blocked notice; Contract view; 1280 and 375 with no horizontal scroll.
- Patched responses: overdue + part-paid invoices, a $50,000 payment split oldest-first across two
  invoices, invoice page Issued / Sent / Paid, money-blind view (no commands, hidden amounts),
  keyboard focus returning to the opener after Escape / Cancel.

### Follow-ups done (2026-09-28, after #235)

- **Receipt numbers.** `payment_receipts.receipt_number` (migration `20260928140000_payment_receipt_number`),
  unique per organisation. A receipt is numbered `RCP-000123` from the PAYMENT_RECEIPT sequence in the
  transaction that posts it (both `post` and `createAndPost`); the migration numbers receipts already
  posted, in posting order, and advances the sequence past them. The Payments list and the client
  statement show it. `post` now marks the receipt posted inside its transaction (it used the outer
  client).
- **Late drafts (owner decision: re-date).** Issue dates an invoice the day it is issued: a draft
  prepared earlier moves to the issue day and its due date moves by the same days (terms kept), so it
  posts in the current period. The deprecated `issue-package` route keeps the date the user chose.
- **"shamiito".** Not in any local database or seed. The name was only a test fixture / code-comment
  example (now "Temporary site power"). If it exists on production it is a separate-charge BOQ line
  someone typed; find it with
  `SELECT id, code, description FROM boq_nodes WHERE description ILIKE '%shamiito%';` and remove or
  rename it in the BOQ (an invoice already issued against it must be credited, not deleted).
