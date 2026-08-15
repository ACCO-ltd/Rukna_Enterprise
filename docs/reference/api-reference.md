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
| `GET` | `/projects/:id/workspace-summary` | Permission-aware setup, responsibility and main-contract projection |
| `GET` | `/projects/:id/workspace-guidance` | Ordered, lifecycle-aware project setup and control guidance |
| `PATCH` | `/projects/:id` | Update (DRAFT only) |

The workspace summary is organization- and membership-scoped. Main-contract metadata requires
`view:contract`; contract value and currency additionally require `view:financial-position`.
It is the authoritative source for project setup state and workspace header summaries.
Workspace guidance is computed server-side and returned in `URGENT`, `WARNING`, then
`INFO` order; the frontend only localizes and presents their typed `kind`.
This project-setup guidance is not the cross-domain `AttentionQueryService` contract
reserved by `frontend-design.md` for approvals, expiry, payment, milestone, and suspension alerts.
The workspace Overview presents it as setup and control guidance, not as the Attention Required panel.

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

**Metric provenance.** Every money figure in `/summary.metrics` is a `CommercialMetric`
carrying `{ state, amount, currency, sourceCount, drillTo, asOf }`. `state` distinguishes:

- `OK` — a real value (`amount` present)
- `ZERO` — query succeeded, no source records (`amount` = `"0.00"`)
- `UNAVAILABLE` — no main contract exists (`amount` null)
- `RESTRICTED` — caller lacks `view:financial-position` (`amount` null)
- `FAILED` — a source query failed; never rendered as `0` (`amount` null)

**Metric definitions (CONST-COM-003/004).** Contract Value = effective main client
contract; Certified (gross/net) = effective IPC totals; Invoiced = posted client invoice
totals; Received = posted receipt allocations; Outstanding = Invoiced − Received. Settlement
figures come only from posted AR — IPC never exposes an independent paid balance.

`capabilities` (both endpoints) is a backend-evaluated `CommercialCapabilities`
(`canEditContract`, `canCreateApplication`, `canGenerateInvoice`, …). It is presentation
convenience only — every command still enforces authorization server-side.

`GET …/applications` returns one `CommercialApplicationRow` per IPA with the full chain
(claimed → effective IPC gross/deductions/net + superseded count → invoice doc/posting
status → received → outstanding), a `settlement` state (`UNINVOICED | UNPAID |
PARTIALLY_PAID | PAID`) and a logical `nextAction`. Money fields are `null` when the caller
lacks `view:financial-position`.

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

> **Idempotent (CONST-COM-006 / ADR-017):** one effective IPC maps to at most one client
> invoice. Repeating `POST /invoices/from-ipc` for the same IPC returns the **existing**
> invoice (200-style success) instead of raising `409` and never creates a second
> receivable. Concurrency is closed by the unique `source_ipc_id` index; a racing request
> resolves to the winner's invoice. Frontend: treat a returned invoice with an existing id
> as success, not an error.

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

> **Note (A1 fix):** Sprint 3 has `GET/POST /receipts` (finance/project tracking). The Sprint 4 accounting layer is at **`/customer-receipts`** — same entity, different service with GL posting. Always use `/customer-receipts` for the Finance workspace.

| Method | Path | Description |
|---|---|---|
| `GET` | `/customer-receipts` | List receipts with posting status |
| `GET` | `/customer-receipts/:id` | Get receipt with allocations and GL status |
| `POST` | `/customer-receipts/:id/post` | Post receipt to GL (Dr Bank / Cr AR or Unapplied) |
| `POST` | `/customer-receipts/:id/allocations` | Allocate posted receipt to a client invoice |
| `POST` | `/customer-receipts/:id/allocations/:allocationId/reverse` | Reverse a specific allocation |
| `POST` | `/customer-receipts/:id/reverse` | Reverse the entire receipt posting |

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

### 6.22 Suppliers (AP)

| Method | Path | Description |
|---|---|---|
| `GET` | `/suppliers` | List suppliers (`?status=ACTIVE\|INACTIVE`) |
| `GET` | `/suppliers/:id` | Get a supplier by ID |
| `POST` | `/suppliers` | Create a new supplier |

**Create supplier — body:**
```json
{
  "code": "SUP-001",
  "name": "Al-Rashid Trading",
  "nameAr": "الراشد للتجارة",
  "taxNumber": "310122445500003",
  "defaultCurrency": "SAR",
  "paymentTermsDays": 30
}
```

