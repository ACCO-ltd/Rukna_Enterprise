'use client';

import { useTranslations } from 'next-intl';
import { Button, cn } from '@erp/ui';
import type { SupplierBillBlockedReason, SupplierBillEligibilityStepKey } from '@erp/types';

import { EligibilityStepList, explainingStep, useEligibilityWords } from '@/components/eligibility-steps';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useSupplierBillEligibility } from '../hooks/use-procurement';

/** Blocks that stop the bill being posted or paid until someone clears them. */
export const HELD = new Set<SupplierBillBlockedReason>([
  'OPENING_BALANCE_AP_NOT_RECONCILED',
  'MATCH_NOT_RUN',
  'MATCH_EXCEPTION',
  'MATCH_DISPUTED',
  'NO_PERIOD',
  'PERIOD_CLOSED',
  'PERIOD_LOCKED',
]);

/**
 * SB-2 — shown only while something blocks the bill (a closed period, an open match, an opening
 * balance that does not tie): one line naming the block and who clears it, with the full path
 * folded under it. A bill that is ready to post, ready to pay or paid shows nothing — the header
 * already says so.
 *
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
  className,
}: {
  billId: string;
  className?: string;
}) {
  const t = useTranslations('finance.eligibility');
  const words = useEligibilityWords();
  const allowed = usePermissions().can(ACCOUNTING_PERMISSIONS.managePayables);
  const query = useSupplierBillEligibility(billId, { enabled: allowed });

  if (!allowed) return null;

  const headingId = `bill-eligibility-${billId}`;
  const frame = (body: React.ReactNode) => (
    <section
      aria-labelledby={headingId}
      data-bill-eligibility
      className={cn('space-y-2 rounded-panel border border-warning/40 bg-warning/5 p-4', className)}
    >
      <h2 id={headingId} className="text-body-sm font-semibold text-foreground">
        {t('bill.title')}
      </h2>
      {body}
    </section>
  );

  // Quiet while loading: the panel only appears when there is a block to explain.
  if (query.isPending) return null;
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
  // Only a real block shows: a draft, a bill awaiting approval or a payment in flight is just a
  // stage, which the status and the primary button already state.
  if (!eligibility.blockedReason || !HELD.has(eligibility.blockedReason)) return null;

  return frame(
    <>
      <p className="text-body-sm text-danger" data-verdict>
        {t('bill.heldBy', {
          reason: words.reason(eligibility.blockedReason, step?.detail ?? null) ?? '',
          owner: step ? words.owner(step.owner) : '—',
        })}
      </p>
      {eligibility.paymentsInFlight > 0 || eligibility.signaturesRequired > 0 ? (
        <p className="text-caption text-muted-foreground">
          {eligibility.paymentsInFlight > 0 ? t('bill.inFlight', { count: eligibility.paymentsInFlight }) : null}
          {eligibility.paymentsInFlight > 0 && eligibility.signaturesRequired > 0 ? ' · ' : null}
          {eligibility.signaturesRequired > 0 ? t('bill.signatures', { count: eligibility.signaturesRequired }) : null}
        </p>
      ) : null}
      <details className="text-body-sm">
        <summary className="cursor-pointer text-caption font-medium text-muted-foreground hover:text-foreground">
          {t('bill.showSteps')}
        </summary>
        <div className="mt-2">
          <EligibilityStepList<SupplierBillEligibilityStepKey>
            steps={eligibility.steps}
            stepLabel={(key) => (t.has(`billStep.${key}`) ? t(`billStep.${key}`) : key)}
          />
        </div>
      </details>
    </>,
  );
}
