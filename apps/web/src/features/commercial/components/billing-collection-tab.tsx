'use client';

import Link from 'next/link';
import { FileText, LockKeyhole, ReceiptText } from 'lucide-react';
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
  CommercialBillingPackage,
  CommercialBillingPackageInvoice,
  CommercialBillingResponse,
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialSummaryResponse,
} from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { useOpenInvoiceDocument } from '@/features/accounting/hooks/use-invoices';
import { formatDate, formatMoney } from '@/lib/format';

import { useBillingPackages, useCommercialBilling } from '../hooks/use-commercial';
import { invoiceStatusTone } from '../presentation';
import { PositionBand, type PositionFigure } from './contract-position';
import { CashflowChart } from './cashflow-chart';
import { AttentionList, PanelLink, SectionCard } from './commercial-ui';
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
 * For a MILESTONE contract the schedule now lives on its own Payment Schedule tab (§5 P2), which
 * hosts the ledger, "Generate invoice" and the CONST-COM-011 gate; this screen keeps the invoices,
 * receipts and ageing that follow from it.
 *
 * C8 (ADR-030 CD13/CD14) gave the screen a top-down money surface: the **money story** —
 * `Contract value → Invoiced → Collected → Outstanding` composed from the summary's contract value
 * and billing's settlement figures, with approved variations stated distinctly as entitlement — then
 * the **cashflow chart** (cumulative invoiced vs collected) as the hero, then the compact
 * collection/aging/unapplied panels, then the invoice and receipt tables as the audit trail.
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
      {/* Relocated from the retired "Attention & Next Action" card (Payment Schedule): a failed
          reconciliation or an uninvoiced certificate is a billing/collection fact, so it belongs
          on the screen that already owns invoices, receipts and the money position — not on a
          second page-level list competing with the cycle ribbon. Renders nothing when empty. */}
      <AttentionList items={summary.attention} />

      {/* The money story reads Contract value → Invoiced → Collected → Outstanding as one chain,
          composed from the summary's contract value and billing's settlement figures, with approved
          variations stated distinctly beneath it (entitlement, never missing revenue). */}
      <MoneyStory billing={billing} summary={summary} />

      {/* The hero: a collected-vs-invoiced cumulative curve. It sits above the tables because the
          shape of the gap is the first read; the per-document figures below are the audit trail. */}
      <CashflowPanel billing={billing} />

      {/* Two small readings beside the aging bars. A sidebar looked tidier in a wireframe and cost
          the invoice table three of its eight columns at 1440 — so the tables below get the whole
          width, and these compact panels sit under the chart instead. */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <CollectionProgressPanel billing={billing} />
        <AgingPanel billing={billing} />
        <UnappliedPanel billing={billing} />
      </div>

      {/* The grouped stage story (S-VB-7): each milestone stage with its milestone invoice and the
          variations billed alongside it. It precedes the flat invoice/receipt audit tables below
          because the reader wants "what did this stage bill" before the document-by-document list. */}
      <BillingPackagesPanel
        projectId={projectId}
        contractId={contract.id}
        currency={summary.currency ?? contract.currency}
      />

      <InvoicesPanel billing={billing} />
      <ReceiptsPanel billing={billing} />
    </div>
  );
}

// ─── Money story (S-BL-1) ─────────────────────────────────────────────────────────

/**
 * Contract value → Invoiced → Collected → Outstanding, as one coherent chain.
 *
 * Composed, not re-computed: `contractValue` (the governing value) comes from the commercial
 * summary; invoiced / collected / outstanding come from the billing position. The frontend adds
 * nothing up — each figure is a server figure, formatted at the render step. The four together are
 * a sentence read left to right, which is why they share one band rather than four cards.
 *
 * Approved variations sit on their own line below the chain, stated as entitlement. A
 * client-approved-but-not-yet-billed variation is real revenue the client has agreed to; showing it
 * inside "Invoiced" would claim it is billed, and omitting it would read as a leak. The precise
 * per-VO billed/unbilled split arrives with C4–C6 — here we show the approved-variations total
 * distinctly so the reader knows the entitlement exists and is not yet in the billed chain.
 */
