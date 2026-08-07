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
enum ProjectStatus   { DRAFT, APPROVED, MOBILIZING, ACTIVE, PRACTICAL_COMPLETION, CLOSEOUT, CLOSED, CANCELLED }
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

---

### 6.4 Roles / Permissions / Audit Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/roles` | List roles for the authenticated org |
| `GET` | `/permissions` | List all platform permissions |
| `GET` | `/audit-logs` | List audit log entries |

---

### 6.5 Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows/definition/:transactionType` | Active workflow definition (org from JWT — no body) |
| `GET` | `/workflows/instance/:instanceId/step` | Current pending approval step |
| `POST` | `/workflows/instance/:instanceId/approve` | Approve current step |
| `POST` | `/workflows/instance/:instanceId/reject` | Reject current step |

> `GET /workflows/definition/:transactionType` requires **no request body** and no query params — the organization is read from the JWT automatically.

> `approve` and `reject` bodies accept only optional `notes`. Do **not** send `actorId` — the acting user is always taken from the JWT:
> ```json
> { "notes": "Approved — quantities verified on site" }
> ```

---

### 6.6 Clients

| Method | Path | Description |
|---|---|---|
| `GET` | `/clients` | List clients (`?status=ACTIVE`) |
| `POST` | `/clients` | Create client |
| `GET` | `/clients/:id` | Get client with contacts |
| `PATCH` | `/clients/:id` | Update client |
| `POST` | `/clients/:id/contacts` | Add contact |
| `DELETE` | `/clients/:id/contacts/:contactId` | Remove contact |

**Create client — request body:**
```json
{
  "code": "CLIENT-001",
  "name": "Baraka Real Estate LLC",
  "nameAr": "شركة البركة للعقارات",
  "taxNumber": "SO-123456",
  "defaultCurrency": "USD",
  "status": "ACTIVE"
}
```

> `code` is unique per org, max 30 chars, **immutable after creation**.

**Get client response:**
```json
{
  "id": "cld...", "code": "CLIENT-001",
  "name": "Baraka Real Estate LLC", "nameAr": "شركة البركة للعقارات",
  "taxNumber": "SO-123456", "defaultCurrency": "USD", "status": "ACTIVE",
  "contacts": [
    {
      "id": "cld...", "name": "Mohammed Hassan",
      "role": "Finance Director", "email": "m.hassan@baraka.so",
      "phone": "+252612345678", "isPrimary": true
    }
  ]
}
```

**Add contact — request body:**
```json
{
  "name": "Mohammed Hassan",
  "role": "Finance Director",
  "email": "m.hassan@baraka.so",
  "phone": "+252612345678",
  "isPrimary": true
}
```

> Setting `isPrimary: true` clears the flag on any existing primary contact for this client.

---

### 6.7 Projects

#### List / Create / Get / Update

| Method | Path | Description |
|---|---|---|
| `GET` | `/projects` | List (`?status=ACTIVE`) |
| `POST` | `/projects` | Create DRAFT |
| `GET` | `/projects/:id` | Get with members + suspension |
| `PATCH` | `/projects/:id` | Update (DRAFT only) |

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
| `POST` | `/projects/:id/approve` | `DRAFT` → `APPROVED` |
| `POST` | `/projects/:id/mobilize` | `APPROVED` → `MOBILIZING` |
| `POST` | `/projects/:id/activate` | `MOBILIZING` → `ACTIVE` |
| `POST` | `/projects/:id/practical-completion` | `ACTIVE` → `PRACTICAL_COMPLETION` ⚠️ |
| `POST` | `/projects/:id/closeout` | `PRACTICAL_COMPLETION` → `CLOSEOUT` |
| `POST` | `/projects/:id/close` | `CLOSEOUT` → `CLOSED` |
| `POST` | `/projects/:id/reopen-to-active` | `PRACTICAL_COMPLETION` → `ACTIVE` |
| `POST` | `/projects/:id/reopen-to-practical-completion` | `CLOSEOUT` → `PRACTICAL_COMPLETION` |

> ⚠️ **`practical-completion`** automatically moves all `ACTIVE` contracts for this project to `FINAL_ACCOUNT_PENDING`. The UI should warn the user before calling this endpoint.

**Cancel:**
```
POST /projects/:id/cancel
{ "reason": "Client withdrew due to funding issues" }
```
Allowed from: `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE`.

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

All routes nested under `/projects/:projectId/boq`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/projects/:id/boq` | Initialize BOQ (idempotent) |
| `GET` | `/projects/:id/boq` | Get BOQ + version list |
| `POST` | `/projects/:id/boq/draft` | New draft from approved (`{ "notes": "..." }`) |
| `POST` | `/projects/:id/boq/versions/:vId/baseline` | Lock draft as approved |
| `POST` | `/projects/:id/boq/versions/:vId/cancel` | Cancel draft |
| `GET` | `/projects/:id/boq/versions/:vId/tree` | Full recursive tree |
| `POST` | `/projects/:id/boq/versions/:vId/nodes` | Add node |
| `PATCH` | `/projects/:id/boq/versions/:vId/nodes/:nId` | Update node |
| `POST` | `/projects/:id/boq/versions/:vId/nodes/:nId/move` | Move node + all descendants |
| `DELETE` | `/projects/:id/boq/versions/:vId/nodes/:nId` | Delete leaf node |

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
  "quantity": 1200,
  "unitRate": 45.00,
  "currency": "USD",
  "measurementMethod": "QUANTITY",
  "pricingBasis": "UNIT_RATE"
}
```

