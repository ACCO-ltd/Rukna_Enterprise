'use client';

/**
 * Supplier bills — read-only list and detail (§12.8's host page).
 *
 * Sprint 4 declared these nav-disabled on #26, which was over-cautious. Only `POST /bills`
 * needs a supplier; `GET /bills` and `GET /bills/:id` work, and §12.8's Matching tab has
 * to hang off a bill detail page that exists.
 *
 * What is genuinely missing:
 *
 *  - **Creating a bill.** Tier B. `POST /bills` is reachable now that suppliers and posting
 *    profiles have endpoints, but only for bills with no purchase order attached: a bill
 *    never records a `purchaseOrderRevisionId` (A14 / #33), so a PO-linked one can never be
 *    matched, skips the match gate entirely, and leaves its commitment stranded at ACCRUED.
 *  - **Posting.** `POST /bills/:id/post` exists and needs an `apAccountCode`. The gate lives
 *    in `canPostBill` and is deliberately stricter than the server (P15).
 *
 * The supplier's name is no longer missing. `supplier-bill.repository.ts:47` selects
 * `{ id, code, name }` on both list and detail (P16, fixed) — note it omits `nameAr`, so an
 * Arabic UI shows the English name here while a purchase order shows the Arabic one (A13).
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { Plus, Receipt } from 'lucide-react';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { formatDate, formatMoney } from '@/lib/format';

import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import type { BillDocumentStatus, BillPostingStatus, SupplierBill } from '../types';
import { BillDocumentHeader } from './bill-actions-bar';
import { ClassificationChips } from './classification-chips';
import { BillMatchSummary } from './bill-matching';
import { BillMatchStatusBadge, PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

const BILL_DOC_STATUSES: BillDocumentStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const BILL_POSTING_STATUSES: BillPostingStatus[] = ['NOT_POSTED', 'PENDING', 'POSTED', 'FAILED', 'REVERSED'];

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList() {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const tPosting = useTranslations('procurement.postingStatus');
  const { can } = usePermissions();

  const bills = useSupplierBills();
  const [filters, setFilters] = useState<FilterValues>({});

  const all = useMemo(() => bills.data ?? [], [bills.data]);
  const visible = useMemo(
    () =>
      all.filter(
        (bill) =>
          (!filters.status || bill.documentStatus === filters.status) &&
          (!filters.posting || bill.postingStatus === filters.posting) &&
          (!filters.supplier || bill.supplierId === filters.supplier),
      ),
    [all, filters],
  );

  // Supplier options come from the bills themselves: a filter offering a supplier with no bills
  // can only ever produce an empty list.
  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const bill of all) {
      if (bill.supplier && !seen.has(bill.supplierId)) seen.set(bill.supplierId, bill.supplier.name);
    }
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [all]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterByStatus'),
      options: BILL_DOC_STATUSES.map((s) => ({ value: s, label: tStatus(s) })),
    },
    {
      key: 'posting',
      type: 'select',
      label: tPosting('axis'),
      options: BILL_POSTING_STATUSES.map((s) => ({ value: s, label: tPosting(s) })),
    },
    { key: 'supplier', type: 'select', label: tc('supplier'), options: supplierOptions },
  ];

  const columns: GridColumn<SupplierBill>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (bill) => [bill.billNumber, bill.supplierInvoiceNumber].filter(Boolean).join(' '),
      // The document number is the row's one link — the grid wraps this cell in it.
      render: (bill) => (
        <span className="block">
          <span className="block font-semibold text-brand-primary">
            {bill.billNumber ?? tStatus('DRAFT')}
          </span>
          <span className="block text-caption font-normal text-muted-foreground">
            {t('supplierRef', { ref: bill.supplierInvoiceNumber })}
          </span>
        </span>
      ),
    },
    {
      key: 'supplier',
      header: tc('supplier'),
      sortable: true,
      card: 'subtitle',
      plainValue: (bill) => bill.supplier?.name ?? '',
      render: (bill) =>
        bill.supplier ? (
          <span className="block max-w-[18rem] truncate font-medium">{bill.supplier.name}</span>
        ) : (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        ),
    },
    {
      key: 'billDate',
      header: t('billDate'),
      sortable: true,
      plainValue: (bill) => bill.billDate,
      render: (bill, ctx) => formatDate(bill.billDate, ctx.locale),
    },
    {
      key: 'dueDate',
      header: t('dueDate'),
      sortable: true,
      card: 'meta',
      plainValue: (bill) => bill.dueDate,
      render: (bill, ctx) => formatDate(bill.dueDate, ctx.locale),
    },
    {
      key: 'total',
      header: t('amount'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (bill) => Number(bill.totalAmount),
      render: (bill) => <MoneyDisplay value={bill.totalAmount} />,
    },
    {
      key: 'status',
      header: tc('status'),
      card: 'status',
      // Document status is the one pill; posting is the quiet second axis beneath it.
      render: (bill) => (
        <span className="flex flex-col items-start gap-1">
          <ProcurementStatusBadge vocabulary="supplierBill" status={bill.documentStatus} />
          <PostingStatusBadge status={bill.postingStatus} />
        </span>
      ),
    },
    {
      key: 'matchStatus',
      header: t('poMatch'),
      card: 'status',
      render: (bill) => {
        // A non-PO bill never matches; "Not run" there would read as an unfinished step (D6).
        const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
        return hasPoLink ? (
          <BillMatchStatusBadge status={bill.matchStatus} />
        ) : (
          <span className="text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{tc('notAvailable')}</span>
          </span>
        );
      },
    },
  ];

  // Two controlled paths (D6): a PO-backed bill that auto-matches on submit — the primary —
  // and a genuine non-PO bill (utilities, rent, one-off) that never matches.
  const createActions = can(ACCOUNTING_PERMISSIONS.managePayables) ? (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href="/finance/accounting/bills/new">{t('newNonPo')}</Link>
      </Button>
      <Button asChild className="gap-1.5">
        <Link href="/finance/accounting/bills/new?po=1">
          <Plus size={16} aria-hidden="true" />
          {t('newPo')}
        </Link>
      </Button>
    </div>
  ) : null;

  return (
    <PlatformDataGrid
      columns={columns}
      data={visible}
      rowKey={(bill) => bill.id}
      label={t('title')}
      isLoading={bills.isPending}
      isError={bills.isError}
      onRetry={() => void bills.refetch()}
      errorMessage={tc('loadFailed')}
      rowHref={(bill) => `/finance/accounting/bills/${bill.id}`}
      emptyState={
        all.length === 0 ? (
          <EmptyState
            icon={<Receipt size={20} aria-hidden="true" />}
            title={t('empty')}
            description={t('emptyHint')}
            action={createActions}
          />
        ) : undefined
      }
      noMatchMessage={t('noMatches')}
      resultLabel={(count) => t('countLabel', { count })}
      pagination={{ defaultPageSize: 25 }}
      defaultSort={{ key: 'billDate', direction: 'desc' }}
      searchPlaceholder={t('searchPlaceholder')}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      toolbarActions={createActions}
    />
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierBillDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tMatch = useTranslations('procurement.matching');
  const locale = useLocale() as 'en';

  const query = useSupplierBill(id);
  const tStatusTrail = useTranslations('procurement.status');
  useModuleTrail(
    query.data ? (query.data.billNumber ?? tStatusTrail(query.data.documentStatus)) : undefined,
  );

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const bill: SupplierBill = query.data;
  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);

  return (
    <div className="space-y-6">
      <BillDocumentHeader bill={bill} />

      {/* Details — a hairline section, not a card wrapper (doctrine §2.1). */}
      <section aria-labelledby="bill-details-heading" className="space-y-4">
        <SectionHeader id="bill-details-heading" title={t('tabDetails')} />

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={t('billDate')}
            value={formatDate(bill.billDate, locale) ?? tc('notAvailable')}
          />
          <Field
            label={t('dueDate')}
            value={formatDate(bill.dueDate, locale) ?? tc('notAvailable')}
          />
          <Field
            label={t('totalAmount')}
            value={formatMoney(bill.totalAmount, bill.currencyCode, locale) ?? ''}
          />
          <Field
            label={t('subtotal')}
            value={formatMoney(bill.subtotal, bill.currencyCode, locale) ?? ''}
          />
          <Field
            label={t('vat')}
            value={formatMoney(bill.vatAmount, bill.currencyCode, locale) ?? ''}
          />
        </dl>

        {bill.lines && bill.lines.length > 0 ? (
          <TableScroll aria-label={t('linesTitle')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-end">{tc('lineNumber')}</TableHead>
                  <TableHead>{tc('description')}</TableHead>
                  <TableHead className="text-end">{tc('quantity')}</TableHead>
                  <TableHead className="text-end">{tc('unitPrice')}</TableHead>
                  <TableHead className="text-end">{t('totalAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                    <TableCell className="text-sm">
                      {line.description}
                      {/* Read-only classification chip (D7). A bill line carries a
                          boqNodeId when it is booked to a cost target; the chip states
                          that a target is set without naming the BOQ path the read model
                          does not send. */}
                      <ClassificationChips
                        className="mt-1.5 flex flex-wrap items-center gap-1.5"
                        hasCostTarget={Boolean(line.boqNodeId)}
                      />
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {line.quantity ?? tc('notAvailable')}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatMoney(line.unitPrice, bill.currencyCode, locale) ??
                        tc('notAvailable')}
                    </TableCell>
                    <TableCell className="text-end font-medium tabular-nums">
                      {formatMoney(line.grossAmount, bill.currencyCode, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        ) : null}
      </section>

      {/* Matching — the auto-match outcome, not a manual tab (D6). Rendered for every bill;
          BillMatchSummary self-suppresses to "not applicable" for a genuine non-PO bill. */}
      <section aria-labelledby="bill-matching-heading" className="space-y-4">
        <SectionHeader id="bill-matching-heading" title={tMatch('title')} />
        <BillMatchSummary bill={bill} />
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
