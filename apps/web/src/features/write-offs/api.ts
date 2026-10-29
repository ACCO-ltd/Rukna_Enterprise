import type { ReceivableWriteOffView } from '@erp/types';

import { apiClient } from '@/lib/api-client';

export interface RequestWriteOffPayload {
  amount: string;
  reason: 'BAD_DEBT' | 'SMALL_BALANCE';
  accountingDate: string;
  note?: string;
}

/** AR-4 — `GET /invoices/:id/write-offs`. */
export function listWriteOffs(invoiceId: string): Promise<ReceivableWriteOffView[]> {
  return apiClient<ReceivableWriteOffView[]>(`/invoices/${invoiceId}/write-offs`);
}

/** Posts at once up to the organisation's limit; above it, waits for a second person. */
export function requestWriteOff(invoiceId: string, payload: RequestWriteOffPayload): Promise<ReceivableWriteOffView> {
  return apiClient<ReceivableWriteOffView>(`/invoices/${invoiceId}/write-offs`, { method: 'POST', body: JSON.stringify(payload) });
}

export function approveWriteOff(id: string): Promise<ReceivableWriteOffView> {
  return apiClient<ReceivableWriteOffView>(`/receivable-write-offs/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
}

export function rejectWriteOff(id: string, reason: string): Promise<ReceivableWriteOffView> {
  return apiClient<ReceivableWriteOffView>(`/receivable-write-offs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function reverseWriteOff(id: string, reason: string): Promise<ReceivableWriteOffView> {
  return apiClient<ReceivableWriteOffView>(`/receivable-write-offs/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reversalDate: new Date().toISOString().slice(0, 10), reason }),
  });
}
