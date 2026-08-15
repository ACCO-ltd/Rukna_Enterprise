'use client';

import type { CommercialApplicationRow, CommercialSummaryResponse } from '@erp/types';
import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { EmptyState } from '@/components/empty-state';
import { formatMoney } from '@/lib/format';
import { useCommercialApplications } from '../hooks/use-commercial';
import { settlementTone } from '../presentation';
import { CommercialSummaryStrip } from './commercial-summary-strip';
import { errorText } from './commercial-workspace';

/** AR-owned invoice, receipt allocation and outstanding truth for this project. */
export function BillingCollectionTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const query = useCommercialApplications(projectId);

  if (query.isPending) return <Skeleton className="h-80 w-full" />;
  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[errorText(query.error, t('states.loadFailedHint'))]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const invoices = query.data.applications.filter((row) => row.invoiceId);
  const readyToInvoice = query.data.applications.find((row) => row.ipcId && !row.invoiceId);
  const money = (value: string | null) =>
    value === null
      ? summary.financialsVisible
        ? t('states.notSet')
        : t('metricState.restricted')
      : formatMoney(value, summary.currency, locale);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-h3 font-semibold text-foreground">{t('billing.title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('billing.subtitle')}</p>
      </div>
      <CommercialSummaryStrip summary={summary} />
      {invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText size={24} aria-hidden="true" />}
          variant="page"
          title={readyToInvoice ? t('billing.readyTitle') : t('billing.emptyTitle')}
          description={readyToInvoice ? t('billing.readyHint') : t('billing.emptyHint')}
          action={
            readyToInvoice && summary.capabilities.canGenerateInvoice ? (
              <Button asChild>
                <Link
                  href={`/contracts/${query.data.contractId}/applications/${readyToInvoice.ipaId}`}
                >
                  {t('cycle.actions.GENERATE_INVOICE')}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-body-sm font-semibold">{t('billing.invoices')}</h3>
          </div>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('billing.col.invoice')}</TableHead>
                  <TableHead>{t('billing.col.source')}</TableHead>
                  <TableHead className="text-end">{t('billing.col.amount')}</TableHead>
                  <TableHead className="text-end">{t('billing.col.received')}</TableHead>
                  <TableHead className="text-end">{t('billing.col.outstanding')}</TableHead>
                  <TableHead>{t('billing.col.status')}</TableHead>
                  <TableHead className="text-end">{t('billing.col.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((row) => (
                  <InvoiceRow key={row.ipaId} row={row} money={money} t={t} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({
  row,
  money,
  t,
}: {
  row: CommercialApplicationRow;
  money: (value: string | null) => string | null;
  t: (key: string) => string;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.invoiceNumber ?? t('applications.draftInvoice')}
      </TableCell>
      <TableCell>{row.applicationRef ?? t('states.notSet')}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.invoicedAmount)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(row.receivedAmount)}</TableCell>
      <TableCell className="text-end font-medium tabular-nums">
        {money(row.outstandingAmount)}
      </TableCell>
      <TableCell>
        <Badge tone={settlementTone(row.settlement)}>{t(`settlement.${row.settlement}`)}</Badge>
      </TableCell>
      <TableCell className="text-end">
        {row.invoiceId ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/finance/accounting/invoices/${row.invoiceId}`}>{t('actions.open')}</Link>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
