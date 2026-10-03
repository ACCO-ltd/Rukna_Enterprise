'use client';

/**
 * Supplier payments — list and detail (Tier C).
 *
 * Hosted under `/finance/accounting/payments`, alongside bills, and living in
 * `features/procurement` for the same reason bills do: the dependency runs procurement →
 * accounting and never back.
 *
 * Neither response embeds anything — no supplier, no bank account, no allocations — so both
 * screens join against the lists they already hold. That join is why `useSuppliers` and
 * `useBankAccounts` are called here rather than only in the form.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
} from '@erp/ui';
import { Banknote } from 'lucide-react';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';

import { useSupplierPayment, useSupplierPayments, useSuppliers } from '../hooks/use-procurement';
import { bankAccountLabel } from '../payment-actions';
import type { PaymentDocumentStatus, SupplierPayment } from '../types';
import { AllocationPanel } from './allocation-panel';
import { PaymentActionBar } from './payment-actions-bar';
import { PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

// ─── List ────────────────────────────────────────────────────────────────────────

const DOC_STATUSES: PaymentDocumentStatus[] = [
  'DRAFT',
  'APPROVED',
  'RELEASED',
  'REJECTED',
  'CANCELLED',
];
const POSTING_STATUSES: SupplierPayment['postingStatus'][] = [
  'NOT_POSTED',
  'PENDING',
  'POSTED',
  'REVERSED',
  'FAILED',
];

const detailHref = (payment: SupplierPayment) => `/finance/accounting/payments/${payment.id}`;

/**
 * The supplier payments list, rebuilt onto `PlatformDataGrid` to match the invoices and bills
 * lists (ADR-035): row navigation to the detail, an empty-state CTA, and status filters. The
 * response embeds no supplier, so the name is joined against `GET /suppliers` the screen holds.
 */
