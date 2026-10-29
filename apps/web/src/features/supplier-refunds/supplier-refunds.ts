'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupplierRefundView } from '@erp/types';

import { procurementKeys } from '@/features/procurement/hooks/use-procurement';
import { apiClient } from '@/lib/api-client';

export interface RecordSupplierRefundPayload {
  bankAccountId: string;
  amount: string;
  refundDate: string;
  reason: string;
  reference?: string;
}

/** AP-5 — `GET /payments/:paymentId/refunds`. */
export function listSupplierRefunds(paymentId: string): Promise<SupplierRefundView[]> {
  return apiClient<SupplierRefundView[]>(`/payments/${paymentId}/refunds`);
}

/** Posts at once: Dr the bank / Cr Supplier advance; at most what the payment holds unapplied. */
export function recordSupplierRefund(paymentId: string, payload: RecordSupplierRefundPayload): Promise<SupplierRefundView> {
  return apiClient<SupplierRefundView>(`/payments/${paymentId}/refunds`, { method: 'POST', body: JSON.stringify(payload) });
}

export function reverseSupplierRefund(id: string, reason: string): Promise<SupplierRefundView> {
  return apiClient<SupplierRefundView>(`/supplier-refunds/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reversalDate: new Date().toISOString().slice(0, 10), reason }),
  });
}

export const supplierRefundKeys = {
  forPayment: (paymentId: string) => [...procurementKeys.all, 'supplier-refunds', paymentId] as const,
};

export function useSupplierRefunds(paymentId: string, enabled = true) {
  return useQuery({ queryKey: supplierRefundKeys.forPayment(paymentId), queryFn: () => listSupplierRefunds(paymentId), enabled: enabled && Boolean(paymentId) });
}

/** A refund moves the payment's unapplied balance: refresh the payment and the lists. */
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: procurementKeys.all });
}

export function useRecordSupplierRefund(paymentId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: RecordSupplierRefundPayload) => recordSupplierRefund(paymentId, payload),
    meta: { successToast: { key: 'procurement.feedback.supplierRefundRecorded' } },
    onSettled: invalidate,
  });
}

export function useReverseSupplierRefund() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: { id: string; reason: string }) => reverseSupplierRefund(input.id, input.reason), onSettled: invalidate });
}