> `measurementMethod` and `pricingBasis` are leaf-node properties. Default: `QUANTITY` / `UNIT_RATE`. These values are snapshotted onto IPA items — do not change after BOQ is baselined.

**Tree node response shape:**
```json
{
  "id": "cld...", "code": "01.01", "description": "Excavation",
  "isLeaf": true, "unit": "m³", "quantity": "1200.000",
  "unitRate": "45.00", "totalAmount": "54000.00",
  "measurementMethod": "QUANTITY", "pricingBasis": "UNIT_RATE",
  "computedTotal": 54000.00, "children": []
}
```

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

### 6.10 IPA (Interim Payment Applications)

ACCO's internal commercial valuation submitted to the client.

| Method | Path | Description |
|---|---|---|
| `GET` | `/ipa` | List (`?contractId=cld...`) |
| `POST` | `/ipa` | Create DRAFT |
| `GET` | `/ipa/:id` | Get with items and deductions |

**Create IPA — body:**
```json
{
  "contractId": "cld...",
  "periodFrom": "2026-10-01",
  "periodTo": "2026-10-31",
  "exchangeRateCurrency": "USD",
  "exchangeRateBase": "SOS",
  "exchangeRateValue": "557300.000000",
  "exchangeRateDate": "2026-10-31",
  "notes": "Monthly valuation — October"
}
```

> The exchange rate snapshot is frozen at creation and never changes, even if rates are updated later.

#### IPA Lifecycle Commands

| Method | Path | From → To | Notes |
|---|---|---|---|
| `POST` | `/ipa/:id/submit-for-approval` | `DRAFT` or `RETURNED_FOR_REVISION` → `PENDING_INTERNAL_APPROVAL` | Requires workflow configured |
| `POST` | `/ipa/:id/return-for-revision` | `PENDING_INTERNAL_APPROVAL` → `RETURNED_FOR_REVISION` | |
| `POST` | `/ipa/:id/approve-for-submission` | `PENDING_INTERNAL_APPROVAL` → `APPROVED_FOR_SUBMISSION` | Assigns application number |
| `POST` | `/ipa/:id/submit` | `APPROVED_FOR_SUBMISSION` → `SUBMITTED` | IPA becomes immutable |
| `POST` | `/ipa/:id/cancel` | `DRAFT / RETURNED_FOR_REVISION` → `CANCELLED` | |

> **Application number** is assigned at `APPROVED_FOR_SUBMISSION`. It is a sequential integer per contract (`applicationRef`: `IPA-001`, `IPA-002`, etc.). A DRAFT IPA has `applicationNumber: null`.

> Once **`SUBMITTED`**, the IPA is immutable. No items or deductions can be added.

#### IPA Items

```
POST   /ipa/:id/items
DELETE /ipa/:id/items/:itemId
```

**Add item — body:**
```json
{
  "boqNodeId": "cld...",
  "cumulativeClaimed": "960.000"
}
```

> `cumulativeClaimed` is the **total quantity/percentage claimed to date** including this application (not just this period). The API automatically resolves `previousEffectiveCertified` from the last effective IPC for this contract + BOQ node. `periodQuantity = cumulativeClaimed − previousEffectiveCertified`.

> **Unit rate and currency are never supplied by the client.** The server reads `unitRate` and `currency` directly from the BOQ node on every add-item call. This prevents tampering with the contracted rate.

> **Quantity cap:** `cumulativeClaimed` must not exceed the BOQ node's `quantity`. The API returns `400` if the cap is breached.

> Only DRAFT and RETURNED_FOR_REVISION IPAs accept items.

> The `boqNodeId` must be a **leaf** BOQ node and must belong to the BOQ version referenced by the contract. The `measurementMethodSnapshot` is auto-copied from the BOQ node.

**Get IPA response (item shape):**
```json
{
  "id": "cld...",
  "boqNodeId": "cld...",
  "measurementMethodSnapshot": "QUANTITY",
  "unitRateSnapshot": "45.00",
  "currencySnapshot": "USD",
  "cumulativeClaimed": "960.000",
  "previousEffectiveCertified": "800.000",
  "periodQuantity": "160.000",
  "periodAmount": "7200.00"
}
```

#### IPA Deductions

```
POST   /ipa/:id/deductions
DELETE /ipa/:id/deductions/:deductionId
```

**Add deduction — body:**
```json
{
  "deductionType": "RETENTION",
  "sourceTermId": "cld...",
  "rate": "0.0500",
  "basis": "7200.00",
  "amount": "360.00"
}
```

> `deductionType`: `RETENTION`, `ADVANCE_RECOVERY`, `TAX`, or any custom string. `sourceTermId` links to the `ContractRetentionTerms` or `ContractAdvanceTerm` that governs this deduction.

---

### 6.11 IPC (Interim Payment Certificates)

The client/consultant's certified response to an IPA. Independent aggregate — one application can have multiple certificates.

| Method | Path | Description |
|---|---|---|
| `GET` | `/ipc` | List (`?applicationId=cld...`) |
| `POST` | `/ipc` | Issue a new certificate |
| `GET` | `/ipc/:id` | Get with items and deductions |
| `POST` | `/ipc/:applicationId/supersede` | Atomic supersession |

