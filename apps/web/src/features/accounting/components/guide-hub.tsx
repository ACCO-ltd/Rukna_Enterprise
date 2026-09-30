'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Notice, StatusPill, cn, type StatusTone } from '@erp/ui';
import { ArrowRight, Check, CircleDot, Lock } from 'lucide-react';
import type { GuideCycle, GuideCycleStatus, GuideStep } from '@erp/types';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useAccountingGuide } from '@/features/finance/hooks/use-accounting-guide';
import { GUIDE_STEP_TONE } from '../guide/guide-status';
import { useAccountingSetupStatus } from '../hooks/use-accounting';
import { AccountingSetupDialog } from './accounting-setup-dialog';
import { PartialSetupNotice } from './partial-setup-notice';

/** The setup step that the one-step install (ADR-040) completes, and so opens instead of linking. */
const SETUP_STEP_KEY = 'chart-of-accounts';

/**
 * The "Get started" hub: the four accounting cycles as cards, each a checklist of steps whose
 * state is read live from the ledger. A launchpad, never a gate — every actionable step is a
 * link to the screen that does it. LOCKED cycles (daily, month-end, year-end before setup is
 * ready) render disabled with "Finish setup first"; the setup card always stays actionable.
 */
export function GuideHub() {
  const t = useTranslations('accounting.guide');
  const tSetup = useTranslations('accounting.setup.hub');
  const guide = useAccountingGuide();
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);
  // Asked only by someone who could run the install; everyone else follows the steps as before.
  const setupStatus = useAccountingSetupStatus({ enabled: mayManage });
  const canInstall = mayManage && setupStatus.data?.canInstall === true;
  const [settingUp, setSettingUp] = useState(false);

  if (guide.isPending) {
    return (
      <div role="status" aria-live="polite" className="space-y-4">
        <span className="sr-only">{t('title')}</span>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (guide.isError) {
    return (
      <Alert
        variant="error"
        messages={[t('loadFailed')]}
        action={
          <Button variant="outline" size="sm" onClick={() => void guide.refetch()}>
            {t('retry')}
          </Button>
        }
      />
    );
  }

  const { cycles, ready } = guide.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Notice tone={ready ? 'success' : 'info'}>
        {ready ? t('readyNote') : t('notReadyNote')}
      </Notice>

      {mayManage && setupStatus.data?.reason === 'PARTIAL_SETUP' ? (
        <PartialSetupNotice records={setupStatus.data.existingRecords} />
      ) : null}

      {canInstall ? (
        <section
          aria-labelledby="accounting-setup-callout"
          className="flex flex-col gap-4 rounded-panel border border-brand-primary/30 bg-brand-accent px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <div className="min-w-0">
            <h3 id="accounting-setup-callout" className="text-h3 font-semibold text-foreground">
              {tSetup('title')}
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{tSetup('body')}</p>
          </div>
          <Button type="button" className="shrink-0" onClick={() => setSettingUp(true)}>
            {tSetup('action')}
          </Button>
        </section>
      ) : null}

      <div className="space-y-4">
        {cycles.map((cycle) => (
          <CycleCard
            key={cycle.key}
            cycle={cycle}
            onSetUp={canInstall ? () => setSettingUp(true) : undefined}
          />
        ))}
      </div>

      {settingUp ? <AccountingSetupDialog onDone={() => setSettingUp(false)} /> : null}
    </div>
  );
}

const CYCLE_TONE: Record<GuideCycleStatus, StatusTone> = {
  LOCKED: 'neutral',
  IN_PROGRESS: 'progress',
  READY: 'progress',
  ATTENTION: 'attention',
  DONE: 'success',
};