function MoneyStory({
  billing,
  summary,
}: {
  billing: CommercialBillingResponse;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.billing.story');
  const tState = useTranslations('commercial.metricState');
  const locale = useLocale() as 'en' | 'ar';
  const { position, currency, financialsVisible } = billing;

  const money = (value: string | null): PositionFigure['value'] =>
    !financialsVisible || value === null ? null : (formatMoney(value, currency, locale) ?? null);
  const blank: PositionFigure['blank'] = financialsVisible ? 'unavailable' : 'restricted';

  // The governing contract value (original + approved variations, ADR-026), or the executed
  // baseline when the variation-derived figure is absent. Either way it is the summary's, not ours.
  const contractValue =
    summary.contractValue?.governingContractValue ?? summary.mainContract?.contractValue ?? null;
  const approvedVariations = summary.contractValue?.approvedVariationsTotal ?? null;
  // Only assert an approved-variations line when there is a non-zero entitlement to state. A
  // restricted user still sees the line (as RESTRICTED); a visible-but-zero one does not, because
  // "approved variations $0" is noise, not information.
  const hasApprovedVariations =
    !financialsVisible || (approvedVariations !== null && Number(approvedVariations) > 0);

  return (
    <div className="space-y-3">
      <PositionBand
        title={t('title')}
        currency={currency}
        figures={[
          {
            label: t('contractValue'),
            value: money(contractValue),
            blank,
            support: t('governingHint'),
          },
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
        ]}
      />

      {hasApprovedVariations ? (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-panel border border-border bg-surface px-4 py-2.5 text-caption text-muted-foreground sm:px-5">
          <span className="font-medium text-foreground">{t('approvedVariations')}</span>
          <LtrValue className="font-semibold tabular-nums text-foreground">
            {money(approvedVariations) ?? (
              <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                <LockKeyhole size={13} aria-hidden="true" />
                {tState('RESTRICTED')}
              </span>
            )}
          </LtrValue>
          <span>· {t('approvedVariationsHint')}</span>
        </p>
      ) : null}
    </div>
  );
}

// ─── Cashflow chart (S-BL-2) ────────────────────────────────────────────────────

/**
 * The hero panel: the cumulative invoiced-vs-collected curve, or an honest empty-state.
 *
 * The chart itself refuses to draw without invoices (it returns null), so the empty-state lives
 * here in the panel rather than as a broken axis. A withheld-money user sees the empty-state's
 * restricted note, never a chart plotted from nulls.
 */
function CashflowPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing.cashflow');

  const empty = !billing.financialsVisible || billing.invoices.length === 0;

  return (
    <SectionCard title={t('title')}>
      {empty ? (
        <p className="py-2 text-body-sm text-muted-foreground">
          {!billing.financialsVisible ? t('restricted') : t('empty')}
        </p>
      ) : (
        <CashflowChart
          invoices={billing.invoices}
          receipts={billing.receipts}
          currency={billing.currency}
        />
      )}
    </SectionCard>
  );
}

// ─── Billing Packages (S-VB-7) ────────────────────────────────────────────────────

/**
 * Stage billing — each milestone stage told as a group.
 *
 * A Billing Package answers "what did this stage bill" in one block: the milestone invoice, then
 * every variation billed alongside it (an addition on its own invoice; an omission netted into the
 * stage, so it has no separate invoice), then the presented total (milestone + Σ addition invoices;
 * an omission is not counted again). The panel is absent entirely when there are no packages — a
 * MEASURED_IPC contract has none, and an empty "Stage billing" card would be noise, not information.
 *
 * Money is redacted (RESTRICTED, never $0) whenever `financialsVisible === false`, mirroring the
 * money-null pattern the rest of this screen uses.
 */
function BillingPackagesPanel({
  projectId,
  contractId,
  currency,
}: {
  projectId: string;
  contractId: string;
  currency: string | null;
}) {
  const t = useTranslations('commercial.billing.packages');
  const query = useBillingPackages(projectId, contractId);

  // Silent while loading and on error — this is a supplementary grouping over invoices that are
  // already shown in full in the audit tables below, so it must never take the screen down.
  const data = query.data;
  if (!data || data.packages.length === 0) return null;

  return (
    <SectionCard title={t('title')} bodyClassName="px-0 py-0">
      <ul className="divide-y divide-border">
        {data.packages.map((pkg) => (
          <BillingPackageBlock
            key={pkg.installmentId}
            pkg={pkg}
            financialsVisible={data.financialsVisible}
            currency={currency}
          />
        ))}
      </ul>
    </SectionCard>
  );
}

