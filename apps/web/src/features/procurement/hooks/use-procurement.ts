'use client';

/**
 * TanStack Query bindings for the procurement API.
 *
 * Mutations invalidate by the narrowest key that can have changed, with one deliberate
 * exception: anything that writes to the commitment ledger — approving a purchase order,
 * posting a goods receipt, cancelling a PO — also invalidates `commitments()`. The
 * Commitments card on the Project Command Center is rendered from a different query than
 * the screen the user is standing on, and a stale one there reads as a real figure.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { PurchaseOrderBillPaymentsResponse, SupplierBillEligibility } from '@erp/types';

import { unitOfMeasureKeys } from '@/features/units-of-measure/hooks/use-units-of-measure';
import {
  allocateAdvance,
  approveGoodsReceiptException,
  approveMatchException,
  approveMaterialRequest,
  approveSupplierBill,
  approveSupplierPayment,
  releaseSupplierPayment,
  approvePurchaseOrder,
  cancelGoodsReceipt,
  cancelMaterialRequest,
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createGoodsReceipt,
  createMaterial,
  createMaterialCategory,
  createMaterialRequest,
  createPurchaseOrder,
  createSpendCategory,
  createSupplier,
  createSupplierBill,
  createSupplierPayment,
  createUom,
  deactivateMaterialCategory,
  deactivateSpendCategory,
  deactivateUom,
  discontinueMaterial,
  getBillMatch,
  getGoodsReceipt,
  getMaterialRequest,
  getProjectCommitmentSummary,
  getPurchaseOrder,
  getPurchaseOrderSettlement,
  getPurchaseOrderReceiving,
  getSupplierBill,
  getSupplierBillActivity,
  getSupplierBillApprovals,
  getSupplierBillPayments,
  getSupplierBillEligibility,
  getPurchaseOrderBillPayments,
  getSupplierPayment,
  listGoodsReceipts,
  listGoodsReceiptAttachments,
  listMaterialCategories,
  listMaterialRequests,
  listMaterials,
  listPoRevisionAttachments,
  listProjectCommitments,
  listPurchaseOrderCommitments,
  listPurchaseOrders,
  listSpendCategories,
  listSupplierBills,
  listSupplierPayments,
  listSuppliers,
  listUoms,
  postGoodsReceipt,
  postSupplierBill,
  postSupplierPayment,
  rejectSupplierBill,
  returnSupplierBill,
  reverseSupplierBill,
  reverseSupplierPayment,
  revisePurchaseOrder,
  resolveMatchException,
  runBillMatch,
  submitMaterialRequest,
  submitPurchaseOrder,
  submitSupplierBill,
  updateSupplierBill,
  updateSupplier,
  attachPoRevision,
  createBuyerAdvance,
  getBuyerAdvance,
  listBuyerAdvances,
  postBuyerAdvance,
  createAdvanceReturn,
  createEvidenceAllocation,
} from '../api/procurement-api';
import type {
  BillActivityEntry,
  BillApprovals,
  BillPayments,
  ApproveExceptionPayload,
  BillMatchResult,
  ResolveExceptionPayload,
  CommitmentLedgerEntry,
  CommitmentStage,
  CommitmentSummary,
  CreateCategoryPayload,
  CreateGoodsReceiptPayload,
  CreateMaterialPayload,
  CreateMaterialRequestPayload,
  CreatePurchaseOrderPayload,
  CreateUomPayload,
  GoodsReceipt,
  GrnAttachment,
  Material,
  MaterialCategory,
  MaterialRequest,
  MaterialRequestScope,
  MaterialRequestStatus,
  PoRevisionAttachment,
  PurchaseOrder,
  PurchaseOrderSettlement,
  PurchaseOrderReceiving,
  PurchaseOrderStatus,
  RevisePurchaseOrderPayload,
  SpendCategory,
  Supplier,
  SupplierBill,
  SupplierPayment,
  AllocateAdvancePayload,
  CreateSupplierPaymentPayload,
  PostSupplierPaymentPayload,
  ReverseSupplierPaymentPayload,
  CreateSupplierPayload,
  UpdateSupplierPayload,
  CreateSupplierBillPayload,
  PostSupplierBillPayload,
  ReverseSupplierBillPayload,
  UnitOfMeasure,
  AttachPoRevisionPayload,
  BuyerAdvance,
  CreateBuyerAdvancePayload,
  CreateAdvanceReturnPayload,
  CreateEvidenceAllocationPayload,
} from '../types';

export const procurementKeys = {
  all: ['procurement'] as const,
  uoms: () => [...procurementKeys.all, 'uoms'] as const,
  materialCategories: () => [...procurementKeys.all, 'material-categories'] as const,
  spendCategories: () => [...procurementKeys.all, 'spend-categories'] as const,
  suppliers: (status?: string) =>
    [...procurementKeys.all, 'suppliers', status ?? 'all'] as const,
  materials: (categoryId?: string, spendId?: string) =>
    [...procurementKeys.all, 'materials', categoryId ?? 'all', spendId ?? 'all'] as const,
  materialRequests: (
    status?: string,
    projectId?: string,
    scope?: string,
  ) =>
    [
      ...procurementKeys.all,
      'material-requests',
      status ?? 'all',
      projectId ?? 'all',
      scope ?? 'all',
    ] as const,
  materialRequest: (id: string) => [...procurementKeys.all, 'material-request', id] as const,
  purchaseOrders: (status?: string, supplierId?: string, projectId?: string) =>
    [...procurementKeys.all, 'purchase-orders', status ?? 'all', supplierId ?? 'all', projectId ?? 'all'] as const,
  purchaseOrder: (id: string) => [...procurementKeys.all, 'purchase-order', id] as const,
  goodsReceipts: (purchaseOrderId?: string) =>
    [...procurementKeys.all, 'goods-receipts', purchaseOrderId ?? 'all'] as const,
  goodsReceipt: (id: string) => [...procurementKeys.all, 'goods-receipt', id] as const,
  bills: (supplierId?: string, projectId?: string) =>
    [...procurementKeys.all, 'bills', supplierId ?? 'all', projectId ?? 'all'] as const,
  bill: (id: string) => [...procurementKeys.all, 'bill', id] as const,
  payments: (supplierId?: string, projectId?: string) =>
    [...procurementKeys.all, 'payments', supplierId ?? 'all', projectId ?? 'all'] as const,
  payment: (id: string) => [...procurementKeys.all, 'payment', id] as const,
  billMatch: (billId: string) => [...procurementKeys.all, 'bill-match', billId] as const,
  commitments: () => [...procurementKeys.all, 'commitments'] as const,
  projectCommitments: (projectId: string, stage?: string, boqNodeId?: string) =>
    [
      ...procurementKeys.commitments(),
      'project',
      projectId,
      stage ?? 'all',
      boqNodeId ?? 'all',
    ] as const,
  projectCommitmentSummary: (projectId: string) =>
    [...procurementKeys.commitments(), 'project-summary', projectId] as const,
  purchaseOrderCommitments: (poId: string) =>
    [...procurementKeys.commitments(), 'purchase-order', poId] as const,
  purchaseOrderSettlement: (poId: string) =>
    [...procurementKeys.all, 'po-settlement', poId] as const,
  purchaseOrderReceiving: (poId: string) =>
    [...procurementKeys.all, 'po-receiving', poId] as const,
  poRevisionAttachments: (poId: string) =>
    [...procurementKeys.all, 'po-revision-attachments', poId] as const,
  grnAttachments: (grnId: string) =>
    [...procurementKeys.all, 'grn-attachments', grnId] as const,
  buyerAdvance: (id: string) => [...procurementKeys.all, 'buyer-advance', id] as const,
  buyerAdvances: (poId: string) => [...procurementKeys.all, 'buyer-advances', poId] as const,
};

// ─── Catalogue ───────────────────────────────────────────────────────────────────

export function useUoms(): UseQueryResult<UnitOfMeasure[]> {
  return useQuery({ queryKey: procurementKeys.uoms(), queryFn: listUoms });
}

export function useMaterialCategories(): UseQueryResult<MaterialCategory[]> {
  return useQuery({
    queryKey: procurementKeys.materialCategories(),
    queryFn: listMaterialCategories,
  });
}

export function useSpendCategories(): UseQueryResult<SpendCategory[]> {
  return useQuery({
    queryKey: procurementKeys.spendCategories(),
    queryFn: listSpendCategories,
  });
}

/**
 * The whole active catalogue. There is no `search` parameter (P1), so pickers filter this
 * in memory — which is also why it is one cache entry per category filter rather than one
 * per keystroke.
 */
