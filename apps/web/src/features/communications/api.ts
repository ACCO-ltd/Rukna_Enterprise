import type {
  OutboundMessageView,
  ResolveMessageRequest,
  WhatsAppSendRequest,
  WhatsAppSendPreview,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** Records whose messages `GET /communications` lists (ADR-042). */
export type CommunicationResourceType = 'client_invoice' | 'payment_receipt';

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
