'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, MoneyDisplay, StatusPill, type StatusTone } from '@erp/ui';
import type { ReceivableWriteOffView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useDecideWriteOff } from './hooks';

const TONE: Record<ReceivableWriteOffView['status'], StatusTone> = {
  PENDING_APPROVAL: 'attention',
  POSTED: 'neutral',
  REJECTED: 'historical',
  REVERSED: 'historical',
};

/**
 * AR-4 — the write-offs on an invoice. A waiting one is approved or rejected here by someone other
 * than the person who asked (the Approvals tab links to this page); a posted one can be reversed.
 */
export function WriteOffsPanel({ writeOffs, canManage }: { writeOffs: ReceivableWriteOffView[]; canManage: boolean }) {
  const t = useTranslations('accounting.writeOff');
  const locale = useLocale() as 'en' | 'ar';
  const { user } = useSession();
  const decide = useDecideWriteOff();
  const [pending, setPending] = useState<{ writeOff: ReceivableWriteOffView; action: 'reject' | 'reverse' } | null>(null);

  if (writeOffs.length === 0) return null;
  const errorText = decide.isError ? (decide.error instanceof ApiError ? decide.error.message : t('failed')) : undefined;

  return (
    <section aria-labelledby="invoice-write-offs" className="space-y-3">
      <h2 id="invoice-write-offs" className="text-body font-semibold text-foreground">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {writeOffs.map((w) => {
          const mine = w.requestedBy === user?.id;
          return (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-foreground">
                  {w.writeOffNumber ?? t('unnumbered')}
                  <span className="ms-2 text-caption font-normal text-muted-foreground">
                    {formatDate(w.accountingDate, locale)} · {t(`reason.${w.reason}`)}
                  </span>
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {t('requestedBy', { name: w.requestedByName ?? '—' })}
                  {w.approvedByName ? ` · ${t('approvedBy', { name: w.approvedByName })}` : ''}
                  {w.note ? ` · ${w.note}` : ''}
                </p>
                {w.status === 'REJECTED' && w.rejectionReason ? (
                  <p className="text-caption text-muted-foreground">{t('rejectedBecause', { reason: w.rejectionReason })}</p>
                ) : null}
                {w.status === 'REVERSED' && w.reversalReason ? (
                  <p className="text-caption text-muted-foreground">{t('reversedBecause', { reason: w.reversalReason })}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone={TONE[w.status]}>{t(`status.${w.status}`)}</StatusPill>
                <span className={w.status === 'POSTED' || w.status === 'PENDING_APPROVAL' ? 'text-foreground' : 'text-muted-foreground line-through'}>
                  <MoneyDisplay value={w.amount} />
                </span>
                {canManage && w.status === 'PENDING_APPROVAL' && !mine ? (
                  <>
                    <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: w.id, action: 'approve' })}>
                      {t('approve')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPending({ writeOff: w, action: 'reject' })}>
                      {t('reject')}
                    </Button>
                  </>
                ) : null}
                {canManage && w.status === 'PENDING_APPROVAL' && mine ? (
                  <span className="text-caption text-muted-foreground">{t('waitingForSomeoneElse')}</span>
                ) : null}
                {canManage && w.status === 'POSTED' ? (
                  <Button size="sm" variant="outline" onClick={() => setPending({ writeOff: w, action: 'reverse' })}>
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
          title={t(`${pending.action}Title`, { ref: pending.writeOff.writeOffNumber ?? t('unnumbered') })}
          description={t(`${pending.action}Body`)}
          confirmLabel={t(pending.action)}
          reason={{ required: true, label: t('reasonPrompt'), maxLength: 500 }}
          destructive={pending.action === 'reverse'}
          isPending={decide.isPending}
          errorMessage={errorText}
          onConfirm={(reason) =>
            decide.mutate({ id: pending.writeOff.id, action: pending.action, reason }, { onSuccess: () => setPending(null) })
          }
          onDismiss={() => {
            decide.reset();
            setPending(null);
          }}
        />
      ) : null}
    </section>
  );
}