export function useMaterials(filters?: {
  materialCategoryId?: string;
  spendCategoryId?: string;
}): UseQueryResult<Material[]> {
  return useQuery({
    queryKey: procurementKeys.materials(filters?.materialCategoryId, filters?.spendCategoryId),
    queryFn: () => listMaterials(filters),
  });
}

// ─── Suppliers ───────────────────────────────────────────────────────────────────

/**
 * Every supplier in the organisation.
 *
 * One cache entry, shared by the Suppliers screen and by every `SupplierPicker` on the
 * purchase-order, bill and payment forms. Like materials (P1) there is no `search`
 * parameter, so the picker filters this in memory rather than per keystroke — the list is
 * a supplier master, not a transaction log, and fetching it once is cheaper than debouncing.
 */
export function useSuppliers(filters?: {
  status?: 'ACTIVE' | 'INACTIVE';
}): UseQueryResult<Supplier[]> {
  return useQuery({
    queryKey: procurementKeys.suppliers(filters?.status),
    queryFn: () => listSuppliers(filters),
  });
}

/**
 * Invalidates every supplier list regardless of its status filter, because a new supplier
 * is ACTIVE and belongs in both the unfiltered and the ACTIVE view.
 */
export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSupplierPayload) => createSupplier(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.supplierCreated',
        values: (supplier) => ({ name: (supplier as Supplier).name }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'suppliers'] }),
  });
}

