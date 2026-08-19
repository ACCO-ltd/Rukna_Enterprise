# Frontend Integration — Files, Documents, Progress/DPR, Roll-up, Signal, IPA pre-fill

Contract reference for the frontend build against the endpoints landed in PR #68.
Routes are transcribed from the actual controllers; payload shapes from `@erp/types`
(`packages/types/src/construction.ts`) and the DTOs.

**Auth:** every endpoint requires `Authorization: Bearer <access-token>` (JWT). Tenant is
resolved from the request (subdomain/host) — the frontend does not send a tenant id.
**Never** store the token in `localStorage`. Money and quantities come back as **strings**
(Decimal); percentages come back as **numbers**.

---

## 0. The upload flow (prerequisite for Documents + DPR evidence)

`PlatformFile` (ADR-014) is a **two-step** upload: presign → PUT to storage → confirm.
Bytes go straight to object storage via a presigned URL; the API only stores metadata.

```
1. POST /files                         → { fileId, uploadUrl }
2. PUT  <uploadUrl>  (raw file body, Content-Type = mimeType)   [direct to storage]
3. POST /files/:fileId/confirm         → file becomes READY
4. …now attach fileId to a Document or a DPR
```

| Method | Route | Body | Returns |
|---|---|---|---|
| POST | `/files` | `{ originalName, mimeType }` | `{ fileId, uploadUrl }` |
| POST | `/files/:id/confirm` | `{ checksumSha256? }` | the READY file record |
| GET | `/files/:id/download` | — | `{ url, originalName, mimeType }` (short-lived signed URL) |
| DELETE | `/files/:id` | — | rejected once the file is immutable/audit-relevant |

Notes:
- Step 2 is a plain `PUT` to `uploadUrl` — **not** through the API. Set the request
  `Content-Type` to the same `mimeType` you presigned with.
- A file is `PENDING` until confirmed, then `READY`. Documents/DPR attach endpoints reject a
  non-`READY` file.