**Issue IPC — body:**
```json
{
  "applicationId": "cld...",
  "status": "CERTIFIED",
  "currency": "USD",
  "exchangeRateCurrency": "USD",
  "exchangeRateBase": "SOS",
  "exchangeRateValue": "557300.000000",
  "exchangeRateDate": "2026-11-15",
  "notes": "Certified at 95% progress",
  "items": [
    {
      "applicationItemId": "cld...",
      "certifiedQuantity": "152.000",
      "varianceReason": "5% withheld pending site inspection"
    }
  ],
  "deductions": [
    {
      "deductionType": "TAX",
      "basis": "6840.00",
      "amount": "342.00"
    }
  ]
}
```

> **`certifiedTotal` is NOT sent by the client.** The server computes it as the sum of `certifiedQuantity × unitRateSnapshot` across all items. Sending it in the body has no effect.

> **RETENTION and ADVANCE_RECOVERY deductions are NOT sent by the client.** The server auto-derives them from the contract's `retentionTerms` and `advanceTerms`. If included in `deductions`, they are silently ignored. Only ad-hoc deduction types (e.g., `TAX`, `CONTRA`) should be supplied.

> **IPA must be `SUBMITTED`** before a certificate can be issued. The API returns `400` if the application is in any other status.

> **`varianceReason` is required** when `certifiedQuantity ≠ cumulativeClaimed` on the application item. The API returns `400` if missing.

> **`isEffective` rule:** The first `CERTIFIED` or `PARTIALLY_CERTIFIED` certificate for an application automatically becomes effective on issue (`isEffective: true`). A `REJECTED` certificate never becomes effective.

> **Supersession:** If an effective certificate already exists and you issue a new one, it is created with `isEffective: false`. You must explicitly supersede via `POST /ipc/:applicationId/supersede`.

**Supersede — body:**
```json
{
  "newCertificateId": "cld...",
  "reason": "Revised following client objection to line 3 deduction"
}
```

> This is an atomic operation: the current effective certificate gets `isEffective = false` + `supersededAt` + `supersessionReason`. The new certificate gets `isEffective = true` + `effectiveAt`.

**IPC response shape:**
```json
{
  "id": "cld...",
  "applicationId": "cld...",
  "certificateNumber": 1,
  "certificateRef": "IPC-001",
  "status": "CERTIFIED",
  "isEffective": true,
  "effectiveAt": "2026-11-15T10:30:00.000Z",
  "certifiedTotal": "6840.00",
  "currency": "USD",
  "supersededAt": null,
  "supersededById": null,
  "items": [...],
  "deductions": [...]
}
```

---

### 6.12 Finance (Payment Receipts)

Records cash received from clients and allocates it against certified IPCs.

| Method | Path | Description |
|---|---|---|
| `GET` | `/receipts` | List receipts (`?clientId=cld...`) |
| `POST` | `/receipts` | Record a new receipt |
| `GET` | `/receipts/:id` | Get receipt with allocations |
| `POST` | `/receipts/:id/allocations` | Allocate receipt amount against an IPC |
| `DELETE` | `/receipts/:id/allocations/:allocationId` | Remove an allocation |
| `GET` | `/receipts/certificate/:certificateId/payment-status` | Derive payment status for an IPC |

**Record receipt — body:**
```json
{
  "clientId": "cld...",
  "receiptDate": "2026-11-20",
  "amount": "6498.00",
  "currency": "USD",
  "exchangeRate": "557300.00",
  "reference": "BK-TXN-20261120-8821",
  "notes": "Wire transfer via Premier Bank"
}
```

**Allocate to IPC — body:**
```json
{
  "certificateId": "cld...",
  "allocatedAmount": "6498.00"
}
```

> The API guards that cumulative allocations never exceed the receipt amount. On breach, `400` is returned with the available unallocated balance.

> One receipt can be allocated across multiple IPCs (partial payment support). Multiple receipts can be allocated to one IPC.

**Payment status response:**
```json
{
  "totalAllocated": "6498.00",
  "netCertified": "6498.00",
  "status": "PAID"
}
```

> `status` is **derived** from allocations — there is no `status` field on the IPC itself. The three possible values are `UNPAID`, `PARTIALLY_PAID`, `PAID`.

> `netCertified` is `sum(items.certifiedAmount) − sum(deductions.amount)` computed server-side. `PAID` means `totalAllocated ≥ netCertified`. Both values are **decimal strings**, never raw numbers.

> **Allocation guards (all return `400`):**
> - Receipt client ≠ IPC contract client (cross-client allocation blocked)
> - Receipt currency ≠ IPC currency (cross-currency allocation blocked)
> - `allocatedAmount ≤ 0` (negative or zero allocation blocked)
> - Cumulative allocations would exceed receipt amount (over-allocation blocked)

---

## 7. Lifecycle State Machines

### Project

```
DRAFT ──approve──► APPROVED ──mobilize──► MOBILIZING ──activate──► ACTIVE
                                                                      │
                                               PRACTICAL_COMPLETION ◄─┘
                                                │             │
                                    reopen-to-active    closeout
                                                │             │
                                             ACTIVE        CLOSEOUT
                                                         │        │
                                             reopen-to-pc    close
                                                         │        │
                                             PRACTICAL_COMPLETION  CLOSED

CANCELLED ◄── (DRAFT, APPROVED, MOBILIZING, ACTIVE)
```