/**
 * Corrects a supplier's master data (A15 / D8). Invalidates every supplier list regardless
 * of its status filter, and every `SupplierPicker` reads the same cache entry, so a corrected
 * name propagates to the pickers on the PO, bill and payment forms without a manual refetch.
 */
export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSupplierPayload }) =>
      updateSupplier(id, payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.supplierUpdated',
        values: (supplier) => ({ name: (supplier as Supplier).name }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'suppliers'] }),
  });
}

// ─── Catalogue mutations ─────────────────────────────────────────────────────────

/**
 * A unit change refreshes both reads of the registry: this admin list and the open lookup the
 * BOQ unit picker uses (`useUnitsOfMeasure`), which would otherwise keep offering a deactivated
 * unit, or miss a new one, for its whole stale time.
 */
function invalidateUnitLists(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: procurementKeys.uoms() }),
    qc.invalidateQueries({ queryKey: unitOfMeasureKeys.all }),
  ]);
}

export function useCreateUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUomPayload) => createUom(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.uomCreated',
        values: (uom) => ({ code: (uom as UnitOfMeasure).code }),
      },
    },
    onSuccess: () => invalidateUnitLists(qc),
  });
}

export function useDeactivateUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateUom(id),
    meta: { successToast: 'procurement.feedback.uomDeactivated' },
    onSuccess: () => invalidateUnitLists(qc),
  });
}

export function useCreateMaterialCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => createMaterialCategory(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.materialCategoryCreated',
        values: (category) => ({ name: (category as MaterialCategory).name }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: procurementKeys.materialCategories() }),
  });
}

export function useDeactivateMaterialCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateMaterialCategory(id),
    meta: { successToast: 'procurement.feedback.materialCategoryDeactivated' },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: procurementKeys.materialCategories() }),
  });
}

export function useCreateSpendCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => createSpendCategory(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.spendCategoryCreated',
        values: (category) => ({ name: (category as SpendCategory).name }),
      },
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.spendCategories() }),
  });
}

export function useDeactivateSpendCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateSpendCategory(id),
    meta: { successToast: 'procurement.feedback.spendCategoryDeactivated' },
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.spendCategories() }),
  });
}

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMaterialPayload) => createMaterial(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.materialCreated',
        values: (material) => ({ code: (material as Material).code }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'materials'] }),
  });
}

export function useDiscontinueMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => discontinueMaterial(id),
    meta: { successToast: 'procurement.feedback.materialDiscontinued' },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'materials'] }),
  });
}

// ─── Material requests ───────────────────────────────────────────────────────────

export function useMaterialRequests(filters?: {
  status?: MaterialRequestStatus;
  projectId?: string;
  scope?: MaterialRequestScope;
}): UseQueryResult<MaterialRequest[]> {
  return useQuery({
    queryKey: procurementKeys.materialRequests(
      filters?.status,
      filters?.projectId,
      filters?.scope,
    ),
    queryFn: () => listMaterialRequests(filters),
  });
}