function BillingPackageBlock({
  pkg,
  financialsVisible,
  currency,
}: {
  pkg: CommercialBillingPackage;
  financialsVisible: boolean;
  currency: string | null;
}) {
  const t = useTranslations('commercial.billing.packages');
  const tState = useTranslations('commercial.metricState');
  const locale = useLocale() as 'en' | 'ar';

  // Money is redacted (RESTRICTED, never $0) when the caller cannot view financials.
  const money = (value: string | null) =>
    !financialsVisible
      ? tState('RESTRICTED')
      : value === null
        ? '—'
        : (formatMoney(value, currency, locale) ?? '—');

  return (
    <li className="px-4 py-3 sm:px-5">
      <p className="text-body-sm font-semibold text-foreground">
        {t('stageTitle', { name: pkg.installmentName })}
      </p>

      <ul className="mt-2 space-y-1.5">
        {/* The milestone invoice line — always the first line of the stage story. */}
        {pkg.milestoneInvoice ? (
          <PackageLine
            label={t('milestone')}
            invoice={pkg.milestoneInvoice}
            amount={pkg.milestoneInvoice.totalAmount}
            money={money}
            statusLabel={pkg.milestoneInvoice.invoiceNumber ?? t('unnumbered')}
          />
        ) : null}

        {/* Then each variation billed alongside it. An addition links to its own invoice; an
            omission has no separate invoice (it lives on the milestone stage), so it shows its
            treatment label instead of a number. */}
        {pkg.variationLines.map((line) => (
          <PackageLine
            key={line.variationId}
            label={`${line.reference} — ${line.title}`}
            invoice={line.treatment === 'INVOICE' ? line.invoice : null}
            amount={line.allocationAmount}
            money={money}
            statusLabel={
              line.treatment === 'INVOICE'
                ? (line.invoice?.invoiceNumber ?? t('unnumbered'))
                : t(`treatment.${line.treatment}`)
            }
          />
        ))}
      </ul>

      <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-border/70 pt-2">
        <span className="text-caption font-medium text-muted-foreground">{t('presentedTotal')}</span>
        <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
          {money(pkg.presentedTotal)}
        </LtrValue>
      </p>
    </li>
  );
}

function PackageLine({
  label,
  invoice,
  amount,
  money,
  statusLabel,
}: {
  label: string;
  invoice: CommercialBillingPackageInvoice | null;
  amount: string | null;
  money: (value: string | null) => string;
  statusLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-caption">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        {invoice ? (
          <Link
            href={`/finance/accounting/invoices/${invoice.id}`}
            className="font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            <LtrValue>{statusLabel}</LtrValue>
          </Link>
        ) : (
          <span className="text-muted-foreground">{statusLabel}</span>
        )}
        <LtrValue className="tabular-nums text-foreground">{money(amount)}</LtrValue>
      </span>
    </li>
  );
}

// ─── Collection progress ──────────────────────────────────────────────────────────

function CollectionProgressPanel({ billing }: { billing: CommercialBillingResponse }) {
  const t = useTranslations('commercial.billing');
  const tPos = useTranslations('commercial.billing.position');
  const locale = useLocale() as 'en' | 'ar';
  const rate = billing.position.collectionRate;
  const { overdue, overdueInvoiceCount } = billing.position;
  const overdueAmount =
    billing.financialsVisible && overdue !== null
      ? formatMoney(overdue, billing.currency, locale)
      : null;

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
          {/* Overdue lives here rather than as a fifth link in the money-story chain — it is a
              signal about the outstanding balance, not a new stage in Contract→Invoiced→Collected.
              Stated plainly with its count; the alarm colour is carried per-invoice, not on a total. */}
          {overdueInvoiceCount > 0 ? (
            <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-border/70 pt-2 text-caption">
              <span className="text-muted-foreground">
                {tPos('overdueInvoices', { n: overdueInvoiceCount })}
              </span>
              <LtrValue className="font-medium tabular-nums text-danger">
                {overdueAmount ?? '—'}
              </LtrValue>
            </p>
          ) : null}
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
  const openDocument = useOpenInvoiceDocument();
  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, invoice.currency, locale) ?? '—');

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        <div className="flex items-center gap-1.5">
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('viewDocument')}
            className="shrink-0"
            disabled={openDocument.isPending}
            onClick={() => openDocument.mutate(invoice.id)}
          >
            <FileText size={14} aria-hidden="true" />
          </Button>
        </div>
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
