'use client';

import Link from 'next/link';
import type { CommercialMetric, CommercialSummaryResponse } from '@erp/types';
import { FileText, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, LtrValue, cn } from '@erp/ui';

import { EmptyState } from '@/components/empty-state';
import { ProgressStepper, type Step } from '@/components/progress-stepper';
import { formatDate, formatMoney } from '@/lib/format';

import { contractStatusTone, guaranteeAttentionTone, guaranteeStatusTone } from '../presentation';
import { CommercialActivity } from './commercial-activity';
import { CommercialSummaryStrip } from './commercial-summary-strip';
import { AttentionList, FactRow, PanelError, PanelLink, SectionCard } from './commercial-ui';

/** ADR-017 contract lifecycle. CANCELLED and TERMINATED are exits, not stages. */
const LIFECYCLE = [
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_SIGNATURE',
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
  'CLOSED',
] as const;

const TERMINAL = new Set(['CLOSED', 'CANCELLED', 'TERMINATED']);

/**
 * Commercial Overview.
 *
 * Reading order is the commercial chain itself: what governs the project, what it is worth,
 * what needs doing, then the position — certification on the left, settlement on the right.
 * Nothing here is computed in the browser; every figure and every verdict arrives from
 * `GET /projects/:id/commercial/summary`, which is the only thing that can be authoritative
 * about money.
 */