export function useMaterialRequest(id: string): UseQueryResult<MaterialRequest> {
  return useQuery({
    queryKey: procurementKeys.materialRequest(id),
    queryFn: () => getMaterialRequest(id),
    enabled: Boolean(id),
  });
}

export function useCreateMaterialRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMaterialRequestPayload) => createMaterialRequest(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.mrCreated',
        values: (mr) => ({ ref: (mr as MaterialRequest).mrNumber }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'material-requests'] }),
  });
}

/**
 * The three MR lifecycle transitions that exist. There is no close (P4) — `CLOSED` is
 * reachable in the service's state machine and by no route.
 */
function useMrTransition(
  action: (id: string) => Promise<MaterialRequest>,
  feedbackKey: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => action(id),
    meta: {
      successToast: {
        key: feedbackKey,
        values: (mr) => ({ ref: (mr as MaterialRequest).mrNumber }),
      },
    },
    onSuccess: (mr) => {
      qc.invalidateQueries({ queryKey: procurementKeys.materialRequest(mr.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'material-requests'] });
    },
  });
}

export const useSubmitMaterialRequest = () =>
  useMrTransition(submitMaterialRequest, 'procurement.feedback.mrSubmitted');
export const useApproveMaterialRequest = () =>
  useMrTransition(approveMaterialRequest, 'procurement.feedback.mrApproved');
export const useCancelMaterialRequest = () =>
  useMrTransition(cancelMaterialRequest, 'procurement.feedback.mrCancelled');

// ─── Purchase orders ─────────────────────────────────────────────────────────────

export function usePurchaseOrders(filters?: {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  projectId?: string;
}): UseQueryResult<PurchaseOrder[]> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrders(filters?.status, filters?.supplierId, filters?.projectId),
    queryFn: () => listPurchaseOrders(filters),
  });
}

export function usePurchaseOrder(id: string): UseQueryResult<PurchaseOrder> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrder(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: Boolean(id),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePurchaseOrderPayload) => createPurchaseOrder(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.poCreated',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] }),
  });
}

export function useSubmitPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => submitPurchaseOrder(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.poSubmitted',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
    },
  });
}

/** Writes commitment entries — the ledger and every summary card go stale together. */
export function useApprovePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => approvePurchaseOrder(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.poApproved',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
      qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

export function useRevisePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RevisePurchaseOrderPayload }) =>
      revisePurchaseOrder(id, payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.poRevised',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
    },
  });
}

/**
 * Cancelling writes no commitment reversal (P12), so the ledger does not actually change.
 * It is invalidated anyway — the PO's own status did change, and a cache that disagrees
 * with the server about anything on this screen is worse than a refetch.
 */
export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelPurchaseOrder(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.poCancelled',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
      qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

/** Confirms the DRAFT revision → ACTIVE, PO DRAFT → OPEN, writes COMMITTED entries. */
export function useConfirmPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => confirmPurchaseOrder(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.poConfirmed',
        values: (po) => ({ ref: (po as PurchaseOrder).poNumber }),
      },
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
      qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

/** Receiving only (ordered vs accepted per line, no money) — `view:procurement`. */
export function usePurchaseOrderReceiving(poId: string): UseQueryResult<PurchaseOrderReceiving> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrderReceiving(poId),
    queryFn: () => getPurchaseOrderReceiving(poId),
    enabled: Boolean(poId),
  });
}

/**
 * Full reconciliation read model for a PO — funding, receiving, settlement status. Carries money:
 * the API requires `view:procurement` + `view:commitment-ledger` (ADR-043 review M2), so callers
 * pass `enabled: false` for anyone without both.
 */
export function usePurchaseOrderSettlement(
  poId: string,
  options?: { enabled?: boolean },
): UseQueryResult<PurchaseOrderSettlement> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrderSettlement(poId),
    queryFn: () => getPurchaseOrderSettlement(poId),
    enabled: Boolean(poId) && (options?.enabled ?? true),
  });
}

/** Quotation evidence attached to the current revision of a PO. */
export function usePoRevisionAttachments(poId: string): UseQueryResult<PoRevisionAttachment[]> {
  return useQuery({
    queryKey: procurementKeys.poRevisionAttachments(poId),
    queryFn: () => listPoRevisionAttachments(poId),
    enabled: Boolean(poId),
  });
}

