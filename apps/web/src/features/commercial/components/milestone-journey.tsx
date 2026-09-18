'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn, Badge, type BadgeTone } from '@erp/ui';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
} from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

import type {
  MilestoneItemViewModel,
  MilestoneJourneyViewModel,
  MilestoneUserState,
} from '../milestone-journey.adapter';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MilestoneJourneyProps {
  viewModel: MilestoneJourneyViewModel;
  onMilestoneClick: (milestone: MilestoneItemViewModel) => void;
  onReviewForBilling: (milestone: MilestoneItemViewModel) => void;
  onPrepareInvoice: (milestone: MilestoneItemViewModel) => void;
  onSendInvoice: (milestone: MilestoneItemViewModel) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MilestoneJourney({
  viewModel,
  onMilestoneClick,
  onReviewForBilling,
  onPrepareInvoice,
  onSendInvoice,
}: MilestoneJourneyProps) {
  const t = useTranslations('commercial.contractMilestones');

  if (viewModel.milestones.length === 0) {
    return (
      <section className="rounded-panel border border-border bg-surface px-5 py-10 text-center">
        <p className="text-body font-medium text-foreground">{t('journey.emptyTitle')}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('journey.emptyHint')}</p>
      </section>
    );
  }

  const billedStates: MilestoneUserState[] = [
    'invoiced', 'paid', 'partially-paid', 'invoice-issued', 'awaiting-payment',
  ];
  const unassignedCount = viewModel.milestones
    .flatMap((m) => m.variationAllocations)
    .filter(
      (vo) =>
        viewModel.milestones
          .filter((m) => !billedStates.includes(m.userState))
          .flatMap((m) => m.variationAllocations)
          .includes(vo),
    ).length;

  return (
    <section aria-label={t('journey.sectionTitle')}>
      <ol className="space-y-2" role="list">
        {viewModel.milestones.map((milestone, idx) => (
          <MilestoneItem
            key={milestone.id}
            milestone={milestone}
            stepNumber={idx + 1}
            currency={viewModel.currency}
            financialsVisible={viewModel.financialsVisible}
            onMilestoneClick={onMilestoneClick}
            onReviewForBilling={onReviewForBilling}
            onPrepareInvoice={onPrepareInvoice}
            onSendInvoice={onSendInvoice}
          />
        ))}
      </ol>

      {/* Unassigned variations banner */}
      {unassignedCount > 0 ? (
        <p className="mt-3 rounded-md bg-muted px-4 py-2 text-caption text-muted-foreground">
          {t('journey.unassignedBanner', { count: unassignedCount })}
        </p>
      ) : null}
    </section>
  );
}

// ─── Milestone item ───────────────────────────────────────────────────────────

