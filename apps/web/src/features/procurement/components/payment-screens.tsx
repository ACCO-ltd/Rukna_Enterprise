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
  Avatar,
  Button,
  cn,
  EmptyState,
  entityTintClass,
  StatusPill,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
  Notice,
  SkeletonRecord,
} from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { Banknote, Plus } from 'lucide-react';

import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';
import type { SavedViewState } from '@erp/types';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';

import { useSupplierPayment, useSupplierPayments, useSuppliers,
  useOpenSupplierPaymentDocument,
} from '../hooks/use-procurement';
import { bankAccountLabel } from '../payment-actions';
import { PAYMENT_LIST_STATE_TONE, paymentListState } from '../payment-list-state';
import type { PaymentDocumentStatus, SupplierPayment } from '../types';
import { AllocationPanel } from './allocation-panel';
import { PaymentActionBar } from './payment-actions-bar';
import { PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';
import { SupplierRefundDialog } from '@/features/supplier-refunds/supplier-refund-dialog';
import { SupplierRefundsPanel } from '@/features/supplier-refunds/supplier-refunds-panel';

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
  const today = todayWireDate();

  // `?projectId=` lets a project link in already narrowed; the filter is applied server-side
  // (`GET /payments?projectId=`), so a payment split across projects still matches.
  const projectFilter = useProjectFilter();
  const view = useListViewState(
    DEFAULT_PAYMENT_SORT,
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const { filters } = view;
  const payments = useSupplierPayments({ projectId: projectId ?? (filters.project || undefined) });
  const suppliers = useSuppliers();

  const supplierNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const supplier of suppliers.data ?? []) map.set(supplier.id, supplier.name);
    return map;
  }, [suppliers.data]);

  const all = useMemo(() => payments.data ?? [], [payments.data]);
  const visible = useMemo(
    () => all.filter((payment) => paymentMatchesFilters(payment, filters)),
    [all, filters],
  );

  const canCreate = can(ACCOUNTING_PERMISSIONS.managePayables);
  const createAction = canCreate ? (
    <Button asChild>
      <Link href="/finance/accounting/payments/new" data-shortcut-new="">
        <Plus size={16} aria-hidden="true" />
        {t('new')}
        <kbd
          className="hidden rounded border border-white/40 px-1 font-mono text-micro md:inline"
          aria-hidden="true"
        >
          N
        </kbd>
      </Link>
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
    {
      key: 'allocation',
      type: 'select',
      label: tList('filterByAllocation'),
      options: [{ value: 'unallocated', label: tList('allocationFilter.unallocated') }],
    },
    ...(projectId
      ? []
      : [
          {
            key: 'project',
            type: 'select' as const,
            label: tList('filterByProject'),
            options: projectFilter.options,
          },
        ]),
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
      exportValue: (payment) => payment.paymentNumber ?? t('unnumbered'),
      render: (payment) => (
        <span
          className={cn(
            'block text-body-sm font-semibold text-brand-primary',
            payment.paymentNumber ? 'font-mono' : 'italic',
          )}
        >
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
      render: (payment) => {
        const name = supplierNames.get(payment.supplierId);
        return name ? (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(payment.supplierId))}
            />
            <span className="block max-w-[16rem] truncate font-medium">{name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        );
      },
    },
    {
      key: 'paymentDate',
      header: t('paymentDate'),
      sortable: true,
      card: 'meta',
      plainValue: (payment) => payment.paymentDate ?? '',
      render: (payment, ctx) => (
        <span className="whitespace-nowrap">
          <bdi>{formatDate(payment.paymentDate, ctx.locale) ?? tc('notAvailable')}</bdi>
        </span>
      ),
    },
    {
      key: 'method',
      header: t('method'),
      plainValue: (payment) => payment.paymentMethod,
      render: (payment) => (
        <span className="text-body-sm text-muted-foreground">{payment.paymentMethod}</span>
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
      render: (payment) => (
        <span className="font-semibold">
          <MoneyDisplay value={payment.totalAmount} />
        </span>
      ),
    },
    {
      key: 'unallocated',
      header: t('unallocated'),
      numeric: true,
      sortable: true,
      plainValue: (payment) => Number(payment.unallocatedAmount),
      render: (payment) => (
        <span
          className={
            toMinorUnits(payment.unallocatedAmount, 2) > 0
              ? 'font-medium text-warning'
              : 'text-muted-foreground'
          }
        >
          <MoneyDisplay value={payment.unallocatedAmount} />
        </span>
      ),
    },
    {
      key: 'status',
      header: tc('status'),
      card: 'status',
      plainValue: (payment) => tList(`listState.${paymentListState(payment)}`),
      render: (payment) => (
        <StatusPill tone={PAYMENT_LIST_STATE_TONE[paymentListState(payment)]}>
          {tList(`listState.${paymentListState(payment)}`)}
        </StatusPill>
      ),
    },
  ];

  const countFor = (viewState: SavedViewState): number | undefined => {
    const f = viewState.filters ?? {};
    if (!projectId && (f.project ?? '') !== (filters.project ?? '')) return undefined;
    return searchRows(
      all.filter((payment) => paymentMatchesFilters(payment, f)),
      viewState.search ?? '',
      columns,
    ).length;
  };
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: tList('views.all'), state: { sort: DEFAULT_PAYMENT_SORT } },
    {
      id: 'drafts',
      label: tList('views.drafts'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_PAYMENT_SORT },
    },
    {
      id: 'approved',
      label: tList('views.approved'),
      state: { filters: { status: 'APPROVED' }, sort: DEFAULT_PAYMENT_SORT },
    },
    {
      id: 'unallocated',
      label: tList('views.unallocated'),
      state: { filters: { allocation: 'unallocated' }, sort: DEFAULT_PAYMENT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const currencies = new Set(all.map((payment) => payment.currencyCode));
  const paidMinor = all
    .filter(
      (payment) => payment.postingStatus === 'POSTED' && payment.documentStatus !== 'CANCELLED',
    )
    .reduce((sum, payment) => sum + toMinorUnits(payment.totalAmount, 2), 0);
  const headerSummary =
    all.length === 0
      ? undefined
      : currencies.size === 1
        ? tList('headerSummary', {
            count: all.length,
            paid: formatMoney(fromMinorUnits(paidMinor, 2), [...currencies][0]) ?? '—',
          })
        : tList('headerCount', { count: all.length });

  const grid = (
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
      columnVisibility
      listState={view.listState}
      savedViews={
        <ListViewsBar
          listKey={projectId ? 'project-payments' : 'payments'}
          builtIns={builtIns}
          current={view.current}
          onApply={view.applyView}
          countFor={countFor}
          label={tList('views.label')}
        />
      }
      exportAs={{ fileName: `payments-${today}`, sheetName: t('title') }}
      shortcuts={
        projectId
          ? undefined
          : {
              onNew: canCreate
                ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
                : undefined,
            }
      }
      searchPlaceholder={tList('searchPlaceholder')}
      searchLabel={tList('search')}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={view.setFilters}
      toolbarActions={projectId ? (createAction ?? undefined) : undefined}
    />
  );

  if (projectId) return grid;
  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={tList('eyebrow')}
        title={tList('pageTitle')}
        summary={headerSummary}
        actions={createAction ?? undefined}
      />
      {grid}
    </div>
  );
}

