'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, MoneyDisplay, StatusPill } from '@erp/ui';
import type { SupplierDebitNoteView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useDebitNotes, useReverseDebitNote } from './debit-notes';

/** AP-4 — the credits the supplier gave against this bill; a posted one can be reversed. */
export function DebitNotesPanel({ billId, canManage }: { billId: string; canManage: boolean }) {
  const t = useTranslations('procurement.debitNote');
  const locale = useLocale() as 'en' | 'ar';
  const query = useDebitNotes(billId);
  const reverse = useReverseDebitNote();
  const [pending, setPending] = useState<SupplierDebitNoteView | null>(null);

  const notes = query.data ?? [];
  if (notes.length === 0) return null;
  const errorText = reverse.isError ? (reverse.error instanceof ApiError ? reverse.error.message : t('failed')) : undefined;

  return (
    <section aria-labelledby="bill-debit-notes" className="mb-6 space-y-3">
      <h2 id="bill-debit-notes" className="text-body font-semibold text-foreground">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {notes.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">
                {n.debitNoteNumber ?? '—'}
                <span className="ms-2 text-caption font-normal text-muted-foreground">
                  {formatDate(n.accountingDate, locale)}
                  {n.supplierReference ? ` · ${t('supplierRef', { ref: n.supplierReference })}` : ''}
                </span>
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">{n.reason}</p>
              {n.status === 'REVERSED' && n.reversalReason ? (
                <p className="text-caption text-muted-foreground">{t('reversedBecause', { reason: n.reversalReason })}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={n.status === 'POSTED' ? 'neutral' : 'historical'}>{t(`status.${n.status}`)}</StatusPill>
              <span className={n.status === 'POSTED' ? 'text-foreground' : 'text-muted-foreground line-through'}>
                <MoneyDisplay value={n.amount} />
              </span>
              {canManage && n.status === 'POSTED' ? (
                <Button size="sm" variant="outline" onClick={() => setPending(n)}>
                  {t('reverse')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending ? (
        <ConfirmActionDialog
          title={t('reverseTitle', { ref: pending.debitNoteNumber ?? '' })}
          description={t('reverseBody')}
          confirmLabel={t('reverse')}
          reason={{ required: true, label: t('reasonPrompt'), maxLength: 500 }}
          destructive
          isPending={reverse.isPending}
          errorMessage={errorText}
          onConfirm={(reason) => reverse.mutate({ id: pending.id, reason }, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            reverse.reset();
            setPending(null);
          }}
        />
      ) : null}
    </section>
  );
}