export function OverviewTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const base = `/projects/${projectId}/commercial`;
  const contract = summary.mainContract;

  if (!contract) {
    const create = summary.attention.find((item) => item.kind === 'NO_MAIN_CONTRACT');
    return (
      <EmptyState
        variant="page"
        icon={<FileText size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
        action={
          create?.actionUrl ? (
            <Button asChild className="min-h-11 sm:min-h-0">
              <Link href={create.actionUrl}>{t('attention.NO_MAIN_CONTRACT.action')}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const isTerminal = TERMINAL.has(contract.status);

  return (
    <div className="space-y-4">
      {/* A closed contract is a record. Say so once, at the top, rather than leaving the user
          to infer it from actions that quietly are not there. */}
      {isTerminal ? (
        <div className="flex items-start gap-2.5 rounded-panel border border-historical/25 bg-historical-subtle px-4 py-3 sm:px-5">
          <Lock size={16} className="mt-0.5 shrink-0 text-historical" aria-hidden="true" />
          <div>
            <p className="text-body-sm font-semibold text-foreground">
              {t(`overview.terminal.${contract.status}`)}
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">{t('overview.terminalHint')}</p>
          </div>
        </div>
      ) : null}

      <CommercialSummaryStrip summary={summary} />

      <SectionCard title={t('overview.attention')}>
        <AttentionList items={summary.attention} />
      </SectionCard>

      {/* min-w-0 on the columns: a grid item defaults to min-width:auto (min-content), so a
          wide child — the lifecycle stepper's min-w-max row — would force the column past the
          viewport and scroll the whole page. min-w-0 lets the column shrink and the stepper's
          own overflow-x-auto contain the scroll. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <MainContractPanel base={base} summary={summary} locale={locale} />
          <CertificationPanel base={base} summary={summary} />
          <RetentionAdvancesPanel base={base} summary={summary} />
        </div>

        <div className="min-w-0 space-y-4">
          <ReceivablesPanel base={base} summary={summary} locale={locale} />
          <GuaranteesPanel base={base} summary={summary} locale={locale} />
          <CommercialActivity items={summary.recentActivity} />
        </div>
      </div>
    </div>
  );
}

// ─── Left column ────────────────────────────────────────────────────────────────

function MainContractPanel({
  base,
  summary,
  locale,
}: {
  base: string;
  summary: CommercialSummaryResponse;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial');
  const contract = summary.mainContract!;
  const stageIndex = LIFECYCLE.indexOf(contract.status as (typeof LIFECYCLE)[number]);

  const steps: Step[] = LIFECYCLE.map((stage, index) => ({
    id: stage,
    label: t(`contractStatus.${stage}`),
    status:
      stageIndex < 0 || index > stageIndex
        ? 'upcoming'
        : index < stageIndex
          ? 'complete'
          : 'current',
  }));

  return (
    <SectionCard
      title={t('mainContract.title')}
      action={<PanelLink href={`${base}/main-contract`}>{t('actions.open')}</PanelLink>}
    >
      <dl>
        <FactRow label={t('mainContract.number')}>
          <LtrValue>{contract.contractNumber}</LtrValue>
        </FactRow>
        <FactRow label={t('mainContract.client')}>{contract.clientName}</FactRow>
        <FactRow label={t('mainContract.status')}>
          <Badge tone={contractStatusTone(contract.status)}>
            {t(`contractStatus.${contract.status}`)}
          </Badge>
        </FactRow>
        <FactRow label={t('mainContract.value')}>
          {contract.contractValue ? (
            <LtrValue>{formatMoney(contract.contractValue, contract.currency, locale)}</LtrValue>
          ) : (
            <RestrictedValue />
          )}
        </FactRow>
        <FactRow label={t('mainContract.effectiveDate')}>
          {formatDate(contract.startDate, locale) ?? t('states.notSet')}
        </FactRow>
        <FactRow label={t('mainContract.completionDate')}>
          {formatDate(contract.expectedEndDate, locale) ?? t('states.notSet')}
        </FactRow>
        <FactRow label={t('mainContract.boqBaseline')}>
          {contract.boqVersionNumber !== null
            ? t('mainContract.boqVersion', { number: contract.boqVersionNumber })
            : t('states.notSet')}
        </FactRow>
        <FactRow label={t('mainContract.billingModel')}>
          {t(`billingModel.${contract.billingModel}`)}
        </FactRow>
      </dl>

      <div className="mt-3 border-t border-border pt-3">
        <ProgressStepper steps={steps} />
      </div>

      {/* The commercial baseline is immutable while the contract governs work. Saying so is
          kinder than an Edit button that answers 409. */}
      {contract.status === 'ACTIVE' ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-caption text-muted-foreground">
          <Lock size={13} aria-hidden="true" />
          {t('mainContract.termsLocked')}
        </p>
      ) : null}
    </SectionCard>
  );
}

function CertificationPanel({ base, summary }: { base: string; summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial');
  const { certification, metrics } = summary;

  return (
    <SectionCard
      title={t('certification.title')}
      action={<PanelLink href={`${base}/applications`}>{t('actions.open')}</PanelLink>}
    >
      {metrics.certifiedGross.state === 'FAILED' ? (
        <PanelError message={t('certification.unavailable')} />
      ) : (
        <>
          {/* The chain as three counts. A funnel graphic would spend a third of the panel to
              say something four words already say precisely. */}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-border bg-border">
            <ChainStep
              label={t('certification.applications')}
              value={certification.applicationsSubmitted}
            />
            <ChainStep
              label={t('certification.certificates')}
              value={certification.effectiveCertificates}
            />
            <ChainStep label={t('certification.invoices')} value={certification.postedInvoices} />
          </div>

          <dl className="mt-3">
            <MetricRow label={t('metric.certifiedGross')} metric={metrics.certifiedGross} />
            <MetricRow label={t('metric.certifiedNet')} metric={metrics.certifiedNet} />
            <MetricRow
              label={t('metric.uninvoicedCertified')}
              metric={metrics.uninvoicedCertified}
              emphasise
            />
          </dl>
        </>
      )}
    </SectionCard>
  );
}

function ChainStep({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-3 py-2.5 text-center">
      <p className="text-h3 font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-micro font-semibold uppercase text-muted-foreground">{label}</p>
    </div>
  );
}

function RetentionAdvancesPanel({
  base,
  summary,
}: {
  base: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const { retention, advances } = summary;

  return (
    <SectionCard
      title={t('retentionAdvances.title')}
      action={<PanelLink href={`${base}/retention-advances`}>{t('actions.viewTerms')}</PanelLink>}
    >
      {/* Terms only. Retention held, released and remaining — and advance recovered and
          outstanding — are deliberately absent: nothing in the system computes them yet, and
          a figure that looks authoritative and is not is worse than no figure at all.
          ADR-017 CONST-COM-005. */}
      <dl>
        {retention ? (
          <>
            <FactRow label={t('retention.rate')}>{percent(retention.retentionRate)}</FactRow>
            <FactRow label={t('retention.cap')}>
              {t('retention.capOfValue', { percent: percent(retention.retentionCap) })}
            </FactRow>
            <FactRow label={t('retention.release')}>
              {t('retention.releaseTerms', {
                pc: percent(retention.retentionSplitOnPC),
                fc: percent(String(1 - Number(retention.retentionSplitOnPC))),
              })}
            </FactRow>
          </>
        ) : (
          <FactRow label={t('retention.rate')}>{t('retention.none')}</FactRow>
        )}

        {advances.length === 0 ? (
          <FactRow label={t('advances.title')}>{t('advances.none')}</FactRow>
        ) : (
          advances.map((advance) => (
            <FactRow key={advance.id} label={t(`advanceType.${advance.advanceType}`)}>
              {advance.percentage
                ? t('advances.percentageOfValue', { percent: percent(advance.percentage) })
                : (advance.amount ?? t('states.notSet'))}
              {' · '}
              {t('advances.recoveryAt', { rate: percent(advance.recoveryRate) })}
            </FactRow>
          ))
        )}
      </dl>
    </SectionCard>
  );
}

// ─── Right column ───────────────────────────────────────────────────────────────

function ReceivablesPanel({
  base,
  summary,
  locale,
}: {
  base: string;
  summary: CommercialSummaryResponse;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial');
  const { metrics, receivables } = summary;
  const rate = receivables.collectionRate;

  return (
    <SectionCard
      title={t('receivables.title')}
      action={<PanelLink href={`${base}/applications`}>{t('actions.view')}</PanelLink>}
    >
      {metrics.invoiced.state === 'FAILED' ? (
        <PanelError message={t('receivables.unavailable')} />
      ) : (
        <>
          <dl>
            <MetricRow label={t('metric.invoiced')} metric={metrics.invoiced} />
            <MetricRow label={t('metric.received')} metric={metrics.received} />
            <MetricRow label={t('metric.outstanding')} metric={metrics.outstanding} />
          </dl>

          {rate !== null ? (
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption text-muted-foreground">
                  {t('receivables.collectionRate')}
                </span>
                <span
                  className={cn(
                    'text-body-sm font-semibold tabular-nums',
                    rate >= 100 ? 'text-success' : 'text-foreground',
                  )}
                >
                  {rate}%
                </span>
              </div>
              {/* Green only at full collection. Amber for "most of it" would read as a
                  problem, when 82% on a live contract is just the invoicing cycle. */}
              <span
                className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={rate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('receivables.collectionRate')}
              >
                <span
                  className={cn(
                    'block h-full rounded-full',
                    rate >= 100 ? 'bg-success' : 'bg-brand-primary',
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
                />
              </span>
            </div>
          ) : null}

          {receivables.outstandingInvoices.length > 0 ? (
            <ul className="mt-3 divide-y divide-border/70 border-t border-border pt-1">
              {receivables.outstandingInvoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <LtrValue className="block text-body-sm font-medium text-foreground">
                      {invoice.invoiceNumber ?? t('receivables.unnumbered')}
                    </LtrValue>
                    <p
                      className={cn(
                        'mt-0.5 text-caption',
                        invoice.daysOverdue > 0 ? 'text-danger' : 'text-muted-foreground',
                      )}
                    >
                      {invoice.daysOverdue > 0
                        ? t('receivables.overdueBy', { days: invoice.daysOverdue })
                        : t('receivables.due', { date: formatDate(invoice.dueDate, locale) ?? '' })}
                    </p>
                  </div>
                  <LtrValue className="shrink-0 text-body-sm font-semibold tabular-nums text-foreground">
                    {formatMoney(invoice.outstandingAmount, invoice.currency, locale)}
                  </LtrValue>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function GuaranteesPanel({
  base,
  summary,
  locale,
}: {
  base: string;
  summary: CommercialSummaryResponse;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial');

  return (
    <SectionCard
      title={t('guarantees.title')}
      action={<PanelLink href={`${base}/guarantees`}>{t('actions.open')}</PanelLink>}
      bodyClassName="px-0 py-0"
    >
      {summary.guarantees.length === 0 ? (
        <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">
          {t('guarantees.none')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {summary.guarantees.map((guarantee) => (
            <li key={guarantee.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-foreground">
                    {guarantee.guaranteeType}
                    {guarantee.reference ? (
                      <LtrValue className="ms-1.5 font-mono text-caption text-muted-foreground">
                        {guarantee.reference}
                      </LtrValue>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {guarantee.issuer} ·{' '}
                    {t('guarantees.expires', {
                      date: formatDate(guarantee.expiryDate, locale) ?? '',
                    })}
                  </p>
                </div>
                <LtrValue className="shrink-0 text-body-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(guarantee.amount, guarantee.currency, locale)}
                </LtrValue>
              </div>

              {/* Lifecycle and attention are different facts and must not merge. A guarantee
                  nearing expiry is still legally ACTIVE; "expiring soon" is a prompt, not a
                  status. ADR-017 is explicit that expiry is an attention state. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={guaranteeStatusTone(guarantee.status)}>
                  {t(`guaranteeStatus.${guarantee.status}`)}
                </Badge>
                {guarantee.attention !== 'NONE' ? (
                  <Badge tone={guaranteeAttentionTone(guarantee.attention)}>
                    {t(`guaranteeAttention.${guarantee.attention}`)}
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────────

function MetricRow({
  label,
  metric,
  emphasise,
}: {
  label: string;
  metric: CommercialMetric;
  emphasise?: boolean;
}) {
  const t = useTranslations('commercial.metricState');
  const locale = useLocale() as 'en' | 'ar';

  const value =
    metric.state === 'RESTRICTED' ? (
      <RestrictedValue />
    ) : metric.state === 'FAILED' ? (
      <span className="font-medium text-warning">{t('FAILED')}</span>
    ) : metric.state === 'UNAVAILABLE' ? (
      <span className="font-normal text-muted-foreground">{t('UNAVAILABLE')}</span>
    ) : (
      <LtrValue className={cn(emphasise && 'text-warning')}>
        {formatMoney(metric.amount, metric.currency, locale) ?? '—'}
      </LtrValue>
    );

  return <FactRow label={label}>{value}</FactRow>;
}

/** Withheld, never zero. A zero would be a different — and false — statement. */
function RestrictedValue() {
  const t = useTranslations('commercial.metricState');
  return (
    <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
      <Lock size={13} aria-hidden="true" />
      {t('RESTRICTED')}
    </span>
  );
}

/** Rates arrive as fractions — 0.05 is 5%. */
function percent(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value)) return rate;
  const scaled = value * 100;
  return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(2)}%`;
}