/** Delivery note evidence attached to a GRN. */
export function useGoodsReceiptAttachments(
  grnId: string,
  options?: { enabled?: boolean },
): UseQueryResult<GrnAttachment[]> {
  return useQuery({
    queryKey: procurementKeys.grnAttachments(grnId),
    queryFn: () => listGoodsReceiptAttachments(grnId),
    enabled: Boolean(grnId) && (options?.enabled ?? true),
  });
}

// ─── Goods receipts ──────────────────────────────────────────────────────────────

export function useGoodsReceipts(filters?: {
  purchaseOrderId?: string;
}): UseQueryResult<GoodsReceipt[]> {
  return useQuery({
    queryKey: procurementKeys.goodsReceipts(filters?.purchaseOrderId),
    queryFn: () => listGoodsReceipts(filters),
  });
}

export function useGoodsReceipt(id: string): UseQueryResult<GoodsReceipt> {
  return useQuery({
    queryKey: procurementKeys.goodsReceipt(id),
    queryFn: () => getGoodsReceipt(id),
    enabled: Boolean(id),
  });
}

export function useCreateGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGoodsReceiptPayload) => createGoodsReceipt(payload),
    meta: {
      successToast: {
        key: 'procurement.feedback.grnSaved',
        values: (grn) => ({ ref: (grn as GoodsReceipt).grnNumber }),
      },
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] }),
  });
}

/** Moves COMMITTED → ACCRUED, so the ledger and both summary surfaces go stale. */
export function usePostGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => postGoodsReceipt(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.grnPosted',
        values: (grn) => ({ ref: (grn as GoodsReceipt).grnNumber }),
      },
    },
    onSuccess: (grn) => {
      qc.invalidateQueries({ queryKey: procurementKeys.goodsReceipt(grn.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] });
      qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

export function useCancelGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelGoodsReceipt(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.grnCancelled',
        values: (grn) => ({ ref: (grn as GoodsReceipt).grnNumber }),
      },
    },
    onSuccess: (grn) => {
      qc.invalidateQueries({ queryKey: procurementKeys.goodsReceipt(grn.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] });
    },
  });
}

/**
 * Clears an over-receipt hold: EXCEPTION_PENDING → DRAFT. It does not touch the commitment
 * ledger — that moves on Post — so only the receipt and the list are invalidated, matching
 * cancel rather than post.
 */
export function useApproveGoodsReceiptException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveGoodsReceiptException(id),
    meta: {
      successToast: {
        key: 'procurement.feedback.grnExceptionApproved',
        values: (grn) => ({ ref: (grn as GoodsReceipt).grnNumber }),
      },
    },
    onSuccess: (grn) => {
      qc.invalidateQueries({ queryKey: procurementKeys.goodsReceipt(grn.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] });
    },
  });
}

// ─── Supplier bills and matching ─────────────────────────────────────────────────

export function useSupplierBills(
  filters?: { supplierId?: string; projectId?: string },
  options?: { enabled?: boolean },
): UseQueryResult<SupplierBill[]> {
  return useQuery({
    queryKey: procurementKeys.bills(filters?.supplierId, filters?.projectId),
    queryFn: () => listSupplierBills(filters),
    // The payment form gates this on a chosen supplier — there is nothing to fetch, and no
    // "Apply to bills" list to build, before one is picked. Defaults to on for every other caller.
    enabled: options?.enabled ?? true,
  });
}

export function useSupplierBill(id: string): UseQueryResult<SupplierBill> {
  return useQuery({
    queryKey: procurementKeys.bill(id),
    queryFn: () => getSupplierBill(id),
    enabled: Boolean(id),
  });
}

// Keyed under the bill, so every bill mutation's invalidation of `bill(id)` refreshes them too.

export function useSupplierBillApprovals(id: string): UseQueryResult<BillApprovals> {
  return useQuery({
    queryKey: [...procurementKeys.bill(id), 'approvals'],
    queryFn: () => getSupplierBillApprovals(id),
    enabled: Boolean(id),
  });
}

export function useSupplierBillActivity(id: string): UseQueryResult<BillActivityEntry[]> {
  return useQuery({
    queryKey: [...procurementKeys.bill(id), 'activity'],
    queryFn: () => getSupplierBillActivity(id),
    enabled: Boolean(id),
  });
}