export function SupplierPaymentsList({
  projectId,
}: {
  /** ADR-043 Phase 2: fixes the list to payments allocated to a bill of this project. */
  projectId?: string;
} = {}) {
  const t = useTranslations('procurement.payments');
  const tList = useTranslations('procurement.payments.list');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const { can } = usePermissions();

  // `?projectId=` lets a project link in already narrowed; the filter is applied server-side
  // (`GET /payments?projectId=`), so a payment split across projects still matches.
  const projectFilter = useProjectFilter();
  const [filters, setFilters] = useState<FilterValues>((): FilterValues =>
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const payments = useSupplierPayments({ projectId: projectId ?? (filters.project || undefined) });
  const suppliers = useSuppliers();

  const supplierNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers.data ?? []) map.set(supplier.id, supplier.name);
    return map;
  }, [suppliers.data]);

  const all = useMemo(() => payments.data ?? [], [payments.data]);
  const visible = useMemo(
    () =>
      all.filter(
        (payment) =>
          (!filters.status || payment.documentStatus === filters.status) &&
          (!filters.posting || payment.postingStatus === filters.posting),
      ),
    [all, filters],
  );

  const createAction = can(ACCOUNTING_PERMISSIONS.managePayables) ? (
    <Button asChild>
      <Link href="/finance/accounting/payments/new">{t('new')}</Link>
    </Button>
  ) : null;

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: tList('filterByStatus'),
      options: DOC_STATUSES.map((s) => ({ value: s, label: tStatus(s) })),
    },
    {
      key: 'posting',
      type: 'select',
      label: tList('filterByPosting'),
      options: POSTING_STATUSES.map((s) => ({ value: s, label: s })),
    },
    ...(projectId
      ? []
      : [{ key: 'project', type: 'select' as const, label: tList('filterByProject'), options: projectFilter.options }]),
  ];

  const columns: GridColumn<SupplierPayment>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      card: 'title',
      // Null until the payment posts — the PMT- sequence is claimed inside the posting
      // transaction, so every draft is unnumbered. Nothing may key a row on it.
      plainValue: (payment) => payment.paymentNumber ?? '',
      render: (payment) => (
        <span className="block font-mono text-caption font-semibold text-brand-primary">
          {payment.paymentNumber ?? t('unnumbered')}
        </span>
      ),
    },
    {
      key: 'supplier',
      header: tc('supplier'),
      sortable: true,
      card: 'subtitle',
      plainValue: (payment) => supplierNames.get(payment.supplierId) ?? '',
      render: (payment) => (
        <span className="block max-w-[16rem] truncate">
          {supplierNames.get(payment.supplierId) ?? tc('notAvailable')}
        </span>
      ),
    },
    {
      key: 'paymentDate',
      header: t('paymentDate'),
      sortable: true,
      card: 'meta',
      plainValue: (payment) => payment.paymentDate ?? '',
      render: (payment, ctx) => (
        <span className="text-muted-foreground">
          <bdi>{formatDate(payment.paymentDate, ctx.locale) ?? tc('notAvailable')}</bdi>
        </span>
      ),
    },
    {
      key: 'method',
      header: t('method'),
      render: (payment) => (
        <span className="text-sm text-muted-foreground">{payment.paymentMethod}</span>
      ),
    },
    {
      key: 'total',
      header: tList('colTotal'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (payment) => Number(payment.totalAmount),
      // MoneyDisplay formats USD (ADR-024), like the invoices and bills lists it mirrors; the
      // detail page renders the payment's own currency in full.
      render: (payment) => <MoneyDisplay value={payment.totalAmount} />,
    },
    {
      key: 'unallocated',
      header: t('unallocated'),
      numeric: true,
      sortable: true,
      plainValue: (payment) => Number(payment.unallocatedAmount),
      render: (payment) => (
        <span className="text-muted-foreground">
          <MoneyDisplay value={payment.unallocatedAmount} />
        </span>
      ),
    },
    {
      key: 'status',
      header: tc('status'),
      card: 'status',
      render: (payment) => (
        <span className="flex flex-col items-start gap-1">
          <ProcurementStatusBadge vocabulary="payment" status={payment.documentStatus} />
          <PostingStatusBadge showAxis status={payment.postingStatus} />
        </span>
      ),
    },
  ];

  return (
    <PlatformDataGrid
      columns={columns}
      data={visible}
      rowKey={(payment) => payment.id}
      label={t('title')}
      isLoading={payments.isPending}
      isError={payments.isError}
      onRetry={() => void payments.refetch()}
      errorMessage={tc('loadFailed')}
      rowHref={detailHref}
      emptyState={
        all.length === 0 ? (
          <EmptyState
            icon={<Banknote size={20} aria-hidden="true" />}
            title={t('empty')}
            description={tList('emptyHint')}
            action={createAction ?? undefined}
          />
        ) : undefined
      }
      noMatchMessage={tList('noMatches')}
      resultLabel={(count) => tList('count', { count })}
      pagination={{ defaultPageSize: 25 }}
      defaultSort={{ key: 'paymentDate', direction: 'desc' }}
      searchPlaceholder={tList('searchPlaceholder')}
      searchLabel={tList('search')}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      toolbarActions={createAction ?? undefined}
    />
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierPaymentDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';

  const query = useSupplierPayment(id);
  const suppliers = useSuppliers();
  const bankAccounts = useBankAccounts();

  useModuleTrail(query.data ? (query.data.paymentNumber ?? t('unnumbered')) : undefined);

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div
          className="h-64 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const payment: SupplierPayment = query.data;
  const supplier = (suppliers.data ?? []).find((s) => s.id === payment.supplierId);
  const bank = (bankAccounts.data ?? []).find((b) => b.id === payment.bankAccountId);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {payment.paymentNumber ?? t('unnumbered')}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ProcurementStatusBadge vocabulary="payment" status={payment.documentStatus} />
          <PostingStatusBadge showAxis status={payment.postingStatus} />
          <span className="text-sm text-muted-foreground">
            {supplier ? `${supplier.code} · ${supplier.name}` : tc('notAvailable')}
          </span>
        </div>
      </div>

      <PaymentActionBar payment={payment} />

      <dl className="grid gap-4 rounded-panel border border-border bg-surface p-4 shadow-e2 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={t('paymentDate')}
          value={formatDate(payment.paymentDate, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('accountingDate')}
          value={formatDate(payment.accountingDate, locale) ?? tc('notAvailable')}
        />
        <Field label={t('method')} value={payment.paymentMethod} />
        <Field
          label={t('bankAccount')}
          value={bank ? bankAccountLabel(bank) : tc('notAvailable')}
        />
        <Field label={t('bankReference')} value={payment.bankReference ?? tc('notAvailable')} />
        <Field
          label={t('totalAmount')}
          value={formatMoney(payment.totalAmount, payment.currencyCode, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('allocated')}
          value={
            formatMoney(payment.allocatedAmount, payment.currencyCode, locale) ??
            tc('notAvailable')
          }
        />
        <Field
          label={t('unallocated')}
          value={
            formatMoney(payment.unallocatedAmount, payment.currencyCode, locale) ??
            tc('notAvailable')
          }
        />
        <Field label={tc('notes')} value={payment.notes ?? tc('notAvailable')} />
      </dl>

      <AllocationPanel payment={payment} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