> `code` must be unique within the organization. Returns `409 Conflict` if the code already exists. `nameAr`, `taxNumber`, `defaultCurrency`, and `paymentTermsDays` are optional.

---

### 6.23 Posting Profiles (AP)

| Method | Path | Description |
|---|---|---|
| `GET` | `/posting-profiles` | List posting profiles (`?status=ACTIVE\|INACTIVE`) |

> Posting profiles determine which expense GL account is debited when a supplier bill is posted. Each profile has a `code` (e.g. `GENERAL-EXPENSE`, `MATERIALS-EXPENSE`) that is referenced in supplier bill lines. The response includes the most recent active version for each profile.

---

### 6.24 Financial Reports

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

> When `projectId` or `departmentId` is supplied, only journal lines tagged with that dimension are included.

#### Project Actual P&L (convenience route) — ADR-013

```
GET /projects/:id/pl?fromDate=2025-01-01&toDate=2025-12-31
```

Project-scoped wrapper over `/reports/pl`: the path project id becomes the `projectId` filter and
**overrides** any `projectId` supplied in the query. Same `PLReportResult` shape as `/reports/pl`
above, with `projectId` set. Requires `view:accounting`. Backed by the new `@@index([projectId])`
on `journal_lines`.

> **This is the _Project Actual P&L_ — posted GL truth only** (revenue + project-cost lines tagged
> with this project). It **excludes committed and forecast cost** by design; those belong to the
> separate _Project Financial Position_ read model below. Do not present this to a PM as the
> complete project financial picture — surface it as "Actual (GL)".

#### Project Financial Position — ADR-013

```
GET /projects/:id/financial-position
```

The PM/control view: posted actuals **plus** remaining committed cost, so forecast margin is not
overstated. Requires `view:financial-position` and project membership (`ProjectAccessGuard`).

**Response** (all amounts decimal strings, contract currency):
```json
{
  "projectId": "cld...",
  "currency": "USD",
  "hasContract": true,
  "contractValue": "1000000.00",
  "certifiedRevenue": "700000.00",
  "invoicedRevenue": "650000.00",
  "receivedRevenue": "500000.00",
  "outstandingReceivables": "150000.00",
  "actualCost": "600000.00",
  "remainingCommitments": "150000.00",
  "forecastCost": "750000.00",
  "forecastMargin": "250000.00",
  "asOf": "2026-08-14T..."
}
```

- `actualCost` — posted GL cost carrying this `projectId` (COST_OF_SALES + EXPENSE), project-to-date.
- `remainingCommitments` — commitment-ledger **COMMITTED + ACCRUED** (excludes ACTUAL, already in
  the GL actual, to avoid double-counting).
- `forecastCost = actualCost + remainingCommitments`; `forecastMargin = contractValue − forecastCost`.
- Without a main contract, `hasContract` is `false` and all contract-derived fields (`contractValue`,
  revenue, `forecastMargin`) are `null`; cost/forecast are still reported.
- First cut is single-currency (contract currency assumed = reporting); multi-currency conversion via
  approved-rate snapshots (ADR-010) is a follow-up.

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

### 6.25 Period Management

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

---

### 6.26 Units of Measure

All MATERIAL procurement lines use a UoM from this table. `MATERIAL` lines are locked to the material's `baseUomCode` — users cannot override it.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/uom` | List active UoMs |
| `POST` | `/procurement/uom` | Create a UoM |
| `GET` | `/procurement/uom/:id` | Get single UoM |
| `POST` | `/procurement/uom/:id/deactivate` | Deactivate |

**Create body:**
```json
{
  "code": "TON",
  "name": "Metric Ton",
  "nameAr": "طن",
  "symbol": "t"
}
```

**Response:**
```json
{
  "id": "clx...",
  "code": "TON",
  "name": "Metric Ton",
  "nameAr": "طن",
  "symbol": "t",
  "status": "ACTIVE"
}
```

---

### 6.27 Material Categories

