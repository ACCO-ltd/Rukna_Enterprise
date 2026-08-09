/**
 * ─── Procurement API layer ──────────────────────────────────────────────────────
 *
 * One function per endpoint, written against the controllers rather than
 * `api-reference.md` §6.24–6.32 — the two disagree in seventeen places and the code wins.
 * Each divergence is noted at the function it affects and carries its P-series ID.
 *
 * Nothing here formats, translates or decides what to render. Money and quantities are
 * passed through as the decimal strings the API sends; the screens parse them into minor
 * units with `src/lib/money.ts`, and payloads are built with the converters in
 * `../quantities.ts`. That is the only place a float is produced (P17).
 */

import { apiClient } from '@/lib/api-client';

import type {
  ApproveExceptionPayload,
  ApprovePurchaseOrderPayload,
  BillMatchResult,
  CommitmentLedgerEntry,
  CommitmentSummary,
  CommitmentStage,
  CreateCategoryPayload,
  CreateGoodsReceiptPayload,
  CreateMaterialPayload,
  CreateMaterialRequestPayload,
  CreatePurchaseOrderPayload,
  CreateUomPayload,
  GoodsReceipt,
  Material,
  MaterialCategory,
  MaterialRequest,
  MaterialRequestScope,
  MaterialRequestStatus,
  PostGoodsReceiptPayload,
  PurchaseOrder,
  PurchaseOrderStatus,
  RevisePurchaseOrderPayload,
  SpendCategory,
  SupplierBill,
  UnitOfMeasure,
} from '../types';

