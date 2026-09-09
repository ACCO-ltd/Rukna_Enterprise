'use client';

import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  LtrValue,
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
import type {
  CommercialAgingBucket,
  CommercialBillingResponse,
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialSummaryResponse,
} from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';

import { useCommercialBilling } from '../hooks/use-commercial';
import { invoiceStatusTone } from '../presentation';
import { PositionBand, type PositionFigure } from './contract-position';
import { PaymentSchedulePanel } from './payment-schedule-panel';
import { PanelLink, SectionCard } from './commercial-ui';
import { errorText } from './commercial-workspace';

/**
 * Billing & Collection — what has been billed, what has been paid, and what is still owed.
 *
 * One accounting rule governs the whole screen: **settlement is measured against the invoice
 * total.** An invoice is VAT-inclusive; a certified amount and a plan installment are not.
 * Comparing a receipt to a pre-VAT figure and calling the result "percent paid" is the specific
 * error this view is built to make impossible, so every ratio here has an invoice total as its
 * denominator and the tax split is stated with its basis named.
 *
 * For a MILESTONE contract the payment schedule is also the billing source, so it stays here —
 * that is where "Generate invoice" lives, gated on the linked programme milestone being verified
 * (CONST-COM-011).
 */
export function BillingCollectionTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.billing');
  const query = useCommercialBilling(projectId);
  const contract = summary.mainContract;

  if (!contract) {
    return (
      <EmptyState
        variant="page"
        title={t('noContractTitle')}
        description={t('noContractHint')}
      />
    );
  }

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('loadFailed')}
        messages={[errorText(query.error, t('loadFailedHint'))]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const billing = query.data;

  return (
    <div className="space-y-4">
      <BillingPositionBand billing={billing} />

      {/* Three small readings across, then the tables full width. A sidebar looked tidier in a
          wireframe and cost the invoice table three of its eight columns at 1440 — the header
          scrolled out of the container before the balance did. Tables get the whole width. */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <CollectionProgressPanel billing={billing} />
        <AgingPanel billing={billing} />
        <UnappliedPanel billing={billing} />
      </div>

      {/* The billing source for a payment-schedule contract. It carries its own generate and
          milestone-link actions, which is why it stays a whole panel rather than a table. */}
      {contract.billingModel === 'MILESTONE' ? (
        <PaymentSchedulePanel projectId={projectId} contractId={contract.id} summary={summary} />
      ) : null}

      <InvoicesPanel billing={billing} />
      <ReceiptsPanel billing={billing} />
    </div>
  );
}

// ─── Position ───────────────────────────────────────────────────────────────────

function BillingPositionBand({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing.position');
  const locale = useLocale() as 'en' | 'ar';
  const { position, currency, financialsVisible } = billing;

  const money = (value: string | null): PositionFigure['value'] =>
    !financialsVisible || value === null ? null : (formatMoney(value, currency, locale) ?? null);
  const blank: PositionFigure['blank'] = financialsVisible ? 'unavailable' : 'restricted';

  return (
    <PositionBand
      title={t('title')}
      currency={currency}
      figures={[
        {
          label: t('invoiced'),
          value: money(position.invoiced),
          blank,
          support: t('postedInvoices', { n: position.postedInvoiceCount }),
        },
        {
          label: t('collected'),
          value: money(position.collected),
          blank,
          support:
            position.collectionRate === null
              ? t('vatInclusive')
              : t('ofInvoiced', { percent: position.collectionRate }),
        },
        { label: t('outstanding'), value: money(position.outstanding), blank },
        {
          label: t('overdue'),
          value: money(position.overdue),
          blank,
          // Overdue is a count of late claims, not a coloured number. The badge on each invoice
          // row is where lateness is asserted; here it is stated plainly with its cause.
          support:
            position.overdueInvoiceCount > 0
              ? t('overdueInvoices', { n: position.overdueInvoiceCount })
              : t('nothingOverdue'),
        },
      ]}
    />
  );
}

function CollectionProgressPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing');
  const locale = useLocale() as 'en' | 'ar';
  const rate = billing.position.collectionRate;

  return (
    <SectionCard title={t('collectionProgress')}>
      {rate === null ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('nothingInvoiced')}</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-h2 font-bold tabular-nums text-foreground">{rate}%</span>
            {/* Green only at full collection. Amber for "most of it" would read as a problem,
                when 83% on a live contract is just the invoicing cycle. */}
            <span
              className={cn(
                'text-caption font-medium',
                rate >= 100 ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {t('collectedOf', {
                collected:
                  formatMoney(billing.position.collected, billing.currency, locale) ?? '—',
                invoiced: formatMoney(billing.position.invoiced, billing.currency, locale) ?? '—',
              })}
            </span>
          </div>
          <span
            className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={rate}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('collectionProgress')}
          >
            <span
              className={cn(
                'block h-full rounded-full',
                rate >= 100 ? 'bg-success' : 'bg-brand-primary',
              )}
              style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
            />
          </span>
          <p className="mt-2 text-caption text-muted-foreground">{t('basisNote')}</p>
        </>
      )}
    </SectionCard>
  );
}

