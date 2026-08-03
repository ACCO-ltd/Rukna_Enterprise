# Rukna ERP — Frontend API Reference

Version: 3.0.0
Last Updated: 2026-08-03
Sprint Coverage: Sprint 3 (all phases complete)
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
| `GET` | `/users/:id` | Get user by ID |

**Response:**
```json
{
  "id": "cld...", "email": "user@acco.com",
  "firstName": "Ahmed", "lastName": "Ali",
  "status": "ACTIVE", "preferredLanguage": "EN"
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
| `GET` | `/workflows/definition/:transactionType` | Active workflow definition |
| `GET` | `/workflows/instance/:instanceId/step` | Current pending approval step |
| `POST` | `/workflows/instance/:instanceId/approve` | Approve current step |
| `POST` | `/workflows/instance/:instanceId/reject` | Reject current step |

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
| `POST` | `/ipa/:id/submit-for-approval` | `DRAFT` → `PENDING_INTERNAL_APPROVAL` | Requires workflow configured |
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
  "unitRateSnapshot": "45.00",
  "currencySnapshot": "USD",
  "cumulativeClaimed": "960.000"
}
```

> `cumulativeClaimed` is the **total quantity/percentage claimed to date** including this application (not just this period). The API automatically resolves `previousEffectiveCertified` from the last effective IPC for this contract + BOQ node. `periodQuantity = cumulativeClaimed − previousEffectiveCertified`.

> Only DRAFT and RETURNED_FOR_REVISION IPAs accept items.

> The `boqNodeId` must be a **leaf** BOQ node. The `measurementMethodSnapshot` is auto-copied from the BOQ node.

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
  "certifiedTotal": "6840.00",
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
      "deductionType": "RETENTION",
      "sourceTermId": "cld...",
      "rate": "0.0500",
      "basis": "6840.00",
      "amount": "342.00"
    }
  ]
}
```

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
  "totalAllocated": 6498.00,
  "status": "PAID"
}
```

> `status` is **derived** from allocations — there is no `status` field on the IPC itself. The three possible values are `UNPAID`, `PARTIALLY_PAID`, `PAID`.

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
| `varianceReason` required when certified ≠ claimed | Validate in form before submitting IPC |
| One effective IPC per application | Disable "issue" button if effective cert exists; show "supersede" instead |
| Contract `execute` freezes client snapshots | Warn user before executing: "Client details will be locked permanently" |
| `PRACTICAL_COMPLETION` moves all ACTIVE contracts to `FINAL_ACCOUNT_PENDING` | Show confirmation dialog listing affected contracts before calling |
| Receipt allocation cannot exceed receipt amount | Show remaining unallocated balance in allocation form |
| IPA is immutable after `SUBMITTED` | Hide edit controls once SUBMITTED |
| `422` on lifecycle = workflow not configured | Show "Approval workflow not configured — contact admin" message |

---

## 9. What Is NOT Built Yet (Do Not Call)

These features are planned but endpoints do not exist:

- Subcontracts / Subcontract Certificates
- Material Requests / Purchase Orders / Goods Receipt Notes
- Stock Ledger / Stock Transfers
- Cost Ledger / Cost Reporting
- Daily Progress Reports / Measurement Sheets
- Labour Attendance / Equipment Logs
- File uploads / Attachment storage (join tables exist in DB, no file serving)
- Notifications / Expiry alerts
- Settings pages (org config, DOA thresholds, workflow builder)
- Budget Authorization (for INTERNAL_CAPITAL projects)
- Exchange rate management UI
