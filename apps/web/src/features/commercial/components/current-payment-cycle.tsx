'use client';

import Link from 'next/link';
import { Check, CircleDot, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, Skeleton, cn } from '@erp/ui';
import type {
  CommercialCurrentCycleResponse,
  CommercialCycleStage,
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
} from '@erp/types';

import { formatMoney } from '@/lib/format';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { paymentInstallmentTone } from '../presentation';
import { errorText } from './commercial-workspace';

/**
 * The single most important thing on the Commercial workspace: **what happens next to get paid.**
 *
 * Not the aggregate money — that is the position band above, and a reader who wanted it has
 * already read it. This card answers the operational question, and it is the only place on
 * Overview that carries a primary action.
 *
 * It branches on the contract's billing model, because a payment-schedule contract and a measured
 * contract genuinely have different cycles (ADR-023). Forcing one vocabulary onto the other would
 * mean telling a milestone project it is "awaiting certification" when nothing certifies.
 */
export function CurrentPaymentCycle({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.cycle');
  const query = useCommercialCurrentCycle(projectId);

  if (query.isPending) return <Skeleton className="h-44 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[errorText(query.error, t('loadFailedHint'))]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const cycle = query.data;

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
        <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
        <span className="text-caption text-muted-foreground">{t(`stageSummary.${cycle.stage}`)}</span>
      </div>

      {cycle.stage === 'MILESTONE_SCHEDULE' ? (
        <MilestoneFocus projectId={projectId} cycle={cycle} summary={summary} />
      ) : (
        <ApplicationFocus cycle={cycle} summary={summary} />
      )}

      <CycleTimeline stage={cycle.stage} milestone={cycle.stage === 'MILESTONE_SCHEDULE'} />
    </section>
  );
}

// ─── MILESTONE — the payment plan's current installment ─────────────────────────

/**
 * "Installment 3 of 6 · Structural frame completion · 20% · $480,000 · Ready to invoice."
 *
 * The focus installment is the server's `NEXT` — the first un-invoiced one, where billing
 * legitimately happens. When every installment is billed there is no focus and the card says so
 * rather than pointing at a button that would 409.
 */
