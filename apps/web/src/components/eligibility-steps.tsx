'use client';

import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import type { EligibilityOwner, EligibilityStep, EligibilityStepStatus } from '@erp/types';

/**
 * ADR-043 Phase 2 — the words for an eligibility read model. The server decides every step's
 * status, owner and reason code (from the same policy its commands enforce); the browser only
 * words them. An unknown code falls back to the server's `detail`, then to a neutral sentence.
 */
export function useEligibilityWords() {
  const t = useTranslations('finance.eligibility');
  return {
    owner: (owner: EligibilityOwner) => (t.has(`owner.${owner}`) ? t(`owner.${owner}`) : owner),
    status: (status: EligibilityStepStatus) => t(`status.${status}`),
    /** The plain-words reason for a machine code; null when there is no code. */
    reason: (code: string | null, detail: string | null = null): string | null => {
      if (code && t.has(`reason.${code}`)) return t(`reason.${code}`);
      if (detail) return detail;
      return code ? t('unknownReason') : null;
    },
  };
}

/**
 * The step that explains a blocked reason: the step carrying that code, else the first BLOCKED
 * step, else the first PENDING one. Picking a step to *display* — the status itself is the
 * server's.
 */
export function explainingStep<K extends string>(
  steps: ReadonlyArray<EligibilityStep<K>>,
  blockedReason: string | null,
): EligibilityStep<K> | undefined {
  return (
    (blockedReason ? steps.find((step) => step.code === blockedReason) : undefined) ??
    steps.find((step) => step.status === 'BLOCKED') ??
    steps.find((step) => step.status === 'PENDING')
  );
}

const ICONS: Record<EligibilityStepStatus, { Icon: typeof CheckCircle2; className: string }> = {
  DONE: { Icon: CheckCircle2, className: 'text-success' },
  PENDING: { Icon: CircleDashed, className: 'text-warning' },
  BLOCKED: { Icon: XCircle, className: 'text-danger' },
  NOT_APPLICABLE: { Icon: MinusCircle, className: 'text-muted-foreground' },
};

/**
 * A step checklist in the server's order: an icon per status (with the status as text for
 * screen readers), the step label, its owner, and — while not done — the reason in plain words
 * plus any server detail ("1 of 2 signatures", a period name) as-is.
 */
export function EligibilityStepList<K extends string>({
  steps,
  stepLabel,
  compact = false,
  label,
  className,
}: {
  steps: ReadonlyArray<EligibilityStep<K>>;
  stepLabel: (key: K) => string;
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  const t = useTranslations('finance.eligibility');
  const words = useEligibilityWords();

  return (
    <ol aria-label={label ?? t('stepsLabel')} className={cn(compact ? 'space-y-1' : 'space-y-2', className)}>
      {steps.map((step) => {
        const { Icon, className: tone } = ICONS[step.status];
        const open = step.status === 'PENDING' || step.status === 'BLOCKED';
        const why = open ? words.reason(step.code, step.detail) : null;
        // The detail is shown beside the worded reason unless it already IS the reason.
        const detail = step.detail && step.detail !== why ? step.detail : null;
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-status={step.status}
            className={cn('flex items-start gap-2', compact ? 'text-caption' : 'text-body-sm')}
          >
            <Icon size={compact ? 14 : 16} aria-hidden="true" className={cn('mt-0.5 shrink-0', tone)} />
            <div className="min-w-0">
              <p className={cn(step.status === 'NOT_APPLICABLE' ? 'text-muted-foreground' : 'text-foreground')}>
                <span className={cn(open && 'font-medium')}>{stepLabel(step.key)}</span>
                <span className="sr-only"> — {words.status(step.status)}</span>
                <span className="text-muted-foreground"> · {t('ownerLabel', { owner: words.owner(step.owner) })}</span>
              </p>
              {why ? (
                <p className={cn(step.status === 'BLOCKED' ? 'text-danger' : 'text-muted-foreground')}>
                  {why}
                  {detail ? <span className="text-muted-foreground"> ({detail})</span> : null}
                </p>
              ) : detail && step.status === 'DONE' ? (
                <p className="text-muted-foreground">{detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
