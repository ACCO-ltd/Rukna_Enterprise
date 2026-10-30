'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  cn,
  Progress,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { ClientStatement, ClientStatementLine } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

export const usd = (amount: string | null) => (amount === null ? '' : (formatMoney(amount, 'USD') ?? amount));
const nonZero = (amount: string | null) => amount !== null && Number(amount) !== 0;
const sum = (values: string[]) => values.reduce((s, v) => s + Math.round(Number(v) * 100), 0) / 100;
const INVOICE_HREF = (id: string) => `/finance/accounting/invoices/${id}`;

function documentHref(line: ClientStatementLine): string {
  if (line.kind === 'RECEIPT' || line.kind === 'RECEIPT_REVERSAL' || line.kind === 'REFUND' || line.kind === 'REFUND_REVERSAL')
    return `/receipts/${line.documentId}`;
  return INVOICE_HREF(line.documentId);
}

/** ST-4 — the account contract by contract: value, billed, paid, owed, retention, left to bill. */
export function AccountsTable({ data }: { data: ClientStatement }) {
  const t = useTranslations('accounting.statement');
  const rows = data.accounts;
  if (rows.length === 0) return <p className="text-body-sm text-muted-foreground">{t('noAccounts')}</p>;
  const total = (pick: (r: (typeof rows)[number]) => string) => usd(sum(rows.map(pick)).toFixed(2));
  const anyRetention = rows.some((r) => nonZero(r.retentionHeld));

  return (
    <TableScroll aria-label={t('tabs.accounts')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colAccount')}</TableHead>
            <TableHead numeric>{t('colContractValue')}</TableHead>
            <TableHead>{t('colBilled')}</TableHead>
            <TableHead numeric>{t('colLeftToBill')}</TableHead>
            <TableHead numeric>{t('colInvoiced')}</TableHead>
            <TableHead numeric>{t('colReceived')}</TableHead>
            <TableHead numeric>{t('colAdjusted')}</TableHead>
            <TableHead numeric>{t('colBalanceDue')}</TableHead>
            {anyRetention ? <TableHead numeric>{t('colRetention')}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const billedPct =
              r.contractValue && Number(r.contractValue) > 0
                ? Math.min(100, Math.round((Number(r.billedToDate) / Number(r.contractValue)) * 100))
                : null;
            const adjusted = (Number(r.credited) + Number(r.writtenOff)).toFixed(2);
            return (
              <TableRow key={r.key}>
                <TableCell className="min-w-44">
                  <span className="block font-medium">
                    {r.kind === 'OTHER_SALES' ? t('otherSales') : (r.projectName ?? t('noProject'))}
                  </span>
                  <span className="block text-caption text-muted-foreground">
                    {r.kind === 'CONTRACT'
                      ? [r.contractNumber, t(`contractStatus.${r.contractStatus ?? 'ACTIVE'}` as never)].join(' · ')
                      : r.kind === 'PROJECT'
                        ? t('noContract')
                        : t('invoiceCount', { count: r.invoiceCount })}
                  </span>
                </TableCell>
                <TableCell numeric className="tabular-nums">{r.contractValue ? usd(r.contractValue) : '—'}</TableCell>
                <TableCell className="min-w-36">
                  {billedPct === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="block">
                      <span className="flex justify-between gap-2 text-body-sm tabular-nums">
                        <span>{usd(r.billedToDate)}</span>
                        <span className="text-muted-foreground">{billedPct}%</span>
                      </span>
                      <Progress value={billedPct} size="sm" className="mt-1" label={t('billedOfValue', { percent: billedPct })} />
                    </span>
                  )}
                </TableCell>
                <TableCell numeric className="tabular-nums">{r.leftToBill ? usd(r.leftToBill) : '—'}</TableCell>
                <TableCell numeric className="tabular-nums">{usd(r.invoiced)}</TableCell>
                <TableCell numeric className="tabular-nums">{usd(r.received)}</TableCell>
                <TableCell numeric className="tabular-nums text-muted-foreground">{nonZero(adjusted) ? usd(adjusted) : '—'}</TableCell>
                <TableCell numeric className="tabular-nums">
                  <span className="block font-semibold">{usd(r.balanceDue)}</span>
                  {nonZero(r.overdue) ? (
                    <span className="block text-caption font-medium text-danger">{t('overdueAmount', { amount: usd(r.overdue) })}</span>
                  ) : null}
                </TableCell>
                {anyRetention ? (
                  <TableCell numeric className="tabular-nums">{nonZero(r.retentionHeld) ? usd(r.retentionHeld) : '—'}</TableCell>
                ) : null}
              </TableRow>
            );
          })}
          <TableRow className="border-t-2 border-border font-semibold">
            <TableCell>{t('total')}</TableCell>
            <TableCell numeric className="tabular-nums">{total((r) => r.contractValue ?? '0')}</TableCell>
            <TableCell className="tabular-nums">{total((r) => r.billedToDate ?? '0')}</TableCell>
            <TableCell numeric className="tabular-nums">{total((r) => r.leftToBill ?? '0')}</TableCell>
            <TableCell numeric className="tabular-nums">{total((r) => r.invoiced)}</TableCell>
            <TableCell numeric className="tabular-nums">{total((r) => r.received)}</TableCell>
            <TableCell numeric className="tabular-nums">{usd(sum(rows.flatMap((r) => [r.credited, r.writtenOff])).toFixed(2))}</TableCell>
            <TableCell numeric className="tabular-nums">{total((r) => r.balanceDue)}</TableCell>
            {anyRetention ? <TableCell numeric className="tabular-nums">{total((r) => r.retentionHeld)}</TableCell> : null}
          </TableRow>
        </TableBody>
      </Table>
    </TableScroll>
  );
}