- To show/download a file, call `/files/:id/download` and use the returned `url` (it expires,
  ~15 min — fetch on demand, don't cache).

---

## 1. Documents tab

Base: `/projects/:projectId/documents`. Upload the bytes via §0 first, then attach the READY file.

| Method | Route | Body | Returns |
|---|---|---|---|
| POST | `/projects/:projectId/documents` | `{ platformFileId, category, title }` | `ProjectDocumentResponse` |
| GET | `/projects/:projectId/documents` | — | `ProjectDocumentResponse[]` |
| DELETE | `/projects/:projectId/documents/:docId` | — | detach |

`category` ∈ `PERMIT | LICENSE | DRAWING | CONTRACT | CERTIFICATE | INSURANCE | GUARANTEE | CORRESPONDENCE | PHOTO | OTHER`

`ProjectDocumentResponse` carries a nested `platformFile { originalName, mimeType, sizeBytes, status }`
so the list renders without an extra call. Use `/files/:id/download` only when the user clicks to open.

---

## 2. Progress — Daily Progress Reports (DPR)

Lifecycle: `DRAFT → SUBMITTED → APPROVED` (or `→ RETURNED` for revision).
Measurements are editable **only while DRAFT**. On approve, measurements become **verified
progress** and the report is immutable. Approve enforces cumulative ≤ BOQ scope (CONST-PROG-002/009).

**Report-scoped (`/progress/reports/...`):**

| Method | Route | Body | Notes |
|---|---|---|---|
| POST | `/projects/:projectId/progress/reports` | `{ reportDate, weather?, labourCount?, equipmentNote?, narrative?, delayReason? }` | creates DRAFT |
| GET | `/projects/:projectId/progress/reports` | — | list DPRs |
| GET | `/progress/reports/:dprId` | — | report + measurements + evidence |
| POST | `/progress/reports/:dprId/measurements` | `{ boqNodeId, quantity, notes? }` | **BOQ leaf only, DRAFT only** |
| POST | `/progress/reports/:dprId/evidence` | `{ platformFileId }` | file must be READY |
| POST | `/progress/reports/:dprId/submit` | — | DRAFT → SUBMITTED |
| POST | `/progress/reports/:dprId/approve` | — | SUBMITTED → APPROVED (verifies progress) |
| POST | `/progress/reports/:dprId/return` | `{ reason }` | SUBMITTED → RETURNED |

`reportDate` is an ISO date string (`YYYY-MM-DD`). `quantity` is a number (≤3 dp).

**Verified progress (read models):**

| Method | Route | Returns |
|---|---|---|
| GET | `/projects/:projectId/progress` | `ProjectProgressLine[]` — verified % per BOQ leaf (approved DPRs only) |

`ProjectProgressLine`: `{ boqNodeId, code, description, measurableQuantity, verifiedToDate, percentComplete: number|null }`.

---

## 3. Work packages + roll-up

Work packages are the weighted control layer. Weights are fractions (0..1); the roll-up is the
weight-weighted mean of leaf %, **never money-weighted** (CONST-PROG-007). `weightsComplete` is
false until weights total 100% — surface that as a "weights incomplete → % understated" hint.

| Method | Route | Body | Returns |
|---|---|---|---|
| POST | `/projects/:projectId/work-packages` | `{ code, name, responsibleOwner?, progressWeight? }` | work package |
| GET | `/projects/:projectId/work-packages` | — | list |
| POST | `/work-packages/:workPackageId/boq-nodes` | `{ boqNodeId }` | allocate a BOQ **leaf** |
| GET | `/projects/:projectId/progress/rollup` | — | `ProjectRollupResponse` |

`ProjectRollupResponse`: `{ projectId, physicalPercent: number, weightsTotal, weightsComplete, packages: WorkPackageRollupLine[] }`
`WorkPackageRollupLine`: `{ id, code, name, responsibleOwner, weight, percentComplete: number, leafCount }`

---

## 4. Physical-vs-financial signal (Overview/Finance cockpit)

Compares built % against cost consumed % — an early-warning, **not** EVM.

| Method | Route | Returns |
|---|---|---|
| GET | `/projects/:projectId/progress/signal` | `PhysicalFinancialSignalResponse` |

```ts
{
  projectId, physicalPercent,           // number
  actualCost, forecastCost,             // string (Decimal)
  costConsumedPercent,                  // number | null (null = no forecast cost yet)
  divergence,                           // number | null: physical − cost (positive = built ahead of spend)
  status: 'ALIGNED' | 'COST_AHEAD' | 'PROGRESS_AHEAD' | 'INSUFFICIENT_DATA',
  weightsComplete                       // boolean (from the roll-up)
}
```

Suggested rendering: `COST_AHEAD` = amber/red "investigate variance"; `PROGRESS_AHEAD` = neutral/green;
`INSUFFICIENT_DATA` = show "not enough data" (no forecast cost). Divergence threshold is 20 points
(server-side); frontend just renders the returned `status`.

---

## 5. IPA pre-fill (firewall-safe suggestion)

Suggests claim quantities from **verified** progress. It **suggests only** — the QS confirms and the
IPA is created the normal way. Nothing here auto-bills.

| Method | Route | Query | Returns |
|---|---|---|---|
| GET | `/ipa/prefill` | `contractId` (required) | `IpaPrefillResponse` |

```ts
IpaPrefillResponse {
  contractId, projectId,
  source: 'VERIFIED_PROGRESS',
  suggestions: IpaPrefillLine[]
}
IpaPrefillLine {
  boqNodeId, code, description,
  measurableQuantity, verifiedToDate, previousEffectiveCertified,  // strings
  suggestedCumulativeClaim,   // clamped to [prev-certified, BOQ measurable]
  suggestedPeriodClaim        // cumulative − previously certified
}
```

Flow: user opens "New IPA" for a contract → call `/ipa/prefill?contractId=…` → pre-populate the
line editor with `suggestedCumulativeClaim` (editable) → user confirms → `POST /ipa` + `POST /ipa/:id/items`
as today. `/ipa` also accepts `?projectId=` on the list endpoint (mutually exclusive with `contractId`).

---

## Conventions cheat-sheet

- **Strings** = Decimal (money, quantities, weights). Parse with a decimal lib or keep as string for display; don't `Number()` money for arithmetic.
- **Numbers** = percentages (`physicalPercent`, `percentComplete`, `costConsumedPercent`, `divergence`).
- `percentComplete` / `costConsumedPercent` can be **null** — guard before formatting.
- 400 = a domain-rule rejection (e.g. non-leaf measurement, non-DRAFT edit, over-scope approve, non-READY file) — show the message; it's meant for the user.
- 403/permission errors on IPA routes require the `ipa:*` permissions; Progress/Documents require project membership.