export function useSupplierBillPayments(id: string): UseQueryResult<BillPayments> {
  return useQuery({
    queryKey: [...procurementKeys.bill(id), 'payments'],
    queryFn: () => getSupplierBillPayments(id),
    enabled: Boolean(id),
  });
}

/**
 * ADR-043 Phase 2: why the bill can or cannot be posted / paid. Keyed under the bill, so every
 * bill mutation (which invalidates `bill(id)`) refreshes it too.
 */
export function useSupplierBillEligibility(
  id: string,
  options?: { enabled?: boolean },
): UseQueryResult<SupplierBillEligibility> {
  return useQuery({
    queryKey: [...procurementKeys.bill(id), 'eligibility'],
    queryFn: () => getSupplierBillEligibility(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
  });
}

/**
 * ADR-043 decision 4: a purchase order's supplier bills and their payment status. The caller
 * gates `enabled` on `view:procurement` + `view:commitment-ledger` — the server's gate.
 */
export function usePurchaseOrderBillPayments(
  id: string,
  options?: { enabled?: boolean },
): UseQueryResult<PurchaseOrderBillPaymentsResponse> {
  return useQuery({
    queryKey: [...procurementKeys.purchaseOrder(id), 'bill-payments'],
    queryFn: () => getPurchaseOrderBillPayments(id),
    enabled: Boolean(id) && (options?.enabled ?? true),
  });
}

/**
 * Every bill mutation invalidates the list, the individual bill, and the commitment ledger.
 *
 * The commitment invalidation is not defensive padding. Posting a bill is the step that turns
 * ACCRUED into ACTUAL (`supplier-bill.service.ts:245`), and the Commitments card on the Project
 * Command Center renders from a different query than the screen the user is standing on — a
 * stale figure there reads as a real one. That it does not fire today, because no bill carries
 * a `purchaseOrderRevisionId` (A14), is exactly why the invalidation should already be here
 * when #33 lands rather than be remembered afterwards.
 */
function useBillMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<SupplierBill>,
  feedbackKey: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    meta: {
      successToast: {
        key: feedbackKey,
        values: (bill) => ({ ref: billRef(bill as SupplierBill) }),
      },
    },
    onSuccess: (bill) => {
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
      void qc.invalidateQueries({ queryKey: procurementKeys.bill(bill.id) });
      // Edit and return discard the PO match; submit runs a fresh one.
      void qc.invalidateQueries({ queryKey: procurementKeys.billMatch(bill.id) });
      void qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

/** A draft bill has no number yet; the supplier's own invoice number always identifies it. */
function billRef(bill: SupplierBill): string {
  return bill.billNumber ?? bill.supplierInvoiceNumber;
}

export function useCreateSupplierBill() {
  return useBillMutation((payload: CreateSupplierBillPayload) => createSupplierBill(payload), 'procurement.feedback.billSaved');
}

/** `PATCH /bills/:id` — edit a DRAFT bill. */
export function useUpdateSupplierBill() {
  return useBillMutation((args: { id: string; payload: CreateSupplierBillPayload }) =>
    updateSupplierBill(args.id, args.payload),
    'procurement.feedback.billUpdated',
  );
}

export function useReturnSupplierBill() {
  return useBillMutation((args: { id: string; reason: string }) =>
    returnSupplierBill(args.id, args.reason),
    'procurement.feedback.billReturned',
  );
}

export function useRejectSupplierBill() {
  return useBillMutation((args: { id: string; reason: string }) =>
    rejectSupplierBill(args.id, args.reason),
    'procurement.feedback.billRejected',
  );
}

export function useSubmitSupplierBill() {
  return useBillMutation((id: string) => submitSupplierBill(id), 'procurement.feedback.billSubmitted');
}

export function useApproveSupplierBill() {
  return useBillMutation((id: string) => approveSupplierBill(id), 'procurement.feedback.billApproved');
}

export function usePostSupplierBill() {
  return useBillMutation((args: { id: string; payload: PostSupplierBillPayload }) =>
    postSupplierBill(args.id, args.payload),
    'procurement.feedback.billPosted',
  );
}

export function useReverseSupplierBill() {
  return useBillMutation((args: { id: string; payload: ReverseSupplierBillPayload }) =>
    reverseSupplierBill(args.id, args.payload),
    'procurement.feedback.billReversed',
  );
}

// ─── Supplier payments ───────────────────────────────────────────────────────────

export function useSupplierPayments(
  filters?: {
    supplierId?: string;
    /** ADR-043 Phase 2: payments allocated to any bill of the project (server-side). */
    projectId?: string;
  },
  options?: { enabled?: boolean },
): UseQueryResult<SupplierPayment[]> {
  return useQuery({
    queryKey: procurementKeys.payments(filters?.supplierId, filters?.projectId),
    queryFn: () => listSupplierPayments(filters),
    enabled: options?.enabled ?? true,
  });
}

export function useSupplierPayment(id: string): UseQueryResult<SupplierPayment> {
  return useQuery({
    queryKey: procurementKeys.payment(id),
    queryFn: () => getSupplierPayment(id),
    enabled: Boolean(id),
  });
}

/**
 * Every payment mutation invalidates the payment, the payment list **and the bills**.
 *
 * Bills matter because posting a payment moves AP, and allocating an advance reduces a
 * specific bill's `outstandingAmount` server-side. A bill list left stale after a payment
 * posts shows a balance the ledger no longer agrees with, which is the one number on that
 * screen a user would act on.
 */
function usePaymentMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<SupplierPayment>,
  feedbackKey: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    meta: {
      successToast: {
        key: feedbackKey,
        // A draft payment has no number yet; the message reads without one (ICU `select`).
        values: (payment) => ({ ref: (payment as SupplierPayment).paymentNumber ?? 'none' }),
      },
    },
    onSuccess: (payment) => {
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'payments'] });
      void qc.invalidateQueries({ queryKey: procurementKeys.payment(payment.id) });
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
    },
  });
}

