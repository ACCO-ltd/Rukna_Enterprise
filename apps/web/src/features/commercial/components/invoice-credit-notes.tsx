'use client';

/**
 * The credit notes raised against an invoice, with Reverse on a posted one (EVT-AR-008, Phase 0
 * H2): a credit note issued in error is undone by a mirror journal and the invoice balance comes
 * back. The reason is mandatory and recorded on the credit note.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CommercialInvoiceDocumentResponse } from '@erp/types';
import { Button, MoneyDisplay } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate } from '@/lib/format';

import { useReverseCreditNote } from '../hooks/use-commercial-invoice';

type CreditNote = CommercialInvoiceDocumentResponse['creditNotes'][number];

export function InvoiceCreditNotes({
  projectId,
  invoiceId,
  creditNotes,
  hidden,
  canReverse,
}: {
  projectId: string;
  invoiceId: string;
  creditNotes: CreditNote[];
  hidden: boolean;
  canReverse: boolean;
}) {
  const t = useTranslations('commercial.invoicePage.creditNotes');
  const tPage = useTranslations('commercial.invoicePage');
  const locale = useLocale() as 'en' | 'ar';
  const reverse = useReverseCreditNote(projectId, invoiceId);
  const [pending, setPending] = useState<CreditNote | null>(null);

  if (creditNotes.length === 0) return null;

  return (
    <section aria-labelledby="invoice-credit-notes" className="space-y-3">
      <h2 id="invoice-credit-notes" className="text-body font-semibold text-foreground">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {creditNotes.map((cn) => (
          <li key={cn.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">
                {cn.creditNoteNumber ?? t('unnumbered')}
                <span className="ms-2 text-caption font-normal text-muted-foreground">
                  {formatDate(cn.accountingDate, locale)} · {t(`status.${cn.postingStatus}`)}
                </span>
              </p>
              {cn.postingStatus === 'REVERSED' && cn.reversalReason ? (
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {t('reversedBecause', { reason: cn.reversalReason })}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className={cn.postingStatus === 'REVERSED' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                <MoneyDisplay value={cn.totalAmount} hidden={hidden} hiddenLabel={tPage('hiddenAmount')} />
              </span>
              {canReverse && cn.postingStatus === 'POSTED' ? (
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setPending(cn)}>
                  {t('reverse')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending ? (
        <ConfirmActionDialog
          title={t('reverseTitle', { ref: pending.creditNoteNumber ?? t('unnumbered') })}
          description={t('reverseBody')}
          confirmLabel={t('reverse')}
          reason={{ required: true, label: t('reasonLabel'), maxLength: 500 }}
          destructive
          isPending={reverse.isPending}
          errorMessage={reverse.isError ? reverse.error.message || t('reverseFailed') : undefined}
          onConfirm={(reason) =>
            reverse.mutate({ creditNoteId: pending.id, reason }, { onSuccess: () => setPending(null) })
          }
          onDismiss={() => {
            reverse.reset();
            setPending(null);
          }}
        />
      ) : null}
    </section>
  );
}
