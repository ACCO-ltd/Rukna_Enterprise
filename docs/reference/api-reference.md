# Rukna ERP — Frontend API Reference

Version: 4.0.0
Last Updated: 2026-08-06
Sprint Coverage: Sprints 1–4 complete. Sprint 4 adds the full accounting foundation.
Audience: **Frontend engineer** — everything you need to call the API without reading backend code.

Interactive docs (Scalar UI): `http://localhost:3001/docs`
Raw OpenAPI JSON: `http://localhost:3001/docs-json`

---

## 1. Base URL & Multi-Tenancy

The API is tenant-scoped via subdomain. Every request must go to the tenant's subdomain:

```
https://{tenant-slug}.rukna.app/api/v1
```

Local development (ACCO tenant):
```
http://acco.localhost:3001/api/v1
```

> Sending requests to the wrong subdomain returns `404 Tenant not found`.

---

## 2. Authentication Flow

### 2.1 Login

```
POST /api/v1/auth/login
```

**Request body:**
```json
{ "email": "user@acco.com", "password": "secret" }
```

**Response `200`:**
```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Side effect:** Sets an `HttpOnly` cookie named `refreshToken`. Never read or set this from JS — the browser manages it automatically.

---

### 2.2 Attach the Access Token

Every protected endpoint requires:
```
Authorization: Bearer <accessToken>
```

Access tokens expire in **15 minutes**. On `401`, call `/auth/refresh` once then retry.

---

### 2.3 Refresh

```
POST /api/v1/auth/refresh
```

No body. Browser sends the refresh cookie automatically.

**Response `200`:** `{ "accessToken": "..." }`

The old cookie is rotated — a new `refreshToken` is set.

**`401` from refresh** = token expired or reused → redirect to `/login`.

---

### 2.4 Logout

```
POST /api/v1/auth/logout
```

No body. Revokes the refresh token and clears the cookie.

---

### 2.5 Recommended Auth Pattern

```typescript
// In-memory only — never localStorage
let accessToken: string | null = null;