Operational hierarchy for the material catalogue (e.g. Steel → Rebar). Separate from spend categories.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/material-categories` | List root categories + children |
| `POST` | `/procurement/material-categories` | Create a category |
| `GET` | `/procurement/material-categories/:id` | Get with children |
| `POST` | `/procurement/material-categories/:id/deactivate` | Deactivate |

**Create body:**
```json
{
  "code": "STEEL",
  "name": "Steel & Metal Products",
  "nameAr": "منتجات الصلب والمعادن",
  "parentCode": "CONSTRUCTION_MATERIALS"
}
```

**Response** (root level includes `children[]`):
```json
{
  "id": "clx...",
  "code": "STEEL",
  "name": "Steel & Metal Products",
  "status": "ACTIVE",
  "children": [
    { "id": "clx...", "code": "REBAR", "name": "Reinforcing Bar", "status": "ACTIVE" }
  ]
}
```

---

### 6.28 Spend Categories

Financial governance hierarchy — drives approval routing, tolerance policies, and commitment ledger attribution. **Do not confuse with Material Categories.**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/spend-categories` | List root categories + children |
| `POST` | `/procurement/spend-categories` | Create a spend category |
| `GET` | `/procurement/spend-categories/:id` | Get with children |
| `POST` | `/procurement/spend-categories/:id/deactivate` | Deactivate |

**Create body:**
```json
{
  "code": "DIRECT_MATERIAL",
  "name": "Direct Material",
  "nameAr": "مواد مباشرة",
  "parentCode": "PROJECT_COSTS"
}
```

---

### 6.29 Materials

The material catalogue. Each material belongs to a `MaterialCategory` and optionally has a default `SpendCategory`. `baseUomCode` is enforced on all MATERIAL procurement lines — the UoM cannot be overridden per line.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/materials` | List active materials |
| `POST` | `/procurement/materials` | Create a material |
| `GET` | `/procurement/materials/:id` | Get material with refs |
| `POST` | `/procurement/materials/:id/discontinue` | Mark discontinued |

**Query params for list:**
- `materialCategoryId` — filter by category
- `spendCategoryId` — filter by default spend category

**Create body:**
```json
{
  "code": "REBAR-12MM",
  "name": "12mm Deformed Steel Rebar",
  "nameAr": "حديد تسليح 12مم",
  "materialCategoryCode": "REBAR",
  "defaultSpendCategoryCode": "DIRECT_MATERIAL",
  "baseUomCode": "TON"
}
```

**Response:**
```json
{
  "id": "clx...",
  "code": "REBAR-12MM",
  "name": "12mm Deformed Steel Rebar",
  "status": "ACTIVE",
  "materialCategory": { "id": "...", "code": "REBAR", "name": "Reinforcing Bar" },
  "defaultSpendCategory": { "id": "...", "code": "DIRECT_MATERIAL", "name": "Direct Material" },
  "baseUom": { "id": "...", "code": "TON", "name": "Metric Ton", "symbol": "t" }
}
```

**`status` values:** `ACTIVE` | `INACTIVE` | `DISCONTINUED`

---

### 6.30 Material Requests

A formal internal request for materials or services. Can be PROJECT-scoped (linked to a project) or ORGANIZATION-scoped (admin/overhead).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/material-requests` | List MRs |
| `POST` | `/procurement/material-requests` | Create a DRAFT MR |
| `GET` | `/procurement/material-requests/:id` | Get MR with lines |
| `POST` | `/procurement/material-requests/:id/submit` | Submit for approval |
| `POST` | `/procurement/material-requests/:id/approve` | Approve |
| `POST` | `/procurement/material-requests/:id/cancel` | Cancel |

**Query params for list:**
- `status` — `DRAFT` | `SUBMITTED` | `APPROVED` | `PARTIALLY_ORDERED` | `FULLY_ORDERED` | `CANCELLED` | `CLOSED`
- `projectId` — filter by project
- `scope` — `PROJECT` | `ORGANIZATION`

**Create body:**
```json
{
  "requestScope": "PROJECT",
  "projectId": "clx...",
  "requestedDate": "2026-08-10",
  "requiredByDate": "2026-08-25",
  "description": "Foundation phase rebar order",
  "lines": [
    {
      "lineType": "MATERIAL",
      "materialCode": "REBAR-12MM",
      "description": "12mm deformed rebar for pile caps",
      "uomCode": "TON",
      "requestedQuantity": 25,
      "boqNodeId": "clx...",
      "spendCategoryId": "clx..."
    },
    {
      "lineType": "SERVICE",
      "description": "Rebar cutting and bending service",
      "uomCode": "LOT",
      "requestedQuantity": 1
    }
  ]
}
```

