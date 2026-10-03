'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button, Skeleton, cn } from '@erp/ui';
import type { SupplierBillEligibilityStepKey } from '@erp/types';

import { EligibilityStepList, explainingStep, useEligibilityWords } from '@/components/eligibility-steps';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatMoney } from '@/lib/format';

import { useSupplierBillEligibility } from '../hooks/use-procurement';

/**
 * "Why can't I pay this?" (ADR-043 Phase 2) — the bill's path from draft to paid, one step per
 * rule a command enforces, read from `GET /bills/:id/eligibility`. The verdict (`canPost`,
 * `canPay`, `blockedReason`) and every step's status are the server's; nothing is re-derived
 * here. The panel takes no action itself — the bill's own action bar does.
 *
 * Gated on `manage:payable`, the endpoint's gate: without it the panel renders nothing and the
 * endpoint is never called.
 */
export function BillEligibilityPanel({
  billId,
  currencyCode,
  className,
}: {
  billId: string;
  currencyCode?: string;
  className?: string;
}) {
  const t = useTranslations('finance.eligibility');
  const locale = useLocale() as 'en';
  const words = useEligibilityWords();
  const allowed = usePermissions().can(ACCOUNTING_PERMISSIONS.managePayables);
  const query = useSupplierBillEligibility(billId, { enabled: allowed });

  if (!allowed) return null;

  const headingId = `bill-eligibility-${billId}`;
  const frame = (body: React.ReactNode) => (
    <section
      aria-labelledby={headingId}
      data-bill-eligibility
      className={cn('space-y-3 rounded-panel border border-border bg-surface p-4 shadow-e1', className)}
    >
      <h2 id={headingId} className="text-h3 font-semibold text-foreground">
        {t('bill.title')}
      </h2>
      {body}
    </section>
  );

  if (query.isPending) {
    return frame(
      <div role="status" aria-live="polite">
        <span className="sr-only">{t('bill.loading')}</span>
        <Skeleton className="h-24 w-full" aria-hidden="true" />
      </div>,
    );
  }
  if (query.isError || !query.data) {
    return frame(
      <div className="space-y-2">
        <p className="text-body-sm text-danger">{t('bill.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t('bill.retry')}
        </Button>
      </div>,
    );
  }

  const eligibility = query.data;
  const step = explainingStep(eligibility.steps, eligibility.blockedReason);
  let verdict: React.ReactNode;
  let tone = 'text-foreground';
  if (eligibility.canPay) {
    verdict = t('bill.readyToPay', {
      amount: formatMoney(eligibility.outstandingAmount, currencyCode ?? 'USD', locale) ?? eligibility.outstandingAmount,
    });
    tone = 'text-success';
  } else if (eligibility.blockedReason === 'FULLY_PAID') {
    verdict = t('bill.paidInFull');
    tone = 'text-success';
  } else if (eligibility.canPost) {
    verdict = t('bill.readyToPost');
  } else if (eligibility.blockedReason) {
    verdict = t('bill.blocked', {
      reason: words.reason(eligibility.blockedReason, step?.detail ?? null) ?? '',
      owner: step ? words.owner(step.owner) : '—',
    });
    tone = 'text-danger';
  }

  return frame(
    <>
      {verdict ? (
        <p className={`text-body-sm font-medium ${tone}`} data-verdict>
          {verdict}
        </p>
      ) : null}
      {eligibility.paymentsInFlight > 0 || eligibility.signaturesRequired > 0 ? (
        <p className="text-caption text-muted-foreground">
          {eligibility.paymentsInFlight > 0 ? t('bill.inFlight', { count: eligibility.paymentsInFlight }) : null}
          {eligibility.paymentsInFlight > 0 && eligibility.signaturesRequired > 0 ? ' · ' : null}
          {eligibility.signaturesRequired > 0 ? t('bill.signatures', { count: eligibility.signaturesRequired }) : null}
        </p>
      ) : null}
      <EligibilityStepList<SupplierBillEligibilityStepKey>
        steps={eligibility.steps}
        stepLabel={(key) => (t.has(`billStep.${key}`) ? t(`billStep.${key}`) : key)}
      />
    </>,
  );
}