export function useCreateSupplierPayment() {
  return usePaymentMutation((payload: CreateSupplierPaymentPayload) =>
    createSupplierPayment(payload),
    'procurement.feedback.paymentSaved',
  );
}

export function useApproveSupplierPayment() {
  return usePaymentMutation((id: string) => approveSupplierPayment(id), 'procurement.feedback.paymentApproved');
}

/**
 * Signing a release moves the payment's `documentStatus` (to RELEASED on the second signature)
 * and gates whether Post is available, so it invalidates exactly what the other payment
 * mutations do — the payment, the list, and the bills. A 403 (not a signatory / SoD) or 409
 * (already signed) leaves the payment untouched; the caller surfaces the message.
 */
export function useReleaseSupplierPayment() {
  return usePaymentMutation((id: string) => releaseSupplierPayment(id), 'procurement.feedback.paymentReleaseSigned');
}

export function usePostSupplierPayment() {
  return usePaymentMutation((args: { id: string; payload: PostSupplierPaymentPayload }) =>
    postSupplierPayment(args.id, args.payload),
    'procurement.feedback.paymentPosted',
  );
}

export function useReverseSupplierPayment() {
  return usePaymentMutation((args: { id: string; payload: ReverseSupplierPaymentPayload }) =>
    reverseSupplierPayment(args.id, args.payload),
    'procurement.feedback.paymentReversed',
  );
}

/**
 * Applying an advance to a bill touches four records, so all four are invalidated: the payment
 * (its allocated/unallocated pair moves), the payment list, the bills (one of them has its
 * `outstandingAmount` reduced server-side) and the commitment ledger.
 *
 * The mutation result is the journal alone. The allocation id is discarded server-side
 * (A17 / #35), so there is nothing to cache and nothing that could later be reversed.
 */
export function useAllocateAdvance(paymentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AllocateAdvancePayload) => allocateAdvance(paymentId, payload),
    meta: { successToast: 'procurement.feedback.advanceApplied', flashRow: false },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: procurementKeys.payment(paymentId) });
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'payments'] });
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
      void qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

export function useBillMatch(billId: string): UseQueryResult<BillMatchResult | null> {
  return useQuery({
    queryKey: procurementKeys.billMatch(billId),
    queryFn: () => getBillMatch(billId),
    enabled: Boolean(billId),
  });
}

/** Running a match rewrites the bill's `matchStatus`, which gates its Post button. */
export function useRunBillMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (billId: string) => runBillMatch(billId),
    meta: {
      successToast: 'procurement.feedback.matchRun',
      flashRow: (result) => (result as BillMatchResult).supplierBillId,
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: procurementKeys.billMatch(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: procurementKeys.bill(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
    },
  });
}

