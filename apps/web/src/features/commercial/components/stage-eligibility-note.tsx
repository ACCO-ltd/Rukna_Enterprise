'use client';

import { useTranslations } from 'next-intl';
import type { StageBillingEligibility, StageBillingEligibilityStepKey } from '@erp/types';

import { EligibilityStepList, explainingStep, useEligibilityWords } from '@/components/eligibility-steps';

/**
 * ADR-043 Phase 2 — why a payment-schedule stage cannot be prepared or issued yet, in plain
 * words with the team that moves it ("Progress not verified yet — owner: Construction"), plus
 * the stage's billing steps behind a disclosure. Everything comes from the row's
 * `billingEligibility`, computed by the same policy the prepare / issue commands call; nothing
 * is re-derived here. Renders nothing for a stage that can move, or is already billed.
 */
export function StageEligibilityNote({ eligibility }: { eligibility: StageBillingEligibility | undefined }) {
  const t = useTranslations('finance.eligibility');
  const words = useEligibilityWords();

  if (!eligibility) return null;
  if (eligibility.canPrepare || eligibility.canIssue) return null;
  if (!eligibility.blockedReason || eligibility.blockedReason === 'STAGE_ISSUED') return null;

  const step = explainingStep(eligibility.steps, eligibility.blockedReason);
  const done = eligibility.steps.filter((s) => s.status === 'DONE' || s.status === 'NOT_APPLICABLE').length;

  return (
    <div className="space-y-1" data-stage-eligibility={eligibility.installmentId}>
      <p className="text-caption font-medium text-warning">
        {t('stage.blocked', {
          reason: words.reason(eligibility.blockedReason, step?.detail ?? null) ?? '',
          owner: step ? words.owner(step.owner) : '—',
        })}
      </p>
      {eligibility.steps.length > 0 ? (
        <details className="group text-caption">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('stage.steps', { done, total: eligibility.steps.length })}
          </summary>
          <EligibilityStepList<StageBillingEligibilityStepKey>
            compact
            className="mt-1"
            steps={eligibility.steps}
            stepLabel={(key) => (t.has(`stageStep.${key}`) ? t(`stageStep.${key}`) : key)}
          />
        </details>
      ) : null}
    </div>
  );
}
