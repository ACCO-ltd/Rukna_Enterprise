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
  FilterBar,
  FilterField,
  Select,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { ReceiptIcon } from '@phosphor-icons/react';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate, formatMoney } from '@/lib/format';

import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import type { BillDocumentStatus, SupplierBill } from '../types';
import { BillActionBar } from './bill-actions-bar';
import { ClassificationChips } from './classification-chips';
import { BillMatchSummary } from './bill-matching';
import { BillMatchStatusBadge, PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

const BILL_DOC_STATUSES: BillDocumentStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList() {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const bills = useSupplierBills();
  const [docStatus, setDocStatus] = useState<BillDocumentStatus | ''>('');

  const visible = useMemo(() => {
    const all = bills.data ?? [];
    return docStatus ? all.filter((b) => b.documentStatus === docStatus) : all;
  }, [bills.data, docStatus]);

  const columns: GridColumn<SupplierBill>[] = [
    {
      key: 'number',
      header: t('invoiceNumber'),
      sticky: true,
      sortable: true,
      plainValue: (bill) => bill.supplierInvoiceNumber,
      render: (bill) => (
        <span className="font-mono text-caption font-semibold">{bill.supplierInvoiceNumber}</span>
      ),
    },
    {
      key: 'supplier',
      header: tc('supplier'),
      sortable: true,
      plainValue: (bill) => bill.supplier?.name ?? '',
      render: (bill) =>
        bill.supplier ? (
          <span className="block max-w-[18rem] truncate text-sm">
            <span className="font-mono text-xs text-muted-foreground">{bill.supplier.code}</span>
            {' '}
            {bill.supplier.name}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{tc('notAvailable')}</span>
        ),
    },
    {
      key: 'billDate',
      header: t('billDate'),
      sortable: true,
      plainValue: (bill) => bill.billDate,
      render: (bill, ctx) => (
        <span className="text-muted-foreground">{formatDate(bill.billDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: t('dueDate'),
      sortable: true,
      plainValue: (bill) => bill.dueDate,
      render: (bill, ctx) => (
        <span className="text-muted-foreground">{formatDate(bill.dueDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'total',
      header: t('totalAmount'),
      numeric: true,
      sortable: true,
      plainValue: (bill) => Number(bill.totalAmount),
      render: (bill, ctx) => (
        <bdi className="tabular-nums">
          {formatMoney(bill.totalAmount, bill.currencyCode, ctx.locale)}
        </bdi>
      ),
    },
    {
      key: 'status',
      header: tc('status'),
      render: (bill) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ProcurementStatusBadge status={bill.documentStatus} />
          <PostingStatusBadge status={bill.postingStatus} />
        </div>
      ),
    },
    {
      key: 'matchStatus',
      header: t('matchStatus'),
      render: (bill) => {
        const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
        return hasPoLink ? <BillMatchStatusBadge status={bill.matchStatus} /> : (
          <span className="text-xs text-muted-foreground">{tc('notAvailable')}</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Two distinct controlled paths (D6): PO-backed bill that auto-matches on submit,
            and a genuine non-PO bill (utilities, rent, one-off) that never matches. */}
        {can(ACCOUNTING_PERMISSIONS.managePayables) ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/finance/accounting/bills/new?po=1">{t('newPo')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/finance/accounting/bills/new">{t('newNonPo')}</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(bill) => bill.id}
        label={t('title')}
        isLoading={bills.isPending}
        isError={bills.isError}
        errorMessage={tc('loadFailed')}
        rowHref={(bill) => `/finance/accounting/bills/${bill.id}`}
        emptyState={
          (bills.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<ReceiptIcon size={28} aria-hidden="true" />}
              title={t('empty')}
            />
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="bill-doc-status" label={t('filterByStatus')}>
              <Select
                id="bill-doc-status"
                value={docStatus}
                onChange={(value) => setDocStatus(value as BillDocumentStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {BILL_DOC_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={docStatus !== '' ? () => setDocStatus('') : undefined}
      />
    </div>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierBillDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tMatch = useTranslations('procurement.matching');
  const locale = useLocale() as 'en';

  const query = useSupplierBill(id);

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
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('detailTitle', { number: bill.supplierInvoiceNumber })}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ProcurementStatusBadge status={bill.documentStatus} />
          <PostingStatusBadge status={bill.postingStatus} />
          {/* The match badge is only meaningful for a PO-backed bill; a non-PO bill never
              matches, so showing NOT_RUN there would read as an unfinished step (D6). */}
          {hasPoLink ? <BillMatchStatusBadge status={bill.matchStatus} /> : null}
          <span className="text-sm text-muted-foreground">
            {bill.supplier
              ? `${bill.supplier.code} · ${bill.supplier.name}`
              : tc('notAvailable')}
          </span>
        </div>
      </div>

      <BillActionBar bill={bill} />

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
