'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { OutboundMessageView, WhatsAppSendBlockedReason } from '@erp/types';

import { getReceiptWhatsAppPreview, sendReceiptWhatsApp } from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog } from './whatsapp-send-dialog';

export interface ReceiptWhatsAppDialogProps {
  open: boolean;
  onClose: () => void;
  receiptId: string;
  title: string;
  subtitle?: string;
  /** Receipt-specific wording for a blocker (e.g. REVERSED). */
  blockedText?: Partial<Record<WhatsAppSendBlockedReason, string>>;
  /** Queries to refresh after a send — the receipt page's own. */
  invalidate?: ReadonlyArray<readonly unknown[]>;
}

/** {@link WhatsAppSendDialog} bound to customer receipts (`/customer-receipts/:id/whatsapp`). */
export function ReceiptWhatsAppDialog({
  open,
  onClose,
  receiptId,
  title,
  subtitle,
  blockedText,
  invalidate = [],
}: ReceiptWhatsAppDialogProps) {
  const queryClient = useQueryClient();
  const refresh = (message: OutboundMessageView) => {
    void queryClient.invalidateQueries({
      queryKey: communicationKeys.resource('payment_receipt', message.resourceId),
    });
    for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
  };
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      previewQueryKey={['whatsapp-preview', 'payment_receipt', receiptId]}
      loadPreview={() => getReceiptWhatsAppPreview(receiptId)}
      send={(body) => sendReceiptWhatsApp(receiptId, body)}
      blockedText={blockedText}
      onSent={refresh}
    />
  );
}
