'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, FilterBar, FilterField, Select } from '@erp/ui';
import { FileTextIcon } from '@phosphor-icons/react';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useClients } from '@/features/clients/hooks/use-clients';
import { formatDate, formatMoney } from '@/lib/format';

import { useInvoices } from '../hooks/use-invoices';
import type { ClientInvoice, InvoiceDocStatus, PostingStatus } from '../types';
import { InvoiceStatusBadges } from './invoice-status-badges';

const DOC_STATUSES: InvoiceDocStatus[] = ['DRAFT', 'APPROVED', 'CANCELLED'];
const POSTING_STATUSES: PostingStatus[] = ['NOT_POSTED', 'POSTED', 'REVERSED', 'FAILED'];

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
  const [docStatus, setDocStatus] = useState<InvoiceDocStatus | ''>('');
  const [postingStatus, setPostingStatus] = useState<PostingStatus | ''>('');

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients.data ?? []) {
      map.set(client.id, client.name);
    }
    return map;
  }, [clients.data]);

  const visible = useMemo(() => {
    let all = invoices.data ?? [];
    if (docStatus) all = all.filter((inv) => inv.documentStatus === docStatus);
    if (postingStatus) all = all.filter((inv) => inv.postingStatus === postingStatus);
    return all;
  }, [invoices.data, docStatus, postingStatus]);

  const columns: GridColumn<ClientInvoice>[] = [
    {
      key: 'number',
      header: t('colNumber'),
      sticky: true,
      sortable: true,
      plainValue: (invoice) => invoice.invoiceNumber ?? '',
      render: (invoice) => (
        <span className="font-mono text-caption font-semibold">
          {invoice.invoiceNumber ?? t('unnumbered')}
        </span>
      ),
    },
    {
      key: 'source',
      header: t('colSource'),
      sortable: true,
      plainValue: (invoice) => {
        const kindText = t(`sourceKind.${invoice.source.kind}`);
        return invoice.source.label ? `${kindText} · ${invoice.source.label}` : kindText;
      },
      render: (invoice) => {
        const kindText = t(`sourceKind.${invoice.source.kind}`);
        const label = invoice.source.label ? `${kindText} · ${invoice.source.label}` : kindText;
        return <span className="block max-w-[18rem] truncate text-sm text-muted-foreground">{label}</span>;
      },
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

  const hasFilter = docStatus !== '' || postingStatus !== '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

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
            <EmptyState
              icon={<FileTextIcon size={28} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
            />
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="invoice-doc-status" label={t('filterByStatus')}>
              <Select
                id="invoice-doc-status"
                value={docStatus}
                onChange={(value) => setDocStatus(value as InvoiceDocStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {DOC_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`docStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField id="invoice-posting-status" label={t('filterByPostingStatus')}>
              <Select
                id="invoice-posting-status"
                value={postingStatus}
                onChange={(value) => setPostingStatus(value as PostingStatus | '')}
              >
                <option value="">{t('allPostingStatuses')}</option>
                {POSTING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`postingStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={hasFilter ? () => { setDocStatus(''); setPostingStatus(''); } : undefined}
      />
    </div>
  );
}