Suspend/Resume is a separate overlay — does not change status.
`PRACTICAL_COMPLETION` triggers all ACTIVE contracts → `FINAL_ACCOUNT_PENDING`.

---

### Contract

```
DRAFT ──submit──► UNDER_REVIEW ──approve-review──► PENDING_SIGNATURE ──execute──► ACTIVE ──► FINAL_ACCOUNT_PENDING ──close──► CLOSED
                                                                                             (set by project lifecycle)
CANCELLED ◄── (DRAFT, UNDER_REVIEW, PENDING_SIGNATURE)
TERMINATED ◄── (ACTIVE)
```

`execute` freezes `clientNameSnapshot` and `clientTaxSnapshot`.

---

### IPA

```
DRAFT ──submit-for-approval──► PENDING_INTERNAL_APPROVAL ──approve-for-submission──► APPROVED_FOR_SUBMISSION ──submit──► SUBMITTED (immutable)
                                        │
                              return-for-revision
                                        │
                              RETURNED_FOR_REVISION ──submit-for-approval──► (back to top)

CANCELLED ◄── (DRAFT, RETURNED_FOR_REVISION)
```

Application number assigned at `APPROVED_FOR_SUBMISSION`.

---

### IPC

IPC has no lifecycle transitions — it is issued in a terminal status.

```
Issue → CERTIFIED         (first: isEffective=true automatically)
     → PARTIALLY_CERTIFIED (first: isEffective=true automatically)
     → REJECTED            (never effective)

Supersede: explicit command swaps isEffective between old and new cert.
```

---

## 8. Key Business Rules (UI must enforce or handle)

| Rule | Implication for UI |
|---|---|
| BOQ nodes must be **leaf** for IPA items | Only show leaf nodes in the item picker |
| `cumulativeClaimed` is total-to-date, not period-only | Show the calculation: `period = cumulative − prev certified` |
| `cumulativeClaimed` must not exceed BOQ node `quantity` | Show the BOQ node's remaining quantity; disable submit if exceeded |
| Unit rate and currency come from the BOQ node — never supply them | Remove `unitRateSnapshot` / `currencySnapshot` from the add-item form |
| `varianceReason` required when certified ≠ claimed | Validate in form before submitting IPC |
| `certifiedTotal` is server-computed — do not send it | Remove `certifiedTotal` from the issue-IPC form |
| RETENTION and ADVANCE_RECOVERY deductions are auto-generated | Do not show RETENTION/ADVANCE_RECOVERY deduction inputs to the user |
| IPA must be `SUBMITTED` before a certificate can be issued | Disable "Issue Certificate" unless IPA status is SUBMITTED |
| One effective IPC per application | Disable "issue" button if effective cert exists; show "supersede" instead |
| Contract `execute` freezes client snapshots | Warn user before executing: "Client details will be locked permanently" |
| `PRACTICAL_COMPLETION` moves all ACTIVE contracts to `FINAL_ACCOUNT_PENDING` | Show confirmation dialog listing affected contracts before calling |
| Receipt allocation: client must match IPC contract client | Only show IPCs for the same client as the receipt in the allocation picker |
| Receipt allocation: currency must match IPC currency | Filter or warn when receipt and IPC currencies differ |
| Receipt allocation cannot exceed receipt amount | Show remaining unallocated balance in allocation form |
| IPA is immutable after `SUBMITTED` | Hide edit controls once SUBMITTED |
| `422` on lifecycle = workflow not configured | Show "Approval workflow not configured — contact admin" message |

---

---

### 6.13 Chart of Accounts

| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts` | List all accounts in the org |
| `POST` | `/accounts` | Create a new account |
| `GET` | `/accounts/:id` | Get account with version history |
| `GET` | `/accounts/by-code/:code` | Look up account by GL code |
| `POST` | `/accounts/import` | Bulk import COA from array |

**Create account — body:**
```json
{
  "code": "1010",
  "name": "Cash at Bank",
  "nameAr": "النقد في البنك",
  "accountClass": "ASSET",
  "accountSubtype": "CASH_AND_BANK",
  "normalBalance": "DEBIT",
  "isPostingAllowed": true,
  "isControlAccount": false,
  "effectiveFrom": "2025-01-01"
}
```

**`accountClass` values:** `ASSET` `LIABILITY` `EQUITY` `INCOME` `COST_OF_SALES` `EXPENSE`

**`normalBalance` values:** `DEBIT` `CREDIT`

> Control accounts (`isControlAccount: true`) block manual journal postings. Only the posting engine can write to them. Set `controlledSubledgerType` to `ACCOUNTS_RECEIVABLE` or `ACCOUNTS_PAYABLE` on the control account that your AR/AP postings target.

**Bulk import — body:**
```json
{
  "accounts": [
    { "code": "1010", "name": "Cash", "accountClass": "ASSET", "accountSubtype": "CASH_AND_BANK", "normalBalance": "DEBIT" },
    { "code": "4000", "name": "Revenue", "accountClass": "INCOME", "accountSubtype": "PROJECT_REVENUE", "normalBalance": "CREDIT" }
  ]
}
```

---

### 6.14 Fiscal Years and Periods

| Method | Path | Description |
|---|---|---|
| `GET` | `/fiscal-years` | List fiscal years for the org |
| `POST` | `/fiscal-years` | Create a new fiscal year |
| `GET` | `/fiscal-years/:id` | Get fiscal year with all periods |
| `GET` | `/fiscal-years/period/covering` | Find the period covering a date (`?date=2025-01-15`) |

**Create fiscal year — body:**
```json
{
  "year": 2025,
  "retainedEarningsAccountCode": "3100"
}
```

> Creating a fiscal year automatically generates 12 accounting periods (Jan–Dec). All start as `OPEN`. Manage their state via `/periods/:id/lock`, `/periods/:id/close`, etc. (Section 6.20).

**Fiscal year response:**
```json
{
  "id": "cld...", "name": "FY2025",
  "startDate": "2025-01-01", "endDate": "2025-12-31",
  "status": "OPEN",
  "retainedEarningsAccountId": "cld...",
  "periods": [
    { "id": "cld...", "periodNumber": 1, "name": "January 2025",
      "startDate": "2025-01-01", "endDate": "2025-01-31", "status": "OPEN" }
  ]
}
```

**`status` values for FiscalYear:** `OPEN` `CLOSED`

**`status` values for AccountingPeriod:** `OPEN` `LOCKED` `CLOSED` `REOPENED`

---

### 6.15 Bank Accounts

| Method | Path | Description |
|---|---|---|
| `GET` | `/bank-accounts` | List bank accounts for the org |
| `POST` | `/bank-accounts` | Configure a bank account |
| `GET` | `/bank-accounts/:id` | Get bank account detail |

**Configure bank account — body:**
```json
{
  "accountName": "Main Operating Account",
  "bankName": "Premier Bank Somalia",
  "accountNumber": "1234567890",
  "currencyCode": "USD",
  "glAccountCode": "1010",
  "allowsReceipts": true,
  "allowsPayments": true
}
```

> `glAccountCode` must reference an account with `accountSubtype: CASH_AND_BANK`. This GL account is debited on receipts and credited on payments.

---

### 6.16 Opening Balance (Migration)

```
POST /accounting/opening-balance
```

One-time wizard to migrate from the previous system. Call once per organization per fiscal year. Do not call again after live transactions have been posted — the endpoint creates immutable OPENING_BALANCE journal entries.

**Body:**
```json
{
  "cutoverDate": "2025-01-01",
  "batchReference": "OB-MIGRATION-2025",
  "arAccountCode": "1200",
  "apAccountCode": "2000",
  "trialBalance": [
    { "accountCode": "1010", "debitBalance": 50000 },
    { "accountCode": "3100", "creditBalance": 50000 }
  ],
  "openArInvoices": [
    { "clientId": "cld...", "invoiceRef": "INV-001", "amount": 12000, "dueDate": "2025-02-28" }
  ],
  "openApBills": [
    { "supplierId": "cld...", "supplierInvoiceRef": "BILL-001", "amount": 5000, "dueDate": "2025-02-15" }
  ]
}
```

> The wizard validates that the trial balance debits equal credits before posting. On `400`, no entries are created.

---

### 6.17 Manual Journals

The standard general-ledger journal entry — reviewed and approved by CFO before posting.

| Method | Path | Description |
|---|---|---|
| `GET` | `/journals` | List journals (`?status=DRAFT&periodId=...`) |
| `POST` | `/journals` | Create a DRAFT journal |
| `GET` | `/journals/:id` | Get journal with all lines |
| `POST` | `/journals/:id/submit` | Submit for CFO approval |
| `POST` | `/journals/:id/approve` | CFO approve or reject |
| `POST` | `/journals/:id/post` | Post an approved journal to the GL |
| `POST` | `/journals/:id/reverse` | Reverse a posted journal |

**Create journal — body:**
```json
{
  "accountingDate": "2025-01-15",
  "description": "Accrual — January office rent",
  "currencyCode": "USD",
  "lines": [
    {
      "accountId": "cld...",
      "debitAmount": 2500,
      "transactionCurrencyCode": "USD",
      "memo": "Rent expense Jan"
    },
    {
      "accountId": "cld...",
      "creditAmount": 2500,
      "transactionCurrencyCode": "USD",
      "memo": "Accrued liability"
    }
  ]
}
```

> Exactly one of `debitAmount` or `creditAmount` must be provided per line. The other defaults to zero. The server validates ∑ debits = ∑ credits before allowing the journal to be posted.

> `accountingDate` must fall within an `OPEN` or `REOPENED` period. `LOCKED` periods only accept `journalCategory: CLOSING_ADJUSTMENT`. `CLOSED` periods reject all postings.

**Approve — body:**
```json
{ "approved": true }
```
```json
{ "approved": false, "rejectionReason": "Account codes incorrect — use 4100 not 4000" }
```

**Reverse — body:**
```json
{ "reversalDate": "2025-02-01", "reason": "Accrual reversed on actual invoice receipt" }
```

**Journal status lifecycle:**
```
DRAFT → SUBMITTED → APPROVED → POSTED
                  → REJECTED (back to DRAFT for correction)
