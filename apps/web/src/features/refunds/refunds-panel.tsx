'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, MoneyDisplay, StatusPill, type StatusTone } from '@erp/ui';
import type { ClientRefundView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useDecideRefund } from './refunds';

const TONE: Record<ClientRefundView['status'], StatusTone> = {
  PENDING_APPROVAL: 'attention',
  POSTED: 'neutral',
  REJECTED: 'historical',
  REVERSED: 'historical',
};

/** AR-5 — the refunds paid from a receipt: approve / reject (someone else), reverse a posted one. */
export function RefundsPanel({ receiptId, refunds, canManage }: { receiptId: string; refunds: ClientRefundView[]; canManage: boolean }) {
  const t = useTranslations('platform.receipts.refund');
  const locale = useLocale() as 'en' | 'ar';
  const { user } = useSession();
  const decide = useDecideRefund(receiptId);
  const [pending, setPending] = useState<{ refund: ClientRefundView; action: 'reject' | 'reverse' } | null>(null);

  if (refunds.length === 0) return null;
  const errorText = decide.isError ? (decide.error instanceof ApiError ? decide.error.message : t('failed')) : undefined;

  return (
    <section aria-labelledby="receipt-refunds" className="space-y-3">
      <h2 id="receipt-refunds" className="text-body font-semibold text-foreground">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {refunds.map((r) => {
          const mine = r.requestedBy === user?.id;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-foreground">
                  {r.refundNumber ?? t('unnumbered')}
                  <span className="ms-2 text-caption font-normal text-muted-foreground">
                    {formatDate(r.refundDate, locale)}
                    {r.reference ? ` · ${r.reference}` : ''}
                  </span>
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {r.reason} · {t('requestedBy', { name: r.requestedByName ?? '—' })}
                  {r.approvedByName ? ` · ${t('approvedBy', { name: r.approvedByName })}` : ''}
                </p>
                {r.status === 'REJECTED' && r.rejectionReason ? <p className="text-caption text-muted-foreground">{t('rejectedBecause', { reason: r.rejectionReason })}</p> : null}
                {r.status === 'REVERSED' && r.reversalReason ? <p className="text-caption text-muted-foreground">{t('reversedBecause', { reason: r.reversalReason })}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone={TONE[r.status]}>{t(`status.${r.status}`)}</StatusPill>
                <MoneyDisplay value={r.amount} />
                {canManage && r.status === 'PENDING_APPROVAL' && !mine ? (
                  <>
                    <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>
                      {t('approve')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPending({ refund: r, action: 'reject' })}>
                      {t('reject')}
                    </Button>
                  </>
                ) : null}
                {canManage && r.status === 'PENDING_APPROVAL' && mine ? <span className="text-caption text-muted-foreground">{t('waitingForSomeoneElse')}</span> : null}
                {canManage && r.status === 'POSTED' ? (
                  <Button size="sm" variant="outline" onClick={() => setPending({ refund: r, action: 'reverse' })}>
                    {t('reverse')}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {decide.isError && !pending ? <p className="text-body-sm text-danger">{errorText}</p> : null}
      {pending ? (
        <ConfirmActionDialog
          title={t(`${pending.action}Title`, { ref: pending.refund.refundNumber ?? t('unnumbered') })}
          description={t(`${pending.action}Body`)}
          confirmLabel={t(pending.action)}
          reason={{ required: true, label: t('reasonPrompt'), maxLength: 500 }}
          destructive={pending.action === 'reverse'}
          isPending={decide.isPending}
          errorMessage={errorText}
          onConfirm={(reason) => decide.mutate({ id: pending.refund.id, action: pending.action, reason }, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            decide.reset();
            setPending(null);
          }}
        />
      ) : null}
    </section>
  );
}