> **Rules:**
> - `requestScope: PROJECT` requires `projectId`. `ORGANIZATION` scope must not have `projectId`.
> - `lineType: MATERIAL` requires `materialCode`. The UoM is automatically set from the material's `baseUomCode` — do not let users change it.
> - `lineType: SERVICE` or `OTHER` allows free-text description and any active UoM.

**Response:**
```json
{
  "id": "clx...",
  "mrNumber": "MR-00001",
  "requestScope": "PROJECT",
  "projectId": "clx...",
  "status": "DRAFT",
  "requestedDate": "2026-08-10T00:00:00.000Z",
  "lines": [
    {
      "id": "clx...",
      "lineNumber": 1,
      "lineType": "MATERIAL",
      "materialId": "clx...",
      "description": "12mm deformed rebar for pile caps",
      "requestedQuantity": "25",
      "approvedQuantity": null,
      "material": { "code": "REBAR-12MM", "name": "12mm Deformed Steel Rebar" },
      "uom": { "code": "TON", "symbol": "t" }
    }
  ]
}
```

**MR status machine:**
```
DRAFT → SUBMITTED → APPROVED → PARTIALLY_ORDERED → FULLY_ORDERED → CLOSED
  └──────────────────────────────────────────────────────► CANCELLED
```

---

### 6.31 Purchase Orders

Immutable revision model. Each PO has a stable identity (`PurchaseOrder`) and one or more `PurchaseOrderRevision` records. Lines are immutable once the revision is ACTIVE. GRNs and bills reference specific revision lines.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/purchase-orders` | List POs |
| `POST` | `/procurement/purchase-orders` | Create PO (DRAFT revision) |
| `GET` | `/procurement/purchase-orders/:id` | Get PO with all revisions |
| `POST` | `/procurement/purchase-orders/:id/submit` | Submit DRAFT → SUBMITTED |
| `POST` | `/procurement/purchase-orders/:id/approve` | Approve → ACTIVE + CommitmentLedger |
| `POST` | `/procurement/purchase-orders/:id/revise` | Create new DRAFT revision |
| `POST` | `/procurement/purchase-orders/:id/cancel` | Cancel PO |

**Query params for list:**
- `status` — `OPEN` | `CLOSED` | `CANCELLED`
- `supplierId`

**Create body:**
```json
{
  "supplierId": "clx...",
  "currencyCode": "SAR",
  "effectiveFrom": "2026-08-10",
  "deliveryAddress": "ACCO Site — Block 7, Riyadh",
  "expectedDeliveryDate": "2026-09-01",
  "lines": [
    {
      "lineType": "MATERIAL",
      "materialCode": "REBAR-12MM",
      "description": "12mm deformed rebar",
      "uomCode": "TON",
      "orderedQuantity": 25,
      "unitPrice": 850,
      "spendCategoryId": "clx...",
      "mrLineAllocations": [
        {
          "materialRequestLineId": "clx...",
          "allocatedQuantity": 25
        }
      ]
    }
  ]
}
```

> `mrLineAllocations` is optional but strongly recommended — it links PO lines back to MR lines for commitment attribution and project/BOQ cost tracking.

**Approve body:**
```json
{
  "reportingCurrencyCode": "SAR",
  "exchangeRate": 1.0
}
```

> Approval atomically: marks revision ACTIVE, supersedes previous ACTIVE revision (if any), and writes `CommitmentLedgerEntry` records for each line.

**Revise body** (same as create, plus required `reason`):
```json
{
  "reason": "Price increase — supplier revised quote",
  "supplierId": "clx...",
  "currencyCode": "SAR",
  "effectiveFrom": "2026-08-15",
  "lines": [...]
}
```

**Response:**
```json
{
  "id": "clx...",
  "poNumber": "PO-00001",
  "status": "OPEN",
  "currentRevisionId": "clx...",
  "supplier": { "id": "...", "name": "Al-Farouk Steel Co." },
  "revisions": [
    {
      "id": "clx...",
      "revisionNumber": 1,
      "status": "ACTIVE",
      "currencyCode": "SAR",
      "effectiveFrom": "2026-08-10T00:00:00.000Z",
      "approvedAt": "2026-08-10T09:15:00.000Z",
      "lines": [
        {
          "id": "clx...",
          "lineNumber": 1,
          "lineType": "MATERIAL",
          "description": "12mm deformed rebar",
          "orderedQuantity": "25",
          "unitPrice": "850",
          "extendedAmount": "21250.00",
          "material": { "code": "REBAR-12MM", "name": "12mm Deformed Steel Rebar" },
          "uom": { "code": "TON", "symbol": "t" }
        }
      ]
    }
  ]
}
```

**Revision status machine:**
```
DRAFT → SUBMITTED → APPROVED → ACTIVE ──superseded──► SUPERSEDED
                                     └──cancelled──► CANCELLED
