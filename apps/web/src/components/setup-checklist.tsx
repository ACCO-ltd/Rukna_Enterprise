'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import { Check, Lock, Minus } from '@phosphor-icons/react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChecklistItemStatus = 'complete' | 'incomplete' | 'blocked' | 'optional';

export interface ChecklistItem {
  id: string;
  /** Translated item label. */
  label: string;
  /** Optional concise description shown below the label. */
  description?: string;
  status: ChecklistItemStatus;
  /** Short reason shown when `status === 'blocked'`. */
  blockedReason?: string;
  /** Contextual action (Button + Link). Omit when complete or blocked. */
  action?: React.ReactNode;
}

export interface SetupChecklistProps {
  /** Translated section title. */
  title?: string;
  /** Human-readable progress summary e.g. "2 of 4 complete". */
  progress?: string;
  items: ChecklistItem[];
  className?: string;
}

// ─── Item indicator ───────────────────────────────────────────────────────────

function ItemIndicator({ status }: { status: ChecklistItemStatus }) {
  const t = useTranslations('common.checklist');

  if (status === 'complete') {
    return (
      <span
        aria-label={t('complete')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"
      >
        <Check size={12} weight="bold" aria-hidden="true" />
      </span>
    );
  }

  if (status === 'blocked') {
    return (
      <span
        aria-label={t('blocked')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-surface text-warning"
      >
        <Lock size={11} aria-hidden="true" />
      </span>
    );
  }

  if (status === 'optional') {
    return (
      <span
        aria-label={t('optional')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground/50"
      >
        <Minus size={11} aria-hidden="true" />
      </span>
    );
  }

  // incomplete
  return (
    <span
      aria-label={t('incomplete')}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-surface"
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Freely navigable project/entity setup progress checklist.
 *
 * Unlike `ProgressStepper` there is no required order — users may complete any
 * item at any time. Blocked items show why they cannot be acted on yet.
 * Optional items are visually de-emphasised.
 *
 * The caller supplies translated content and statuses; no construction-specific
 * labels are hardcoded here.
 *
 * @example
 * <SetupChecklist
 *   title={t('setup')}
 *   progress={t('setupProgress', { done: 1, total: 4 })}
 *   items={[
 *     { id: 'project', label: t('setupProject'), status: 'complete' },
 *     { id: 'boq', label: t('setupBoq'), status: 'incomplete',
 *       action: <Button asChild><Link href="/boq">{t('continueSetup')}</Link></Button> },
 *   ]}
 * />
 */
export function SetupChecklist({ title, progress, items, className }: SetupChecklistProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn('rounded-panel border border-border bg-surface p-5 sm:p-6', className)}
    >
      {title || progress ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 id={headingId} className="text-body font-semibold text-foreground">
              {title}
            </h2>
          ) : null}
          {progress ? <span className="text-caption text-muted-foreground">{progress}</span> : null}
        </div>
      ) : null}
      <ol className="mt-3 divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-3">
            <ItemIndicator status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-sm font-medium text-foreground">{item.label}</p>
                <StatusLabel status={item.status} />
              </div>
              {item.status !== 'complete' && item.description ? (
                <p className="mt-1 text-body-sm text-muted-foreground">{item.description}</p>
              ) : null}
              {item.status === 'blocked' && item.blockedReason ? (
                <p className="mt-1 text-caption text-muted-foreground">{item.blockedReason}</p>
              ) : null}
              {item.action && item.status !== 'complete' && item.status !== 'blocked' ? (
                <div className="mt-3">{item.action}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatusLabel({ status }: { status: ChecklistItemStatus }) {
  const t = useTranslations('common.checklist');

  const [label, colorClass] = ((): [string, string] => {
    switch (status) {
      case 'complete':
        return [t('complete'), 'text-success'];
      case 'blocked':
        return [t('blocked'), 'text-warning'];
      case 'optional':
        return [t('optional'), 'text-muted-foreground'];
      default:
        return [t('incomplete'), 'text-muted-foreground'];
    }
  })();

  return (
    <p className={cn('mt-0.5 text-micro font-semibold uppercase tracking-[0.06em]', colorClass)}>
      {label}
    </p>
  );
}
