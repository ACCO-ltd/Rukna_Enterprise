'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Combobox,
  DateRangePicker,
  EmptyState,
  FilterBar,
  FilterField,
  SkeletonTable,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { FileText } from 'lucide-react';
import type { SupplierStatement as SupplierStatementData, SupplierStatementLine } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ReportActions } from '@/features/accounting/components/report-actions';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { useSuppliers } from '@/features/procurement/hooks/use-procurement';
import { apiClient } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

const usd = (amount: string | null) => (amount === null ? '' : (formatMoney(amount, 'USD') ?? amount));

/** AP-3 — `GET /finance/suppliers/:supplierId/statement?from&to`. */
export function getSupplierStatement(supplierId: string, from: string, to: string): Promise<SupplierStatementData> {
  return apiClient<SupplierStatementData>(`/finance/suppliers/${supplierId}/statement?from=${from}&to=${to}`);
}

function thisYear(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 4)}-01-01`, to };
}

function documentHref(line: SupplierStatementLine): string {
  if (line.kind === 'PAYMENT' || line.kind === 'PAYMENT_REVERSAL' || line.kind === 'REFUND' || line.kind === 'REFUND_REVERSAL')
    return `/finance/accounting/payments/${line.documentId}`;
  return `/finance/accounting/bills/${line.documentId}`;
}

/**
 * AP-3 — a supplier's account as the organisation keeps it: every bill, payment and buyer-cash
 * settlement (and each one's reversal), opening on the balance at the start of the period and
 * closing on what is owed — the figure to agree with the statement the supplier sends. Columns
 * follow the ledger: paid (debit), billed (credit). Printable and exportable.
 */
export function SupplierStatement() {
  const t = useTranslations('accounting.supplierStatement');
  const params = useSearchParams();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState(params?.get('supplierId') ?? '');
  const [range, setRange] = useState(() => {
    const fallback = thisYear();
    return { from: params?.get('from') ?? fallback.from, to: params?.get('to') ?? fallback.to };
  });
  const statement = useQuery({
    queryKey: ['finance', 'supplier-statement', supplierId, range.from, range.to],
    queryFn: () => getSupplierStatement(supplierId, range.from, range.to),
    enabled: Boolean(supplierId),
  });
  const supplierOptions = useMemo(
    () => (suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    [suppliers.data],
  );

  const download = (data: SupplierStatementData) =>
    exportCsv(
      reportFilename(`supplier-statement-${data.supplier.code}`, data.from, data.to),
      [t('colDate'), t('colDocument'), t('colKind'), t('colDetails'), t('colPaid'), t('colBilled'), t('colBalance')],
      [
        [data.from, null, t('opening'), null, null, null, Number(data.openingBalance)],
        ...data.lines.map((l) => [
          l.date,
          l.reference,
          t(`kinds.${l.kind}`),
          l.description,
          l.debit === null ? null : Number(l.debit),
          l.credit === null ? null : Number(l.credit),
          Number(l.balance),
        ]),
        [data.to, null, t('closing'), null, Number(data.totals.debits), Number(data.totals.credits), Number(data.closingBalance)],
      ],
    );

  const data = statement.data;

  return (
    <div className="space-y-6">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={data ? t('summary', { supplier: data.supplier.name, from: formatDate(data.from) ?? data.from, to: formatDate(data.to) ?? data.to }) : t('subtitle')}
        actions={data ? <ReportActions onExport={() => download(data)} /> : undefined}
      />

      <div className="print:hidden">
        <FilterBar>
          <FilterField id="statement-supplier" label={t('supplier')} grow>
            <Combobox
              id="statement-supplier"
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
              placeholder={t('supplierPlaceholder')}
              searchPlaceholder={t('supplierSearch')}
              emptyLabel={t('supplierEmpty')}
              loading={suppliers.isPending}
            />
          </FilterField>
          <FilterField id="statement-range" label={t('period')}>
            <DateRangePicker
              id="statement-range"
              fromValue={range.from}
              toValue={range.to}
              onChange={(next) => next.from && next.to && setRange({ from: next.from, to: next.to })}
            />
          </FilterField>
        </FilterBar>
      </div>

      {!supplierId ? (
        <EmptyState icon={<FileText size={20} aria-hidden="true" />} title={t('pickTitle')} description={t('pickBody')} />
      ) : statement.isPending ? (
        <SkeletonTable columns={6} label={t('loading')} />
      ) : statement.isError || !data ? (
        <LoadError message={t('loadFailed')} onRetry={() => void statement.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t('opening')} value={usd(data.openingBalance)} />
            <StatTile label={t('billed')} value={usd(data.totals.credits)} />
            <StatTile label={t('paid')} value={usd(data.totals.debits)} />
            <StatTile
              label={t('closing')}
              value={usd(data.closingBalance)}
              note={[
                Number(data.unapplied) > 0 ? t('unapplied', { amount: usd(data.unapplied) }) : null,
                Number(data.pendingPayments) > 0 ? t('pending', { amount: usd(data.pendingPayments) }) : null,
              ].filter(Boolean).join(' · ') || undefined}
            />
          </div>

          <TableScroll aria-label={t('title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead>{t('colDocument')}</TableHead>
                  <TableHead>{t('colDetails')}</TableHead>
                  <TableHead numeric>{t('colPaid')}</TableHead>
                  <TableHead numeric>{t('colBilled')}</TableHead>
                  <TableHead numeric>{t('colBalance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(data.from)}</TableCell>
                  <TableCell colSpan={4} className="font-medium">{t('opening')}</TableCell>
                  <TableCell numeric className="font-medium tabular-nums">{usd(data.openingBalance)}</TableCell>
                </TableRow>
                {data.lines.map((line, i) => {
                  const href = documentHref(line);
                  return (
                    <TableRow key={`${line.kind}-${line.documentId}-${line.reference ?? ''}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(line.date)}</TableCell>
                      <TableCell>
                        <span className="block font-medium">{t(`kinds.${line.kind}`)}</span>
                        {line.reference ? (
                          <Link href={href} className="font-mono text-caption text-brand-primary underline-offset-2 hover:underline">
                            {line.reference}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{line.description ?? ''}</TableCell>
                      <TableCell numeric className="tabular-nums">{usd(line.debit)}</TableCell>
                      <TableCell numeric className="tabular-nums">{usd(line.credit)}</TableCell>
                      <TableCell numeric className="tabular-nums">{usd(line.balance)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-border">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(data.to)}</TableCell>
                  <TableCell colSpan={2} className="font-semibold">{t('closing')}</TableCell>
                  <TableCell numeric className="font-semibold tabular-nums">{usd(data.totals.debits)}</TableCell>
                  <TableCell numeric className="font-semibold tabular-nums">{usd(data.totals.credits)}</TableCell>
                  <TableCell numeric className="font-semibold tabular-nums">{usd(data.closingBalance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableScroll>
          {data.lines.length === 0 ? <p className="text-body-sm text-muted-foreground">{t('nothingInPeriod')}</p> : null}

          <section aria-labelledby="statement-aging" className="space-y-2">
            <h2 id="statement-aging" className="text-body font-semibold">{t('agingTitle')}</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const).map((key) => (
                <div key={key} className="rounded-panel border border-border bg-surface px-3 py-2">
                  <dt className="text-caption text-muted-foreground">{t(`aging.${key}`)}</dt>
                  <dd className="font-medium tabular-nums">{usd(data.aging[key])}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