```

**PO status:** `OPEN` | `CLOSED` | `CANCELLED`

> When displaying a PO, show only the **ACTIVE** revision lines to users. Show SUPERSEDED revisions in a collapsible history panel.

---

### 6.32 Goods Receipts

Records physical delivery against an ACTIVE PO revision. Each line records the full physical quantity received, then splits into `acceptedQuantity` and `rejectedQuantity`. Only accepted quantity generates ACCRUED commitment movement.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/goods-receipts` | List GRNs |
| `POST` | `/procurement/goods-receipts` | Create GRN (DRAFT) |
| `GET` | `/procurement/goods-receipts/:id` | Get GRN with lines + allocations |
| `POST` | `/procurement/goods-receipts/:id/post` | Post GRN → COMMITTED→ACCRUED |
| `POST` | `/procurement/goods-receipts/:id/approve-exception` | Supervisor approves over-receipt: EXCEPTION_PENDING → DRAFT |
| `POST` | `/procurement/goods-receipts/:id/cancel` | Cancel (not allowed after POSTED) |

**Query params for list:**
- `purchaseOrderId` — filter by PO

**Create body:**
```json
{
  "purchaseOrderId": "clx...",
  "deliveryDate": "2026-08-18",
  "deliveryNoteRef": "DN-2026-0042",
  "lines": [
    {
      "purchaseOrderLineId": "clx...",
      "receivedQuantity": 24,
      "acceptedQuantity": 23,
      "rejectedQuantity": 1,
      "rejectionReason": "Surface rust on 1 bundle",
      "qualityStatus": "PARTIALLY_ACCEPTED"
    }
  ]
}
```

> **Rules:**
> - `acceptedQuantity + rejectedQuantity` must equal `receivedQuantity` (400 if not).
> - If total received exceeds the PO ordered quantity by more than 5%, the GRN is created with status `EXCEPTION_PENDING` and cannot be posted until the exception is resolved or a PO revision is approved.
> - `qualityStatus`: `PENDING_INSPECTION` | `ACCEPTED` | `PARTIALLY_ACCEPTED` | `REJECTED`

**Post body:**
```json
{
  "exchangeRate": 1.0,
  "reportingCurrencyCode": "SAR"
}
```

> Posting atomically writes two `CommitmentLedgerEntry` rows per line: `COMMITTED -amount` and `ACCRUED +amount`. The GRN becomes immutable after posting.

**Response:**
```json
{
  "id": "clx...",
  "grnNumber": "GRN-00001",
  "status": "POSTED",
  "purchaseOrderId": "clx...",
  "supplierId": "clx...",
  "deliveryDate": "2026-08-18T00:00:00.000Z",
  "postedAt": "2026-08-18T11:30:00.000Z",
  "lines": [
    {
      "id": "clx...",
      "lineNumber": 1,
      "purchaseOrderLineId": "clx...",
      "orderedQuantity": "25",
      "previouslyReceivedQty": "0",
      "receivedQuantity": "24",
      "acceptedQuantity": "23",
      "rejectedQuantity": "1",
      "rejectionReason": "Surface rust on 1 bundle",
      "qualityStatus": "PARTIALLY_ACCEPTED",
      "allocations": [...]
    }
  ]
}
```

**GRN status machine:**
```
DRAFT ──post──► POSTED  (immutable)
  │
  └──cancel──► CANCELLED
  └──(over-receipt)──► EXCEPTION_PENDING
```

---

### 6.33 Bill Matching

Explicit matching of a supplier bill against PO lines (and GRN lines for MATERIAL). The bill's `matchStatus` must be `MATCHED`, `MATCHED_WITH_TOLERANCE`, or `APPROVED_EXCEPTION` before posting is allowed.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/bill-matching/:billId` | Get current match result |
| `POST` | `/procurement/bill-matching/:billId/run` | Run matching (TWO_WAY or THREE_WAY) |
| `POST` | `/procurement/bill-matching/:billId/approve-exception` | Approve exception |

