'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { OutboundMessageView } from '@erp/types';

import { getInvoiceWhatsAppPreview, sendInvoiceWhatsApp } from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog, type WhatsAppSendItem } from './whatsapp-send-dialog';

export interface InvoiceWhatsAppDialogProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  title: string;
  subtitle?: string;
  /**
   * The other issued invoices of the same billing package (a stage's variation invoices): each is
   * sent as its own message with its own PDF, after this one, to the same number.
   */
  otherInvoices?: Array<{ id: string; invoiceNumber: string }>;
  /** Queries to refresh after a send — the invoice page's own (it becomes Sent). */
  invalidate?: ReadonlyArray<readonly unknown[]>;
}

/** {@link WhatsAppSendDialog} bound to client invoices (`/invoices/:id/whatsapp`). */
export function InvoiceWhatsAppDialog({
  open,
  onClose,
  invoiceId,
  title,
  subtitle,
  otherInvoices = [],
  invalidate = [],
}: InvoiceWhatsAppDialogProps) {
  const queryClient = useQueryClient();
  const refresh = (message: OutboundMessageView) => {
    void queryClient.invalidateQueries({
      queryKey: communicationKeys.resource('client_invoice', message.resourceId),
    });
    for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
  };
  const extraItems: WhatsAppSendItem[] = otherInvoices
    .filter((invoice) => invoice.id !== invoiceId)
    .map((invoice) => ({
      key: invoice.id,
      label: `${invoice.invoiceNumber}.pdf`,
      send: (body) => sendInvoiceWhatsApp(invoice.id, body),
    }));
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      previewQueryKey={['whatsapp-preview', 'client_invoice', invoiceId]}
      loadPreview={() => getInvoiceWhatsAppPreview(invoiceId)}
      send={(body) => sendInvoiceWhatsApp(invoiceId, body)}
      extraItems={extraItems}
      onSent={refresh}
    />
  );
}
