# Rukna ERP — Frontend API Reference

Version: 1.0.0
Last Updated: 2026-08-02
Audience: **Frontend engineer** — everything you need to call the API without reading the backend code.

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

> **Important:** The subdomain is how the API knows which tenant database to use.
> Sending requests to the wrong subdomain will return `404 Tenant not found`.

---

## 2. Authentication Flow

### 2.1 Login

```
POST /api/v1/auth/login
```

**Request body:**
```json
{
  "email": "user@acco.com",
  "password": "secret"
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Side effect:** The API also sets an **HttpOnly cookie** named `refreshToken`.

```
Set-Cookie: refreshToken=<token>; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=604800
```

Do **not** try to read or set this cookie from JavaScript — it is `HttpOnly` by design.
The browser sends it automatically on every request to `/api/v1/auth/*`.

---

### 2.2 Attach the Access Token

Every protected endpoint requires the access token as a Bearer header:

```
Authorization: Bearer <accessToken>
```

Access tokens expire in **15 minutes**. When a request returns `401`, call `/auth/refresh` to get a new one before retrying.

---

### 2.3 Refresh the Access Token

```
POST /api/v1/auth/refresh
```

No request body needed. The browser sends the `refreshToken` cookie automatically.

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Side effect:** The old refresh cookie is rotated — a new `refreshToken` cookie is set.

**Error `401`:** Refresh token expired (>7 days), already used (reuse detection), or missing.
On `401` from refresh → redirect user to login.

---

### 2.4 Logout

```
POST /api/v1/auth/logout
```

No body needed. Revokes the refresh token and clears the cookie.

**Response `200`:** Empty body.

---

### 2.5 Recommended Frontend Auth Pattern

```typescript
// On app start / route change:
// 1. Check if accessToken is in memory (not localStorage — XSS risk)
// 2. If missing or expired, call POST /auth/refresh
// 3. If refresh 401, redirect to /login

// On every API call:
// - Attach Authorization: Bearer <accessToken>
// - On 401, call refresh once, retry, then redirect to /login if still 401
```

Use TanStack Query with an axios/fetch interceptor that handles the refresh cycle automatically.

---

## 3. Error Format

Every error (4xx, 5xx) returns the same envelope:

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
| `401 Unauthorized` | Missing/expired/invalid token, no active org membership |
| `403 Forbidden` | Authenticated but not permitted (wrong org, not a project member) |
| `404 Not Found` | Resource does not exist, tenant not found |
| `409 Conflict` | Duplicate (project code, active suspension, etc.) |
| `500 Internal Server Error` | Unexpected server error |

**Validation errors** (from `class-validator`) return `400` with a `message` array:
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": ["code must be shorter than or equal to 30 characters", "name should not be empty"],
    "details": {}
  }
}
```

---

## 4. Shared Types (from `@erp/types`)

The `packages/types` package is importable in the frontend:

```typescript
import type { JwtPayload, RequestIdentity, ProjectStatus, ProjectRole, BoqVersionStatus } from '@erp/types';
```

Key enums:

```typescript
enum ProjectStatus {
  DRAFT = 'DRAFT', APPROVED = 'APPROVED', MOBILIZING = 'MOBILIZING',
  ACTIVE = 'ACTIVE', PRACTICAL_COMPLETION = 'PRACTICAL_COMPLETION',
  CLOSEOUT = 'CLOSEOUT', CLOSED = 'CLOSED', CANCELLED = 'CANCELLED'
}

enum ProjectRole {
  PROJECT_MANAGER = 'PROJECT_MANAGER', QUANTITY_SURVEYOR = 'QUANTITY_SURVEYOR',
  SITE_ENGINEER = 'SITE_ENGINEER', COMMERCIAL_MANAGER = 'COMMERCIAL_MANAGER',
  FINANCE_REVIEWER = 'FINANCE_REVIEWER', VIEWER = 'VIEWER'
}

enum BoqVersionStatus {
  DRAFT = 'DRAFT', BASELINED = 'BASELINED',
  SUPERSEDED = 'SUPERSEDED', CANCELLED = 'CANCELLED'
}
```

---

## 5. Endpoint Catalog

### 5.1 Auth

All auth endpoints are **public** (no Authorization header needed).

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Login — returns accessToken + sets refresh cookie |
| `POST` | `/auth/refresh` | Rotate refresh token — returns new accessToken |
| `POST` | `/auth/logout` | Revoke refresh token + clear cookie |

---

### 5.2 Users

All require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/users/:id` | Get user by ID |

**Response:**
```json
{
  "id": "cld...",
  "email": "user@acco.com",
  "firstName": "Ahmed",
  "lastName": "Al-Rashidi",
  "status": "ACTIVE",
  "organizationId": "cld...",
  "preferredLanguage": "EN"
}
```

---

### 5.3 Organizations

| Method | Path | Description |
|---|---|---|
| `GET` | `/organizations/:id` | Get organization by ID |

**Response:**
```json
{
  "id": "cld...",
  "name": "ACCO Ltd",
  "slug": "acco",
  "status": "ACTIVE"
}
```

---

### 5.4 Roles

| Method | Path | Description |
|---|---|---|
| `GET` | `/roles` | List roles for the authenticated org |

---

### 5.5 Permissions

| Method | Path | Description |
|---|---|---|
| `GET` | `/permissions` | List all platform permissions |

---

### 5.6 Audit Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/audit-logs` | List audit log entries |

---

### 5.7 Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows/definition/:transactionType` | Get active workflow definition for a transaction type |
| `GET` | `/workflows/instance/:instanceId/step` | Get current pending approval step |
| `POST` | `/workflows/instance/:instanceId/approve` | Approve the current step |
| `POST` | `/workflows/instance/:instanceId/reject` | Reject the current step |

`transactionType` values: `MATERIAL_REQUEST`, `PURCHASE_ORDER`, `SUPPLIER_PAYMENT`,
`STOCK_TRANSFER`, `MATERIAL_ISSUE`, `SUBCONTRACT_CERTIFICATE`, `IPC`, `VARIATION`

---

### 5.8 Projects

All require `Authorization: Bearer <token>`. All scoped to the authenticated user's organization.

#### List Projects
```
GET /projects?status=ACTIVE
```
Query param `status` is optional. Returns array of project objects.

**Response:**
```json
[
  {
    "id": "cld...",
    "organizationId": "cld...",
    "code": "ACCO-2026-001",
    "name": "Al-Baraka Tower Construction",
    "nameAr": "مشروع برج البركة",
    "description": null,
    "status": "ACTIVE",
    "clientName": "Baraka Real Estate LLC",
    "contractValue": "4500000.00",
    "currency": "USD",
    "startDate": "2026-09-01T00:00:00.000Z",
    "expectedEndDate": "2028-03-31T00:00:00.000Z",
    "createdBy": "cld...",
    "createdAt": "2026-08-02T14:00:00.000Z",
    "updatedAt": "2026-08-02T14:00:00.000Z"
  }
]
```

---

#### Create Project
```
POST /projects
```

**Request body:**
```json
{
  "code": "ACCO-2026-001",
  "name": "Al-Baraka Tower Construction",
  "nameAr": "مشروع برج البركة",
  "description": "Mixed-use residential tower",
  "clientName": "Baraka Real Estate LLC",
  "contractValue": 4500000.00,
  "currency": "USD",
  "startDate": "2026-09-01",
  "expectedEndDate": "2028-03-31"
}
```

> `code` is required, max 30 chars, **immutable after creation**.
> All other fields are optional.

**Response `201`:** Project object (same shape as list item).

**Error `409`:** Project code already exists in this org.

---

#### Get Project
```
GET /projects/:id
```

Returns the full project including active members and active suspension (if any).

**Response includes:**
```json
{
  "id": "cld...",
  "...": "all project fields",
  "members": [
    {
      "id": "cld...",
      "userId": "cld...",
      "joinedAt": "2026-08-02T14:00:00.000Z",
      "joinedBy": "cld...",
      "removedAt": null,
      "roles": [
        { "id": "cld...", "role": "PROJECT_MANAGER", "assignedAt": "..." }
      ],
      "user": { "id": "cld...", "firstName": "Ahmed", "lastName": "Ali", "email": "..." }
    }
  ],
  "suspensions": []
}
```

---

#### Update Project
```
PATCH /projects/:id
```

Only allowed when `status = DRAFT`. All fields optional. `code` cannot be changed.

**Request body:** Same as Create, minus `code`.

---

#### Lifecycle Commands

All return the updated project object. All return `400` if the transition is not valid from the current status.

| Method | Path | From → To |
|---|---|---|
| `POST` | `/projects/:id/approve` | `DRAFT` → `APPROVED` |
| `POST` | `/projects/:id/mobilize` | `APPROVED` → `MOBILIZING` |
| `POST` | `/projects/:id/activate` | `MOBILIZING` → `ACTIVE` |
| `POST` | `/projects/:id/practical-completion` | `ACTIVE` → `PRACTICAL_COMPLETION` |
| `POST` | `/projects/:id/closeout` | `PRACTICAL_COMPLETION` → `CLOSEOUT` |
| `POST` | `/projects/:id/close` | `CLOSEOUT` → `CLOSED` |

No request body for any of the above.

#### Cancel Project
```
POST /projects/:id/cancel
```

Allowed from: `DRAFT`, `APPROVED`, `MOBILIZING`, `ACTIVE`.

**Request body:**
```json
{ "reason": "Client withdrew due to funding issues" }
```

---

#### Suspend / Resume

```
POST /projects/:id/suspend
```
**Request body:**
```json
{ "reason": "Awaiting site access clearance from municipality" }
```
**Error `409`:** Already has an active suspension.

```
POST /projects/:id/resume
```
No body. **Error `400`:** No active suspension to resume.

---

#### Project Members

```
GET  /projects/:id/members
POST /projects/:id/members
DELETE /projects/:id/members/:userId
```

**Add member — request body:**
```json
{
  "userId": "cld...",
  "roles": ["SITE_ENGINEER", "QUANTITY_SURVEYOR"]
}
```

**List members response:**
```json
[
  {
    "id": "cld...",
    "userId": "cld...",
    "joinedAt": "2026-08-02T14:00:00.000Z",
    "roles": [{ "role": "PROJECT_MANAGER" }],
    "user": { "id": "cld...", "firstName": "Ahmed", "email": "..." }
  }
]
```

---

### 5.9 BOQ (Bill of Quantities)

All routes are nested under `/projects/:projectId/boq`.

#### Initialize BOQ
```
POST /projects/:projectId/boq
```

Idempotent — returns the existing BOQ if already initialized.
Creates the BOQ root and a first DRAFT version automatically.

**Response:**
```json
{
  "id": "cld...",
  "projectId": "cld...",
  "originalBaselineVersionId": null,
  "currentApprovedVersionId": null,
  "currentDraftVersionId": "cld...",
  "versions": [
    {
      "id": "cld...",
      "versionNumber": 1,
      "status": "DRAFT",
      "notes": null,
      "baselinedAt": null,
      "createdBy": "cld...",
      "createdAt": "2026-08-02T14:00:00.000Z"
    }
  ]
}
```

---

#### Get BOQ
```
GET /projects/:projectId/boq
```
Returns same shape as Initialize response.

---

#### Create New Draft (from approved version)
```
POST /projects/:projectId/boq/draft
```

Only works when `currentApprovedVersionId` is set and `currentDraftVersionId` is null.
Copies all nodes from the approved version into a new draft.

**Request body:**
```json
{ "notes": "Variation Order #3 — additional excavation scope" }
```

**Error `400`:** No approved version exists.
**Error `409`:** Draft already exists.

---

#### Baseline (lock a draft as approved)
```
POST /projects/:projectId/boq/versions/:versionId/baseline
```

- The DRAFT → BASELINED
- Previous approved version → SUPERSEDED
- `originalBaselineVersionId` set on first baseline (immutable thereafter)

**Error `400`:** Not the current draft, or not in DRAFT status.

---

#### Cancel Draft
```
POST /projects/:projectId/boq/versions/:versionId/cancel
```

Cancels the draft without affecting the approved version.

---

#### Get Tree
```
GET /projects/:projectId/boq/versions/:versionId/tree
```

Returns the full hierarchical tree with computed totals.

**Response — array of root nodes (recursive):**
```json
[
  {
    "id": "cld...",
    "parentId": null,
    "path": "cld...",
    "depth": 0,
    "sortOrder": 1,
    "code": "01",
    "description": "Substructure Works",
    "descriptionAr": "أعمال البنية التحتية",
    "isLeaf": false,
    "unit": null,
    "quantity": null,
    "unitRate": null,
    "totalAmount": null,
    "computedTotal": 540000.00,
    "children": [
      {
        "id": "cld...",
        "parentId": "cld...",
        "path": "cld.../cld...",
        "depth": 1,
        "sortOrder": 1,
        "code": "01.01",
        "description": "Excavation",
        "isLeaf": true,
        "unit": "m³",
        "quantity": "1200.000",
        "unitRate": "45.00",
        "totalAmount": "54000.00",
        "computedTotal": 54000.00,
        "children": []
      }
    ]
  }
]
```

> `computedTotal` is computed at query time — sum of all descendant `totalAmount` values.
> For leaf nodes it equals `totalAmount`. For summary nodes it is the sum of children.

---

#### Add Node
```
POST /projects/:projectId/boq/versions/:versionId/nodes
```

**Request body:**
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
  "currency": "USD"
}
```

> Omit `parentId` to add at root level.
> `isLeaf: true` nodes accept `quantity`, `unitRate`, `unit`, `currency`.
> `isLeaf: false` (summary) nodes cannot have children added to a leaf node.

**Error `403`:** Version is not in DRAFT status.

---

#### Update Node
```
PATCH /projects/:projectId/boq/versions/:versionId/nodes/:nodeId
```

All fields optional. Cannot change `parentId` or `sortOrder` via this endpoint — use `/move`.

**Request body (partial):**
```json
{
  "description": "Mass Excavation",
  "quantity": 1350,
  "unitRate": 42.50
}
```

---

#### Move Node
```
POST /projects/:projectId/boq/versions/:versionId/nodes/:nodeId/move
```

Moves the node and **all its descendants** to a new parent position.
Uses raw SQL for atomic path/depth update on all affected nodes.

**Request body:**
```json
{
  "newParentId": "cld...",
  "newSortOrder": 2
}
```

> Omit `newParentId` to move to root level.

**Error `400`:** Circular move (target is a descendant of the moved node), or target is a leaf.

---

#### Delete Node
```
DELETE /projects/:projectId/boq/versions/:versionId/nodes/:nodeId
```

Hard-deletes the node. Must have no children.

**Error `400`:** Node has children — delete or re-parent them first.

---

## 6. Lifecycle State Machine (UI Reference)

### Project Status

```
         ┌─────────────────── CANCELLED ◄──────────────────────┐
         │         (from any of the first 4 states)             │
         ▼                                                       │
       DRAFT ──approve──► APPROVED ──mobilize──► MOBILIZING ──activate──► ACTIVE
                                                                            │
                              CLOSED ◄──close── CLOSEOUT ◄──closeout── PRACTICAL_COMPLETION
```

**Suspend/Resume** is a separate overlay — does not change status.
Lifecycle transitions are blocked while a suspension is active.

---

### BOQ Version Status

```
DRAFT ──baseline──► BASELINED (previous approved → SUPERSEDED)
DRAFT ──cancel───► CANCELLED

To revise: createDraft (copies BASELINED nodes) → edit → baseline again
```

---

## 7. CORS & Cookies

- CORS `credentials: true` is enabled. Your fetch/axios must include `credentials: 'include'` (or `withCredentials: true`).
- The refresh cookie is `SameSite=Lax` — it is sent on top-level navigations and same-origin requests, but **not** on cross-origin requests from third-party contexts.
- In development, the cookie `Path` is `/api/v1/auth` — the browser only sends it to auth endpoints, not to every API call.

```typescript
// Correct fetch config
fetch(url, {
  credentials: 'include',
  headers: { Authorization: `Bearer ${accessToken}` },
});

// Correct axios config
axios.defaults.withCredentials = true;
```

---

## 8. What Is NOT Built Yet (Do Not Call)

These features are planned but the endpoints do not exist:

- Contract management
- Subcontract / Subcontract Certificates
- IPC (Interim Payment Certificates)
- Material Requests / Purchase Orders / GRNs
- Stock Ledger / Stock Transfers
- Cost Ledger
- Daily Progress Reports / Measurement Sheets
- Labour & Equipment logging
- File uploads
- Notifications
- Settings
