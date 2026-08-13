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
  const doneCount = items.filter((i) => i.status === 'complete').length;
  const total = items.filter((i) => i.status !== 'optional').length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <section
      aria-labelledby={title ? 'setup-checklist-heading' : undefined}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {/* Header */}
      {(title || progress) ? (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            {title ? (
              <h2
                id="setup-checklist-heading"
                className="text-[13px] font-semibold text-foreground"
              >
                {title}
              </h2>
            ) : null}
            {progress ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-brand-primary">
                  {progressPct}%
                </span>
                <span className="text-[12px] font-medium text-muted-foreground">{progress}</span>
              </div>
            ) : null}
          </div>
          {/* Hidden progress bar for SR */}
          <span
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={total}
            className="sr-only"
          />
        </div>
      ) : null}

      {/* Item list */}
      <ol className="flex min-w-max overflow-x-auto px-4 py-4 [-webkit-overflow-scrolling:touch] lg:min-w-0 lg:overflow-visible lg:px-5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li
              key={item.id}
              className="relative flex w-56 shrink-0 gap-3 pe-5 last:pe-0 lg:w-auto lg:min-w-0 lg:flex-1"
            >
              {/* Left column: indicator + connector */}
              <div className="flex flex-col items-center">
                <ItemIndicator status={item.status} />
                {!isLast ? (
                  <div
                    aria-hidden="true"
                    className={cn(
                      'absolute start-6 top-3 h-px w-[calc(100%-1.5rem)]',
                      item.status === 'complete' ? 'bg-success/40' : 'bg-border',
                    )}
                  />
                ) : null}
              </div>

              {/* Right column: content */}
              <div className="relative z-10 min-w-0 flex-1 bg-surface pe-2">
                <p
                  className={cn(
                    'truncate text-[12.5px] font-semibold leading-5',
                    item.status === 'blocked' || item.status === 'optional'
                      ? 'text-muted-foreground/60'
                      : 'text-foreground',
                  )}
                >
                  {item.label}
                </p>

                {/* Status text */}
                <StatusLabel status={item.status} />

                {/* Description (only when not complete) */}
                {item.status !== 'complete' && item.description ? (
                  <p
                    className={cn(
                      'mt-0.5 line-clamp-1 text-[11.5px] leading-4',
                      item.status === 'blocked' || item.status === 'optional'
                        ? 'text-muted-foreground/50'
                        : 'text-muted-foreground',
                    )}
                  >
                    {item.description}
                  </p>
                ) : null}

                {/* Blocked reason */}
                {item.status === 'blocked' && item.blockedReason ? (
                  <p
                    className="mt-1 line-clamp-1 text-[10.5px] font-medium text-warning"
                    title={item.blockedReason}
                  >
                    {item.blockedReason}
                  </p>
                ) : null}

                {/* Action — only on actionable items */}
                {item.action && item.status !== 'complete' && item.status !== 'blocked' ? (
                  <div className="mt-1.5">{item.action}</div>
                ) : null}
              </div>
            </li>
          );
        })}
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
        return [t('optional'), 'text-muted-foreground/50'];
      default:
        return [t('incomplete'), 'text-muted-foreground'];
    }
  })();

  return (
    <p className={cn('mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]', colorClass)}>
      {label}
    </p>
  );
}