function MilestoneItem({
  milestone,
  stepNumber,
  currency,
  financialsVisible,
  onMilestoneClick,
  onReviewForBilling,
  onPrepareInvoice,
  onSendInvoice,
}: {
  milestone: MilestoneItemViewModel;
  stepNumber: number;
  currency: string;
  financialsVisible: boolean;
  onMilestoneClick: (m: MilestoneItemViewModel) => void;
  onReviewForBilling: (m: MilestoneItemViewModel) => void;
  onPrepareInvoice: (m: MilestoneItemViewModel) => void;
  onSendInvoice: (m: MilestoneItemViewModel) => void;
}) {
  const t = useTranslations('commercial.contractMilestones');
  const locale = useLocale() as 'en' | 'ar';

  const isCurrent =
    milestone.userState === 'in-progress' ||
    milestone.userState === 'review-for-billing' ||
    milestone.userState === 'ready-to-bill' ||
    milestone.userState === 'invoice-issued';
  const isDone =
    milestone.userState === 'paid' ||
    milestone.userState === 'partially-paid' ||
    milestone.userState === 'invoiced' ||
    milestone.userState === 'awaiting-payment';

  return (
    <li
      data-current={isCurrent || undefined}
      data-done={isDone || undefined}
      className={cn(
        'rounded-panel border px-4 py-4 transition-colors',
        isCurrent
          ? 'border-brand-primary/30 bg-white shadow-sm'
          : isDone
            ? 'border-border bg-surface/50'
            : 'border-border bg-surface',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Step indicator */}
        <StepIcon state={milestone.userState} stepNumber={stepNumber} />

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Name row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onMilestoneClick(milestone)}
              className="flex items-center gap-1 text-body font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={milestone.name}
            >
              {milestone.name}
              <ChevronRight size={14} className="text-muted-foreground" aria-hidden="true" />
            </button>
            <StateBadge state={milestone.userState} />
          </div>

          {/* Date */}
          {milestone.dateLabel && milestone.expectedDate ? (
            <p className="text-body-sm text-muted-foreground">
              {milestone.dateLabel === 'expected'
                ? t('dateLabel.expected', {
                    date: formatDate(milestone.expectedDate, locale) ?? milestone.expectedDate,
                  })
                : t('dateLabel.due', {
                    date: formatDate(milestone.expectedDate, locale) ?? milestone.expectedDate,
                  })}
            </p>
          ) : null}

          {/* Money — base + variations separated */}
          {financialsVisible ? (
            <MoneyBlock
              milestone={milestone}
              currency={currency}
              locale={locale}
              t={t}
              isCurrent={isCurrent}
            />
          ) : null}

          {/* Programme milestone status (only when linked and current/upcoming) */}
          {!isDone && milestone.programmeMilestone ? (
            <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
              {milestone.programmeMilestone.status === 'VERIFIED' ? (
                <>
                  <CheckCircle2 size={12} className="text-success" aria-hidden="true" />
                  {t('milestone.linked', {
                    code: milestone.programmeMilestone.code,
                    name: milestone.programmeMilestone.name,
                  })}{' '}
                  — {t('milestone.verified')}
                </>
              ) : (
                <>
                  <Clock size={12} aria-hidden="true" />
                  {t('milestone.linked', {
                    code: milestone.programmeMilestone.code,
                    name: milestone.programmeMilestone.name,
                  })}{' '}
                  — {t('milestone.planned')}
                </>
              )}
            </p>
          ) : null}

          {/* CTAs */}
          {milestone.userState === 'review-for-billing' ? (
            <button
              type="button"
              onClick={() => onReviewForBilling(milestone)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-body-sm font-medium text-white hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('cta.reviewForBilling')}
            </button>
          ) : milestone.userState === 'ready-to-bill' ? (
            <div className="mt-1 space-y-2">
              <div>
                <Badge tone="live" className="gap-1 text-caption">
                  <CheckCircle2 size={11} aria-hidden="true" />
                  {t('cta.readyToBill')}
                </Badge>
                <p className="mt-1 text-caption text-muted-foreground">{t('cta.readyNote')}</p>
              </div>
              <button
                type="button"
                onClick={() => onPrepareInvoice(milestone)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-body-sm font-medium text-white hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('cta.prepareInvoice')}
              </button>
            </div>
          ) : milestone.userState === 'invoice-issued' ? (
            <div className="mt-1 space-y-2">
              <Badge tone="info" className="text-caption">
                {t('state.invoice-issued')}
              </Badge>
              <button
                type="button"
                onClick={() => onSendInvoice(milestone)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-3 py-1.5 text-body-sm font-medium text-white hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('cta.sendToClient')}
              </button>
            </div>
          ) : milestone.userState === 'awaiting-payment' ? (
            <AwaitingPaymentDisplay
              milestone={milestone}
              currency={currency}
              locale={locale}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

// ─── Step icon ────────────────────────────────────────────────────────────────

function StepIcon({
  state,
  stepNumber,
}: {
  state: MilestoneUserState;
  stepNumber: number;
}) {
  const isDone =
    state === 'paid' ||
    state === 'partially-paid' ||
    state === 'invoiced' ||
    state === 'awaiting-payment';
  const isCurrent =
    state === 'in-progress' ||
    state === 'review-for-billing' ||
    state === 'ready-to-bill' ||
    state === 'invoice-issued';

  if (isDone) {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10">
        <Check size={13} className="text-success" aria-hidden="true" />
      </span>
    );
  }
  if (isCurrent) {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-brand-primary bg-white">
        <span className="text-[10px] font-bold text-brand-primary">{stepNumber}</span>
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
      <Circle size={8} className="text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

// ─── State badge ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: MilestoneUserState }) {
  const t = useTranslations('commercial.contractMilestones.state');
  const tone = stateTone(state);
  return (
    <Badge tone={tone} className="shrink-0 text-caption">
      {t(state)}
    </Badge>
  );
}

function stateTone(state: MilestoneUserState): BadgeTone {
  switch (state) {
    case 'paid':
      return 'live';
    case 'partially-paid':
      return 'warning';
    case 'awaiting-payment':
      return 'warning';
    case 'invoiced':
      return 'info';
    case 'invoice-issued':
      return 'info';
    case 'ready-to-bill':
      return 'live';
    case 'review-for-billing':
      return 'accent';
    case 'in-progress':
      return 'info';
    case 'upcoming':
    default:
      return 'neutral';
  }
}

// ─── Awaiting-payment display ─────────────────────────────────────────────────

function AwaitingPaymentDisplay({
  milestone,
  currency,
  locale,
  t,
}: {
  milestone: MilestoneItemViewModel;
  currency: string;
  locale: 'en' | 'ar';
  t: ReturnType<typeof useTranslations<'commercial.contractMilestones'>>;
}) {
  const journey = milestone.invoiceJourney;
  const dueDate = journey?.dueDate;
  const formattedDue = dueDate ? (formatDate(dueDate, locale) ?? dueDate) : null;

  const base = milestone.baseAmount ? Number(milestone.baseAmount) : 0;
  const voTotal = milestone.variationAllocations.reduce(
    (sum, vo) => sum + (vo.amount ? Number(vo.amount) : 0),
    0,
  );
  const totalWithVat = ((base + voTotal) * 1.05).toFixed(2);
  const fmtTotal = formatMoney(totalWithVat, currency, locale) ?? totalWithVat;

  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-body-sm font-medium text-foreground">
        {t('cta.awaitingPayment')}
      </p>
      {formattedDue ? (
        <p className="text-body-sm text-muted-foreground">
          {t('cta.dueDate', { date: formattedDue })}
        </p>
      ) : null}
      <p className="text-body-sm font-semibold tabular-nums text-foreground">
        {fmtTotal}
      </p>
    </div>
  );
}

// ─── Money block ──────────────────────────────────────────────────────────────

function MoneyBlock({
  milestone,
  currency,
  locale,
  t,
  isCurrent,
}: {
  milestone: MilestoneItemViewModel;
  currency: string;
  locale: 'en' | 'ar';
  t: ReturnType<typeof useTranslations<'commercial.contractMilestones'>>;
  isCurrent: boolean;
}) {
  if (!milestone.baseAmount) return null;

  const fmtMoney = (amount: string) => formatMoney(amount, currency, locale) ?? amount;

  return (
    <div className="space-y-1">
      {/* Base amount */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-caption text-muted-foreground">{t('journey.baseAmount')}</span>
        <span className="text-body-sm font-medium tabular-nums text-foreground">
          {fmtMoney(milestone.baseAmount)}
        </span>
      </div>

      {/* Variation lines — only on current/billed stages */}
      {(isCurrent || milestone.userState === 'invoiced' || milestone.userState === 'paid' || milestone.userState === 'partially-paid' || milestone.userState === 'awaiting-payment') &&
        milestone.variationAllocations.map((vo) => (
          <div key={vo.variationId} className="flex items-center justify-between gap-4 pl-2">
            <span className="min-w-0 truncate text-caption text-muted-foreground">
              <span className="font-mono">{vo.reference}</span> {vo.title}
            </span>
            {vo.amount ? (
              <span
                className={`shrink-0 text-caption font-medium tabular-nums ${
                  vo.isOmission ? 'text-destructive' : 'text-success'
                }`}
              >
                {vo.isOmission ? '' : '+'}
                {fmtMoney(vo.amount)}
              </span>
            ) : null}
          </div>
        ))}
    </div>
  );
}