const DEFAULT_PAYMENT_SORT: SortState = { key: 'paymentDate', direction: 'desc' };

/** Whether a payment passes the list's filters (`project` is applied by the API query). */
export function paymentMatchesFilters(payment: SupplierPayment, filters: FilterValues): boolean {
  if (filters.status && payment.documentStatus !== filters.status) return false;
  if (filters.posting && payment.postingStatus !== filters.posting) return false;
  if (filters.allocation === 'unallocated' && toMinorUnits(payment.unallocatedAmount, 2) <= 0)
    return false;
  return true;
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierPaymentDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const tRefund = useTranslations('procurement.supplierRefund');
  const locale = useLocale() as 'en' | 'ar';

  const { can } = usePermissions();
  const [refundOpen, setRefundOpen] = useState(false);
  const query = useSupplierPayment(id);
  const suppliers = useSuppliers();
  const bankAccounts = useBankAccounts();

  useModuleTrail(query.data ? (query.data.paymentNumber ?? t('unnumbered')) : undefined);

  if (query.isPending) {
    return (
      <SkeletonRecord label={tc('loading')} />
    );
  }

  if (query.isError || !query.data) {
    return <LoadError message={tc('loadFailed')} onRetry={() => void query.refetch()} />;
  }

  const payment: SupplierPayment = query.data;
  const supplier = (suppliers.data ?? []).find((s) => s.id === payment.supplierId);
  const bank = (bankAccounts.data ?? []).find((b) => b.id === payment.bankAccountId);
  // AP-1 — a rejected or cancelled payment is a closed record: nothing left to act on.
  const ended = payment.documentStatus === 'REJECTED' || payment.documentStatus === 'CANCELLED';

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

      {ended ? (
        <Notice tone="historical" title={t(payment.documentStatus === 'REJECTED' ? 'rejectedNotice' : 'cancelledNotice')}>
          {payment.rejectionReason ?? payment.cancellationReason ?? ''}
        </Notice>
      ) : null}
      {ended ? null : <PaymentActionBar payment={payment} />}
      <div className="flex flex-wrap gap-2">
        {payment.postingStatus === 'POSTED' && payment.paymentNumber ? <RemittanceButton paymentId={payment.id} /> : null}
        {/* AP-5 — the supplier paid back money this payment holds unapplied. */}
        {payment.postingStatus === 'POSTED' && Number(payment.unallocatedAmount) > 0 && can(ACCOUNTING_PERMISSIONS.managePayables) ? (
          <Button type="button" variant="outline" onClick={() => setRefundOpen(true)}>
            {tRefund('action')}
          </Button>
        ) : null}
      </div>
      <SupplierRefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        paymentId={payment.id}
        unapplied={payment.unallocatedAmount}
        currencyCode={payment.currencyCode}
      />

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
          value={
            formatMoney(payment.totalAmount, payment.currencyCode, locale) ?? tc('notAvailable')
          }
        />
        <Field
          label={t('allocated')}
          value={
            formatMoney(payment.allocatedAmount, payment.currencyCode, locale) ?? tc('notAvailable')
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

      {ended ? null : <AllocationPanel payment={payment} />}

      <SupplierRefundsPanel paymentId={payment.id} canManage={can(ACCOUNTING_PERMISSIONS.managePayables)} />

      <AttachmentsPanel kind="PAYMENT" ownerId={payment.id} />
    </div>
  );
}

/** Step 4 — the branded remittance advice to send the supplier, once the payment is posted. */
function RemittanceButton({ paymentId }: { paymentId: string }) {
  const t = useTranslations('procurement.payments');
  const open = useOpenSupplierPaymentDocument();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" loading={open.isPending} loadingText={t('remittanceOpening')} onClick={() => open.mutate(paymentId)}>
        {t('remittance')}
      </Button>
      {open.isError ? <p className="text-body-sm text-danger" role="alert">{t('remittanceFailed')}</p> : null}
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