/** ST-4 — every invoice still owed on, most overdue first, then what the client holds with us. */
export function OpenInvoicesTable({ data }: { data: ClientStatement }) {
  const t = useTranslations('accounting.statement');
  const rows = data.openInvoices;
  const owed = sum(rows.map((r) => r.balance));
  const onAccount = Number(data.onAccount);

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t('nothingOwed')}</p>
      ) : (
        <TableScroll aria-label={t('tabs.open')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colInvoice')}</TableHead>
                <TableHead>{t('colFor')}</TableHead>
                <TableHead>{t('colDue')}</TableHead>
                <TableHead numeric>{t('colTotal')}</TableHead>
                <TableHead numeric>{t('colReceived')}</TableHead>
                <TableHead numeric>{t('colAdjusted')}</TableHead>
                <TableHead numeric>{t('colBalance')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={INVOICE_HREF(r.id)} className="whitespace-nowrap font-mono font-medium text-brand-primary hover:underline">
                      {r.invoiceNumber ?? '—'}
                    </Link>
                    <span className="block whitespace-nowrap text-caption text-muted-foreground">{formatDate(r.invoiceDate)}</span>
                  </TableCell>
                  <TableCell className="max-w-80">
                    <span className="block truncate">
                      {r.projectName || r.contractNumber ? [r.projectName, r.contractNumber].filter(Boolean).join(' · ') : (r.label ?? '—')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="whitespace-nowrap">{r.dueDate ? formatDate(r.dueDate) : '—'}</span>
                  </TableCell>
                  <TableCell numeric className="tabular-nums">{usd(r.total)}</TableCell>
                  <TableCell numeric className="tabular-nums">{nonZero(r.received) ? usd(r.received) : '—'}</TableCell>
                  <TableCell numeric className="tabular-nums text-muted-foreground">{nonZero(r.adjusted) ? usd(r.adjusted) : '—'}</TableCell>
                  <TableCell numeric className="font-semibold tabular-nums">{usd(r.balance)}</TableCell>
                  <TableCell>
                    <StatusPill tone={r.daysOverdue > 30 ? 'danger' : r.daysOverdue > 0 ? 'attention' : nonZero(r.received) ? 'progress' : 'neutral'}>
                      {r.daysOverdue > 0
                        ? t('daysOverdue', { count: r.daysOverdue })
                        : nonZero(r.received)
                          ? t('partPaid')
                          : t('notDue')}
                    </StatusPill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      <dl className="ms-auto w-full max-w-sm space-y-1.5 text-body-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('openTotal')}</dt>
          <dd className="tabular-nums">{usd(owed.toFixed(2))}</dd>
        </div>
        {onAccount > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('lessOnAccount')}</dt>
            <dd className="tabular-nums">−{usd(data.onAccount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-border pt-2 text-body font-semibold">
          <dt>{t('balanceDue')}</dt>
          <dd className="tabular-nums">{usd((owed - onAccount).toFixed(2))}</dd>
        </div>
      </dl>

      <section aria-labelledby="statement-aging" className="space-y-2">
        <h3 id="statement-aging" className="text-body-sm font-semibold">{t('agingTitle')}</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const).map((key) => (
            <div
              key={key}
              className={cn(
                'rounded-panel border border-border bg-surface px-3 py-2',
                key !== 'current' && nonZero(data.aging[key]) && 'border-danger/40',
              )}
            >
              <dt className="text-caption text-muted-foreground">{t(`aging.${key}`)}</dt>
              <dd className={cn('font-medium tabular-nums', key !== 'current' && nonZero(data.aging[key]) && 'text-danger')}>
                {usd(data.aging[key])}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** AR-3 — every movement in the period with a running balance. */
export function ActivityTable({ data }: { data: ClientStatement }) {
  const t = useTranslations('accounting.statement');
  return (
    <div className="space-y-3">
      <p className="text-body-sm text-muted-foreground">
        {t('periodLine', {
          from: formatDate(data.from) ?? data.from,
          to: formatDate(data.to) ?? data.to,
          opening: usd(data.openingBalance),
          charged: usd(data.totals.debits),
          paid: usd(data.totals.credits),
          closing: usd(data.closingBalance),
        })}
      </p>
      <TableScroll aria-label={t('tabs.activity')}>
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
            {data.lines.map((line, i) => (
              <TableRow key={`${line.kind}-${line.documentId}-${line.reference ?? ''}-${i}`}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(line.date)}</TableCell>
                <TableCell>
                  <span className="block font-medium">{t(`kinds.${line.kind}`)}</span>
                  {line.reference ? (
                    <Link href={documentHref(line)} className="font-mono text-caption text-brand-primary underline-offset-2 hover:underline">
                      {line.reference}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-72 text-muted-foreground">
                  <span className="block truncate">{line.description ?? ''}</span>
                </TableCell>
                <TableCell numeric className="tabular-nums">{usd(line.debit)}</TableCell>
                <TableCell numeric className="tabular-nums">{usd(line.credit)}</TableCell>
                <TableCell numeric className="tabular-nums">{usd(line.balance)}</TableCell>
              </TableRow>
            ))}
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
    </div>
  );
}
