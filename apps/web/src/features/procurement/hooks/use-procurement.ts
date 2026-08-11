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

import {
  allocateAdvance,
  approveMatchException,
  approveMaterialRequest,
  approveSupplierBill,
  approveSupplierPayment,
  approvePurchaseOrder,
  cancelGoodsReceipt,
  cancelMaterialRequest,
  cancelPurchaseOrder,
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
  getSupplierBill,
  getSupplierPayment,
  listGoodsReceipts,
  listMaterialCategories,
  listMaterialRequests,
  listMaterials,
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
  reverseSupplierBill,
  reverseSupplierPayment,
  revisePurchaseOrder,
  runBillMatch,
  submitMaterialRequest,
  submitPurchaseOrder,
  submitSupplierBill,
} from '../api/procurement-api';
import type {
  ApproveExceptionPayload,
  ApprovePurchaseOrderPayload,
  BillMatchResult,
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
  Supplier,
  SupplierBill,
  SupplierPayment,
  AllocateAdvancePayload,
  CreateSupplierPaymentPayload,
  PostSupplierPaymentPayload,
  ReverseSupplierPaymentPayload,
  CreateSupplierPayload,
  CreateSupplierBillPayload,
  PostSupplierBillPayload,
  ReverseSupplierBillPayload,
  UnitOfMeasure,
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
  purchaseOrders: (status?: string, supplierId?: string) =>
    [...procurementKeys.all, 'purchase-orders', status ?? 'all', supplierId ?? 'all'] as const,
  purchaseOrder: (id: string) => [...procurementKeys.all, 'purchase-order', id] as const,
  goodsReceipts: (purchaseOrderId?: string) =>
    [...procurementKeys.all, 'goods-receipts', purchaseOrderId ?? 'all'] as const,
  goodsReceipt: (id: string) => [...procurementKeys.all, 'goods-receipt', id] as const,
  bills: (supplierId?: string) =>
    [...procurementKeys.all, 'bills', supplierId ?? 'all'] as const,
  bill: (id: string) => [...procurementKeys.all, 'bill', id] as const,
  payments: (supplierId?: string) =>
    [...procurementKeys.all, 'payments', supplierId ?? 'all'] as const,
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'suppliers'] }),
  });
}

// ─── Catalogue mutations ─────────────────────────────────────────────────────────

export function useCreateUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUomPayload) => createUom(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.uoms() }),
  });
}

export function useDeactivateUom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateUom(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.uoms() }),
  });
}

export function useCreateMaterialCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => createMaterialCategory(payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: procurementKeys.materialCategories() }),
  });
}

export function useDeactivateMaterialCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateMaterialCategory(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: procurementKeys.materialCategories() }),
  });
}

export function useCreateSpendCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => createSpendCategory(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.spendCategories() }),
  });
}

export function useDeactivateSpendCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateSpendCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: procurementKeys.spendCategories() }),
  });
}

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMaterialPayload) => createMaterial(payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'materials'] }),
  });
}

export function useDiscontinueMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => discontinueMaterial(id),
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'material-requests'] }),
  });
}

/**
 * The three MR lifecycle transitions that exist. There is no close (P4) — `CLOSED` is
 * reachable in the service's state machine and by no route.
 */
function useMrTransition(action: (id: string) => Promise<MaterialRequest>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => action(id),
    onSuccess: (mr) => {
      qc.invalidateQueries({ queryKey: procurementKeys.materialRequest(mr.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'material-requests'] });
    },
  });
}

export const useSubmitMaterialRequest = () => useMrTransition(submitMaterialRequest);
export const useApproveMaterialRequest = () => useMrTransition(approveMaterialRequest);
export const useCancelMaterialRequest = () => useMrTransition(cancelMaterialRequest);

// ─── Purchase orders ─────────────────────────────────────────────────────────────

export function usePurchaseOrders(filters?: {
  status?: PurchaseOrderStatus;
  supplierId?: string;
}): UseQueryResult<PurchaseOrder[]> {
  return useQuery({
    queryKey: procurementKeys.purchaseOrders(filters?.status, filters?.supplierId),
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] }),
  });
}

export function useSubmitPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => submitPurchaseOrder(id),
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
    mutationFn: ({ id, payload }: { id: string; payload: ApprovePurchaseOrderPayload }) =>
      approvePurchaseOrder(id, payload),
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
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: procurementKeys.purchaseOrder(po.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
      qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] }),
  });
}

/** Moves COMMITTED → ACCRUED, so the ledger and both summary surfaces go stale. */
export function usePostGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PostGoodsReceiptPayload }) =>
      postGoodsReceipt(id, payload),
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
    onSuccess: (grn) => {
      qc.invalidateQueries({ queryKey: procurementKeys.goodsReceipt(grn.id) });
      qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'goods-receipts'] });
    },
  });
}

// ─── Supplier bills and matching ─────────────────────────────────────────────────

export function useSupplierBills(filters?: {
  supplierId?: string;
}): UseQueryResult<SupplierBill[]> {
  return useQuery({
    queryKey: procurementKeys.bills(filters?.supplierId),
    queryFn: () => listSupplierBills(filters),
  });
}

export function useSupplierBill(id: string): UseQueryResult<SupplierBill> {
  return useQuery({
    queryKey: procurementKeys.bill(id),
    queryFn: () => getSupplierBill(id),
    enabled: Boolean(id),
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
function useBillMutation<TArgs>(mutationFn: (args: TArgs) => Promise<SupplierBill>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (bill) => {
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'bills'] });
      void qc.invalidateQueries({ queryKey: procurementKeys.bill(bill.id) });
      void qc.invalidateQueries({ queryKey: procurementKeys.commitments() });
    },
  });
}

export function useCreateSupplierBill() {
  return useBillMutation((payload: CreateSupplierBillPayload) => createSupplierBill(payload));
}

export function useSubmitSupplierBill() {
  return useBillMutation((id: string) => submitSupplierBill(id));
}

export function useApproveSupplierBill() {
  return useBillMutation((id: string) => approveSupplierBill(id));
}

export function usePostSupplierBill() {
  return useBillMutation((args: { id: string; payload: PostSupplierBillPayload }) =>
    postSupplierBill(args.id, args.payload),
  );
}

export function useReverseSupplierBill() {
  return useBillMutation((args: { id: string; payload: ReverseSupplierBillPayload }) =>
    reverseSupplierBill(args.id, args.payload),
  );
}

// ─── Supplier payments ───────────────────────────────────────────────────────────

export function useSupplierPayments(filters?: {
  supplierId?: string;
}): UseQueryResult<SupplierPayment[]> {
  return useQuery({
    queryKey: procurementKeys.payments(filters?.supplierId),
    queryFn: () => listSupplierPayments(filters),
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
function usePaymentMutation<TArgs>(mutationFn: (args: TArgs) => Promise<SupplierPayment>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
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
  );
}

export function useApproveSupplierPayment() {
  return usePaymentMutation((id: string) => approveSupplierPayment(id));
}

export function usePostSupplierPayment() {
  return usePaymentMutation((args: { id: string; payload: PostSupplierPaymentPayload }) =>
    postSupplierPayment(args.id, args.payload),
  );
}

export function useReverseSupplierPayment() {
  return usePaymentMutation((args: { id: string; payload: ReverseSupplierPaymentPayload }) =>
    reverseSupplierPayment(args.id, args.payload),
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