export function useApproveMatchException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ billId, payload }: { billId: string; payload: ApproveExceptionPayload }) =>
      approveMatchException(billId, payload),
    meta: {
      successToast: 'procurement.feedback.matchExceptionApproved',
      flashRow: (result) => (result as BillMatchResult).supplierBillId,
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: procurementKeys.billMatch(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: procurementKeys.bill(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
    },
  });
}

export function useResolveMatchException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ billId, payload }: { billId: string; payload: ResolveExceptionPayload }) =>
      resolveMatchException(billId, payload),
    meta: {
      successToast: 'procurement.feedback.matchExceptionResolved',
      flashRow: (result) => (result as BillMatchResult).supplierBillId,
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: procurementKeys.billMatch(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: procurementKeys.bill(result.supplierBillId) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
    },
  });
}

// ─── Commitment ledger ───────────────────────────────────────────────────────────

export function useProjectCommitments(
  projectId: string,
  filters?: { stage?: CommitmentStage; boqNodeId?: string },
): UseQueryResult<CommitmentLedgerEntry[]> {
  return useQuery({
    queryKey: procurementKeys.projectCommitments(
      projectId,
      filters?.stage,
      filters?.boqNodeId,
    ),
    queryFn: () => listProjectCommitments(projectId, filters),
    enabled: Boolean(projectId),
  });
}

export function useProjectCommitmentSummary(
  projectId: string,
  options?: { enabled?: boolean },
): UseQueryResult<CommitmentSummary> {
  return useQuery({
    queryKey: procurementKeys.projectCommitmentSummary(projectId),
    queryFn: () => getProjectCommitmentSummary(projectId),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
  });
}

export function usePurchaseOrderCommitments(
  poId: string,
): UseQueryResult<CommitmentLedgerEntry[]> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrderCommitments(poId),
    queryFn: () => listPurchaseOrderCommitments(poId),
    enabled: Boolean(poId),
  });
}

// ─── PO revision attachment write ────────────────────────────────────────────────

export function useAttachPoRevision(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AttachPoRevisionPayload) => attachPoRevision(poId, payload),
    meta: { successToast: 'procurement.feedback.quotationAttached' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.poRevisionAttachments(poId) });
    },
  });
}

// ─── Buyer advances write ─────────────────────────────────────────────────────────

export function useCreateBuyerAdvance(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBuyerAdvancePayload) => createBuyerAdvance(payload),
    meta: { successToast: 'procurement.feedback.buyerAdvanceCreated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderSettlement(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderReceiving(poId) });
    },
  });
}

export function useCreateAdvanceReturn(advanceId: string, poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAdvanceReturnPayload) => createAdvanceReturn(advanceId, payload),
    meta: { successToast: 'procurement.feedback.advanceReturnRecorded' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderSettlement(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderReceiving(poId) });
    },
  });
}

export function useCreateEvidenceAllocation(advanceId: string, poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEvidenceAllocationPayload) =>
      createEvidenceAllocation(advanceId, payload),
    meta: { successToast: 'procurement.feedback.evidenceAllocated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderSettlement(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderReceiving(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.buyerAdvance(advanceId) });
      qc.invalidateQueries({ queryKey: procurementKeys.buyerAdvances(poId) });
    },
  });
}

// ─── Buyer advances read ──────────────────────────────────────────────────────────

export function useGetBuyerAdvance(id: string): UseQueryResult<BuyerAdvance> {
  return useQuery({ queryKey: procurementKeys.buyerAdvance(id), queryFn: () => getBuyerAdvance(id) });
}

export function useListBuyerAdvances(purchaseOrderId: string): UseQueryResult<BuyerAdvance[]> {
  return useQuery({
    queryKey: procurementKeys.buyerAdvances(purchaseOrderId),
    queryFn: () => listBuyerAdvances(purchaseOrderId),
  });
}

export function usePostBuyerAdvance(advanceId: string, poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postBuyerAdvance(advanceId),
    meta: { successToast: 'procurement.feedback.buyerAdvancePosted' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.buyerAdvance(advanceId) });
      qc.invalidateQueries({ queryKey: procurementKeys.buyerAdvances(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderSettlement(poId) });
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrderReceiving(poId) });
    },
  });
}