> The match type is determined automatically: if any bill line has `lineType: MATERIAL`, the match is `THREE_WAY` (PO ↔ GRN ↔ Bill). Otherwise `TWO_WAY` (PO ↔ Bill only).

**Run matching** — no body required.

**Approve exception body:**
```json
{ "approvalReason": "Price variance within CFO approved limit — see email 2026-08-20" }
```

**Match result response:**
```json
{
  "id": "clx...",
  "supplierBillId": "clx...",
  "matchType": "THREE_WAY",
  "status": "MATCHED_WITH_TOLERANCE",
  "matchedAt": "2026-08-19T10:00:00.000Z",
  "matchedBy": "clx...",
  "lines": [
    {
      "purchaseOrderLineId": "clx...",
      "goodsReceiptLineId": "clx...",
      "poQuantity": "25",
      "receivedQuantity": "23",
      "billedQuantity": "23",
      "poUnitPrice": "850.00",
      "billedUnitPrice": "855.00",
      "quantityVariance": "-2",
      "priceVariance": "5.00",
      "amountVariance": "115.00",
      "withinTolerance": true
    }
  ]
}
```

**`matchStatus` values on `SupplierBill`:**
| Value | Meaning |
|-------|---------|
| `NOT_RUN` | Matching not yet executed |
| `MATCHED` | All lines within tolerance — posting allowed |
| `MATCHED_WITH_TOLERANCE` | Variance exists but within tolerance — posting allowed |
| `EXCEPTION` | Variance exceeds tolerance — posting blocked |
| `APPROVED_EXCEPTION` | Exception approved by authorised user — posting allowed |

> **UI rule:** The "Post Bill" button must be disabled whenever `matchStatus` is `NOT_RUN` or `EXCEPTION`. Show a clear explanation of why.

---

### 6.34 Commitment Ledger

Read-only query endpoints. The ledger is written automatically by PO approval and GRN posting — there is no create/update endpoint.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/procurement/commitment-ledger/projects/:projectId` | Query entries for a project |
| `GET` | `/procurement/commitment-ledger/projects/:projectId/summary` | Summarized totals |
| `GET` | `/procurement/commitment-ledger/purchase-orders/:poId` | Entries for a single PO |

**Query params for project entries:**
- `stage` — `COMMITTED` | `ACCRUED` | `ACTUAL`
- `boqNodeId` — filter by BOQ node

**Project summary response:**
```json
{
  "committed": "21250.00",
  "accrued": "19550.00",
  "actual": "0.00"
}
```

> `committed` = total PO value not yet received (purchase orders approved but goods not yet confirmed)
> `accrued` = goods received and accepted but supplier bill not yet posted
> `actual` = supplier bill posted to GL

**Ledger entry response:**
```json
{
  "id": "clx...",
  "stage": "COMMITTED",
  "amount": "21250.00",
  "reportingAmount": "21250.00",
  "currencyCode": "SAR",
  "sourceDocumentType": "PURCHASE_ORDER_REVISION",
  "sourceDocumentId": "clx...",
  "eventType": "PO_APPROVED",
  "accountingDate": "2026-08-10",
  "purchaseOrderId": "clx...",
  "spendCategoryId": "clx...",
  "projectId": "clx...",
  "boqNodeId": "clx..."
}
```

---

## 9. What Is NOT Built Yet (Do Not Call)

These features are planned but endpoints do not exist:

- Procurement: Subcontracts / Supplier Returns (Sprint 6+)
- Variations / Change Orders (Sprint 6)
- Inventory: Stock Ledger / Stock Transfers (Sprint 7)
- Cost Ledger / Project Costing (Sprint 7)
- Daily Progress Reports / Measurement Sheets (Sprint 9)
- Labour Attendance / Equipment Logs (Sprint 9)
- File uploads / Attachment storage (tables exist in DB, no file serving yet)
- Notifications / Expiry alerts
- Cash Flow Statement (deferred — requires indirect-method computation)
- Advanced bank reconciliation — statement import and auto-matching
- Tax reporting — VAT return computation and filing
- Budget Authorization (for INTERNAL_CAPITAL projects)
- Exchange rate management UI (rates can be managed via admin, no dedicated UI endpoint yet)
