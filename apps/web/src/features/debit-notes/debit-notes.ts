'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupplierDebitNoteView } from '@erp/types';

import { procurementKeys } from '@/features/procurement/hooks/use-procurement';
import { apiClient } from '@/lib/api-client';

export interface RecordDebitNotePayload {
  amount: string;
  accountingDate: string;
  reason: string;
  supplierReference?: string;
}

/** AP-4 — `GET /bills/:billId/debit-notes`. */
export function listDebitNotes(billId: string): Promise<SupplierDebitNoteView[]> {
  return apiClient<SupplierDebitNoteView[]>(`/bills/${billId}/debit-notes`);
}

/** Posts at once: Dr AP / Cr the bill's cost lines; at most what is left to pay on the bill. */
export function recordDebitNote(billId: string, payload: RecordDebitNotePayload): Promise<SupplierDebitNoteView> {
  return apiClient<SupplierDebitNoteView>(`/bills/${billId}/debit-notes`, { method: 'POST', body: JSON.stringify(payload) });
}

export function reverseDebitNote(id: string, reason: string): Promise<SupplierDebitNoteView> {
  return apiClient<SupplierDebitNoteView>(`/supplier-debit-notes/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reversalDate: new Date().toISOString().slice(0, 10), reason }),
  });
}

export const debitNoteKeys = {
  forBill: (billId: string) => [...procurementKeys.all, 'debit-notes', billId] as const,
};

export function useDebitNotes(billId: string, enabled = true) {
  return useQuery({ queryKey: debitNoteKeys.forBill(billId), queryFn: () => listDebitNotes(billId), enabled: enabled && Boolean(billId) });
}

/** A debit note moves the bill's balance: refresh the bill, the bill lists and its payability. */
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: procurementKeys.all });
}

export function useRecordDebitNote(billId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: RecordDebitNotePayload) => recordDebitNote(billId, payload),
    meta: { successToast: { key: 'procurement.feedback.debitNoteRecorded' } },
    onSettled: invalidate,
  });
}

export function useReverseDebitNote() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: { id: string; reason: string }) => reverseDebitNote(input.id, input.reason), onSettled: invalidate });
}