POSTED → REVERSED (via /reverse)
```

---

### 6.18 Client Invoices (AR)

Formal accounting invoice raised against a certified IPC. This is the AR-layer counterpart to the Sprint 3 IPC — it creates the double-entry GL posting.

| Method | Path | Description |
|---|---|---|
| `GET` | `/invoices` | List client invoices (`?clientId=...&status=...`) |
| `POST` | `/invoices/from-ipc` | Generate invoice from a certified IPC |
| `GET` | `/invoices/:id` | Get invoice with GL status |
| `POST` | `/invoices/:id/approve` | Approve the invoice |
| `POST` | `/invoices/:id/post` | Post to AR control account |
| `POST` | `/invoices/:id/reverse` | Reverse a posted invoice |

**Generate from IPC — body:**
```json
{
  "ipcId": "cld...",
  "invoiceDate": "2025-01-20",
  "dueDate": "2025-02-20",
  "paymentTerms": "NET_30"
}
```

> The server reads `certifiedTotal`, `currency`, and `clientId` from the IPC. You do not supply amounts — they come from the IPC.

**Post to GL — body:**
```json
{
  "arAccountCode": "1200",
  "revenueAccountCode": "4000",
  "vatAccountCode": "2100"
}
```

> Posting creates: Dr AR control / Cr Revenue (+ VAT liability if applicable). After posting, the invoice `outstandingAmount` tracks how much remains uncollected.

**Reverse — body:**
```json
{ "reversalDate": "2025-01-25", "reason": "Issued in error — incorrect IPC reference" }
```

**Invoice `documentStatus` values:** `DRAFT` `APPROVED` `CANCELLED`

**Invoice `postingStatus` values:** `NOT_POSTED` `POSTED` `REVERSED` `OPENING_BALANCE`

---

### 6.19 Customer Receipts and Allocations (AR)

Records cash collected and allocates it to reduce outstanding invoice balances.

> **Note:** Sprint 3 also has `GET/POST /receipts` for operational payment tracking. The endpoints in this section are the **accounting layer** — they create GL postings. They are distinct services but may share the same underlying PaymentReceipt entity. If you are building the Finance accounting workspace (not the project-level receipt view), use these endpoints.

| Method | Path | Description |
|---|---|---|
| `GET` | `/receipts` | List receipts with posting status |
| `GET` | `/receipts/:id` | Get receipt with allocations and GL status |
| `POST` | `/receipts/:id/post` | Post receipt to GL (Dr Bank / Cr AR or Unapplied) |
| `POST` | `/receipts/:id/allocations` | Allocate posted receipt to a client invoice |
| `POST` | `/receipts/:id/allocations/:allocationId/reverse` | Reverse a specific allocation |
| `POST` | `/receipts/:id/reverse` | Reverse the entire receipt posting |

**Post receipt — body:**
```json
{
  "bankAccountCode": "1010",
  "arAccountCode": "1200",
  "unappliedAccountCode": "2050"
}
```

> If the receipt is not immediately allocated, it lands in the `unappliedAccountCode` (a liability). Allocation moves it from unapplied to AR.

**Allocate to invoice — body:**
```json
{
  "clientInvoiceId": "cld...",
  "amount": 6498.00,
  "arAccountCode": "1200",
  "unappliedAccountCode": "2050"
}
```

> `amount` must not exceed `receipt.unallocatedAmount`. Returns `400` if over-allocation is attempted.

**Reverse allocation — body:**
```json
{
  "arAccountCode": "1200",
  "unappliedAccountCode": "2050"
}
```

---

### 6.20 Supplier Bills (AP)

| Method | Path | Description |
|---|---|---|
| `GET` | `/bills` | List supplier bills (`?supplierId=...&status=...`) |
| `POST` | `/bills` | Create a new supplier bill |
| `GET` | `/bills/:id` | Get bill with lines and GL status |
| `POST` | `/bills/:id/submit` | Submit for approval |
| `POST` | `/bills/:id/approve` | Approve or reject |
| `POST` | `/bills/:id/post` | Post to AP control account |
| `POST` | `/bills/:id/reverse` | Reverse a posted bill |

**Create bill — body:**
```json
{
  "supplierId": "cld...",
  "supplierInvoiceNumber": "SUP-INV-2025-001",
  "billDate": "2025-01-10",
  "dueDate": "2025-02-10",
  "currencyCode": "USD",
  "lines": [
    {
      "description": "Concrete delivery — Jan batch",
      "quantity": 50,
      "unitPrice": 120.00,
      "amount": 6000.00,
      "postingProfileCode": "GENERAL-EXPENSE"
    }
  ]
}
```

> `postingProfileCode` maps to a `PostingProfile` configured in the accounting setup. It determines which expense GL account is debited when the bill is posted.

**Post to GL — body:**
```json
{ "apAccountCode": "2000" }
```

> Posting creates: Dr Expense (per posting profile) / Cr AP control account.

**Bill `postingStatus` values:** `NOT_POSTED` `POSTED` `REVERSED` `OPENING_BALANCE`

---

### 6.21 Supplier Payments (AP)

| Method | Path | Description |
|---|---|---|
| `GET` | `/payments` | List supplier payments |
| `POST` | `/payments` | Create a payment record |
| `GET` | `/payments/:id` | Get payment with allocations |
| `POST` | `/payments/:id/approve` | Approve or reject |
| `POST` | `/payments/:id/post` | Post to GL (Dr AP / Cr Bank or Advance) |
| `POST` | `/payments/:id/allocations` | Allocate advance payment against a supplier bill |
| `POST` | `/payments/:id/allocations/:allocationId/reverse` | Reverse an advance allocation |
| `POST` | `/payments/:id/reverse` | Reverse the entire payment |

**Create payment — body:**
```json
{
  "supplierId": "cld...",
  "bankAccountId": "cld...",
  "paymentDate": "2025-01-20",
  "accountingDate": "2025-01-20",
  "currencyCode": "USD",
  "totalAmount": 6000.00,
  "paymentMethod": "BANK_TRANSFER"
}
```

**Post to GL — body:**
```json
{
  "apAccountCode": "2000",
  "bankGlCode": "1010",
  "supplierAdvanceCode": "1300"
}
```

> If the payment has no bill allocated yet (advance payment), it goes to `supplierAdvanceCode` (an asset). Once allocated to a bill, the advance is reversed and the AP is cleared.

**Allocate advance to bill — body:**
```json
{
  "supplierBillId": "cld...",
  "amount": 6000.00,
  "apAccountCode": "2000",
  "supplierAdvanceCode": "1300"
}
```

---

### 6.22 Financial Reports

All report endpoints require `Authorization: Bearer <token>`. All results are scoped to the authenticated user's organization.

**Important:** Monetary amounts in all report responses are decimal strings (e.g. `"1200.00"`), not raw JavaScript numbers. Never render them without `formatCurrency()`.

#### Account Ledger

```
GET /reports/ledger/:accountId?fromDate=2025-01-01&toDate=2025-01-31
```

Optional filters: `&projectId=cld...` `&departmentId=cld...` `&costCenterId=cld...`

**Response:**
```json
{
  "accountId": "cld...",
  "accountCode": "1010",
  "accountName": "Cash at Bank",
  "openingBalance": "48500.00",
  "periodDebit": "6000.00",
  "periodCredit": "2500.00",
  "closingBalance": "52000.00",
  "lines": [
    {
      "journalEntryId": "cld...",
      "journalNumber": "JE-000001",
      "accountingDate": "2025-01-10",
      "documentDate": "2025-01-10",
      "description": "Receipt from Baraka Real Estate",
      "debitAmount": "6000.00",
      "creditAmount": "0.00",
      "runningBalance": "54500.00",
      "sourceDocumentType": "PAYMENT_RECEIPT",
      "sourceDocumentId": "cld..."
    }
  ]
}
```

> `openingBalance` = sum of all POSTED lines before `fromDate`. `runningBalance` updates after each line. This is the traditional paper ledger format.

#### GL Balance

```
GET /reports/gl-balance/:accountId?asOfDate=2025-01-31
```

**Response:**
```json
{
  "accountId": "cld...",
  "accountCode": "1010",
  "asOfDate": "2025-01-31",
  "debitTotal": "54500.00",
  "creditTotal": "2500.00",
  "netBalance": "52000.00"
}
```

#### Drill-down

```
GET /reports/drill-down?sourceDocumentType=CLIENT_INVOICE&sourceDocumentId=cld...
```

Returns all journal entries linked to a specific source document. Use this to trace any invoice, receipt, bill, or payment back to its GL impact.

**`sourceDocumentType` values:** `CLIENT_INVOICE` `PAYMENT_RECEIPT` `SUPPLIER_BILL` `SUPPLIER_PAYMENT` `MANUAL_JOURNAL` `OPENING_BALANCE` `YEAR_END_CLOSE`

#### Trial Balance

```
GET /reports/trial-balance?asOfDate=2025-01-31&includeZeroBalance=false
```

**Response:**
```json
{
  "asOfDate": "2025-01-31",
  "organizationId": "cld...",
  "totalOpeningDebit": "100000.00",
  "totalOpeningCredit": "100000.00",
  "totalPeriodDebit": "15000.00",
  "totalPeriodCredit": "15000.00",
  "totalClosingDebit": "115000.00",
  "totalClosingCredit": "115000.00",
  "balanced": true,
  "lines": [
    {
      "accountId": "cld...",
      "accountCode": "1010",
      "accountName": "Cash at Bank",
      "accountClass": "ASSET",
      "accountSubtype": "CASH_AND_BANK",
      "openingDebit": "48500.00",
      "openingCredit": "0.00",
      "periodDebit": "6000.00",
      "periodCredit": "2500.00",
      "closingDebit": "52000.00",
      "closingCredit": "0.00"
    }
  ]
}
```

> `balanced: true` means `totalClosingDebit − totalClosingCredit ≤ $0.01`. If `false`, there is a data integrity issue — surface it immediately as an error state, not a normal view.

> For `CLOSED` periods (when `asOfDate ≥ period.endDate`), the server uses frozen `PeriodAccountBalance` snapshots instead of scanning journal lines. The response is identical — the client does not need to handle this differently.

#### Profit & Loss

```
GET /reports/pl?fromDate=2025-01-01&toDate=2025-01-31
```

Optional: `&projectId=cld...` `&departmentId=cld...`

**Response:**
```json
{
  "fromDate": "2025-01-01",
  "toDate": "2025-01-31",
  "organizationId": "cld...",
  "revenue": {
    "label": "Revenue",
    "total": "85000.00",
    "lines": [
      { "accountCode": "4000", "accountName": "Project Revenue", "amount": "85000.00" }
    ]
  },
  "costOfSales": { "label": "Cost of Sales", "total": "0.00", "lines": [] },
  "grossProfit": "85000.00",
  "expenses": {
    "label": "Operating Expenses",
    "total": "12000.00",
    "lines": [
      { "accountCode": "5000", "accountName": "Office Rent", "amount": "2500.00" },
      { "accountCode": "5100", "accountName": "Site Costs", "amount": "9500.00" }
    ]
  },
  "netIncome": "73000.00"
}
```

> When `projectId` or `departmentId` is supplied, only journal lines tagged with that dimension are included. This gives project-level P&L without a separate endpoint.

#### Monthly P&L Comparison

```
GET /reports/pl/monthly/:fiscalYearId?projectId=cld...
```

Returns one column per accounting period in the fiscal year.

**Response:**
```json
{
  "fiscalYearId": "cld...",
  "fiscalYearName": "FY2025",
  "columns": [
    {
      "periodNumber": 1,
      "periodName": "January 2025",
      "revenue": "85000.00",
      "costOfSales": "0.00",
      "grossProfit": "85000.00",
      "expenses": "12000.00",
      "netIncome": "73000.00"
    }
  ]
}
```

#### Balance Sheet

```
GET /reports/balance-sheet?asOfDate=2025-01-31&comparativeDate=2024-12-31
```

`comparativeDate` is optional. When supplied, a prior-period column appears alongside the current column.

**Response:**
```json
{
  "asOfDate": "2025-01-31",
  "comparativeDate": "2024-12-31",
  "organizationId": "cld...",
  "assets": {
    "label": "Assets",
    "total": "155000.00",
    "comparativeTotal": "100000.00",
    "lines": [
      { "accountCode": "1010", "accountName": "Cash at Bank", "balance": "52000.00", "comparativeBalance": "48500.00" }
    ]
  },
  "liabilities": {
    "label": "Liabilities",
    "total": "10000.00",
    "lines": [
      { "accountCode": "2000", "accountName": "Accounts Payable", "balance": "10000.00" }
    ]
  },
  "equity": {
    "label": "Equity",
    "total": "145000.00",
    "lines": [
      { "accountCode": "3100", "accountName": "Retained Earnings", "balance": "72000.00" },
      { "accountId": "CURRENT_YEAR_EARNINGS", "accountCode": "CYE", "accountName": "Current Year Earnings", "balance": "73000.00" }
    ]
  },
  "totalLiabilitiesAndEquity": "155000.00",
  "balanced": true
}
```

> `balanced: true` means `assets.total − totalLiabilitiesAndEquity ≤ $0.01`. Show a clear error state if `false` — it means there is a GL integrity issue.

> The `CURRENT_YEAR_EARNINGS` line (`accountId: "CURRENT_YEAR_EARNINGS"`) is computed dynamically from the live P&L for the current fiscal year. It disappears after year-end close, when the net income is rolled into Retained Earnings via the closing journal. Handle `accountId === "CURRENT_YEAR_EARNINGS"` as a special display row — it has no real account ID.

---

### 6.23 Period Management

These are CFO-level operations. Gate them with a `can('manage:periods')` permission check before showing the controls.

| Method | Path | Description |
|---|---|---|
| `POST` | `/periods/:id/lock` | `OPEN` or `REOPENED` → `LOCKED` |
| `POST` | `/periods/:id/close` | `LOCKED` → `CLOSED` (generates snapshot) |
| `POST` | `/periods/:id/reopen` | `CLOSED` → `REOPENED` (CFO only, invalidates snapshots) |
| `GET` | `/periods/:id/close-gate` | Pre-flight check — are there any blockers? |
| `POST` | `/periods/:id/snapshot/rebuild` | Rebuild snapshots from this period forward |
| `POST` | `/periods/fiscal-year/:fiscalYearId/close` | Year-end close — Period 12 only |

**Reopen — body:**
```json
{ "reason": "AR allocation error discovered — approved by CFO on 2025-02-01" }
```

> Reopening invalidates the balance snapshots for this period and all later CLOSED periods in the fiscal year. Reports on those periods will show live data (slower) until the periods are re-closed and snapshots are rebuilt.

**Close-gate response:**
```json
{
  "passed": true,
  "blockers": []
}
```
```json
{
  "passed": false,
  "blockers": [
    "3 journal(s) are not yet posted (DRAFT/SUBMITTED/APPROVED)",
    "AR control reconciliation failed: GL 85000.00 vs subledger 82000.00 (variance 3000.00)"
  ]
}
```

> Show the close-gate result **before** letting the CFO click "Close Period". Do not call `POST /periods/:id/close` if `passed: false` — it will return `400` with the same blockers.

**Period state machine:**
```
OPEN ──lock──► LOCKED ──close──► CLOSED ──reopen──► REOPENED
 ▲                                                      │
 └──────────────────────lock──────────────────────────────┘
```

---

## 9. What Is NOT Built Yet (Do Not Call)

These features are planned but endpoints do not exist:

- Procurement: Subcontracts / Purchase Orders / Goods Receipt Notes (Sprint 5)
- Inventory: Stock Ledger / Stock Transfers / Material Catalogue (Sprint 6)
- Cost Ledger / Project Costing (Sprint 6)
- Daily Progress Reports / Measurement Sheets (Sprint 8)
- Labour Attendance / Equipment Logs (Sprint 8)
- File uploads / Attachment storage (tables exist in DB, no file serving yet — Sprint 5)
- Notifications / Expiry alerts (Sprint 5 attention engine)
- Cash Flow Statement (deferred — requires indirect-method computation)
- Advanced bank reconciliation — statement import and auto-matching
- Tax reporting — VAT return computation and filing
- Budget Authorization (for INTERNAL_CAPITAL projects)
- Exchange rate management UI (rates can be managed via admin, no dedicated UI endpoint yet)