/** Strips `undefined` entries so an absent filter is not sent as the string "undefined". */
function queryParams(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

// ─── Units of measure ────────────────────────────────────────────────────────────

/**
 * `GET /procurement/uom`
 *
 * Returns **ACTIVE units only**, always. `uom.service.ts:24` passes a hard-coded `'ACTIVE'`
 * and the controller exposes no `status` parameter (P2), so there is no way to list a
 * deactivated unit — §12.4's status filter cannot be built, and deactivation is a one-way
 * trapdoor from the UI's point of view.
 */
export function listUoms(): Promise<UnitOfMeasure[]> {
  return apiClient<UnitOfMeasure[]>('/procurement/uom');
}

export function getUom(id: string): Promise<UnitOfMeasure> {
  return apiClient<UnitOfMeasure>(`/procurement/uom/${id}`);
}

export function createUom(payload: CreateUomPayload): Promise<UnitOfMeasure> {
  return apiClient<UnitOfMeasure>('/procurement/uom', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /procurement/uom/:id/deactivate`
 *
 * There is no in-use guard on the server (P3): a unit referenced by live materials can be
 * deactivated, after which new materials cannot be created against it while existing ones
 * keep pointing at it. The confirm dialog says so.
 */
export function deactivateUom(id: string): Promise<UnitOfMeasure> {
  return apiClient<UnitOfMeasure>(`/procurement/uom/${id}/deactivate`, { method: 'POST' });
}

// ─── Material categories ─────────────────────────────────────────────────────────

/** `GET /procurement/material-categories` — roots with one level of `children` nested. */
export function listMaterialCategories(): Promise<MaterialCategory[]> {
  return apiClient<MaterialCategory[]>('/procurement/material-categories');
}

export function createMaterialCategory(
  payload: CreateCategoryPayload,
): Promise<MaterialCategory> {
  return apiClient<MaterialCategory>('/procurement/material-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deactivateMaterialCategory(id: string): Promise<MaterialCategory> {
  return apiClient<MaterialCategory>(`/procurement/material-categories/${id}/deactivate`, {
    method: 'POST',
  });
}

// ─── Spend categories ────────────────────────────────────────────────────────────

/**
 * `GET /procurement/spend-categories`
 *
 * A different entity from material categories, serving a different purpose — spend
 * categories drive approval routing, tolerance policy and commitment attribution. Never
 * label these "cost category" or "material category" in the UI (§12.4).
 */
export function listSpendCategories(): Promise<SpendCategory[]> {
  return apiClient<SpendCategory[]>('/procurement/spend-categories');
}

export function createSpendCategory(payload: CreateCategoryPayload): Promise<SpendCategory> {
  return apiClient<SpendCategory>('/procurement/spend-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deactivateSpendCategory(id: string): Promise<SpendCategory> {
  return apiClient<SpendCategory>(`/procurement/spend-categories/${id}/deactivate`, {
    method: 'POST',
  });
}

// ─── Materials ───────────────────────────────────────────────────────────────────

/**
 * `GET /procurement/materials`
 *
 * Two limits, both server-side. **ACTIVE only** — the service hard-codes it, so a
 * discontinued material is unlistable (P2). And there is **no `search` parameter** — the
 * controller reads `materialCategoryId` and `spendCategoryId` and nothing else, and an
 * unrecognised parameter is ignored silently rather than rejected (P1).
 *
 * So `MaterialPicker` fetches the catalogue once and filters in memory. Correct for
 * hundreds of materials; it will not survive tens of thousands.
 */
export function listMaterials(filters?: {
  materialCategoryId?: string;
  spendCategoryId?: string;
}): Promise<Material[]> {
  return apiClient<Material[]>('/procurement/materials', {
    params: queryParams({
      materialCategoryId: filters?.materialCategoryId,
      spendCategoryId: filters?.spendCategoryId,
    }),
  });
}

export function getMaterial(id: string): Promise<Material> {
  return apiClient<Material>(`/procurement/materials/${id}`);
}

export function createMaterial(payload: CreateMaterialPayload): Promise<Material> {
  return apiClient<Material>('/procurement/materials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function discontinueMaterial(id: string): Promise<Material> {
  return apiClient<Material>(`/procurement/materials/${id}/discontinue`, { method: 'POST' });
}

// ─── Material requests ───────────────────────────────────────────────────────────

export function listMaterialRequests(filters?: {
  status?: MaterialRequestStatus;
  projectId?: string;
  scope?: MaterialRequestScope;
}): Promise<MaterialRequest[]> {
  return apiClient<MaterialRequest[]>('/procurement/material-requests', {
    params: queryParams({
      status: filters?.status,
      projectId: filters?.projectId,
      scope: filters?.scope,
    }),
  });
}

export function getMaterialRequest(id: string): Promise<MaterialRequest> {
  return apiClient<MaterialRequest>(`/procurement/material-requests/${id}`);
}

/**
 * `POST /procurement/material-requests` — creates a DRAFT.
 *
 * `uomCode` must be present on every line and is ignored on MATERIAL lines, where the
 * server uses the material's own `baseUnitOfMeasureId` (P7). Send the material's base UoM
 * code — it is the honest value and it is discarded either way.
 *
 * None of `projectId`, `boqNodeId` or `spendCategoryId` is validated server-side (P8).
 */
export function createMaterialRequest(
  payload: CreateMaterialRequestPayload,
): Promise<MaterialRequest> {
  return apiClient<MaterialRequest>('/procurement/material-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitMaterialRequest(id: string): Promise<MaterialRequest> {
  return apiClient<MaterialRequest>(`/procurement/material-requests/${id}/submit`, {
    method: 'POST',
  });
}

export function approveMaterialRequest(id: string): Promise<MaterialRequest> {
  return apiClient<MaterialRequest>(`/procurement/material-requests/${id}/approve`, {
    method: 'POST',
  });
}

export function cancelMaterialRequest(id: string): Promise<MaterialRequest> {
  return apiClient<MaterialRequest>(`/procurement/material-requests/${id}/cancel`, {
    method: 'POST',
  });
}

/**
 * There is deliberately no `closeMaterialRequest`.
 *
 * `NEXT_STATUS` in `material-request.service.ts` permits `APPROVED → CLOSED` and
 * `PARTIALLY_ORDERED → CLOSED`, and §12.5 offers a Close action for both — but no
 * controller route reaches it (P4). `CLOSED` exists in the state machine and cannot be
 * reached over HTTP, so the button is not rendered.
 */

// ─── Purchase orders ─────────────────────────────────────────────────────────────

/**
 * `GET /procurement/purchase-orders`
 *
 * Each PO carries `supplier` and exactly **one** revision: the highest-numbered, with no
 * `lines` (P14). That means the list cannot compute §12.6's "Total Amount", and the
 * embedded revision is the DRAFT whenever a revision is in progress — not the ACTIVE one.
 * The list column is labelled "latest revision" for that reason.
 */
export function listPurchaseOrders(filters?: {
  status?: PurchaseOrderStatus;
  supplierId?: string;
}): Promise<PurchaseOrder[]> {
  return apiClient<PurchaseOrder[]>('/procurement/purchase-orders', {
    params: queryParams({ status: filters?.status, supplierId: filters?.supplierId }),
  });
}

/** `GET /procurement/purchase-orders/:id` — every revision, each with its lines. */
export function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>(`/procurement/purchase-orders/${id}`);
}

export function createPurchaseOrder(
  payload: CreatePurchaseOrderPayload,
): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>('/procurement/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>(`/procurement/purchase-orders/${id}/submit`, {
    method: 'POST',
  });
}

/**
 * `POST /procurement/purchase-orders/:id/approve`
 *
 * Marks the SUBMITTED revision ACTIVE, supersedes the previous ACTIVE one, and writes
 * `COMMITTED` commitment ledger entries.
 *
 * The supersede reversal is wrong (P11): it reverses the **full** original line value
 * rather than the uncommitted balance, so if goods were already received against the
 * superseded revision, `COMMITTED` is reduced twice and goes negative. The approve drawer
 * therefore does not repeat §12.6's promise about the uncommitted balance.
 */
export function approvePurchaseOrder(
  id: string,
  payload: ApprovePurchaseOrderPayload,
): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>(`/procurement/purchase-orders/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /procurement/purchase-orders/:id/revise` — a new DRAFT revision.
 *
 * The body requires `supplierId` and the service discards it (P13); a supplier cannot be
 * changed by revision. Resend the PO's existing value.
 */
export function revisePurchaseOrder(
  id: string,
  payload: RevisePurchaseOrderPayload,
): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>(`/procurement/purchase-orders/${id}/revise`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /procurement/purchase-orders/:id/cancel`
 *
 * Writes **no** commitment reversal (P12) — every `COMMITTED` entry from the approval
 * survives, so a cancelled order consumes commitment forever and there is no endpoint that
 * can correct it. The confirmation dialog says so.
 */
export function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiClient<PurchaseOrder>(`/procurement/purchase-orders/${id}/cancel`, {
    method: 'POST',
  });
}

// ─── Goods receipts ──────────────────────────────────────────────────────────────

export function listGoodsReceipts(filters?: {
  purchaseOrderId?: string;
}): Promise<GoodsReceipt[]> {
  return apiClient<GoodsReceipt[]>('/procurement/goods-receipts', {
    params: queryParams({ purchaseOrderId: filters?.purchaseOrderId }),
  });
}

export function getGoodsReceipt(id: string): Promise<GoodsReceipt> {
  return apiClient<GoodsReceipt>(`/procurement/goods-receipts/${id}`);
}

/**
 * `POST /procurement/goods-receipts`
 *
 * Lines with no quantity must be **omitted**, not sent as zeros: `receivedQuantity` and
 * `acceptedQuantity` are both `@IsPositive()`, so a single zero row `400`s the whole
 * request (P6). The same validator makes a fully rejected line impossible to record.
 *
 * If cumulative receipt exceeds the ordered quantity beyond the org's tolerance, the GRN
 * is created as `EXCEPTION_PENDING` — from which there is no route back (P10).
 */
export function createGoodsReceipt(
  payload: CreateGoodsReceiptPayload,
): Promise<GoodsReceipt> {
  return apiClient<GoodsReceipt>('/procurement/goods-receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `POST /procurement/goods-receipts/:id/post` — DRAFT only; moves COMMITTED → ACCRUED. */
export function postGoodsReceipt(
  id: string,
  payload: PostGoodsReceiptPayload,
): Promise<GoodsReceipt> {
  return apiClient<GoodsReceipt>(`/procurement/goods-receipts/${id}/post`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelGoodsReceipt(id: string): Promise<GoodsReceipt> {
  return apiClient<GoodsReceipt>(`/procurement/goods-receipts/${id}/cancel`, {
    method: 'POST',
  });
}

// ─── Bill matching ───────────────────────────────────────────────────────────────

/**
 * `GET /procurement/bill-matching/:billId`
 *
 * Returns `null` when matching has never been run for the bill — the service has nothing
 * to return, and the caller treats that as `NOT_RUN` rather than as an error.
 */
export function getBillMatch(billId: string): Promise<BillMatchResult | null> {
  return apiClient<BillMatchResult | null>(`/procurement/bill-matching/${billId}`);
}

/** `POST /procurement/bill-matching/:billId/run` — no body. Type inferred server-side. */
export function runBillMatch(billId: string): Promise<BillMatchResult> {
  return apiClient<BillMatchResult>(`/procurement/bill-matching/${billId}/run`, {
    method: 'POST',
  });
}

export function approveMatchException(
  billId: string,
  payload: ApproveExceptionPayload,
): Promise<BillMatchResult> {
  return apiClient<BillMatchResult>(`/procurement/bill-matching/${billId}/approve-exception`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Supplier bills (read-only host for the Matching tab) ───────────────────────

/**
 * `GET /bills`
 *
 * Read-only here on purpose. `POST /bills` needs a `supplierId` and no endpoint lists
 * suppliers (#26), so bills cannot be created from the UI at all. Neither this response
 * nor the detail one embeds the `supplier` relation, so a supplier **name** is
 * unavailable anywhere on these screens (P16).
 *
 * `status` is documented as a filter and not implemented (A7) — filtering is client-side.
 */
export function listSupplierBills(filters?: { supplierId?: string }): Promise<SupplierBill[]> {
  return apiClient<SupplierBill[]>('/bills', {
    params: queryParams({ supplierId: filters?.supplierId }),
  });
}

export function getSupplierBill(id: string): Promise<SupplierBill> {
  return apiClient<SupplierBill>(`/bills/${id}`);
}

// ─── Commitment ledger ───────────────────────────────────────────────────────────

/**
 * `GET /procurement/commitment-ledger/projects/:projectId`
 *
 * Project-scoped only — there is no organization-wide ledger endpoint, which is why §12.9
 * makes the project picker mandatory rather than optional.
 */
export function listProjectCommitments(
  projectId: string,
  filters?: { stage?: CommitmentStage; boqNodeId?: string },
): Promise<CommitmentLedgerEntry[]> {
  return apiClient<CommitmentLedgerEntry[]>(
    `/procurement/commitment-ledger/projects/${projectId}`,
    { params: queryParams({ stage: filters?.stage, boqNodeId: filters?.boqNodeId }) },
  );
}

/**
 * `GET /procurement/commitment-ledger/projects/:projectId/summary`
 *
 * These three totals overstate wherever a PO has been cancelled (P12) or revised after
 * goods were received (P11). Both are server-side defects with no client-side correction;
 * the card carries a note.
 */
export function getProjectCommitmentSummary(projectId: string): Promise<CommitmentSummary> {
  return apiClient<CommitmentSummary>(
    `/procurement/commitment-ledger/projects/${projectId}/summary`,
  );
}

export function listPurchaseOrderCommitments(
  poId: string,
): Promise<CommitmentLedgerEntry[]> {
  return apiClient<CommitmentLedgerEntry[]>(
    `/procurement/commitment-ledger/purchase-orders/${poId}`,
  );
}

// ─── Suppliers — blocked ─────────────────────────────────────────────────────────

/**
 * There is no supplier endpoint.
 *
 * `Supplier` exists in `schema.prisma` and has no controller (A3 / #26). No supplier is
 * seeded either, so there is no way to obtain a valid `supplierId` through the API at all
 * — which is why the "New Purchase Order" entry point is disabled rather than the create
 * page being omitted. The page is built and tested; only its supplier field has no source.
 *
 * When `GET /suppliers` lands, this function's body is the whole change.
 */
export function listSuppliers(): Promise<never> {
  return Promise.reject(
    new Error(
      'GET /suppliers does not exist — blocked on issue #26. ' +
        'A purchase order cannot be created until it does.',
    ),
  );
}

/** Whether supplier-dependent create paths can be offered at all. */
export const SUPPLIER_ENDPOINT_AVAILABLE = false;