axios.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        const { data } = await axios.post('/api/v1/auth/refresh');
        accessToken = data.accessToken;
        error.config.headers.Authorization = `Bearer ${accessToken}`;
        return axios(error.config);
      } catch {
        accessToken = null;
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
```

---

## 3. Error Format

Every error returns:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Human-readable description",
    "details": {}
  }
}
```

| HTTP Status | When |
|---|---|
| `400 Bad Request` | Validation failed, invalid state transition, business rule violation |
| `401 Unauthorized` | Missing/expired token |
| `403 Forbidden` | Not a project member, wrong org |
| `404 Not Found` | Resource not found, tenant not found |
| `409 Conflict` | Duplicate (contract number, guarantee already effective, etc.) |
| `422 Unprocessable Entity` | Workflow approval required but not configured |
| `500 Internal Server Error` | Unexpected server error |

**Validation errors** return `400` with a `message` array:
```json
{ "error": { "message": ["code must not be empty", "currency must be exactly 3 characters"] } }
```

---

## 4. Shared Types (`@erp/types`)

Import in the frontend — **do not redefine locally**:

```typescript
import type { RequestIdentity } from '@erp/types';
import {
  ProjectStatus, ProjectRole,
  CommercialModel, ParticipationModel,
  BoqVersionStatus, MeasurementMethod, PricingBasis,
  ClientStatus,
  ContractStatus, BillingModel, AdvanceType, GuaranteeStatus,
  IpaStatus, IpcStatus,
} from '@erp/types';
```

Key enums:

```typescript
// Projects
enum ProjectStatus   { DRAFT, ACTIVE, PRACTICAL_COMPLETION, CLOSEOUT, CLOSED, CANCELLED }
enum CommercialModel { CLIENT_CONTRACT, INTERNAL_CAPITAL }
enum ParticipationModel { SOLE, JOINT_VENTURE }
enum ProjectRole     { PROJECT_MANAGER, QUANTITY_SURVEYOR, SITE_ENGINEER, COMMERCIAL_MANAGER, FINANCE_REVIEWER, VIEWER }

// BOQ
enum BoqVersionStatus  { DRAFT, BASELINED, SUPERSEDED, CANCELLED }
enum MeasurementMethod { QUANTITY, PERCENTAGE, MILESTONE }
enum PricingBasis      { UNIT_RATE, LUMP_SUM }

// Clients
enum ClientStatus { ACTIVE, INACTIVE }

// Contracts
enum ContractStatus { DRAFT, UNDER_REVIEW, PENDING_SIGNATURE, ACTIVE, FINAL_ACCOUNT_PENDING, CLOSED, CANCELLED, TERMINATED }
enum BillingModel   { MEASURED_IPC, MILESTONE, TIME_AND_MATERIAL, HYBRID }
enum AdvanceType    { MOBILIZATION, MATERIAL_ON_SITE, EQUIPMENT, OTHER }
enum GuaranteeStatus { ACTIVE, DISCHARGED, EXPIRED, CALLED }

// IPA
enum IpaStatus { DRAFT, PENDING_INTERNAL_APPROVAL, RETURNED_FOR_REVISION, APPROVED_FOR_SUBMISSION, SUBMITTED, CANCELLED }

// IPC
enum IpcStatus { CERTIFIED, PARTIALLY_CERTIFIED, REJECTED }
```

---

## 5. CORS & Cookies

```typescript
// Always include credentials
fetch(url, { credentials: 'include', headers: { Authorization: `Bearer ${token}` } });

// Axios
axios.defaults.withCredentials = true;
```

---

## 6. Endpoint Catalog

All endpoints require `Authorization: Bearer <token>` unless marked public.
All endpoints are scoped to the authenticated user's organization.

---

### 6.1 Auth (public)

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/branding` | Public. `{ name: string | null }` — the organisation the request subdomain resolves to, for the login page. Nothing about a company is built into the web app (ADR-047). |
| `POST` | `/auth/login` | Login — returns accessToken + sets refresh cookie |
| `POST` | `/auth/refresh` | Rotate refresh token — returns new accessToken |
| `POST` | `/auth/logout` | Revoke refresh token + clear cookie |

---

### 6.2 Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List all users in the caller's organization |
| `GET` | `/users/:id` | Get user by ID |

> `GET /users` is scoped to the caller's organization from the JWT. No query parameters required.

**User response shape:**
```json
{
  "id": "cld...", "email": "user@acco.com",
  "firstName": "Ahmed", "lastName": "Ali",
  "status": "ACTIVE", "organizationId": "cld..."
}
```

---

### 6.3 Organizations

| Method | Path | Description |
|---|---|---|
| `GET` | `/organizations/:id` | Get organization |
| `PATCH` | `/organizations/:id/branding` | `manage:organization`. Invoice branding: logo file, legal address, tax ID, brand colour, footer note, template. |

#### Record search (⌘K, Step 2f, ADR-047)

| Method | Path | Description |
|---|---|---|
| `GET` | `/search?q=` | Authentication only. Up to 5 records per type matching number, reference or name (`q` ≥ 2 characters): invoices (`manage:receivable`), receipts (`manage:receivable` or `view:receipt`), bills and payments (`manage:payable`), manual journals (`manage:journal`), projects (`view:project`, limited to the caller's memberships), clients (`view:client`), suppliers (`manage:payable` or `view:procurement`). Returns `{ query, records: [{ kind, id, title, detail, amount, currencyCode, status, clientId }] }`. |
| `GET` | `/approvals/inbox` | ADR-049. Everything waiting on the caller's decision, oldest first: `{ items: ApprovalItem[], count }`. `ApprovalItem` = `{ kind: JOURNAL \| BILL \| PAYMENT \| QUOTATION \| MATERIAL_REQUEST \| PROGRESS_REPORT \| WORKFLOW, id, title, detail, amount, currencyCode, waitingSince, requestedByName, projectId, projectName, transactionType }`. Each queue requires its decision's permission; project documents only for the caller's projects; items an active SoD rule would bar are left out. |

#### Hand-typed invoices (ADR-048)

`manage:receivable`. For sales **outside** a construction contract only: no project, contract or
source. Lines are `{ description, quantity, unitPrice, revenueAccountCode }` (1–50), priced to
cents. Each line's account must be an active, posting INCOME account. Errors:
`400 MANUAL_INVOICE_INVALID` with `details.problems`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/invoices/manual` | Body `{ clientId, invoiceDate, dueDate, currencyCode, taxCodeId?, paymentTerms?, lines }`. Returns the invoice detail with `source.kind = 'MANUAL'` and `lines`. |
| `GET` | `/invoices/income-accounts` | `[{ code, name, subtype }]`: the active posting INCOME accounts a line may credit (`OTHER_INCOME` ones first). Readable without `manage:accounting`. |
| `PUT` | `/invoices/:id/manual` | Same body; rewrites a DRAFT in full. `409 INVOICE_NOT_DRAFT` once it is approved; `400 INVOICE_NOT_MANUAL` for a contract invoice. |
| `POST` | `/invoices/:id/cancel` | Step 2g. Body `{ reason? }` (≤500). Cancels an unposted invoice (any source except a stage plan) and frees its IPC / BOQ / separate-charge source so it can be billed again; audited `CLIENT_INVOICE_CANCELLED`. `409 INVOICE_ALREADY_POSTED` (reverse it instead) · `409 INVOICE_CANCELLED` · `400 STAGE_DRAFT_USE_COMMERCIAL` (delete it from the contract's Billing tab). The web list sends it only after an 8-second undo window. |
| `POST` | `/invoices/:id/issue` | ADR-046 §2. Same optional body as `/post` (`arAccountCode?`, `revenueAccountCode?`, `vatAccountCode?`). Approves a DRAFT and posts it in one transaction; returns the numbered invoice. A refusal leaves the draft untouched. `409 INVOICE_ALREADY_POSTED` · `409 INVOICE_CANCELLED` · `409 INVOICE_REVERSED` · any `/post` refusal. |
| `POST` | `/customer-receipts/receive` | ADR-046 §6. Body `{ clientId, bankAccountId, receiptDate, amount, currency, paymentMethod?, reference?, notes?, allocations?: [{ clientInvoiceId, amount }] }`. Records, posts (Dr the bank account's GL account / Cr AR for what is applied, Cr Unapplied for the rest) and applies in one transaction; returns the posted receipt. Requires `manage:receivable`. `400 BANK_ACCOUNT_NOT_RECEIVING` · `400 CURRENCY_MISMATCH` · `400 ALLOCATION_CLIENT_MISMATCH` · an unissued invoice or more than it owes → 400 · `409` if an invoice was paid concurrently. |
| `POST` | `/customer-receipts/:id/reverse` | AR-2. Body `{ reversalDate, reason }` (reason required). Reverses a posted receipt — a bounced cheque, money booked to the wrong client: a mirror journal on the reversal date, every invoice it paid owes again, and `reversedAt`, `reversedBy`, `reversalReason`, `reversalJournalEntryId` are recorded on the receipt (returned by `GET /customer-receipts/:id`). `400 RECEIPT_NOT_POSTED` · `400 REVERSAL_REASON_REQUIRED` · `400 RECEIPT_HAS_LATER_ALLOCATIONS` (applications made after posting are undone first). |
| `GET` | `/finance/clients/:clientId/statement` | AR-3. `manage:receivable`. Query `from`, `to` (YYYY-MM-DD; default 1 Jan of the `to` year → today). `ClientStatement` `{ client, from, to, openingBalance, lines: [{ date, kind: INVOICE·INVOICE_REVERSAL·CREDIT_NOTE·CREDIT_NOTE_REVERSAL·RECEIPT·RECEIPT_REVERSAL, documentId, reference, description, debit, credit, balance }], totals: { debits, credits }, closingBalance, aging (today), onAccount }` — every project and hand-typed sale, read from the receivables documents (so history before ledger lines carried the client is included). Receipts count in full, so cash held on account lowers the balance; today's closing balance equals open invoices less cash on account. `400 STATEMENT_PERIOD_INVALID` · `404 CLIENT_NOT_FOUND`. |
| `GET` | `/invoices/:invoiceId/write-offs` | AR-4. `manage:receivable`. `ReceivableWriteOffView[]` `{ id, invoiceId, writeOffNumber, reason: BAD_DEBT·SMALL_BALANCE, note, amount, accountingDate, status: PENDING_APPROVAL·POSTED·REJECTED·REVERSED, requestedBy, requestedByName, requestedAt, approvedByName, rejectedByName, rejectionReason, reversalReason, reversedAt }`. |
| `POST` | `/invoices/:invoiceId/write-offs` | AR-4. Body `{ amount, reason, accountingDate, note? }`. Up to the organisation's `writeOffApprovalAbove` (default $50) it posts at once (Dr the `BAD_DEBT_EXPENSE` account / Cr AR, `WO-` number, tagged with client and project); above it, it waits (`PENDING_APPROVAL`, listed in the Approvals inbox as `WRITE_OFF`). A waiting write-off counts against the balance. `400 BAD_DEBT_ACCOUNT_NOT_CONFIGURED` (nothing is saved) · `400 WRITE_OFF_EXCEEDS_BALANCE` (`details.available`) · `400 INVOICE_NOT_OPEN`. |
| `POST` | `/receivable-write-offs/:id/approve` | AR-4. Someone other than the requester (`403 WRITE_OFF_SELF_APPROVAL`); it posts. `409 WRITE_OFF_NOT_PENDING`. |
| `POST` | `/receivable-write-offs/:id/reject` | AR-4. Body `{ reason }`. |
| `POST` | `/receivable-write-offs/:id/reverse` | AR-4. Body `{ reversalDate, reason }`. A mirror journal; the invoice owes the amount again. `409 WRITE_OFF_NOT_POSTED`. |
| `GET` | `/customer-receipts/:receiptId/refunds` | AR-5. `ClientRefundView[]` `{ id, receiptId, receiptNumber, bankAccountId, refundNumber, amount, refundDate, reference, reason, status: PENDING_APPROVAL·POSTED·REJECTED·REVERSED, requestedBy, requestedByName, approvedByName, rejectionReason, reversalReason }`. |
| `POST` | `/customer-receipts/:receiptId/refunds` | AR-5. Body `{ bankAccountId, amount, refundDate, reason, reference? }`. Pays back cash the receipt holds on account: Dr Unapplied client receipts / Cr the bank's GL account (`RF-` number), the receipt's `unallocatedAmount` falls. Up to `paymentAutoApproveUpTo` it posts at once; above it, it waits (Approvals inbox `REFUND`, `parentId` = receipt). `400 REFUND_EXCEEDS_ON_ACCOUNT` (a waiting refund counts) · `BANK_ACCOUNT_NOT_PAYING` · `CURRENCY_MISMATCH` · `RECEIPT_NOT_POSTED`. |
| `POST` | `/client-refunds/:id/approve` · `/reject` · `/reverse` | AR-5. As write-offs: approve by someone other than the requester (`403 REFUND_SELF_APPROVAL`), reject `{ reason }`, reverse `{ reversalDate, reason }` (the cash is on account again). A receipt with a posted refund cannot be reversed (`400 RECEIPT_HAS_REFUNDS`). |
| `GET` / `PUT` | `/accounting/approval-settings` | ADR-046 §8. `{ invoiceApprovalAbove: string \| null, billApprovalAbove: string \| null, autoPostToleratedBills: boolean, paymentAutoApproveUpTo: string, writeOffApprovalAbove: string }`. GET for any finance user (defaults when never saved: null, null, false, "1000.00", "50.00"); `writeOffApprovalAbove` (AR-4) is optional on PUT and kept when omitted; PUT needs `manage:accounting`, saves whole, audited. `400 APPROVAL_SETTINGS_INVALID` lists every bad field in `details.problems`. Effects: `POST /invoices/:id/issue` → `409 INVOICE_APPROVAL_REQUIRED` at or above the invoice amount, and `POST /invoices/:id/approve` → `403 INVOICE_APPROVER_IS_PREPARER`; `POST /bills/:id/submit` may return the bill posted (`postedOnSave`); `POST /payments` may return it approved / posted (`approvedOnSave`, `postedOnSave`). |
| `GET` | `/finance/home` | Step 4. Finance Home: `{ asOf, cash: { total, accounts[] } \| null, receivables: { outstanding, overdue, aging[current,d1_30,d31_60,d61_90,d90_plus], topOverdue[≤5] } \| null, payables: { outstanding, overdue, dueThisWeek, dueThisWeekCount } \| null, month: { from, to, invoiced, collected, paid } \| null }`. Cash = posted GL balance of each open bank account's account. Cash and month need `view:accounting` (or `manage:accounting`); receivables also open to `manage:receivable`, payables to `manage:payable`; a section the caller may not read is null. |
| `POST` | `/payments/:id/reject` · `/cancel` | AP-1. `manage:payable`. Body `{ reason }` (required). Ends an unposted payment (DRAFT, APPROVED or RELEASED; posting NOT_POSTED or FAILED): reject is for someone other than the person who raised it, cancel only for that person (`403` otherwise). The bills it held get their `outstandingAmount` back and any open approval is voided; the payment keeps `rejectedAt/By/rejectionReason` or `cancelledAt/By/cancellationReason`. `409 PAYMENT_NOT_OPEN` when it is posted (reverse it), rejected or cancelled. Until a payment posts, the AP tie-out, the close gate and the payables aging count the bills it holds as still owed. |
| `GET` | `/payments/:id/document` | Step 4. `manage:payable`. The branded remittance advice PDF of a POSTED supplier payment, as a short-lived signed download URL `{ url, originalName, mimeType }`. Rendered on first request from the organisation's branding and invoice settings, then frozen (`supplier_payments.document_file_id`, IMMUTABLE). `409 NOT_POSTED` · `409 PAYMENT_REVERSED`. File reads need `manage:payable` (owner kind `PAYMENT_DOCUMENT`). |
| `GET` | `/finance/attachments/:kind/:ownerId` | Step 4. Files on a finance document; `kind` ∈ `INVOICE · RECEIPT · BILL · PAYMENT · JOURNAL`. Returns `FinanceAttachment[]` `{ id, fileId, fileName, mimeType, sizeBytes, addedAfterPosting, locked, createdBy, createdAt }`, newest first. Readable with the permission that runs the document (`manage:receivable` for INVOICE/RECEIPT, `manage:payable` for BILL/PAYMENT, `manage:journal` for JOURNAL) or `view:accounting`. `404 DOCUMENT_NOT_FOUND` when the id is not this organisation's document of that kind. |
| `POST` | `/finance/attachments/:kind/:ownerId` | Step 4. Body `{ platformFileId }` — a READY, TEMPORARY file the caller uploaded (`/files` presign → PUT → confirm). Needs the document's own manage permission. On a posted (or reversed) document the file is frozen on the way in (IMMUTABLE, `addedAfterPosting: true`). `400 FILE_NOT_READY · FILE_ALREADY_ATTACHED` · `403 FILE_NOT_YOURS`. File reads go through owner kind `FINANCE_ATTACHMENT` with the same read rule. |
| `DELETE` | `/finance/attachments/:kind/:ownerId/:attachmentId` | Step 4. Removes a file from a document that has not posted and discards the upload if nothing else owns it. `403 ATTACHMENT_FROZEN` once the document is posted. |
| `GET` | `/finance/aging/:side` | Step 6. `side` ∈ `receivables · payables`. Open invoices (posted or opening-balance, not cancelled, outstanding > 0) or open bills, by party and days past due as of today, in the Finance Home buckets (`current · d1_30 · d31_60 · d61_90 · d90_plus`). Returns `AgingReport` `{ side, asOf, totals, total, rows: [{ partyId, partyCode, partyName, buckets, total, oldestDaysLate, documents: [{ id, number, date, dueDate, outstanding, daysLate, bucket, opening }] }] }`, largest balance first. Receivables need `manage:receivable` or `view:accounting`; payables `manage:payable` or `view:accounting`. |
| `GET` | `/finance/vat-report?from&to` | Step 6. Output VAT for the period (YYYY-MM-DD, inclusive), read from the ledger: every posted line on a `VAT_OUTPUT_PAYABLE` account dated in the period, traced to its invoice or credit note (a reversal through the journal it reverses; anything else is an `ADJUSTMENT`). Returns `VatReport` `{ from, to, output: { byRate, invoices, creditNotes, adjustments, total, lines: [{ journalEntryId, journalNumber, accountingDate, kind, documentId, documentNumber, partyName, taxableAmount, rate, vat, reversal }] }, input: { count, taxable, vat }, closingBalance }`. `output.total` equals the VAT account's movement. Input VAT is non-recoverable (ACC-TAX-001) and shown for information. `view:accounting` or `manage:accounting`. `400 PERIOD_INVALID`. |
| `GET` | `/finance/bank-statements?bankAccountId` | Step 6. Imported statements, newest first: `BankStatementSummary[]` `{ id, bankAccountId, bankName, accountName, periodStart, statementDate, openingBalance, closingBalance, status: OPEN·RECONCILED, lineCount, unmatchedCount, reconciledAt }`. `view:accounting` or `manage:accounting`. |
| `POST` | `/finance/bank-statements` | Step 6. `manage:accounting`. Body `{ bankAccountId, periodStart, statementDate, openingBalance, closingBalance, fileName?, lines: [{ transactionDate, description, reference?, amount }] }` (amounts signed decimal strings, money in positive). Every line must fall inside the period and be non-zero; the statement must add up (`400 STATEMENT_DOES_NOT_ADD_UP` with `computedClosing`). Returns the workspace. |
| `GET` | `/finance/bank-statements/:id` | Step 6. The workspace: `{ statement, lines: [{ …, matchStatus: UNMATCHED·MATCHED·POSTED, matched, suggestion }], uncleared, reconciliation: { ledgerBalance, outstanding, adjustedLedger, statementClosing, difference, balanced }, previousClosing, canReconcile }`. A suggestion is the same-amount unmatched ledger line on the bank's GL account dated closest within 7 days, made only when unambiguous. Ledger lines dated before the account's first statement are `broughtForward` (part of its opening balance, not outstanding). |
| `POST` | `/finance/bank-statements/:id/accept-suggestions` · `/lines/:lineId/match` `{ journalLineId }` · `/lines/:lineId/unmatch` | Step 6. `manage:accounting`. One ledger line clears at most one statement line (`409 LEDGER_LINE_ALREADY_CLEARED`); it must be a posted line on this bank's GL account (`404 LEDGER_LINE_NOT_FOUND`) of the same amount (`400 AMOUNTS_DIFFER`). A posted line is undone by reversing its journal (`409 LINE_POSTED`). |
| `POST` | `/finance/bank-statements/:id/lines/:lineId/post` | Step 6. `manage:accounting`. Body `{ accountId, memo? }`. Posts a charge or interest from the line (`SourceDocType BANK_STATEMENT`, `EVT-BNK-001`, dated on the line): the bank against a postable non-control account, and matches the line to the journal's bank line (`POSTED`). `400 ACCOUNT_IS_THE_BANK · ACCOUNT_NOT_POSTABLE`. |
| `POST` | `/finance/bank-statements/:id/reconcile` · `DELETE /finance/bank-statements/:id` | Step 6. `manage:accounting`. Reconcile needs every line matched or posted and a zero difference (`409 LINES_UNMATCHED · NOT_BALANCED`); the statement then freezes (`409 STATEMENT_RECONCILED` on any later change). Delete removes an open statement with nothing posted from it (`409 STATEMENT_HAS_POSTINGS`). |
| `GET` | `/finance/close-checklist?periodId` | Step 6. The month-end close checklist, read live (no stored ticks). Default period: the earliest unclosed period that has ended, else the current one. Returns `CloseChecklist` `{ period, periods, checks: [{ key: documents·banks·tie-out·vat·lock·close, status: DONE·TODO·BLOCKED·INFO, detail, href, items }], requireBankReconciliation, readyToClose }`. Documents counts unposted invoices, receipts, bills, payments and journals dated in the month; banks, each active reconcilable account's latest reconciled statement against the month end; tie-out, the close gate's AR/AP checks; VAT, the month's VAT report. `view:accounting`, `manage:accounting` or `manage:period`. |
| `PUT` | `/finance/close-checklist/policy` | Step 6. `manage:accounting`. Body `{ requireBankReconciliation }` → `banking_policy.require_bank_review_before_close` (audited). When on, the period close gate (`/periods/:id/close`, `/close-gate`) refuses a month while any bank account is not reconciled to its end. |
| `GET` | `/document-reader/status` | Step 7. Any signed-in user. `{ available, enabled, provider, model }`: whether the server has a reader (`DOCUMENT_READER_PROVIDER` = `openrouter` default · `none`; `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` default `openrouter/free`) and whether this company turned it on. |
| `PUT` | `/document-reader/settings` | Step 7. `manage:organization`. Body `{ enabled }`. Off by default (owner decision 2026-10-28); audited. `400 READER_NOT_CONFIGURED` when enabling with no provider. |
| `POST` | `/document-reader/read` | Step 7. Body `{ platformFileId, kind: DELIVERY_NOTE·RECEIPT·QUOTE·MATERIAL_LIST }`. Needs the permission that fills that form (`create:goods-receipt`, `manage:payable`, `award:quotation`, `create:material-request`) and read access to the file; READY JPEG/PNG/WebP ≤ 8 MB. Returns `DocumentReadResult` `{ readingId, kind, supplierName, documentNumber, date, currency, total, taxAmount, lines: [{ description, quantity, unit, unitPrice, amount }], warnings }` — unreadable values are null, never guessed. Saves nothing but a `document_readings` log row (success or failure). `403 READER_DISABLED` · `429 READER_RATE_LIMITED` · `502 READER_UNREADABLE · READER_PROVIDER_ERROR · READER_TIMEOUT`. |
| `GET` | `/procurement/sent-back` | Step 7. `view:procurement` + `collect:quotation`. The signed-in collector's items to redo, newest first: `SentBackItem[]` `{ kind: QUOTATION_RETURNED·QUOTE_REJECTED·RECEIPT_REJECTED, id, quotationRequestId, number, storeName, reason, note, at }`. A returned round while still RETURNED; a rejected quote until a newer quote is added to its round; a rejected receipt until a newer one is sent for the same order. |
| `POST` | `/finance/import/:kind/check` | Step 5. `kind` ∈ `suppliers · clients`. Body `{ rows: SetupImportRow[], defaultCountry, openingDate?, skipRowsWithErrors? }`; every cell is text as typed in the sheet (`name, code, taxNumber, contactName, phone, email, paymentTerms, currency, address, city, country, clientType, openingBalance`), plus per row `action?: CREATE · MERGE · SKIP` and `mergeIntoId?`. Saves nothing. Returns `SetupImportCheck` `{ kind, rows: [{ index, status: READY·WARNING·ERROR·SKIPPED, action, problems: [{ field, code, severity, message, relatedIndex? }], duplicateOf, openingBalance }], summary: { total, toCreate, toMerge, skipped, withErrors, withWarnings, openingBalanceTotal, openingItems }, openingBalancesOpen }`. Suppliers need `manage:payable`; clients `create:client` or `manage:receivable`; a row with a balance needs `manage:accounting` (else `OPENING_BALANCES_FORBIDDEN`). `400 OPENING_DATE_REQUIRED · TOO_MANY_ROWS (2000) · NOTHING_TO_IMPORT`. |
| `POST` | `/finance/import/:kind` | Step 5. Same body. Re-runs the check, then in one transaction creates the records through `SupplierService` / `ClientService` (audited; blank supplier codes become `SUP-000001`…) and records each balance as an approved open bill / invoice in `OPENING_BALANCE` status (USD, due `openingDate` + terms, `migrationBatchId` = the batch). Balances close once the opening-balance journal is posted (`OPENING_BALANCES_CLOSED`). `400 IMPORT_HAS_ERRORS` unless `skipRowsWithErrors`. Returns `{ kind, created, merged, skipped, openingItems, openingBalanceTotal, batchReference }`. |

`POST /clients` also accepts `manage:receivable` (ADR-048 §7: add a client without leaving the invoice).
`GET /invoices/:id` now also returns `lines: ManualInvoiceLineDto[]` (empty for source invoices).
Posting a manual invoice credits each income account for its lines (`409 MANUAL_LINES_MISMATCH` if
the lines and subtotal disagree).

#### Saved list views (Step 2a, ADR-047)

Authentication only. A view is a named list state (`{ search?, filters?, sort?, columns? }`, strings
only, validated) saved on one list (`listKey`, e.g. `invoices`). Personal to its owner; an admin
(`manage:organization`) may publish it to everyone and may then edit or delete it. Someone else's
personal view answers 404. At most 30 views per user per list; names are unique per owner and list.

| Method | Path | Description |
|---|---|---|
| `GET` | `/saved-views?listKey=` | The caller's views plus every published view: `SavedViewDto[]` (`{ id, listKey, name, state, published, mine, createdAt, updatedAt }`). |
| `POST` | `/saved-views` | Body `{ listKey, name, state }`. `409 SAVED_VIEW_NAME_TAKEN` / `SAVED_VIEW_LIMIT`; `400 SAVED_VIEW_INVALID` with `details.problems`. |
| `PATCH` | `/saved-views/:id` | Body `{ name?, state? }`. Owner, or an admin for a published view. |
| `POST` | `/saved-views/:id/publish` · `/unpublish` | `manage:organization`. |
| `DELETE` | `/saved-views/:id` | `204`. Owner, or an admin for a published view. |

#### Company templates (Step 1b, ADR-047)

Rukna ships a default payment plan and building schedule; a company may save its own copy and reset
to the default. `GET` needs `view:project`; the writes need `manage:organization` and are audited
(`COMPANY_TEMPLATE_SAVED` / `COMPANY_TEMPLATE_RESET`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/company-templates` | `{ paymentPlan: { rows: [{ name, percentage, isAdvance }], isDefault }, schedule: { phases: [{ name, durationDays, scheduleOnly }], isDefault } }` — the templates in force. |
| `PUT` | `/company-templates/payment-plan` | Body `{ rows }` (1–20). Stages total exactly 100%, at most one advance, names required, up to 2 decimals. `400 TEMPLATE_INVALID` with `details.problems: string[]`. |
| `DELETE` | `/company-templates/payment-plan` | Back to the Rukna default. Returns the `GET` shape. |
| `PUT` | `/company-templates/schedule` | Body `{ phases }` (1–30). Unique names, whole-day durations 1–365. Applying `STANDARD_BUILDING` (`POST …/apply-schedule-template`) uses this copy. |
| `DELETE` | `/company-templates/schedule` | Back to the Rukna default. |

---

### 6.4 Roles / Permissions / Audit Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/roles` | List roles for the authenticated org |
| `GET` | `/roles/matrix` | Step 3. `view:role`. `{ roles: (RoleSummary & { permissionIds: string[] })[] }`: every role with the permission ids it grants, in one read, for the roles matrix. Saving uses `PUT /roles/:id/permissions` per changed role. |
| `GET` | `/permissions` | List all platform permissions |
| `GET` | `/audit-logs` | Step 8. `view:audit-logs`. Query `search` (action, resource, record id, reason, person's name or email), `resource`, `userId`, `from`/`to` (inclusive YYYY-MM-DD), `page`, `pageSize` (default 50, max 100). Returns `AuditLogPage` `{ items: [{ id, createdAt, action, resource, resourceId, reason, ipAddress, user: { id, name, email } \| null }], total, page, pageSize, facets: { resources, users } }`, newest first. (Was a bare array capped at the latest 50, with no names.) |

---

### 6.5 Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows/bindings` | Governance trigger bindings the org is subject to (own + tenant defaults), read-only |
| `GET` | `/workflows/definition/:transactionType` | Active workflow definition (org from JWT — no body) |
| `GET` | `/workflows/instance/:instanceId/step` | Current pending approval step |
| `POST` | `/workflows/instance/:instanceId/approve` | Approve current step |
| `POST` | `/workflows/instance/:instanceId/reject` | Reject current step |

> `GET /workflows/bindings` (permission `workflows:view`) returns each `WorkflowTriggerBinding` — `triggerKind`, `entityType`, `transactionType`, `fromState`, `toState`, `priority`, `isActive`, `organizationId` (null = tenant default) — with the `definition` it routes to and that definition's ordered `steps`. It shows **what is wired and what is active**; it does not activate anything. Activation stays a deliberate act until ACCO confirms the policy (ADR-007), so there is intentionally no create/toggle endpoint here yet.

> `GET /workflows/definition/:transactionType` requires **no request body** and no query params — the organization is read from the JWT automatically.

> `approve` and `reject` bodies accept only optional `notes`. Do **not** send `actorId` — the acting user is always taken from the JWT:
> ```json
> { "notes": "Approved — quantities verified on site" }
> ```

> `approve`/`reject` now **enforce** `step.roleRequired` against the caller's roles and are
> org-scoped (B16/#45). A caller without the step's required role gets `403`.

#### Governed state transitions — the `409` gate (ADR-011, ADR-015)

Certain state-changing commands route through the governance seam. When a DOA
`WorkflowTriggerBinding` is configured for the transition, the command creates an
`ApprovalInstance` and returns **`409 Conflict`** with the instance id instead of transitioning.
The id is under `error.details` (the global error envelope):

```json
{ "success": false, "error": {
  "code": "...", "message": "Purchase order submission requires workflow approval.",
  "details": { "approvalInstanceId": "cld..." } } }
```

Frontend: read `error.details.approvalInstanceId` off the `409` (`ApiError.details`).

Governed today: `POST /purchase-orders/:id/submit` (`PurchaseOrder` DRAFT→SUBMITTED),
`POST /bills/:id/submit` (`SupplierBill` DRAFT→SUBMITTED),
`POST /payments/:id/approve` (`SupplierPayment` DRAFT→APPROVED), plus IPA and Project transitions.

**Loop-back (re-drive):** after approvers finish (`approve` down the chain until the instance is
`APPROVED`), the client **re-invokes the same command**; the gate finds the approved instance,
consumes it, and the transition proceeds. With **no** binding configured the command behaves
exactly as before (no `409`). Frontend contract: on `409`, show "pending approval", surface the
approval panel via `approvalInstanceId`, and re-call the command once the instance reads `APPROVED`.

> With no seeded bindings, none of these gate today — governance is wired and functional but
> **switched off by configuration**. There is no admin UI yet to create bindings/requirement
> policies (the "config" gap).

---

### 6.6 Clients

Clients redesign (2026-10-02). Full contract: [`docs/design/clients-redesign-contract.md`](../design/clients-redesign-contract.md);
wire types in `@erp/types` (`packages/types/src/clients.ts`). Money follows one gate,
`view:financial-position`: without it every money field is `null` (never `"0.00"`). Every write is
audited in its own transaction (`audit_logs.resource = 'client'`, `sourceCommand = client.*`).

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/clients` | `view:client` | All clients (pickers), name order |
| `GET` | `/clients/summary` | `view:client` | List: `search` (name, code, contact name), `status`, `type`, `balance=OWES\|OVERDUE`, `sort=name\|-name\|outstanding\|-outstanding`, `page`, `pageSize` (≤100). Returns `{ items, total, page, pageSize, moneyVisible }` |
| `GET` | `/clients/duplicate-candidates?name=` | `view:client` | Up to 5 similar names |
| `POST` | `/clients` | `create:client` | Create with a **required** `primaryContact` (phone required). Returns the record |
| `GET` | `/clients/:id` | `view:client` | Record: master data, contacts (primary first), `allowedCommands`, `deactivationBlockedBy` |
| `GET` | `/clients/:id/overview` | `view:client` | Metrics, projects, unpaid invoices (money gated) |
| `GET` | `/clients/:id/activity?limit=10` | `view:client` | Audit entries; invoices/receipts only with money permission |
| `PATCH` | `/clients/:id` | `manage:client` | Master data only (`null` clears). `status` is refused — use deactivate/reactivate |
| `POST` | `/clients/:id/deactivate` | `manage:client` | `{ reason }` (3–500). `409 CLIENT_HAS_ACTIVE_PROJECTS` (any project not CLOSED/CANCELLED) · `409 CLIENT_HAS_OPEN_BALANCE` (Σ outstanding of POSTED invoices > 0) · `409 CLIENT_ALREADY_INACTIVE` |
| `POST` | `/clients/:id/reactivate` | `manage:client` | `409 CLIENT_ALREADY_ACTIVE` when already active |
| `POST` | `/clients/:id/contacts` | `manage:client` | Add contact; the first is always primary; `isPrimary: true` demotes the current one. Returns the contact |
| `PATCH` | `/clients/:id/contacts/:contactId` | `manage:client` | Edit contact (`role`/`whatsappPhone`/`email` clear with `null`; phone cannot be cleared). Returns the contact |
| `POST` | `/clients/:id/contacts/:contactId/make-primary` | `manage:client` | Demote + promote in one transaction. Returns the contact |
| `DELETE` | `/clients/:id/contacts/:contactId` | `manage:client` | `204`; `409 CONTACT_IS_PRIMARY` for the primary |

**Create client — request body:**
```json
{
  "name": "Baraka Real Estate LLC",
  "type": "COMPANY",
  "taxNumber": "SO-123456",
  "registrationNumber": "BL-2024-0091",
  "paymentTermsDays": 30,
  "countryCode": "SO",
  "city": "Mogadishu",
  "address": "Maka Al Mukarama Rd, Building 12",
  "invoiceEmail": "accounts@baraka.so",
  "primaryContact": {
    "name": "Mohammed Hassan",
    "role": "Finance Director",
    "phone": { "country": "SO", "number": "61 234 5678" },
    "whatsappPhone": "+252612345678",
    "email": "m.hassan@baraka.so"
  }
}
```

> `code` (`CLI-000001`) is assigned by the server, unique per org, immutable.
> Input rules: names trimmed/whitespace-collapsed (1–255); phones `{ country, number }` or a `+…`
> string, validated with libphonenumber-js and stored **E.164**; emails trimmed + lower-cased.
> Errors are `400` with `error.code` = `NAME_INVALID` / `PHONE_INVALID` / `EMAIL_INVALID` /
> `COUNTRY_INVALID` / `PAYMENT_TERMS_INVALID` / `FIELD_INVALID` / `REASON_INVALID` / `NO_CHANGES`
> and `error.details.field` naming the field (e.g. `primaryContact.phone`).

**Get client response:**
```json
{
  "id": "cld...", "organizationId": "org...", "code": "CLI-000001",
  "name": "Baraka Real Estate LLC", "type": "COMPANY", "status": "ACTIVE",
  "taxNumber": "SO-123456", "registrationNumber": "BL-2024-0091", "paymentTermsDays": 30,
  "defaultCurrency": "USD", "countryCode": "SO", "city": "Mogadishu",
  "address": "Maka Al Mukarama Rd, Building 12", "invoiceEmail": "accounts@baraka.so", "notes": null,
  "createdAt": "2026-10-02T09:00:00.000Z", "updatedAt": "2026-10-02T09:00:00.000Z",
  "contacts": [
    {
      "id": "cld...", "clientId": "cld...", "name": "Mohammed Hassan", "role": "Finance Director",
      "phone": "+252612345678", "whatsappPhone": "+252612345678", "email": "m.hassan@baraka.so",
      "isPrimary": true, "createdAt": "2026-10-02T09:00:00.000Z"
    }
  ],
  "allowedCommands": ["DEACTIVATE"],
  "deactivationBlockedBy": null
}
```

> **One primary contact per client** is a database invariant (partial unique index
> `client_contacts_one_primary_per_client`, migration `20261002120000_client_contact_details`).

---

### 6.7 Projects

#### List / Create / Get / Update

| Method | Path | Description |
|---|---|---|
| `GET` | `/projects` | List (`?status=ACTIVE`) |
| `POST` | `/projects` | Create DRAFT |
| `GET` | `/projects/:id` | Get with members + suspension |
| `GET` | `/projects/:id/workspace-summary` | Permission-aware setup, responsibility and main-contract projection |
| `GET` | `/projects/:id/workspace-guidance` | Ordered, lifecycle-aware project setup and control guidance |
| `GET` | `/projects/:id/activity` | Project history, newest first, cursor-paged (see below) |
| `PATCH` | `/projects/:id` | Update (DRAFT only) |

The workspace summary is organization- and membership-scoped. Main-contract metadata requires
`view:contract`; contract value and currency additionally require `view:financial-position`.
It is the authoritative source for project setup state and workspace header summaries.
Workspace guidance is computed server-side and returned in `URGENT`, `WARNING`, then
`INFO` order; the frontend only localizes and presents their typed `kind`.
This project-setup guidance is not the cross-domain `AttentionQueryService` contract
reserved by `frontend-design.md` for approvals, expiry, payment, milestone, and suspension alerts.
The workspace Overview presents it as setup and control guidance, not as the Attention Required panel.

`recentActivity` on the workspace summary is the first **5** events of `GET /projects/:id/activity`
(same selection, same shape — see below). Each event now also carries `command`, `resourceType`
and `resourceId` (additive, 2026-09-28).

**Project activity (ADR-019 amendment 2026-09-28):**
```
GET /projects/:id/activity?cursor=<nextCursor>&limit=25
→ { items: [{ id, action, sourceCommand, command, resourceType, resourceId, occurredAt,
              actor: { id, name }, target: { label, href? } | null }],
    nextCursor: string | null }
```
- `view:project` + project membership (`@ProjectScoped`), like the other project reads. Newest
  first (`createdAt DESC, id DESC`), keyset cursor (opaque; pass `nextCursor` back). `limit`
  defaults to 25, is clamped to 100; a non-integer/`< 1` limit or a malformed cursor is a `400`.
- Rows: audit events on the project **and the records it owns**. Outbox rows (`sourceCommand`
  set) on the project, its contracts and their children/variations (**only with
  `view:contract`**, which also gates project-level `commercial.*` rows), its documents/revisions
  and programme baselines; plus request-logged rows (`sourceCommand: null`) of project routes that
  write no outbox row — project edit, member add/remove/roles, BOQ create/import/draft/commit/
  baseline/cancel/contingency draw (**only with `view:boq`**), programme/progress setup. BOQ line
  edits are excluded. Full list: `projects/domain/project-activity.ts`.
- `command` is always a stable code — the `sourceCommand`, or the catalogued code of a
  request-logged route (`project.update`, `project.addMember`, `boq.commit`, …). It is not display
  text; clients map it to a label and fall back on `resourceType`.
- `target` (additive, 2026-09-30) names what the event was done to by its business reference —
  never an amount: contract number (contract, payment plan, retention terms), payment-stage /
  deliverable name, advance-term description, guarantee reference, variation reference, invoice
  number (`commercial.issuePackage` / `issueInvoice`; `preparePackage` names the payment stage, its drafts have no number yet), receipt number
  (`commercial.recordProjectPayment`), document number (+ `rev. <code>` for a revision),
  programme baseline `v<n>`. `href` is the app route when one exists (Contract page, invoice page,
  document page). `null` for project rows, request-logged rows (their id is the project, so the
  BOQ version, member or report is unknown), records without a reference, and deleted records.
  Resolved per page with one query per record kind, held to the org and project
  (`projects/domain/project-activity-targets.ts`).

**Create project — request body:**
```json
{
  "code": "ACCO-2026-001",
  "name": "Al-Baraka Tower Construction",
  "nameAr": "مشروع برج البركة",
  "commercialModel": "CLIENT_CONTRACT",
  "participationModel": "SOLE",
  "contractValue": 4500000.00,
  "currency": "USD",
  "startDate": "2026-09-01",
  "expectedEndDate": "2028-03-31"
}
```

> `commercialModel` defaults to `CLIENT_CONTRACT`. Use `INTERNAL_CAPITAL` for capex projects (no client contract required).

#### Lifecycle Commands

All return the updated project. All return `400` if the transition is invalid from the current status.

| Method | Path | From → To |
|---|---|---|
| `POST` | `/projects/:id/start` | `DRAFT` → `ACTIVE` |
| `POST` | `/projects/:id/practical-completion` | `ACTIVE` → `PRACTICAL_COMPLETION` ⚠️ |
| `POST` | `/projects/:id/closeout` | `PRACTICAL_COMPLETION` → `CLOSEOUT` |
| `POST` | `/projects/:id/close` | `CLOSEOUT` → `CLOSED` |
| `POST` | `/projects/:id/reopen-to-active` | `PRACTICAL_COMPLETION` → `ACTIVE` |
| `POST` | `/projects/:id/reopen-to-practical-completion` | `CLOSEOUT` → `PRACTICAL_COMPLETION` |

> ⚠️ **`practical-completion`** automatically moves all `ACTIVE` contracts for this project to `FINAL_ACCOUNT_PENDING`. The UI should warn the user before calling this endpoint.

**Readiness (ADR-019 Phase B — query before you command):**
```
GET /projects/:id/readiness?command=start
→ { command, targetStatus, ready,
    conditions: [{ code, severity: MANDATORY|WAIVABLE, satisfied, detail,
                   blockedBy: string[], satisfiedAt: string | null }],
    deferred: [],
    caller: { canRun: boolean, waivableConditions: string[] } }
```
Call this to render a readiness dashboard **before** `start`/`close`. `ready` is false while any condition is unsatisfied.

Additive since 2026-09-28 (ADR-019 amendment):
- `blockedBy` — codes in the same response that must be satisfied first. Only genuine data
  dependencies: today `CONTRACT_START_DATE → ACTIVE_MAIN_CONTRACT`. There is **no**
  `BOQ_BASELINED → ACTIVE_MAIN_CONTRACT` edge (ADR-032).
- `satisfiedAt` — ISO time the condition became true, or `null` when there is no trustworthy
  source (always `null` for `CLIENT_ACTIVE` and `PROGRAMME_DATES`; sources in
  `docs/design/project-overview-implementation.md` §6.2).
- `caller` — for the requesting user: `canRun` = holds `manage:project` and the command would pass
  readiness once a reason is supplied for each of `waivableConditions` (the unsatisfied conditions
  this user may waive: WAIVABLE ones, plus — for `start`, CFO/CEO only — `ACTIVE_MAIN_CONTRACT` /
  `CONTRACT_START_DATE`, ADR-026 Route 7A). Workflow approval may still answer `409`; status and
  suspension are not re-checked here. Computed with the same `planEnforcement` the command uses.

**Start (now takes a body — ADR-019 Phase B2):**
```
POST /projects/:id/start
{ "actualStartDate": "2026-09-01", "commencementNote": "…?",
  "overrides": [{ "condition": "PROGRAMME_DATES", "reason": "…" }]? }
```
`actualStartDate` is **required**. Readiness is **enforced**: a `400` lists unmet MANDATORY conditions, WAIVABLE conditions that need an override, and invalid overrides. A WAIVABLE condition is only unblocked by an `override` targeting that specific `condition` code with a reason (there is no whole-command `force`). Each waiver is audited.

**Close (now takes a body — ADR-019 Phase B2):**
```
POST /projects/:id/close
{ "closureDate": "2027-09-30", "closureSummary": "Final account agreed, retention released." }
```
Both fields **required**. (Close currently has no queryable readiness conditions — those grow as final-account / commitments / inventory / retention become queryable.)

**Cancel:**
```
POST /projects/:id/cancel
{ "reason": "Client withdrew due to funding issues" }
```
Allowed from: `DRAFT`, `ACTIVE`.

**Suspend / Resume:**
```
POST /projects/:id/suspend  { "reason": "..." }
POST /projects/:id/resume
```

**Members:**
```
GET    /projects/:id/members
POST   /projects/:id/members   { "userId": "cld...", "roles": ["SITE_ENGINEER"] }
DELETE /projects/:id/members/:userId
```

> **`422`** on any controlled lifecycle command means a workflow approval configuration is required but missing. The API does not silently pass through — it rejects. Surface this to the user as a configuration issue.

---

### 6.8 BOQ (Bill of Quantities)

All routes nested under `/projects/:projectId/boq`. Governed by ADR-016 — read it before
changing anything here. Response contracts live in `@erp/types` (`BoqWorkspaceResponse`,
`BoqTreeNodeResponse`, `BoqBaselineReadinessResponse`, `BoqCompareResponse`).

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/projects/:id/boq` | `manage:boq` | Initialize BOQ (idempotent). Currency is seeded from the project. |
| `GET` | `/projects/:id/boq` | `view:boq` | BOQ + version list |
| `GET` | `/projects/:id/boq/workspace` | `view:boq` | **Workspace read model** — versions, totals, contract baseline, readiness, capabilities |
| `GET` | `/projects/:id/boq/versions/:leftId/compare/:rightId` | `view:boq` | Version diff, paired on `originNodeId` |
| `POST` | `/projects/:id/boq/draft` | `manage:boq` | New draft from approved (`{ "notes": "..." }`) |
| `GET` | `/projects/:id/boq/versions/:vId/readiness` | `view:boq` | **Baseline readiness** — the same evaluation `baseline` enforces |
| `POST` | `/projects/:id/boq/versions/:vId/baseline` | `baseline:boq` | Lock draft as approved |
| `POST` | `/projects/:id/boq/versions/:vId/cancel` | `manage:boq` | Cancel draft |
| `GET` | `/projects/:id/boq/versions/:vId/tree` | `view:boq` | Full recursive tree |
| `POST` | `/projects/:id/boq/versions/:vId/nodes` | `manage:boq` | Add node |
| `PATCH` | `/projects/:id/boq/versions/:vId/nodes/:nId` | `manage:boq` | Update node |
| `POST` | `/projects/:id/boq/versions/:vId/nodes/:nId/move` | `manage:boq` | Move node + descendants. **Returns the reindexed tree.** |
| `DELETE` | `/projects/:id/boq/versions/:vId/nodes/:nId` | `manage:boq` | Delete a node |

**BOQ Item Library (ADR-020 CONST-BOQ-020/021)** — org-level reusable work items, distinct from the Material catalogue.

| Method | Path | Perm | Description |
|---|---|---|---|
| `GET` | `/boq-item-library?q=` | `view:boq` | Search reusable work items (code / description) |
| `POST` | `/boq-item-library` | `manage:boq` | Save a work item `{ code, description, defaultUnit?, measurementMethod?, pricingBasis?, category? }` |
| `POST` | `/boq-item-library/:id/record-usage` | `manage:boq` | Record the rate an item was used at `{ rate, projectId? }` — assistance only, no authoritative rate |

**Add node — request body:**
```json
{
  "parentId": "cld...",
  "sortOrder": 1,
  "code": "01.01",
  "description": "Excavation",
  "descriptionAr": "حفر",
  "isLeaf": true,
  "unit": "m³",
  "quantity": "1200.000",
  "unitRate": "45.00",
  "currency": "USD",
  "measurementMethod": "QUANTITY",
  "pricingBasis": "UNIT_RATE"
}
```

> **`quantity` and `unitRate` are decimal strings, not numbers** (CONST-BOQ-014) — the same
> convention as `AddIpaItemDto`. They were JSON numbers before ADR-016.
>
> `sortOrder` is optional; omit it to append. Sibling positions are dense, unique and
> server-owned (CONST-BOQ-017), so an out-of-range value is clamped rather than rejected.
>
> `currency` is optional and must equal the BOQ currency when supplied — a BOQ holds one
> currency (CONST-BOQ-013). Sections carry no unit, quantity, rate or currency.
>
> `measurementMethod` and `pricingBasis` are leaf-node properties, default `QUANTITY` /
> `UNIT_RATE`. They are snapshotted onto IPA items — do not change them after baselining.
> (These were documented here but unreachable through the API until ADR-016 — blocker C9.)

**Tree node response shape:**
```json
{
  "id": "cld...", "code": "01.01", "description": "Excavation",
  "isLeaf": true, "unit": "m³", "quantity": "1200.000",
  "unitRate": "45.00", "totalAmount": "54000.00",
  "currency": "USD", "measurementMethod": "QUANTITY", "pricingBasis": "UNIT_RATE",
  "sourceType": "BASELINE", "sourceChangeOrderId": null, "isActive": true,
  "computedTotal": "54000.00", "children": []
}
```

> **`computedTotal` is a string.** It was a JSON number while `totalAmount` beside it was a
> string — the same quantity in two representations on one object (blocker B7). A section's
> `computedTotal` is the decimal sum of its descendants; `null` means unpriced, which is not
> the same fact as `"0.00"`.

**Baseline readiness — response:**
```json
{
  "ready": false,
  "sectionCount": 18, "itemCount": 426,
  "pricedItemCount": 409, "incompleteItemCount": 17,
  "duplicateCodeCount": 3,
  "totalAmount": "12585000.00", "currency": "USD",
  "blockers": [
    { "kind": "MISSING_RATE", "nodeId": "cld...", "code": "02.01.002",
      "description": "Rock excavation", "message": "Item 02.01.002 is missing a rate." }
  ],
  "warnings": [
    { "kind": "EMPTY_SECTION", "nodeId": "cld...", "code": "03",
      "message": "Section 03 contains no items." }
  ]
}
```

Blocker kinds: `NO_BILLABLE_ITEMS`, `DUPLICATE_CODE`, `MISSING_UNIT`, `MISSING_QUANTITY`,
`MISSING_RATE`, `CURRENCY_MISMATCH`, `STRUCTURE_INVALID`, `VARIATION_REQUIRED`.
Warnings never block — a zero rate is a provisional sum, not an error.

**Error responses specific to BOQ:**

| Status | When | Payload |
|---|---|---|
| `400` | Node validation failed | `details.violations[]` with `code` + `message` |
| `400` | Baseline attempted on an unready version | `details.blockers[]` — same shape as the readiness query |
| `403` | Any node write against a non-DRAFT version (CONST-BOQ-005) | — |
| `409` | Delete blocked by downstream references (CONST-BOQ-003) | `details.references[]` = `{ source, count }` |
| `409` | Baseline requires approval (CONST-BOQ-018 / ADR-011) | `details.approvalInstanceId` |

The `409` approval path follows ADR-015 re-drive: approve the instance, then re-invoke
`POST …/baseline` and it completes.

---

### 6.9 Contracts

| Method | Path | Description |
|---|---|---|
| `GET` | `/contracts` | List (`?projectId=cld...`) |
| `POST` | `/contracts` | Create DRAFT |
| `GET` | `/contracts/:id` | Get with all sub-entities |
| `PATCH` | `/contracts/:id` | Update (DRAFT only) |

**Create contract — request body:**
```json
{
  "projectId": "cld...",
  "clientId": "cld...",
  "boqVersionId": "cld...",
  "contractNumber": "ACCO-2026-001",
  "contractValue": "5000000.00",
  "currency": "USD",
  "billingModel": "MEASURED_IPC",
  "startDate": "2026-09-01",
  "expectedEndDate": "2028-03-31"
}
```

> `boqVersionId` must reference a **BASELINED** BOQ version — this is the contractual scope baseline. `contractValue` is stored independently from the BOQ total (they may differ after negotiation).

**Get contract response:**
```json
{
  "id": "cld...", "contractNumber": "ACCO-2026-001",
  "status": "ACTIVE", "billingModel": "MEASURED_IPC",
  "contractValue": "5000000.00", "currency": "USD",
  "clientNameSnapshot": "Baraka Real Estate LLC",
  "clientTaxSnapshot": "SO-123456",
  "retentionTerms": {
    "retentionRate": "0.0500",
    "retentionCap": "0.1000",
    "retentionSplitOnPC": "0.5000"
  },
  "advanceTerms": [],
  "guarantees": [],
  "milestones": [],
  "attachments": []
}
```

> `clientNameSnapshot` and `clientTaxSnapshot` are frozen at the moment the contract is executed (PENDING_SIGNATURE → ACTIVE). They never change even if the Client record is later updated.

#### Contract Lifecycle Commands

| Method | Path | From → To | Notes |
|---|---|---|---|
| `POST` | `/contracts/:id/submit` | `DRAFT` → `UNDER_REVIEW` | |
| `POST` | `/contracts/:id/approve-review` | `UNDER_REVIEW` → `PENDING_SIGNATURE` | |
| `POST` | `/contracts/:id/execute` | `PENDING_SIGNATURE` → `ACTIVE` | Freezes client snapshots |
| `POST` | `/contracts/:id/close` | `FINAL_ACCOUNT_PENDING` → `CLOSED` | |
| `POST` | `/contracts/:id/cancel` | `DRAFT / UNDER_REVIEW / PENDING_SIGNATURE` → `CANCELLED` | Body: `{ "reason": "..." }` |
| `POST` | `/contracts/:id/terminate` | `ACTIVE` → `TERMINATED` | Body: `{ "reason": "..." }` |

> `FINAL_ACCOUNT_PENDING` is set automatically when the parent project reaches `PRACTICAL_COMPLETION`. The user cannot set it manually.

> **Activation requires the signed date (D3, 2026-09-28).** `POST /contracts/:id/activate` returns
> **`400`** with `error.code = CONTRACT_SIGNED_DATE_REQUIRED` when the contract has no `signedDate`.
> Record it first with `PATCH /contracts/:id/signed-date` (`{ "signedDate": "YYYY-MM-DD" }`, allowed on
> DRAFT and on any non-terminal contract). `POST /contracts/record-signed` captures the date up front
> and is unaffected.

> **Commercial term lifecycle gate (CONST-COM-001 / ADR-017).** The retention, advance,
> guarantee (add), and milestone (add) endpoints below, and `PATCH /contracts/:id`, mutate
> the commercial **baseline** and are accepted only while the contract is `DRAFT`. On any
> later status they return **`409 Conflict`** with a reason code
> (`CONTRACT_UNDER_REVIEW` | `CONTRACT_BASELINE_FROZEN` | `CONTRACT_TERMINAL`). Operational
> exceptions: `PATCH /contracts/:id/guarantees/:guaranteeId` (status change) is allowed in
> any non-terminal status, and `POST /contracts/:id/milestones/:milestoneId/complete` is
> allowed in `ACTIVE`/`FINAL_ACCOUNT_PENDING`. Every child endpoint is scoped by
> `contractId + childId` and returns **`404`** if the child belongs to another contract or
> tenant (CONST-COM-002).

#### Retention Terms (1:1)

```
POST /contracts/:id/retention-terms
```
```json
{
  "retentionRate": "0.05",
  "retentionCap": "0.10",
  "retentionSplitOnPc": "0.50"
}
```

> This endpoint upserts — calling it again replaces the existing terms.

#### Advance Terms (1:many)

```
POST   /contracts/:id/advance-terms
DELETE /contracts/:id/advance-terms/:termId
```

**Add advance term — body:**
```json
{
  "advanceType": "MOBILIZATION",
  "description": "Initial mobilization advance",
  "percentage": "0.10",
  "recoveryRate": "0.15"
}
```

> Provide either `amount` (fixed USD value) or `percentage` (fraction of contract value). `recoveryRate` is the fraction deducted from each IPC until fully recovered.

#### Guarantees (1:many)

```
POST   /contracts/:id/guarantees
PATCH  /contracts/:id/guarantees/:guaranteeId
```

**Add guarantee — body:**
```json
{
  "guaranteeType": "PERFORMANCE",
  "amount": "250000.00",
  "currency": "USD",
  "issuer": "Premier Bank Somalia",
  "beneficiary": "ACCO Ltd",
  "issueDate": "2026-09-01",
  "expiryDate": "2028-03-31",
  "notes": "Valid for the full contract period"
}
```

**Update guarantee — body:**
```json
{ "status": "DISCHARGED", "notes": "Released on project close" }
```

> `guaranteeType` is a free string — `PERFORMANCE` and `ADVANCE_PAYMENT` are the confirmed ACCO types.

#### Milestones (1:many)

```
POST /contracts/:id/milestones
POST /contracts/:id/milestones/:milestoneId/complete
```

**Add milestone — body:**
```json
{
  "name": "Structural Completion",
  "description": "All structural elements above ground complete",
  "dueDate": "2027-06-30",
  "sortOrder": 1
}
```

---

### 6.9b Commercial workspace read models (ADR-017, Gate B)

Project-scoped, read-only aggregation across contract / IPA / IPC / AR. Construction reads
AR data (ARCH-BOUNDARY-001: construction → accounting). Guarded by `view:contract` +
project membership.

| Method | Path | Description |
|---|---|---|
| `GET` | `/projects/:projectId/commercial/summary` | Permission-aware commercial summary |
| `GET` | `/projects/:projectId/commercial/current-cycle` | Server-owned lifecycle stage, blocker and permitted next action |
| `GET` | `/projects/:projectId/commercial/applications` | IPA → IPC → invoice → settlement chain |
| `GET` | `/projects/:projectId/commercial/overview` | Commercial overview: contract, financial position, current position, attention |
| `GET` | `/projects/:projectId/commercial/billing-packages` | Invoices grouped per milestone stage (milestone invoice + variation lines) |

**Overview agrees with the cycle (2026-09-27).** `overview.currentCycle.nextAction` is taken
from `current-cycle`: it is `null` whenever the cycle is blocked (`MILESTONE_NOT_VERIFIED`) or
the caller cannot bill (`manage:receivable`), so the card never offers what the ribbon says is
blocked. `nextAction.label` is kept for compatibility; the web renders its own label from
`nextAction.kind`. `financialPosition.draftInvoiceCount` counts live invoices raised but not
yet posted (DRAFT/APPROVED, not POSTED) — they are outside `netBilled`; `null` when money is
hidden. Each `billing-packages` document carries `postingStatus`: a stage whose invoice is not
`POSTED` is a draft, never "issued".

**Strict milestone evidence (2026-09-28, ADR-023 amendment).** A `MILESTONE`-trigger installment is
billable only when linked to a VERIFIED programme milestone. `POST …/installments/:id/ready-to-bill`,
`POST /invoices/from-installment` and `issue-package` return `400` otherwise, and `current-cycle`
reports `blockers: ['MILESTONE_NOT_LINKED']` or `['MILESTONE_NOT_VERIFIED']`. `ADVANCE` and
An `ADVANCE` installment is billable once the contract is executed (`ACTIVE`) —
otherwise `400` with reason `CONTRACT_NOT_ACTIVE`; no site evidence is required. `TIME_BASED`
installments are not gated by this rule.

**Commercial tab redesign (2026-09-28, `docs/design/commercial-tab-implementation.md`).** All
additive; types in `@erp/types` (`construction.ts`, section "Commercial tab redesign"). Money is
`null` without the margin tier (`resolveBoqVisibility(identity).canViewMargin` — `view-margin:boq` or
`view:financial-position`), never `"0"`. Refusals are `400` with the reason in `error.code`.

| Method | Path | Permission | Returns |
|---|---|---|---|
| `GET` | `/projects/:projectId/commercial/workspace` | `view:contract` | `CommercialWorkspaceResponse` — contract facts, bar facts, ranked `todo`, capabilities |
| `GET` | `/projects/:projectId/commercial/installments/:installmentId/prepare-preview` | `view:contract` + `manage:receivable` | `CommercialPreparePreviewResponse` (`taxRate` = the AR invoice rate); `400 STAGE_ALREADY_INVOICED` |
| `POST` | `/projects/:projectId/commercial/installments/:installmentId/prepare-package` | `view:contract` + `manage:receivable` | `201` `CommercialPreparePackageResponse` — DRAFTS only (stage + one per selected VO addition; omissions net into the stage). Records `readyToBillAt/By` when unset. `400`: `CONTRACT_NOT_ACTIVE`, `MILESTONE_NOT_LINKED`, `MILESTONE_NOT_VERIFIED`, `STAGE_ALREADY_INVOICED`, `VARIATION_NOT_BILLABLE`, `INVALID_DUE_DATE` |
| `POST` | `/projects/:projectId/commercial/invoices/:invoiceId/issue` | `view:contract` + `manage:receivable` | `CommercialIssueInvoiceResponse` — approve + number + post the draft and every draft of its stage package (a separate charge alone) in one transaction; org branding re-snapshotted first. Idempotent. `400 INVOICE_CANCELLED`, or the posting gate (`installmentBillingBlocker(at:'post')`) |
| `DELETE` | `/projects/:projectId/commercial/invoices/:invoiceId` | `view:contract` + `manage:receivable` | `CommercialDeleteDraftInvoiceResponse` — cancels the draft and its package drafts, releases their variation allocations, frees the stage (or certificate) to be prepared again. `400 INVOICE_ALREADY_ISSUED` / `INVOICE_CANCELLED` |
| `POST` | `/projects/:projectId/commercial/invoices/:invoiceId/credit-notes` | `manage:receivable` | Create a NOT_POSTED credit note against a posted invoice (Slice 6B). |
| `POST` | `/projects/:projectId/commercial/invoices/:invoiceId/credit-notes/:creditNoteId/post` | `manage:receivable` | Post it (EVT-AR-007, `CN-` number), reducing the invoice outstanding. Only a `NOT_POSTED`/`FAILED` credit note posts. |
| `POST` | `/projects/:projectId/commercial/invoices/:invoiceId/credit-notes/:creditNoteId/reverse` | `manage:receivable` | Phase 0 H2 — body `{ reversalDate, reason }`. Reverses a posted credit note (EVT-AR-008, mirror journal) and restores the invoice outstanding; `postingStatus` → `REVERSED`. `400` when not posted or the invoice is not posted. |
| `GET` | `/invoices/:invoiceId/credit-notes` | `manage:receivable` | AR-1 — every credit note on the invoice, oldest first: `{ id, creditNoteNumber, reason, netAmount, vatAmount, totalAmount, accountingDate, postingStatus, note, reversedAt, reversalReason }`. |
| `POST` | `/invoices/:invoiceId/credit-notes` | `manage:receivable` | AR-1 — Finance's route for **any** posted invoice, project or not (a hand-typed sale has no project). Body `{ reason: OMISSION·PRICE_ERROR·CORRECTION, netAmount, accountingDate, note? }`; `netAmount` a positive amount, ≤ 2 decimals. Negative variations stay on the project route. |
| `POST` | `/invoices/:invoiceId/credit-notes/:creditNoteId/post` | `manage:receivable` | AR-1 — posts it; `404 CREDIT_NOTE_NOT_FOUND` when the credit note belongs to another invoice. With no account given, revenue is taken back off the invoice lines' own income accounts, split by line amount (an invoice without lines uses the project-revenue role). |
| `POST` | `/invoices/:invoiceId/credit-notes/:creditNoteId/reverse` | `manage:receivable` | AR-1 — body `{ reversalDate, reason }` (reason ≥ 3 chars); as the project route. |
