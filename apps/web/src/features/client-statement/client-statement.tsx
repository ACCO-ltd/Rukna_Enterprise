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
import type { ClientStatement as ClientStatementData, ClientStatementLine } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ReportActions } from '@/features/accounting/components/report-actions';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { useClients } from '@/features/clients/hooks/use-clients';
import { apiClient } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

const usd = (amount: string | null) => (amount === null ? '' : (formatMoney(amount, 'USD') ?? amount));

/** AR-3 — `GET /finance/clients/:clientId/statement?from&to`. */
export function getClientStatement(clientId: string, from: string, to: string): Promise<ClientStatementData> {
  return apiClient<ClientStatementData>(`/finance/clients/${clientId}/statement?from=${from}&to=${to}`);
}

function thisYear(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 4)}-01-01`, to };
}

function documentHref(line: ClientStatementLine): string | null {
  if (line.kind === 'RECEIPT' || line.kind === 'RECEIPT_REVERSAL' || line.kind === 'REFUND' || line.kind === 'REFUND_REVERSAL')
    return `/receipts/${line.documentId}`;
  return `/finance/accounting/invoices/${line.documentId}`;
}

/**
 * AR-3 — a client's statement of account: every invoice, credit note and receipt (and each one's
 * reversal) across all projects and hand-typed sales, opening on the balance at the start of the
 * period and closing on what the client owes. Printable (the app chrome drops out) and exportable.
 */
export function ClientStatement() {
  const t = useTranslations('accounting.statement');
  const params = useSearchParams();
  const clients = useClients();
  const [clientId, setClientId] = useState(params?.get('clientId') ?? '');
  const [range, setRange] = useState(() => {
    const fallback = thisYear();
    return { from: params?.get('from') ?? fallback.from, to: params?.get('to') ?? fallback.to };
  });
  const statement = useQuery({
    queryKey: ['finance', 'client-statement', clientId, range.from, range.to],
    queryFn: () => getClientStatement(clientId, range.from, range.to),
    enabled: Boolean(clientId),
  });
  const clientOptions = useMemo(
    () => (clients.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined })),
    [clients.data],
  );

  const download = (data: ClientStatementData) =>
    exportCsv(
      reportFilename(`statement-${data.client.code ?? data.client.name}`, data.from, data.to),
      [t('colDate'), t('colDocument'), t('colKind'), t('colDetails'), t('colCharged'), t('colPaid'), t('colBalance')],
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
        summary={data ? t('summary', { client: data.client.name, from: formatDate(data.from) ?? data.from, to: formatDate(data.to) ?? data.to }) : t('subtitle')}
        actions={data ? <ReportActions onExport={() => download(data)} /> : undefined}
      />

      <div className="print:hidden">
        <FilterBar>
          <FilterField id="statement-client" label={t('client')} grow>
            <Combobox
              id="statement-client"
              value={clientId}
              onChange={setClientId}
              options={clientOptions}
              placeholder={t('clientPlaceholder')}
              searchPlaceholder={t('clientSearch')}
              emptyLabel={t('clientEmpty')}
              loading={clients.isPending}
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

      {!clientId ? (
        <EmptyState icon={<FileText size={20} aria-hidden="true" />} title={t('pickTitle')} description={t('pickBody')} />
      ) : statement.isPending ? (
        <SkeletonTable columns={6} label={t('loading')} />
      ) : statement.isError || !data ? (
        <LoadError message={t('loadFailed')} onRetry={() => void statement.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t('opening')} value={usd(data.openingBalance)} />
            <StatTile label={t('charged')} value={usd(data.totals.debits)} />
            <StatTile label={t('paid')} value={usd(data.totals.credits)} />
            <StatTile label={t('closing')} value={usd(data.closingBalance)} note={Number(data.onAccount) > 0 ? t('onAccount', { amount: usd(data.onAccount) }) : undefined} />
          </div>

          <TableScroll aria-label={t('title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead>{t('colDocument')}</TableHead>
                  <TableHead>{t('colDetails')}</TableHead>
                  <TableHead numeric>{t('colCharged')}</TableHead>
                  <TableHead numeric>{t('colPaid')}</TableHead>
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
                          href ? (
                            <Link href={href} className="font-mono text-caption text-brand-primary underline-offset-2 hover:underline">
                              {line.reference}
                            </Link>
                          ) : (
                            <span className="font-mono text-caption">{line.reference}</span>
                          )
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
