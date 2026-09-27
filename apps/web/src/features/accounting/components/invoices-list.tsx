'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
  OverflowGlyph,
  RowActions,
  useToast,
} from '@erp/ui';
import { FileText } from 'lucide-react';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useClients } from '@/features/clients/hooks/use-clients';
import { formatDate } from '@/lib/format';

import { useInvoices, useOpenInvoiceDocument } from '../hooks/use-invoices';
import { isInvoiceOverdue, todayWireDate } from '../invoice-overdue';
import type { ClientInvoice, InvoiceDocStatus, PostingStatus } from '../types';
import { InvoiceDocStatusBadge, InvoicePostingStatusBadge } from './invoice-status-badges';

const DOC_STATUSES: InvoiceDocStatus[] = ['DRAFT', 'APPROVED', 'CANCELLED'];
const POSTING_STATUSES: PostingStatus[] = ['NOT_POSTED', 'PENDING', 'POSTED', 'REVERSED', 'FAILED'];

const detailHref = (invoice: ClientInvoice) => `/finance/accounting/invoices/${invoice.id}`;

/**
 * The client invoice list (ADR-035 list page, ADR-036 pilot).
 *
 * "New invoice" opens a source picker, not a blank form (ADR-037): there is no blank create
 * endpoint — an invoice is raised from a certified IPC, a billing milestone or a separate charge,
 * and its amount is copied from that source. The action is shown only to holders of
 * `manage:receivable`, which every create endpoint requires.
 */
export function InvoicesList() {
  const t = useTranslations('accounting.invoices');
  const tGrid = useTranslations('common.grid');
  const { toast } = useToast();
  const openDocument = useOpenInvoiceDocument();
  const { can } = usePermissions();
  const createAction = can(ACCOUNTING_PERMISSIONS.manageReceivables) ? (
    <Button asChild>
      <Link href="/finance/accounting/invoices/new">{t('newInvoice')}</Link>
    </Button>
  ) : null;

  const invoices = useInvoices();
  // Joined here because `GET /invoices` embeds no client relation.
  const clients = useClients();
  const [filters, setFilters] = useState<FilterValues>({});
  const today = todayWireDate();

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients.data ?? []) map.set(client.id, client.name);
    return map;
  }, [clients.data]);

  const all = useMemo(() => invoices.data ?? [], [invoices.data]);
  const visible = useMemo(
    () =>
      all.filter(
        (inv) =>
          (!filters.status || inv.documentStatus === filters.status) &&
          (!filters.posting || inv.postingStatus === filters.posting) &&
          (!filters.client || inv.clientId === filters.client),
      ),
    [all, filters],
  );

  // Client options are the clients that have invoices — never an option that can only empty the list.
  const clientOptions = useMemo(() => {
    const ids = new Set(all.map((inv) => inv.clientId));
    return [...ids]
      .map((id) => ({ value: id, label: clientNames.get(id) ?? id.slice(-8) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [all, clientNames]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterByStatus'),
      options: DOC_STATUSES.map((s) => ({ value: s, label: t(`docStatus.${s}`) })),
    },
    {
      key: 'posting',
      type: 'select',
      label: t('filterByPostingStatus'),
      options: POSTING_STATUSES.map((s) => ({ value: s, label: t(`postingStatus.${s}`) })),
    },
    { key: 'client', type: 'select', label: t('colClient'), options: clientOptions },
  ];

  const sourceText = (invoice: ClientInvoice) => {
    const kind = t(`sourceKind.${invoice.source.kind}`);
    return invoice.source.label ? `${kind} · ${invoice.source.label}` : kind;
  };

  const columns: GridColumn<ClientInvoice>[] = [
    {
      key: 'number',
      header: t('colInvoice'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (inv) => `${inv.invoiceNumber ?? ''} ${sourceText(inv)}`,
      // The invoice number is the row's one link (the grid wraps this cell); the source says
      // what was billed — a certificate, a milestone, a separate charge.
      render: (inv) => (
        <span className="block">
          <span className="block font-semibold text-brand-primary">
            {inv.invoiceNumber ?? t('unnumbered')}
          </span>
          <span className="block max-w-[16rem] truncate text-caption font-normal text-muted-foreground">
            {sourceText(inv)}
          </span>
        </span>
      ),
    },
    {
      key: 'client',
      header: t('colClient'),
      sortable: true,
      card: 'subtitle',
      plainValue: (inv) => clientNames.get(inv.clientId) ?? '',
      render: (inv) => (
        <span className="block max-w-[16rem] truncate font-medium">
          {clientNames.get(inv.clientId) ?? inv.clientId.slice(-8)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: t('colDueDate'),
      sortable: true,
      card: 'meta',
      plainValue: (inv) => inv.dueDate ?? '',
      render: (inv, ctx) =>
        inv.dueDate ? (
          <span className="block">
            <span className="block">{formatDate(inv.dueDate, ctx.locale)}</span>
            {isInvoiceOverdue(inv, today) ? (
              <span className="block text-caption font-semibold text-danger">{t('overdue')}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'total',
      header: t('colTotal'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (inv) => Number(inv.totalAmount),
      render: (inv) => <MoneyDisplay value={inv.totalAmount} />,
    },
    {
      key: 'outstanding',
      header: t('colBalanceDue'),
      numeric: true,
      sortable: true,
      plainValue: (inv) => Number(inv.outstandingAmount),
      // A cancelled or reversed invoice owes nothing, and a zero there would read as "paid".
      render: (inv) =>
        inv.documentStatus === 'CANCELLED' || inv.postingStatus === 'REVERSED' ? (
          <MoneyDisplay value={null} />
        ) : (
          <MoneyDisplay value={inv.outstandingAmount} />
        ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      card: 'status',
      render: (inv) => (
        <span className="flex flex-col items-start gap-1">
          <InvoiceDocStatusBadge status={inv.documentStatus} />
          <InvoicePostingStatusBadge status={inv.postingStatus} />
        </span>
      ),
    },
  ];

  const copyLink = async (invoice: ClientInvoice) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${detailHref(invoice)}`);
      toast({ title: t('linkCopied'), tone: 'success' });
    } catch {
      toast({ title: t('linkCopyFailed'), tone: 'error' });
    }
  };

  return (
    <PlatformDataGrid
      columns={columns}
      data={visible}
      rowKey={(invoice) => invoice.id}
      label={t('title')}
      isLoading={invoices.isPending}
      isError={invoices.isError}
      onRetry={() => void invoices.refetch()}
      errorMessage={t('loadFailed')}
      rowHref={detailHref}
      rowActions={(invoice) => (
        <RowActions
          overflow={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('rowMenu', { number: invoice.invoiceNumber ?? t('unnumbered') })}
                >
                  <OverflowGlyph />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={detailHref(invoice)}>{t('rowOpen')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    openDocument.mutate(invoice.id, {
                      onError: () => toast({ title: t('viewDocumentFailed'), tone: 'error' }),
                    })
                  }
                >
                  {t('rowOpenPdf')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyLink(invoice)}>{t('rowCopyLink')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      )}
      emptyState={
        all.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} aria-hidden="true" />}
            title={t('empty')}
            description={t('emptyHint')}
            action={createAction ?? undefined}
          />
        ) : undefined
      }
      noMatchMessage={t('noMatches')}
      resultLabel={(count) => t('countLabel', { count })}
      pagination={{ defaultPageSize: 25 }}
      defaultSort={{ key: 'dueDate', direction: 'desc' }}
      searchPlaceholder={t('searchPlaceholder')}
      searchLabel={tGrid('searchLabel')}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      toolbarActions={createAction ?? undefined}
    />
  );
}