function CycleCard({ cycle, onSetUp }: { cycle: GuideCycle; onSetUp?: () => void }) {
  const t = useTranslations('accounting.guide');
  const locked = cycle.status === 'LOCKED';

  return (
    <section
      aria-labelledby={`cycle-${cycle.key}`}
      className={cn(
        'rounded-panel border border-border bg-surface',
        locked && 'opacity-70',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`cycle-${cycle.key}`} className="text-h3 font-semibold text-foreground">
              {cycle.title}
            </h3>
            <StatusPill tone={CYCLE_TONE[cycle.status]}>
              {t(`cycleStatus.${cycle.status}`)}
            </StatusPill>
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">{cycle.summary}</p>
        </div>
        {locked ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption font-medium text-muted-foreground">
            <Lock size={13} aria-hidden="true" />
            {t('lockedCycle')}
          </span>
        ) : null}
      </header>

      <ol className="divide-y divide-border">
        {cycle.steps.map((step) => (
          <StepRow
            key={step.key}
            step={step}
            locked={locked}
            onActivate={cycle.key === 'setup' && step.key === SETUP_STEP_KEY ? onSetUp : undefined}
          />
        ))}
      </ol>
    </section>
  );
}

function StepRow({
  step,
  locked,
  onActivate,
}: {
  step: GuideStep;
  locked: boolean;
  /** Opens an in-place action (the setup dialog) instead of following `href`. */
  onActivate?: () => void;
}) {
  const t = useTranslations('accounting.guide');
  const tone = GUIDE_STEP_TONE[step.status];
  // A step is a live link only when the cycle is unlocked, the step carries an href, and the
  // user is allowed to act (RESTRICTED steps come back with no href). Otherwise the row is
  // informational — the detail already says what is needed or who does it.
  const actionable =
    !locked && step.status !== 'RESTRICTED' && (step.href !== null || onActivate !== undefined);
  const isNext = step.status === 'NEXT' && actionable;

  const body = (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 sm:px-5',
        isNext && 'bg-brand-accent',
        actionable && 'transition-colors group-hover:bg-surface-subtle',
      )}
    >
      <StepGlyph status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'text-body-sm text-foreground',
              isNext ? 'font-semibold' : 'font-medium',
              step.status === 'DONE' && 'text-muted-foreground',
            )}
          >
            {step.label}
          </span>
          <StatusPill tone={tone}>
            {t(`stepStatus.${step.status}`)}
            {step.status === 'ATTENTION' && typeof step.count === 'number'
              ? ` · ${step.count}`
              : ''}
          </StatusPill>
        </div>
        <p className="mt-0.5 text-caption text-muted-foreground">{step.detail}</p>
      </div>
      {actionable ? (
        <ArrowRight
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      ) : null}
    </div>
  );

  return (
    <li>
      {actionable && onActivate ? (
        <button
          type="button"
          onClick={onActivate}
          className="group block w-full text-start focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
          aria-label={`${step.label} — ${t('openStep')}`}
        >
          {body}
        </button>
      ) : actionable && step.href ? (
        <Link
          href={step.href}
          className="group block focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
          aria-label={`${step.label} — ${t('openStep')}`}
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** A small leading glyph that reinforces the row's state before the reader reaches the pill. */
function StepGlyph({ status }: { status: GuideStep['status'] }) {
  const base = 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full';
  if (status === 'DONE') {
    return (
      <span className={cn(base, 'bg-success-subtle text-success')} aria-hidden="true">
        <Check size={13} strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'NEXT') {
    return (
      <span className={cn(base, 'bg-brand-primary text-brand-on-primary')} aria-hidden="true">
        <CircleDot size={13} strokeWidth={2.5} />
      </span>
    );
  }
  const dot: Record<Exclude<GuideStep['status'], 'DONE' | 'NEXT'>, string> = {
    TODO: 'bg-muted-foreground',
    BLOCKED: 'bg-warning',
    ATTENTION: 'bg-warning',
    RESTRICTED: 'bg-muted-foreground',
    NA: 'bg-muted-foreground',
  };
  return (
    <span className={cn(base)} aria-hidden="true">
      <span className={cn('size-2 rounded-full', dot[status])} />
    </span>
  );
}
