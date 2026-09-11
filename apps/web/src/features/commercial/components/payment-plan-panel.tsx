'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import type { CommercialSummaryResponse } from '@erp/types';

import { formatMoney } from '@/lib/format';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { paymentInstallmentTone } from '../presentation';
import { formatPercent } from './current-payment-cycle';
import { PanelLink, SectionCard } from './commercial-ui';

/**
 * The negotiated payment plan, read as a live ledger: what each installment is worth and where it
 * has got to.
 *
 * For a MILESTONE contract this is first-class — it *is* the billing mechanism (ADR-023), and a
 * commercial manager reads it the way a measured contract's manager reads the certificate
 * history. The percentages must total exactly 100% (the server enforces it on save), so the
 * footer states the total: a plan that does not reconcile is a contract that cannot be billed in
 * full, and the reader should see that here rather than discover it at the last installment.
 *
 * The row actions live on Billing & Collection, not here. This panel is for reading position;
 * putting "Generate invoice" on six rows would give Overview six primary actions.
 */
export function PaymentPlanPanel({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.paymentPlan');
  const tSchedule = useTranslations('commercial.paymentSchedule');
  const locale = useLocale() as 'en' | 'ar';
  const query = useCommercialCurrentCycle(projectId);

  if (query.isPending) return <Skeleton className="h-72 w-full" />;

  const schedule = query.data?.paymentSchedule ?? null;
  const installments = schedule?.installments ?? [];

  if (installments.length === 0) {
    return (
      <SectionCard title={t('title')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('empty')}</p>
      </SectionCard>
    );
  }

  const currency = schedule?.currency ?? summary.currency;
  const money = (value: string | null) =>
    value === null
      ? summary.financialsVisible
        ? '—'
        : t('restricted')
      : (formatMoney(value, currency, locale) ?? '—');

  // Σ of the stored fractions. Rendered as the plan's own reconciliation, not recomputed policy:
  // the server rejects a plan that does not sum to 1.0000, so anything else here means the data
  // predates that rule and the reader needs to know.
  const totalFraction = installments.reduce((sum, i) => sum + Number(i.percentage), 0);
  const reconciled = Math.abs(totalFraction - 1) < 0.00005;

  const original = summary.contractValue?.originalContractValue ?? null;
  const governing = summary.contractValue?.governingContractValue ?? null;
  const differsFromGoverning =
    original !== null && governing !== null && Number(original) !== Number(governing);

  return (
    <SectionCard
      title={t('title')}
      action={
        <PanelLink href={`/projects/${projectId}/commercial/payment-schedule`}>
          {t('viewFull')}
        </PanelLink>
      }
      bodyClassName="px-0 py-0"
    >
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-end">{t('col.number')}</TableHead>
              <TableHead>{t('col.milestone')}</TableHead>
              <TableHead className="text-end">{t('col.percent')}</TableHead>
              <TableHead className="text-end">{t('col.value')}</TableHead>
              <TableHead>{t('col.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installments.map((installment, index) => (
              <TableRow
                key={installment.id}
                // The focus installment is where the money is right now. A tint rather than a
                // border so the row reads as "current" without looking selected.
                className={cn(installment.status === 'NEXT' && 'bg-brand-primary-subtle/40')}
              >
                <TableCell className="text-end tabular-nums text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell className="font-medium text-foreground">{installment.name}</TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">
                  {formatPercent(installment.percentage)}
                </TableCell>
                <TableCell className="text-end tabular-nums">{money(installment.amount)}</TableCell>
                <TableCell>
                  <Badge tone={paymentInstallmentTone(installment.status)}>
                    {tSchedule(`status.${installment.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5">
        <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('total')}
        </span>
        <span className="flex items-center gap-3 text-body-sm font-semibold tabular-nums text-foreground">
          <span className={cn(!reconciled && 'text-warning')}>
            {formatPercent(String(totalFraction))}
          </span>
          <span>{money(schedule?.contractValue ?? null)}</span>
        </span>
      </div>
      {!reconciled ? (
        <p className="border-t border-border px-4 py-2 text-caption text-warning sm:px-5">
          {t('notReconciled')}
        </p>
      ) : null}

      {/* The plan's shares are of the ORIGINAL contract value, so once a variation is approved
          this total and the governing value on the position band legitimately differ. Both are
          right; saying which is which here is cheaper than a reader deciding one is a bug. */}
      {differsFromGoverning ? (
        <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
          {t('originalBasis')}
        </p>
      ) : null}
    </SectionCard>
  );
}

/**
 * The measured contract's equivalent: how far the certification chain has got, as three counts
 * and the money behind them. A funnel graphic would spend a third of the panel saying what four
 * words already say precisely.
 */
export function CertificationPanel({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const { certification, metrics } = summary;

  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, summary.currency, locale) ?? '—');

  return (
    <SectionCard
      title={t('certification.title')}
      action={
        <PanelLink href={`/projects/${projectId}/commercial/applications`}>
          {t('actions.open')}
        </PanelLink>
      }
    >
      {metrics.certifiedGross.state === 'FAILED' ? (
        <p className="py-2 text-body-sm text-warning">{t('certification.unavailable')}</p>
      ) : (
        <>
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

          <dl className="mt-3 space-y-2">
            <Row label={t('metric.certifiedGross')} value={money(metrics.certifiedGross.amount)} />
            <Row label={t('metric.certifiedNet')} value={money(metrics.certifiedNet.amount)} />
            {/* Certified work nobody has invoiced. The one figure that is nobody's job by
                default, which is why it is called out rather than buried in the chain. */}
            <Row
              label={t('metric.uninvoicedCertified')}
              value={money(metrics.uninvoicedCertified.amount)}
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

function Row({
  label,
  value,
  emphasise,
}: {
  label: string;
  value: string;
  emphasise?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-body-sm font-medium tabular-nums',
          emphasise ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function PaymentPlanOrCertification({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  return summary.mainContract?.billingModel === 'MILESTONE' ? (
    <PaymentPlanPanel projectId={projectId} summary={summary} />
  ) : (
    <CertificationPanel projectId={projectId} summary={summary} />
  );
}
