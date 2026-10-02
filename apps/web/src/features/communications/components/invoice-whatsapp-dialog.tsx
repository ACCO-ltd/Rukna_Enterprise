'use client';

import { useQueryClient } from '@tanstack/react-query';

import { getInvoiceWhatsAppPreview, sendInvoiceWhatsApp } from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog } from './whatsapp-send-dialog';

export interface InvoiceWhatsAppDialogProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  title: string;
  subtitle?: string;
  /** Queries to refresh after a send — the invoice page's own (it becomes Sent). */
  invalidate?: ReadonlyArray<readonly unknown[]>;
}

/** {@link WhatsAppSendDialog} bound to a client invoice (`/invoices/:id/whatsapp`). */
export function InvoiceWhatsAppDialog({
  open,
  onClose,
  invoiceId,
  title,
  subtitle,
  invalidate = [],
}: InvoiceWhatsAppDialogProps) {
  const queryClient = useQueryClient();
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      previewQueryKey={['whatsapp-preview', 'client_invoice', invoiceId]}
      loadPreview={() => getInvoiceWhatsAppPreview(invoiceId)}
      send={(body) => sendInvoiceWhatsApp(invoiceId, body)}
      onSent={() => {
        void queryClient.invalidateQueries({
          queryKey: communicationKeys.resource('client_invoice', invoiceId),
        });
        for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
      }}
    />
  );
}
