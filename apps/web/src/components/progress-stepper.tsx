'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import { Check, Warning } from '@phosphor-icons/react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error';

export interface Step {
  id: string;
  /** Translated label shown below the step indicator. */
  label: string;
  /** Optional supporting text. */
  description?: string;
  status: StepStatus;
}

export interface ProgressStepperProps {
  steps: Step[];
  /**
   * If provided, step labels become interactive buttons. Only pass this when
   * the stepper is genuinely navigable — do not allow navigation past the
   * current step for blocking workflows.
   */
  onStepClick?: (id: string) => void;
  className?: string;
}

// ─── Indicator ────────────────────────────────────────────────────────────────

function StepIndicator({
  index,
  status,
  label,
}: {
  index: number;
  status: StepStatus;
  label: string;
}) {
  const t = useTranslations('common.stepper');

  if (status === 'complete') {
    return (
      <span
        aria-label={`${t('complete')}: ${label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-white"
      >
        <Check size={13} weight="bold" aria-hidden="true" />
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        aria-label={`${t('error')}: ${label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-danger bg-surface text-danger"
      >
        <Warning size={13} weight="bold" aria-hidden="true" />
      </span>
    );
  }

  if (status === 'current') {
    return (
      <span
        aria-label={`${t('current')}: ${label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-[11px] font-bold text-white ring-4 ring-brand-primary/15"
      >
        {index + 1}
      </span>
    );
  }

  // upcoming
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-border bg-surface text-[11px] font-semibold text-muted-foreground"
    >
      {index + 1}
    </span>
  );
}

// ─── Connector ────────────────────────────────────────────────────────────────

function Connector({ complete }: { complete: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'mb-4 h-px w-8 flex-shrink-0',
        complete ? 'bg-success/50' : 'bg-border',
      )}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Generic sequential workflow progress component.
 *
 * Expresses linear progress through a mandatory sequence of steps. Steps are
 * either complete, the active current step, upcoming, or in error.
 *
 * On desktop the steps are laid out horizontally with connector lines between
 * them. On mobile, the row is horizontally scrollable to avoid cramped labels.
 *
 * Color alone never conveys meaning — each status also has an icon and/or a
 * numeric indicator.
 *
 * @example
 * <ProgressStepper
 *   steps={[
 *     { id: 'details', label: t('step.details'), status: 'complete' },
 *     { id: 'review',  label: t('step.review'),  status: 'current'  },
 *     { id: 'confirm', label: t('step.confirm'), status: 'upcoming' },
 *   ]}
 * />
 */
export function ProgressStepper({ steps, onStepClick, className }: ProgressStepperProps) {
  return (
    <nav
      aria-label="Progress"
      className={cn('overflow-x-auto [-webkit-overflow-scrolling:touch]', className)}
    >
      <ol className="flex min-w-max items-start gap-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isPast = step.status === 'complete';

          return (
            <li key={step.id} className="flex items-center">
              {/* Step + label */}
              <div className="flex flex-col items-center gap-2 px-1">
                {onStepClick && step.status !== 'upcoming' ? (
                  <button
                    type="button"
                    aria-current={step.status === 'current' ? 'step' : undefined}
                    onClick={() => onStepClick(step.id)}
                    className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary rounded-full"
                  >
                    <StepIndicator index={index} status={step.status} label={step.label} />
                  </button>
                ) : (
                  <div aria-current={step.status === 'current' ? 'step' : undefined}>
                    <StepIndicator index={index} status={step.status} label={step.label} />
                  </div>
                )}
                <span
                  className={cn(
                    'max-w-[5.5rem] text-center text-[11px] font-medium leading-tight',
                    step.status === 'current'
                      ? 'text-brand-primary'
                      : step.status === 'complete'
                        ? 'text-foreground'
                        : step.status === 'error'
                          ? 'text-danger'
                          : 'text-muted-foreground/60',
                  )}
                >
                  {step.label}
                </span>
                {step.description ? (
                  <span className="max-w-[6rem] text-center text-[10px] leading-tight text-muted-foreground">
                    {step.description}
                  </span>
                ) : null}
              </div>

              {/* Connector line between steps */}
              {!isLast ? <Connector complete={isPast} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
