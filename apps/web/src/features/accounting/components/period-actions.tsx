'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useCloseGate, usePeriodAction } from '../hooks/use-accounting';
import type { AccountingPeriod, FiscalYear } from '../types';

type PeriodActionType = 'lock' | 'close' | 'reopen' | 'rebuild';

/**
 * What the server accepts from each period status.
 *
 * `lockPeriod` requires OPEN, `closePeriod` requires LOCKED, `reopenPeriod` requires CLOSED.
 * A REOPENED period behaves as OPEN and can be locked again. Snapshot rebuild only makes
 * sense where a snapshot exists, which is a closed period.
 */
function actionsFor(status: AccountingPeriod['status']): PeriodActionType[] {
  switch (status) {
    case 'OPEN':
    case 'REOPENED':
      return ['lock'];
    case 'LOCKED':
      return ['close'];
    case 'CLOSED':
      return ['reopen', 'rebuild'];
  }
}

export function PeriodActions({ period }: { period: AccountingPeriod }) {
  const t = useTranslations('accounting.periodActions');
  const { can } = usePermissions();

  const action = usePeriodAction();
  const [pending, setPending] = useState<PeriodActionType | null>(null);

  // Fetched only while a close is being considered — it is a pre-flight, not page data.
  const gate = useCloseGate(pending === 'close' ? period.id : null);

  const available = actionsFor(period.status).filter(() =>
    can(ACCOUNTING_PERMISSIONS.managePeriods),
  );

  if (available.length === 0) return null;

  function run(type: PeriodActionType, reason: string) {
    const request =
      type === 'reopen'
        ? ({ type: 'reopen', periodId: period.id, reason } as const)
        : ({ type, periodId: period.id } as const);

    action.mutate(request, { onSuccess: () => setPending(null) });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((type) => (
        <Button
          key={type}
          size="sm"
          variant={type === 'lock' ? 'default' : 'outline'}
          onClick={() => setPending(type)}
        >
          {t(type)}
        </Button>
      ))}

      {pending ? (
        <ConfirmActionDialog
          title={t(`confirm.${pending}Title`)}
          description={t(`confirm.${pending}Body`)}
          confirmLabel={t(pending)}
          reason={
            pending === 'reopen'
              ? { required: true, label: t('confirm.reopenReasonLabel'), maxLength: 500 }
              : undefined
          }
          // Closing is blocked until the gate passes. The gate returns its blockers rather
          // than throwing, so they can be read here instead of arriving as a 400 afterwards.
          isPending={action.isPending || (pending === 'close' && gate.isPending)}
          errorMessage={
            action.isError
              ? t('failed')
              : pending === 'close' && gate.data && !gate.data.passed
                ? `${t('gateBlocked')} ${gate.data.blockers.join('; ')}`
                : undefined
          }
          onConfirm={(reason) => {
            if (pending === 'close' && gate.data && !gate.data.passed) return;
            run(pending, reason);
          }}
          onDismiss={() => {
            setPending(null);
            action.reset();
          }}
        />
      ) : null}

      {action.isError && !pending ? (
        <Alert variant="error" messages={[t('failed')]} />
      ) : null}
    </div>
  );
}

/**
 * Year-end close.
 *
 * Kept apart from the per-period actions: it is not a period transition but the last
 * accounting act of the year — it posts the closing journal and zeroes every P&L account into
 * retained earnings. It is gated on its own permission, which §11.2 marks CFO-only.
 */
export function FiscalYearCloseAction({ year }: { year: FiscalYear }) {
  const t = useTranslations('accounting.periodActions');
  const { can } = usePermissions();

  const action = usePeriodAction();
  const [confirming, setConfirming] = useState(false);

  const allClosed = year.periods.every((p) => p.status === 'CLOSED');

  if (year.status === 'CLOSED' || !can(ACCOUNTING_PERMISSIONS.manageYearEnd)) return null;

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        // Every period has to be closed first — the closing journal is computed from the
        // year's balances, and an open period means those balances can still move.
        disabled={!allClosed}
        onClick={() => setConfirming(true)}
      >
        {t('closeYear')}
      </Button>

      {confirming ? (
        <ConfirmActionDialog
          title={t('confirm.closeYearTitle')}
          description={t('confirm.closeYearBody')}
          confirmLabel={t('closeYear')}
          isPending={action.isPending}
          errorMessage={action.isError ? t('failed') : undefined}
          onConfirm={() =>
            action.mutate(
              { type: 'close-year', fiscalYearId: year.id },
              { onSuccess: () => setConfirming(false) },
            )
          }
          onDismiss={() => {
            setConfirming(false);
            action.reset();
          }}
        />
      ) : null}
    </div>
  );
}
