import type {
  OutboundMessageView,
  ResolveMessageRequest,
  WhatsAppReminderPreview,
  WhatsAppSendRequest,
  WhatsAppSendPreview,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** Records whose messages `GET /communications` lists (ADR-042). */
export type CommunicationResourceType =
  | 'client_invoice'
  /** Payment / overdue reminders for an invoice (resourceId = the invoice id). */
  | 'client_invoice_reminder'
  | 'payment_receipt'
  /** ST-6 — statements sent to a client (resourceId = the client id). */
  | 'client_statement'
  /** SS-3 — statements sent to a supplier (resourceId = the supplier id). */
  | 'supplier_statement';

/** Messages Rukna sent about one record, newest first. */
export function listCommunications(
  resourceType: CommunicationResourceType,
  resourceId: string,
): Promise<OutboundMessageView[]> {
  return apiClient<OutboundMessageView[]>('/communications', {
    params: { resourceType, resourceId },
  });
}

/** Settle a message WhatsApp never confirmed (UNKNOWN) as sent or not sent. */
export function resolveCommunication(
  id: string,
  body: ResolveMessageRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/communications/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getInvoiceWhatsAppPreview(invoiceId: string): Promise<WhatsAppSendPreview> {
  return apiClient<WhatsAppSendPreview>(`/invoices/${invoiceId}/whatsapp/preview`);
}

/** 200 with the message — also when WhatsApp refused it (status FAILED / UNKNOWN). */
export function sendInvoiceWhatsApp(
  invoiceId: string,
  body: WhatsAppSendRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/invoices/${invoiceId}/whatsapp`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getReceiptWhatsAppPreview(receiptId: string): Promise<WhatsAppSendPreview> {
  return apiClient<WhatsAppSendPreview>(`/customer-receipts/${receiptId}/whatsapp/preview`);
}

/** 200 with the message — also when WhatsApp refused it (status FAILED / UNKNOWN). */
export function sendReceiptWhatsApp(
  receiptId: string,
  body: WhatsAppSendRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/customer-receipts/${receiptId}/whatsapp`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** ST-6 — the statement for a client and period, as the WhatsApp send would deliver it. */
export function getStatementWhatsAppPreview(clientId: string, from: string, to: string): Promise<WhatsAppSendPreview> {
  return apiClient<WhatsAppSendPreview>(`/finance/clients/${clientId}/statement/whatsapp/preview?from=${from}&to=${to}`);
}

export function sendStatementWhatsApp(
  clientId: string,
  from: string,
  to: string,
  body: WhatsAppSendRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/finance/clients/${clientId}/statement/whatsapp?from=${from}&to=${to}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** SS-3 — our statement of a supplier's account for a period, as the WhatsApp send would deliver it. */
export function getSupplierStatementWhatsAppPreview(supplierId: string, from: string, to: string): Promise<WhatsAppSendPreview> {
  return apiClient<WhatsAppSendPreview>(`/finance/suppliers/${supplierId}/statement/whatsapp/preview?from=${from}&to=${to}`);
}

export function sendSupplierStatementWhatsApp(
  supplierId: string,
  from: string,
  to: string,
  body: WhatsAppSendRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/finance/suppliers/${supplierId}/statement/whatsapp?from=${from}&to=${to}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** What a manual payment / overdue reminder would send (text only; WhatsApp V1 step 4). */
export function getInvoiceReminderPreview(invoiceId: string): Promise<WhatsAppReminderPreview> {
  return apiClient<WhatsAppReminderPreview>(`/invoices/${invoiceId}/whatsapp-reminder/preview`);
}

/** 200 with the message — also when WhatsApp refused it (status FAILED / UNKNOWN). */
export function sendInvoiceReminder(
  invoiceId: string,
  body: WhatsAppSendRequest,
): Promise<OutboundMessageView> {
  return apiClient<OutboundMessageView>(`/invoices/${invoiceId}/whatsapp-reminder`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
