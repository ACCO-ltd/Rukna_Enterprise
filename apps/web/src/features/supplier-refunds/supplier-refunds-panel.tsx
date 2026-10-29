'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, MoneyDisplay, StatusPill } from '@erp/ui';
import type { SupplierRefundView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useReverseSupplierRefund, useSupplierRefunds } from './supplier-refunds';

/** AP-5 — money the supplier paid back from this payment; a posted refund can be reversed. */
export function SupplierRefundsPanel({ paymentId, canManage }: { paymentId: string; canManage: boolean }) {
  const t = useTranslations('procurement.supplierRefund');
  const locale = useLocale() as 'en' | 'ar';
  const query = useSupplierRefunds(paymentId);
  const reverse = useReverseSupplierRefund();
  const [pending, setPending] = useState<SupplierRefundView | null>(null);

  const refunds = query.data ?? [];
  if (refunds.length === 0) return null;
  const errorText = reverse.isError ? (reverse.error instanceof ApiError ? reverse.error.message : t('failed')) : undefined;

  return (
    <section aria-labelledby="payment-refunds" className="space-y-3">
      <h2 id="payment-refunds" className="text-body font-semibold text-foreground">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {refunds.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">
                {r.refundNumber ?? '—'}
                <span className="ms-2 text-caption font-normal text-muted-foreground">
                  {formatDate(r.refundDate, locale)}
                  {r.reference ? ` · ${r.reference}` : ''}
                </span>
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">{r.reason}</p>
              {r.status === 'REVERSED' && r.reversalReason ? (
                <p className="text-caption text-muted-foreground">{t('reversedBecause', { reason: r.reversalReason })}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={r.status === 'POSTED' ? 'neutral' : 'historical'}>{t(`status.${r.status}`)}</StatusPill>
              <span className={r.status === 'POSTED' ? 'text-foreground' : 'text-muted-foreground line-through'}>
                <MoneyDisplay value={r.amount} />
              </span>
              {canManage && r.status === 'POSTED' ? (
                <Button size="sm" variant="outline" onClick={() => setPending(r)}>
                  {t('reverse')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending ? (
        <ConfirmActionDialog
          title={t('reverseTitle', { ref: pending.refundNumber ?? '' })}
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
