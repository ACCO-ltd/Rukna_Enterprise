'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FilterBar, FilterField, Select } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
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

  const invoices = useInvoices();
  // Joined here because `GET /invoices` embeds no client relation. P16 fixed this for supplier
  // bills; AR was not given the same treatment.
  const clients = useClients();
  const [status, setStatus] = useState<InvoiceDocStatus | ''>('');

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients.data ?? []) {
      map.set(client.id, client.name);
    }
    return map;
  }, [clients.data]);

  const visible = useMemo(() => {
    const all = invoices.data ?? [];
    return status ? all.filter((invoice) => invoice.documentStatus === status) : all;
  }, [invoices.data, status]);

  const columns: GridColumn<ClientInvoice>[] = [
    {
      key: 'number',
      header: t('colNumber'),
      sticky: true,
      sortable: true,
      plainValue: (invoice) => invoice.invoiceNumber ?? '',
      render: (invoice) => (
        // Null until the invoice posts — the INV- sequence is drawn inside the posting
        // transaction, so every draft is unnumbered.
        <span className="font-mono text-caption font-semibold">
          {invoice.invoiceNumber ?? t('unnumbered')}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('colDate'),
      sortable: true,
      plainValue: (invoice) => invoice.invoiceDate,
      render: (invoice, ctx) => (
        <span className="text-muted-foreground">{formatDate(invoice.invoiceDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'client',
      header: t('colClient'),
      sortable: true,
      plainValue: (invoice) => clientNames.get(invoice.clientId) ?? '',
      render: (invoice) => (
        <span className="block max-w-[16rem] truncate">
          {clientNames.get(invoice.clientId) ?? invoice.clientId.slice(-8)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (invoice) => (
        <InvoiceStatusBadges
          documentStatus={invoice.documentStatus}
          postingStatus={invoice.postingStatus}
        />
      ),
    },
    {
      key: 'total',
      header: t('colTotal'),
      numeric: true,
      sortable: true,
      plainValue: (invoice) => Number(invoice.totalAmount),
      render: (invoice, ctx) => (
        <bdi className="tabular-nums">
          {formatMoney(invoice.totalAmount, invoice.currencyCode, ctx.locale)}
        </bdi>
      ),
    },
    {
      key: 'outstanding',
      header: t('colOutstanding'),
      numeric: true,
      sortable: true,
      plainValue: (invoice) => Number(invoice.outstandingAmount),
      render: (invoice, ctx) => (
        <bdi className="tabular-nums">
          {formatMoney(invoice.outstandingAmount, invoice.currencyCode, ctx.locale)}
        </bdi>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* `GET /invoices` accepts only `clientId` — no status filter, no date range, no
          pagination — so this narrows what is already loaded rather than re-querying. */}
      <p className="text-xs text-muted-foreground">{t('filterNote')}</p>

      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(invoice) => invoice.id}
        label={t('title')}
        isLoading={invoices.isPending}
        isError={invoices.isError}
        errorMessage={t('loadFailed')}
        rowHref={(invoice) => `/finance/accounting/invoices/${invoice.id}`}
        emptyState={
          (invoices.data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="invoice-status" label={t('filterByStatus')}>
              <Select
                id="invoice-status"
                value={status}
                onChange={(value) => setStatus(value as InvoiceDocStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {DOC_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`docStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => setStatus('')}
      />
    </div>
  );
}
