'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  FormField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { useClients } from '@/features/clients/hooks/use-clients';
import { formatDate, formatMoney } from '@/lib/format';

import { useInvoices } from '../hooks/use-invoices';
import type { ClientInvoice, InvoiceDocStatus } from '../types';
import { InvoiceStatusBadges } from './invoice-status-badges';

const DOC_STATUSES: InvoiceDocStatus[] = ['DRAFT', 'APPROVED', 'CANCELLED'];

/**
 * Read-only by design.
 *
 * There is no blank create endpoint — `POST /invoices/from-ipc` is the only way an invoice
 * exists — so a "New invoice" button here would have to open a certificate picker, and the
 * certificate page is where someone already is when the certificate becomes effective. The
 * action lives there instead.
 */
export function InvoicesList() {
  const t = useTranslations('accounting.invoices');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const invoices = useInvoices();
  // Joined here because `GET /invoices` embeds no client relation. P16 fixed this for supplier
  // bills; AR was not given the same treatment.
  const clients = useClients();
  const [status, setStatus] = useState<InvoiceDocStatus | ''>('');

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients.data ?? []) {
      map.set(client.id, (locale === 'ar' ? (client.nameAr ?? client.name) : client.name));
    }
    return map;
  }, [clients.data, locale]);

  const visible = useMemo(() => {
    const all = invoices.data ?? [];
    return status ? all.filter((invoice) => invoice.documentStatus === status) : all;
  }, [invoices.data, status]);

  if (invoices.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (invoices.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {invoices.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
            <FormField htmlFor="invoice-status" label={t('filterByStatus')} className="sm:w-56">
              <Select
                id="invoice-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceDocStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {DOC_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`docStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            {/* `GET /invoices` accepts only `clientId` — no status filter, no date range, no
                pagination — so this narrows what is already loaded rather than re-querying. */}
            <p className="text-xs text-muted-foreground sm:pb-3">{t('filterNote')}</p>
          </div>

          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('countLabel', { count: visible.length })}
          </p>

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
            </div>
          ) : (
            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colNumber')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="min-w-[160px]">{t('colClient')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead numeric>{t('colTotal')}</TableHead>
                    <TableHead numeric>{t('colOutstanding')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      clientName={clientNames.get(invoice.clientId)}
                      locale={locale}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceRow({
  invoice,
  clientName,
  locale,
}: {
  invoice: ClientInvoice;
  clientName: string | undefined;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('accounting.invoices');

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/finance/accounting/invoices/${invoice.id}`}
          className="font-mono text-sm text-brand-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          {/* Null until the invoice posts — the INV- sequence is drawn inside the posting
              transaction, so every draft is unnumbered and the link cannot key on it. */}
          {invoice.invoiceNumber ?? t('unnumbered')}
        </Link>
      </TableCell>

      <TableCell>
        <span className="text-sm text-muted-foreground">
          {formatDate(invoice.invoiceDate, locale)}
        </span>
      </TableCell>

      <TableCell className="min-w-[160px] max-w-[260px]">
        <span className="line-clamp-2 text-sm text-foreground">
          {clientName ?? invoice.clientId.slice(-8)}
        </span>
      </TableCell>

      <TableCell>
        <InvoiceStatusBadges
          documentStatus={invoice.documentStatus}
          postingStatus={invoice.postingStatus}
        />
      </TableCell>

      <TableCell numeric>
        <bdi className="tabular-nums">
          {formatMoney(invoice.totalAmount, invoice.currencyCode, locale)}
        </bdi>
      </TableCell>

      <TableCell numeric>
        <bdi className="tabular-nums">
          {formatMoney(invoice.outstandingAmount, invoice.currencyCode, locale)}
        </bdi>
      </TableCell>
    </TableRow>
  );
}