// ─── Invoices ───────────────────────────────────────────────────────────────────

function InvoicesPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing');
  const locale = useLocale() as 'en' | 'ar';

  if (billing.invoices.length === 0) {
    return (
      <SectionCard title={t('invoices')}>
        <div className="flex items-start gap-2.5 py-2">
          <ReceiptText size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-body-sm text-muted-foreground">{t('noInvoices')}</p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('invoices')} bodyClassName="px-0 py-0">
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.invoice')}</TableHead>
              <TableHead>{t('col.source')}</TableHead>
              <TableHead>{t('col.issued')}</TableHead>
              <TableHead>{t('col.due')}</TableHead>
              <TableHead className="text-end">{t('col.total')}</TableHead>
              <TableHead className="text-end">{t('col.paid')}</TableHead>
              <TableHead className="text-end">{t('col.balance')}</TableHead>
              <TableHead>{t('col.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billing.invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} locale={locale} />
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
        {t('vatNote')}
      </p>
    </SectionCard>
  );
}

function InvoiceRow({
  invoice,
  locale,
}: {
  invoice: CommercialInvoiceRow;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial.billing');
  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, invoice.currency, locale) ?? '—');

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        {/* `invoiceNumber` is drawn inside the posting transaction, so every draft is
            unnumbered. Nothing may key a row on it, and the reader is told why it is blank. */}
        <Link
          href={`/finance/accounting/invoices/${invoice.id}`}
          className={cn(
            'inline-flex min-h-11 items-center hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0',
            !invoice.invoiceNumber && 'text-muted-foreground',
          )}
        >
          {invoice.invoiceNumber ? (
            <LtrValue>{invoice.invoiceNumber}</LtrValue>
          ) : (
            t('unnumbered')
          )}
        </Link>
      </TableCell>
      <TableCell className="text-caption text-muted-foreground">
        {invoice.source.label ??
          (invoice.source.kind === 'NONE'
            ? t('source.NONE')
            : t(`source.${invoice.source.kind}`))}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(invoice.invoiceDate, locale) ?? '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className={cn(invoice.daysOverdue > 0 ? 'text-danger' : 'text-muted-foreground')}>
          {formatDate(invoice.dueDate, locale) ?? '—'}
        </span>
        {invoice.daysOverdue > 0 ? (
          <span className="block text-micro text-danger">
            {t('overdueBy', { days: invoice.daysOverdue })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(invoice.totalAmount)}</TableCell>
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {money(invoice.paidAmount)}
      </TableCell>
      <TableCell className="text-end font-medium tabular-nums">
        {money(invoice.outstandingAmount)}
      </TableCell>
      <TableCell>
        <Badge tone={invoiceStatusTone(invoice.status)}>{t(`status.${invoice.status}`)}</Badge>
      </TableCell>
    </TableRow>
  );
}

// ─── Receipts ───────────────────────────────────────────────────────────────────

/**
 * Client payments and where each one went.
 *
 * The allocations are shown under their receipt rather than in a separate table, because the
 * question a reader has is "this $200,000 landed — what did it settle?", and two tables side by
 * side make them join it themselves. Unapplied cash on a receipt is stated on the row: hiding it
 * would make a partly-allocated receipt look fully applied.
 */
function ReceiptsPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing');
  const locale = useLocale() as 'en' | 'ar';

  if (billing.receipts.length === 0) {
    return (
      <SectionCard title={t('receipts')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('noReceipts')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('receipts')} bodyClassName="px-0 py-0">
      <ul className="divide-y divide-border">
        {billing.receipts.map((receipt) => (
          <ReceiptRow key={receipt.id} receipt={receipt} locale={locale} />
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
        {t('receiptsNote')}
      </p>
    </SectionCard>
  );
}

function ReceiptRow({
  receipt,
  locale,
}: {
  receipt: CommercialReceiptRow;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial.billing');
  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, receipt.currency, locale) ?? '—');
  const unapplied = Number(receipt.unallocatedAmount ?? 0) > 0;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-foreground">
            {formatDate(receipt.receiptDate, locale) ?? '—'}
            {receipt.reference ? (
              <LtrValue className="ms-2 font-mono text-caption text-muted-foreground">
                {receipt.reference}
              </LtrValue>
            ) : null}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {receipt.paymentMethod ?? t('methodUnknown')}
          </p>
        </div>
        <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
          {money(receipt.totalAmount)}
        </LtrValue>
      </div>

      <ul className="mt-2 space-y-1">
        {receipt.allocations.map((allocation) => (
          <li
            key={allocation.id}
            className="flex items-baseline justify-between gap-3 text-caption text-muted-foreground"
          >
            <span className="min-w-0 truncate">
              {allocation.invoiceNumber ?? t('unnumbered')}
            </span>
            <LtrValue className="shrink-0 tabular-nums">
              {money(allocation.allocatedAmount)}
            </LtrValue>
          </li>
        ))}
        {unapplied ? (
          <li className="flex items-baseline justify-between gap-3 text-caption text-warning">
            <span>{t('unapplied')}</span>
            <LtrValue className="tabular-nums">{money(receipt.unallocatedAmount)}</LtrValue>
          </li>
        ) : null}
      </ul>
    </li>
  );
}

function UnappliedPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing');
  const locale = useLocale() as 'en' | 'ar';
  const total = billing.clientUnappliedTotal;

  const none = total === null || Number(total) <= 0;

  return (
    <SectionCard
      title={t('unappliedTitle')}
      action={
        // Only when the user can actually perform the allocation. Receipt allocation lives in
        // Accounting — Commercial reports the balance and hands over rather than owning a second
        // allocation interaction that would have to stay in step with the first.
        !none && billing.capabilities.canAllocateReceipt ? (
          <PanelLink href="/receipts">{t('allocate')}</PanelLink>
        ) : null
      }
    >
      {none ? (
        <p className="py-1 text-body-sm text-muted-foreground">{t('noUnapplied')}</p>
      ) : (
        <>
          <p className="text-h3 font-bold tabular-nums text-foreground">
            {formatMoney(total, billing.currency, locale) ?? '—'}
          </p>
          {/* Said plainly, because it is the one figure on this screen that is NOT
              project-scoped: unallocated cash has not been attributed to any contract yet. */}
          <p className="mt-1 text-caption text-muted-foreground">{t('unappliedHint')}</p>
        </>
      )}
    </SectionCard>
  );
}

// ─── Ageing ─────────────────────────────────────────────────────────────────────

const BUCKET_ORDER: CommercialAgingBucket['bucket'][] = [
  'NOT_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_90_PLUS',
];

/**
 * Outstanding balances by how late they are.
 *
 * The buckets and the day counts are the server's, measured against the server clock — whether a
 * client is late is a commercial fact with consequences, and a browser with a skewed clock does
 * not get a vote. Rendered as proportional bars rather than a chart: five numbers and their
 * relative size is the entire message.
 */
function AgingPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing.aging');
  const locale = useLocale() as 'en' | 'ar';

  const buckets = BUCKET_ORDER.map(
    (bucket) =>
      billing.aging.find((b) => b.bucket === bucket) ?? { bucket, amount: null, invoiceCount: 0 },
  );
  const max = Math.max(...buckets.map((b) => Number(b.amount ?? 0)), 0);

  if (max <= 0) {
    return (
      <SectionCard title={t('title')}>
        <p className="py-1 text-body-sm text-muted-foreground">{t('nothingOutstanding')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('title')}>
      <ul className="space-y-2.5">
        {buckets.map((bucket) => {
          const amount = Number(bucket.amount ?? 0);
          const width = max > 0 ? Math.round((amount / max) * 100) : 0;
          const late = bucket.bucket !== 'NOT_DUE' && amount > 0;
          return (
            <li key={bucket.bucket}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption text-muted-foreground">
                  {t(`bucket.${bucket.bucket}`)}
                </span>
                <LtrValue className="text-body-sm font-medium tabular-nums text-foreground">
                  {formatMoney(bucket.amount, billing.currency, locale) ?? '—'}
                </LtrValue>
              </div>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn('block h-full rounded-full', late ? 'bg-warning' : 'bg-brand-primary')}
                  style={{ width: `${width}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
