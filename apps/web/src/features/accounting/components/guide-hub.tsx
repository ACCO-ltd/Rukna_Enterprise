'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Notice, StatusPill, cn, type StatusTone } from '@erp/ui';
import { ArrowRight, Check, CircleCheck, CircleDot, Lock, Settings2 } from 'lucide-react';
import type { GuideCycle, GuideCycleStatus, GuideStep } from '@erp/types';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useAccountingGuide } from '@/features/finance/hooks/use-accounting-guide';
import { GUIDE_STEP_TONE } from '../guide/guide-status';
import { useAccountingSetupStatus } from '../hooks/use-accounting';
import { AccountingSetupDialog } from './accounting-setup-dialog';
import { PartialSetupNotice } from './partial-setup-notice';

/**
 * Setup steps the one-step install does not do and that are optional — importing opening balances
 * from a prior system. Once only these remain, setup is complete for practical purposes.
 */
const OPTIONAL_SETUP_STEPS = new Set(['opening-balances']);

/**
 * How the setup part of the hub reads.
 *  - `install`: the chart is empty and this user can run the one-step setup — the setup card is the
 *    whole page; a checklist of the five things it installs would only repeat it.
 *  - `awaitAdmin`: the chart is empty and this user cannot run setup — one line saying who does.
 *  - `done`: everything required is in place; only optional steps remain.
 *  - `checklist`: anything else (a partial or manual setup) — the step-by-step list is the way.
 */
type SetupMode = 'install' | 'awaitAdmin' | 'done' | 'checklist';

function setupModeOf(
  setup: GuideCycle | undefined,
  canInstall: boolean,
  mayManage: boolean,
): SetupMode {
  if (canInstall) return 'install';
  if (!setup) return 'done';
  const nothingDone = !setup.steps.some((step) => step.status === 'DONE');
  if (!mayManage && nothingDone) return 'awaitAdmin';
  const remaining = setup.steps.filter((step) => step.status !== 'DONE' && step.status !== 'NA');
  return remaining.every((step) => OPTIONAL_SETUP_STEPS.has(step.key)) ? 'done' : 'checklist';
}