function MilestoneFocus({
  projectId,
  cycle,
  summary,
}: {
  projectId: string;
  cycle: CommercialCurrentCycleResponse;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.cycle');
  const tSchedule = useTranslations('commercial.paymentSchedule');
  const locale = useLocale() as 'en' | 'ar';

  const installments = cycle.paymentSchedule?.installments ?? [];
  const focus = installments.find((i) => i.status === 'NEXT') ?? null;
  const position = focus ? installments.findIndex((i) => i.id === focus.id) + 1 : 0;
  const currency = cycle.paymentSchedule?.currency ?? summary.currency;
  const blocked = focus ? isGateBlocked(focus) : false;

  if (!focus) {
    return (
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success">
          <Check size={16} aria-hidden="true" />
        </span>
        <div>
          <p className="text-body font-semibold text-foreground">{t('milestone.allBilledTitle')}</p>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            {t('milestone.allBilledHint', { total: installments.length })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground">
          {t('milestone.installmentOf', { n: position, total: installments.length })}
        </p>
        <p className="mt-0.5 text-h3 font-semibold text-foreground">{focus.name}</p>

        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-h2 font-bold tabular-nums text-foreground">
            {formatMoney(focus.amount, currency, locale) ??
              (summary.financialsVisible ? '—' : t('restricted'))}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {formatPercent(focus.percentage)}
          </span>
          <Badge tone={paymentInstallmentTone(focus.status)}>
            {tSchedule(`status.${focus.status}`)}
          </Badge>
        </div>

        {/* What has to be true before this installment can be billed. A free-text label is the
            contract's own wording; a linked programme milestone is a hard gate the API enforces
            too, so an unverified one is stated as the blocker it is. */}
        {focus.programmeMilestone ? (
          <p
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 text-caption',
              blocked ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {blocked ? <Lock size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
            {blocked
              ? tSchedule('milestone.blockedHint')
              : t('milestone.evidenceVerified', { code: focus.programmeMilestone.code })}
          </p>
        ) : focus.milestoneLabel ? (
          <p className="mt-2 text-caption text-muted-foreground">
            {t('milestone.trigger', { trigger: focus.milestoneLabel })}
          </p>
        ) : null}
      </div>

      {cycle.nextAction ? (
        <Button asChild size="sm" className="min-h-11 shrink-0 self-start sm:min-h-0">
          <Link href={cycle.nextAction.href}>{t(`actions.${cycle.nextAction.kind}`)}</Link>
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0 self-start sm:min-h-0">
          <Link href={`/projects/${projectId}/commercial/payment-schedule`}>
            {t('milestone.view')}
          </Link>
        </Button>
      )}
    </div>
  );
}

/** CONST-COM-011: a linked programme milestone that is not yet verified blocks invoicing. */
function isGateBlocked(installment: CommercialPaymentScheduleInstallment): boolean {
  return (
    installment.programmeMilestone !== null && installment.programmeMilestone.status !== 'VERIFIED'
  );
}

// ─── MEASURED_IPC — the current application/certificate ─────────────────────────

function ApplicationFocus({
  cycle,
  summary,
}: {
  cycle: CommercialCurrentCycleResponse;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.cycle');
  const locale = useLocale() as 'en' | 'ar';
  const row = cycle.application;

  if (!row) {
    return (
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-body font-semibold text-foreground">{t(`stageTitle.${cycle.stage}`)}</p>
          {cycle.responsibleRole ? (
            <p className="mt-0.5 text-caption text-muted-foreground">
              {t('responsible', { role: t(`roles.${cycle.responsibleRole}`) })}
            </p>
          ) : null}
        </div>
        {cycle.nextAction ? (
          <Button asChild size="sm" className="min-h-11 shrink-0 sm:min-h-0">
            <Link href={cycle.nextAction.href}>{t(`actions.${cycle.nextAction.kind}`)}</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const money = (value: string | null) =>
    value === null
      ? summary.financialsVisible
        ? '—'
        : t('restricted')
      : (formatMoney(value, summary.currency, locale) ?? '—');

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground">{t(`stageTitle.${cycle.stage}`)}</p>
        <p className="mt-0.5 text-h3 font-semibold text-foreground">
          {row.applicationRef ?? t('application', { n: row.applicationNumber ?? 0 })}
        </p>

        {/* Claimed vs certified is the whole point of the measured cycle, so both are stated
            with the adjustment between them named — not a coloured number the reader has to
            work out the sign of. */}
        <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
          <Figure label={t('claimed')} value={money(row.claimedAmount)} />
          {row.ipcId ? <Figure label={t('certified')} value={money(row.certifiedNet)} /> : null}
          {row.ipcId && row.claimedAmount !== null && row.certifiedNet !== null ? (
            <Figure
              label={t('adjustment')}
              value={money(
                (Number(row.certifiedNet) - Number(row.claimedAmount)).toFixed(2),
              )}
            />
          ) : null}
        </dl>
      </div>

      {cycle.nextAction ? (
        <Button asChild size="sm" className="min-h-11 shrink-0 self-start sm:min-h-0">
          <Link href={cycle.nextAction.href}>{t(`actions.${cycle.nextAction.kind}`)}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── The compact cycle rail ─────────────────────────────────────────────────────

/**
 * Where this cycle has got to — six stages for a payment schedule, seven for a measured chain.
 *
 * This is the *current commercial cycle*, not the project lifecycle: it resets with each
 * installment or application, which is exactly why it is scoped to this card rather than sitting
 * permanently across the top of the workspace. Only stages the read model can actually reach are
 * listed; a rail with a stage nothing ever lands on is a promise the product does not keep.
 */
const MILESTONE_STAGES = [
  'contractActive',
  'installmentDue',
  'readyToInvoice',
  'invoiceIssued',
  'awaitingPayment',
  'settled',
] as const;

const APPLICATION_STAGES = [
  'contractActive',
  'applicationPrepared',
  'submitted',
  'certified',
  'invoiceIssued',
  'awaitingPayment',
  'settled',
] as const;

export function CycleTimeline({
  stage,
  milestone,
}: {
  stage: CommercialCycleStage;
  milestone: boolean;
}) {
  const t = useTranslations('commercial.cycle');
  const stages = milestone ? MILESTONE_STAGES : APPLICATION_STAGES;
  const current = milestone ? milestoneStageIndex(stage) : applicationStageIndex(stage);

  return (
    <div className="overflow-x-auto border-t border-border px-4 py-3.5 sm:px-5">
      <ol
        className={cn('grid gap-2', milestone ? 'min-w-[520px] grid-cols-6' : 'min-w-[620px] grid-cols-7')}
        aria-label={t('label')}
      >
        {stages.map((name, index) => {
          const complete = index < current;
          const active = index === current;
          return (
            <li
              key={name}
              className="relative flex flex-col items-center text-center"
              aria-current={active ? 'step' : undefined}
            >
              {index > 0 ? (
                <span
                  className={cn(
                    'absolute end-1/2 top-2.5 h-px w-full',
                    index <= current ? 'bg-success' : 'bg-border-strong',
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 flex size-5 items-center justify-center rounded-full border bg-surface',
                  complete && 'border-success bg-success text-on-success',
                  active &&
                    'border-brand-primary bg-brand-primary-subtle text-brand-primary ring-4 ring-brand-primary/10',
                  !complete && !active && 'border-border-strong text-muted-foreground',
                )}
              >
                {complete ? (
                  <Check size={11} aria-hidden="true" />
                ) : active ? (
                  <CircleDot size={11} aria-hidden="true" />
                ) : null}
              </span>
              <span
                className={cn(
                  'mt-1.5 text-micro font-medium',
                  active ? 'text-brand-primary' : 'text-muted-foreground',
                )}
              >
                {t(`rail.${name}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A MILESTONE contract's cycle position.
 *
 * The read model reports `MILESTONE_SCHEDULE` for the whole plan rather than per-installment
 * stages, so the rail sits on "ready to invoice" — the point the focus installment is at and the
 * one the card's action addresses. It moves further only for stages the schedule genuinely has.
 */
export function milestoneStageIndex(stage: CommercialCycleStage): number {
  if (stage === 'NO_CONTRACT' || stage === 'CONTRACT_DRAFT') return 0;
  if (stage === 'MILESTONE_SCHEDULE') return 2;
  if (stage === 'INVOICE_DRAFT') return 3;
  if (stage === 'AWAITING_PAYMENT' || stage === 'PARTIALLY_PAID') return 4;
  return 5;
}

export function applicationStageIndex(stage: CommercialCycleStage): number {
  if (stage === 'NO_CONTRACT' || stage === 'CONTRACT_DRAFT') return 0;
  if (
    stage === 'READY_FOR_APPLICATION' ||
    stage === 'APPLICATION_DRAFT' ||
    stage === 'APPLICATION_RETURNED'
  )
    return 1;
  if (stage === 'APPLICATION_SUBMITTED' || stage === 'AWAITING_CERTIFICATION') return 2;
  if (stage === 'CERTIFIED' || stage === 'AWAITING_INVOICE') return 3;
  if (stage === 'INVOICE_DRAFT') return 4;
  if (stage === 'AWAITING_PAYMENT' || stage === 'PARTIALLY_PAID') return 5;
  return 6;
}

/** Rates arrive as fractions — `0.2000` is 20%. */
export function formatPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}
