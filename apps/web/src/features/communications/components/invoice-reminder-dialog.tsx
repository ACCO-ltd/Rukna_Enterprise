'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { OutboundMessageView } from '@erp/types';

import { getInvoiceReminderPreview, sendInvoiceReminder } from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog } from './whatsapp-send-dialog';

export interface InvoiceReminderDialogProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  /** Formatted outstanding amount, e.g. "USD 4,500.00" — for the subtitle (null: left out). */
  outstanding: string | null;
  /** Whole days past due (0 when not overdue) — picks the overdue wording. */
  daysOverdue?: number;
  /** Queries to refresh after a send (the invoice's collection timeline). */
  invalidate?: ReadonlyArray<readonly unknown[]>;
}

/**
 * Manual payment / overdue reminder for one invoice on WhatsApp (ADR-042 WhatsApp V1 step 4) —
 * {@link WhatsAppSendDialog} bound to `/invoices/:id/whatsapp-reminder`. The server picks the
 * template (overdue once the due date has passed); the message is text only.
 */
export function InvoiceReminderDialog({
  open,
  onClose,
  invoiceId,
  invoiceNumber,
  outstanding,
  daysOverdue = 0,
  invalidate = [],
}: InvoiceReminderDialogProps) {
  const t = useTranslations('common.messaging.reminder');
  const queryClient = useQueryClient();
  const refresh = (message: OutboundMessageView) => {
    void queryClient.invalidateQueries({
      queryKey: communicationKeys.resource('client_invoice_reminder', message.resourceId),
    });
    for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
  };
  const overdue = daysOverdue > 0;
  // An opening-balance invoice has no Rukna number: the subtitle says so instead of a blank.
  const number = invoiceNumber.trim() || 'none';
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={overdue ? t('titleOverdue') : t('titlePayment')}
      subtitle={
        outstanding === null
          ? undefined
          : overdue
            ? t('subtitleOverdue', {
                number,
                amount: outstanding,
                days: daysOverdue,
              })
            : t('subtitle', { number, amount: outstanding })
      }
      previewQueryKey={['whatsapp-preview', 'client_invoice_reminder', invoiceId]}
      loadPreview={() => getInvoiceReminderPreview(invoiceId)}
      send={(body) => sendInvoiceReminder(invoiceId, body)}
      onSent={refresh}
    />
  );
}