/**
 * The "Get started" hub: the accounting cycles as cards, each a checklist of steps whose state is
 * read live from the ledger. A launchpad, never a gate — every actionable step is a link to the
 * screen that does it.
 *
 * Setup is shown in proportion to what is left (see `SetupMode`): before setup, the one-step
 * setup card stands alone and the locked cycles collapse to one line; after it, setup shrinks to a
 * "set up" line with any optional step. The full setup checklist is kept for partial or manual
 * setups, where it is the only way through.
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

  // Wait for the setup status too: rendering the checklist and then swapping it for the setup card
  // a moment later is exactly the clutter this page avoids.
  if (guide.isPending || (mayManage && setupStatus.isPending)) {
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
  const setupCycle = cycles.find((cycle) => cycle.key === 'setup');
  const otherCycles = cycles.filter((cycle) => cycle.key !== 'setup');
  const mode = setupModeOf(setupCycle, canInstall, mayManage);
  const beforeSetup = mode === 'install' || mode === 'awaitAdmin';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('description')}</p>
      </div>

      {mode === 'checklist' ? (
        <Notice tone={ready ? 'success' : 'info'}>
          {ready ? t('readyNote') : t('notReadyNote')}
        </Notice>
      ) : null}

      {mayManage && setupStatus.data?.reason === 'PARTIAL_SETUP' ? (
        <PartialSetupNotice records={setupStatus.data.existingRecords} />
      ) : null}

      {mode === 'install' ? <SetupCallout onSetUp={() => setSettingUp(true)} /> : null}

      {mode === 'awaitAdmin' ? (
        <section
          aria-labelledby="accounting-setup-await"
          className="flex items-start gap-3 rounded-panel border border-border bg-surface px-4 py-4 sm:px-5"
        >
          <Settings2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 id="accounting-setup-await" className="text-h3 font-semibold text-foreground">
              {tSetup('awaitAdminTitle')}
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{tSetup('awaitAdminBody')}</p>
          </div>
        </section>
      ) : null}

      {mode === 'done' && setupCycle ? <SetupDone cycle={setupCycle} /> : null}

      {beforeSetup ? (
        // Daily posting, month-end and year-end cannot start until setup is done; three locked cards
        // saying so would bury the one thing to do.
        otherCycles.length > 0 ? (
          <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <Lock size={14} aria-hidden="true" className="shrink-0" />
            {t('lockedUntilSetup')}
          </p>
        ) : null
      ) : (
        <div className="space-y-4">
          {(mode === 'checklist' ? cycles : otherCycles).map((cycle) => (
            <CycleCard key={cycle.key} cycle={cycle} />
          ))}
        </div>
      )}

      {settingUp ? <AccountingSetupDialog onDone={() => setSettingUp(false)} /> : null}
    </div>
  );
}

/** The one-step setup (ADR-040), with what it installs — the whole page until it has run. */
function SetupCallout({ onSetUp }: { onSetUp: () => void }) {
  const tSetup = useTranslations('accounting.setup.hub');
  const installs = ['chart', 'banks', 'tax', 'fiscalYear', 'numbering'] as const;
  return (
    <section
      aria-labelledby="accounting-setup-callout"
      className="rounded-panel border border-brand-primary/30 bg-brand-accent px-4 py-5 sm:px-6"
    >
      <h3 id="accounting-setup-callout" className="text-h2 font-semibold text-foreground">
        {tSetup('title')}
      </h3>
      <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{tSetup('body')}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {installs.map((key) => (
          <li key={key} className="flex items-start gap-2 text-body-sm text-foreground">
            <Check size={16} strokeWidth={2.5} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            {tSetup(`installs.${key}`)}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" onClick={onSetUp}>
          {tSetup('action')}
        </Button>
        <p className="text-caption text-muted-foreground">{tSetup('afterSetup')}</p>
      </div>
    </section>
  );
}

/** Setup is complete: one line, plus any optional step still open (opening balances). */
function SetupDone({ cycle }: { cycle: GuideCycle }) {
  const t = useTranslations('accounting.guide');
  const optional = cycle.steps.filter((step) => step.status !== 'DONE' && step.status !== 'NA');
  return (
    <section
      aria-labelledby="accounting-setup-done"
      className="rounded-panel border border-border bg-surface"
    >
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <CircleCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0">
          <h3 id="accounting-setup-done" className="text-h3 font-semibold text-foreground">
            {t('setupDoneTitle')}
          </h3>
          <p className="mt-0.5 text-body-sm text-muted-foreground">{t('setupDoneBody')}</p>
        </div>
      </div>
      {optional.length > 0 ? (
        <ol className="divide-y divide-border border-t border-border">
          {optional.map((step) => (
            <StepRow key={step.key} step={step} locked={false} optional />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

const CYCLE_TONE: Record<GuideCycleStatus, StatusTone> = {
  LOCKED: 'neutral',
  IN_PROGRESS: 'progress',
  READY: 'progress',
  ATTENTION: 'attention',
  DONE: 'success',
};

function CycleCard({ cycle }: { cycle: GuideCycle }) {
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
          <StepRow key={step.key} step={step} locked={locked} />
        ))}
      </ol>
    </section>
  );
}

function StepRow({
  step,
  locked,
  optional = false,
}: {
  step: GuideStep;
  locked: boolean;
  /** Labels the step "Optional" in place of its status — it is not holding anything up. */
  optional?: boolean;
}) {
  const t = useTranslations('accounting.guide');
  const tone = GUIDE_STEP_TONE[step.status];
  // A step is a live link only when the cycle is unlocked, the step carries an href, and the
  // user is allowed to act (RESTRICTED steps come back with no href). Otherwise the row is
  // informational — the detail already says what is needed or who does it.
  const actionable =
    !locked && step.status !== 'RESTRICTED' && step.href !== null;
  const isNext = step.status === 'NEXT' && actionable && !optional;

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
          <StatusPill tone={optional ? 'neutral' : tone}>
            {optional ? t('optional') : t(`stepStatus.${step.status}`)}
            {!optional && step.status === 'ATTENTION' && typeof step.count === 'number'
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
      {actionable && step.href ? (
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
