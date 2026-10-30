'use client';

/**
 * Supplier payments — list and detail (Tier C; redesigned SP-4).
 *
 * Hosted under `/finance/accounting/payments`, alongside bills, and living in
 * `features/procurement` for the same reason bills do: the dependency runs procurement →
 * accounting and never back.
 *
 * Neither response embeds anything — no supplier, no bank account, no allocations — so both
 * screens join against the lists they already hold. That join is why `useSuppliers` and
 * `useBankAccounts` are called here rather than only in the form.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Avatar,
  Button,
  cn,
  DefinitionList,
  DefinitionRow,
  EmptyState,
  entityTintClass,
  StatusPill,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
  Notice,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  SkeletonRecord,
  StatTile,
} from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { Banknote, ChevronLeft, Plus } from 'lucide-react';

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

import { useSupplierPayment, useSupplierPayments, useSuppliers } from '../hooks/use-procurement';
import { bankAccountLabel } from '../payment-actions';
import { PAYMENT_LIST_STATE_TONE, paymentListState } from '../payment-list-state';
import type { PaymentDocumentStatus, SupplierPayment } from '../types';
import { AllocationPanel } from './allocation-panel';
import { PaymentHeaderActions, useDualControl } from './payment-actions-bar';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';
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
  const tPosting = useTranslations('procurement.postingStatus');
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

  const bankAccounts = useBankAccounts();
  const bankNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of bankAccounts.data ?? []) map.set(account.id, account.accountName);
    return map;
  }, [bankAccounts.data]);

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
      options: POSTING_STATUSES.map((s) => ({ value: s, label: tPosting(s) })),
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
        <span className={cn('block whitespace-nowrap text-body-sm font-semibold text-brand-primary', payment.paymentNumber && 'font-mono')}>
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
      plainValue: (payment) => methodWord(t, payment.paymentMethod),
      render: (payment) => (
        <span className="block text-body-sm">
          <span className="block whitespace-nowrap">{methodWord(t, payment.paymentMethod)}</span>
          {payment.bankReference ? (
            <span className="block font-mono text-caption text-muted-foreground">{payment.bankReference}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'paidFrom',
      header: t('paidFrom'),
      plainValue: (payment) => bankNames.get(payment.bankAccountId) ?? '',
      render: (payment) => (
        <span className="block max-w-[10rem] truncate text-body-sm text-muted-foreground">
          {bankNames.get(payment.bankAccountId) ?? tc('notAvailable')}
        </span>
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
      header: t('heldAsAdvance'),
      numeric: true,
      sortable: true,
      plainValue: (payment) => (holdsAdvance(payment) ? Number(payment.unallocatedAmount) : null),
      // Only a posted payment holds money for the supplier; a draft, reversed or cancelled one holds nothing.
      render: (payment) =>
        holdsAdvance(payment) ? (
          <span className="font-medium text-warning">
            <MoneyDisplay value={payment.unallocatedAmount} />
          </span>
        ) : (
          <span className="text-muted-foreground" aria-hidden="true">—</span>
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
      id: 'toApprove',
      label: tList('views.toApprove'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_PAYMENT_SORT },
    },
    {
      id: 'toPost',
      label: tList('views.toPost'),
      state: { filters: { stage: 'toPost' }, sort: DEFAULT_PAYMENT_SORT },
    },
    {
      id: 'paid',
      label: tList('views.paid'),
      state: { filters: { posting: 'POSTED' }, sort: DEFAULT_PAYMENT_SORT },
    },
    {
      id: 'unallocated',
      label: tList('views.advances'),
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
  const month = today.slice(0, 7);
  const sumOf = (rows: SupplierPayment[], amount: (p: SupplierPayment) => string = (p) => p.totalAmount) =>
    formatMoney(fromMinorUnits(rows.reduce((sum, p) => sum + toMinorUnits(amount(p), 2), 0), 2), 'USD') ?? '—';
  const paidThisMonth = all.filter((p) => p.postingStatus === 'POSTED' && (p.paymentDate ?? '').slice(0, 7) === month);
  const toApprove = all.filter((p) => p.documentStatus === 'DRAFT' && ['NOT_POSTED', 'FAILED'].includes(p.postingStatus));
  const toPost = all.filter((p) => paymentMatchesFilters(p, { stage: 'toPost' }));
  const advances = all.filter(holdsAdvance);
  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={tList('eyebrow')}
        title={tList('pageTitle')}
        summary={headerSummary}
        actions={createAction ?? undefined}
      />
      {all.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={tList('tiles.paidThisMonth')} value={sumOf(paidThisMonth)} note={tList('count', { count: paidThisMonth.length })} />
          <StatTile label={tList('tiles.toApprove')} value={sumOf(toApprove)} note={tList('count', { count: toApprove.length })} />
          <StatTile label={tList('tiles.toPost')} value={sumOf(toPost)} note={tList('count', { count: toPost.length })} />
          <StatTile label={tList('tiles.advances')} value={sumOf(advances, (p) => p.unallocatedAmount)} note={tList('tiles.advancesNote')} />
        </div>
      ) : null}
      {grid}
    </div>
  );
}

const DEFAULT_PAYMENT_SORT: SortState = { key: 'paymentDate', direction: 'desc' };

/** Whether a payment passes the list's filters (`project` is applied by the API query). */
export function paymentMatchesFilters(payment: SupplierPayment, filters: FilterValues): boolean {
  if (filters.status && payment.documentStatus !== filters.status) return false;
  if (filters.posting && payment.postingStatus !== filters.posting) return false;
  if (filters.allocation === 'unallocated' && !holdsAdvance(payment)) return false;
  // Approved (or released) and waiting to be posted.
  if (filters.stage === 'toPost' && !(['APPROVED', 'RELEASED'].includes(payment.documentStatus) && ['NOT_POSTED', 'FAILED'].includes(payment.postingStatus)))
    return false;
  return true;
}

/** A posted payment with money not yet applied to a bill: held for the supplier as an advance. */
export function holdsAdvance(payment: SupplierPayment): boolean {
  return payment.postingStatus === 'POSTED' && toMinorUnits(payment.unallocatedAmount, 2) > 0;
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

/**
 * The payment page (SP-4): number, one status, supplier, date, method and the account paid
 * from, with the amount; the proof and details, the bills it paid, refunds and files; the split
 * of the money and the history in the rail.
 */
export function SupplierPaymentDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.payments');
  const tList = useTranslations('procurement.payments.list');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const query = useSupplierPayment(id);
  const suppliers = useSuppliers();
  const bankAccounts = useBankAccounts();
  const payment = query.data;
  const underDualControl = useDualControl(payment?.bankAccountId ?? '');
  const title = payment ? (payment.paymentNumber ?? t(`titleUnnumbered.${paymentListState(payment)}` as never)) : undefined;
  useModuleTrail(title);

  if (query.isPending) return <SkeletonRecord label={tc('loading')} />;
  if (query.isError || !payment) {
    return <LoadError message={tc('loadFailed')} onRetry={() => void query.refetch()} />;
  }

  const supplier = (suppliers.data ?? []).find((s) => s.id === payment.supplierId);
  const bank = (bankAccounts.data ?? []).find((b) => b.id === payment.bankAccountId);
  const state = paymentListState(payment);
  const posted = payment.postingStatus === 'POSTED';
  const ended = payment.documentStatus === 'REJECTED' || payment.documentStatus === 'CANCELLED';
  const money = (value: string) => formatMoney(value, payment.currencyCode, locale) ?? value;
  const awaitingRelease = underDualControl && payment.documentStatus === 'APPROVED' && !posted;

  return (
    <RecordLayout
      header={
        <RecordHeader
          headingLevel="h2"
          breadcrumb={
            <Link
              href="/finance/accounting/payments"
              className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {t('backToList')}
            </Link>
          }
          title={<span className={cn(payment.paymentNumber && 'font-mono')}>{title}</span>}
          statusPlacement="title"
          status={<StatusPill tone={PAYMENT_LIST_STATE_TONE[state]}>{tList(`listState.${state}`)}</StatusPill>}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
              <span className="font-medium text-foreground">{supplier?.name ?? tc('notAvailable')}</span>
              <span>· {formatDate(payment.paymentDate, locale)}</span>
              <span>· {methodWord(t, payment.paymentMethod)}</span>
              {bank ? <span>· {t('paidFromAccount', { account: `${bank.bankName} ${bank.accountName}` })}</span> : null}
            </span>
          }
          figure={{ label: t('amountPaid'), value: <span className="tabular-nums">{money(payment.totalAmount)}</span> }}
          actions={ended ? undefined : <PaymentHeaderActions payment={payment} />}
        />
      }
      banner={
        ended ? (
          <Notice
            tone="historical"
            title={t(payment.documentStatus === 'REJECTED' ? 'rejectedNotice' : 'cancelledNotice', {
              date: formatDate(payment.rejectedAt ?? payment.cancelledAt ?? null, locale) ?? '',
            })}
          >
            {payment.rejectionReason ?? payment.cancellationReason ?? ''}
          </Notice>
        ) : payment.postingStatus === 'REVERSED' ? (
          <Notice tone="historical" title={t('reversedNotice', { date: formatDate(payment.reversedAt ?? null, locale) ?? '' })}>
            {payment.reversalReason ?? ''}
          </Notice>
        ) : awaitingRelease ? (
          <Notice tone="info" title={t('awaitingReleaseTitle')}>
            {t('releaseDualControlNote')}
          </Notice>
        ) : payment.postingStatus === 'FAILED' ? (
          <Notice tone="danger" title={t('postFailedTitle')}>
            {t('postFailedBody')}
          </Notice>
        ) : null
      }
      rail={<PaymentRail payment={payment} />}
    >
      <RecordPanel title={t('detailsTitle')}>
        <dl className="grid gap-x-8 gap-y-4 text-body-sm sm:grid-cols-2">
          <Field label={t('paidTo')} value={supplier ? `${supplier.name} · ${supplier.code}` : tc('notAvailable')} />
          <Field label={t('paidFrom')} value={bank ? bankAccountLabel(bank) : tc('notAvailable')} />
          <Field label={t('paymentDate')} value={formatDate(payment.paymentDate, locale) ?? '—'} />
          {payment.accountingDate?.slice(0, 10) !== payment.paymentDate?.slice(0, 10) ? (
            <Field label={t('accountingDate')} value={formatDate(payment.accountingDate, locale) ?? '—'} />
          ) : null}
          <Field label={t('method')} value={methodWord(t, payment.paymentMethod)} />
          <Field label={referenceLabel(t, payment.paymentMethod)} value={payment.bankReference ?? t('noReference')} mono={Boolean(payment.bankReference)} />
          {payment.instrumentDate ? <Field label={t('proof.chequeDate')} value={formatDate(payment.instrumentDate, locale) ?? '—'} /> : null}
          {payment.provider ? <Field label={t('proof.provider')} value={t(`providers.${payment.provider}` as never)} /> : null}
          {payment.payeeAccount ? (
            <Field label={t(payment.paymentMethod === 'MOBILE_MONEY' ? 'proof.payeePhone' : 'proof.payeeAccount')} value={payment.payeeAccount} mono />
          ) : null}
          {payment.payeeName ? (
            <Field label={t.has(`proof.nameLabel.${payment.paymentMethod}` as never) ? t(`proof.nameLabel.${payment.paymentMethod}` as never) : t('paidTo')} value={payment.payeeName} />
          ) : null}
          {payment.notes ? <Field label={tc('notes')} value={payment.notes} wide /> : null}
        </dl>
      </RecordPanel>

      <AllocationPanel payment={payment} />

      <SupplierRefundsPanel paymentId={payment.id} canManage={can(ACCOUNTING_PERMISSIONS.managePayables)} />

      <AttachmentsPanel kind="PAYMENT" ownerId={payment.id} />
    </RecordLayout>
  );
}

/** The payment's money: applied to bills, paid back, and still held as an advance; then its history. */
function PaymentRail({ payment }: { payment: SupplierPayment }) {
  const t = useTranslations('procurement.payments');
  const locale = useLocale() as 'en' | 'ar';
  const money = (value: string | number) => formatMoney(String(value), payment.currencyCode, locale) ?? String(value);
  const live = payment.postingStatus !== 'REVERSED' && payment.documentStatus !== 'CANCELLED' && payment.documentStatus !== 'REJECTED';
  const totalMinor = toMinorUnits(payment.totalAmount, 2);
  const appliedMinor = toMinorUnits(payment.allocatedAmount, 2);
  const heldMinor = toMinorUnits(payment.unallocatedAmount, 2);
  const refundedMinor = Math.max(totalMinor - appliedMinor - heldMinor, 0);

  return (
    <>
      <RecordPanel title={t('moneyTitle')}>
        <DefinitionList>
          <DefinitionRow label={t('amountPaid')} numeric>
            {money(payment.totalAmount)}
          </DefinitionRow>
          {live ? (
            <>
              <DefinitionRow label={t('appliedToBills')} numeric>
                {money(fromMinorUnits(appliedMinor, 2))}
              </DefinitionRow>
              {refundedMinor > 0 ? (
                <DefinitionRow label={t('paidBack')} numeric>
                  {money(fromMinorUnits(refundedMinor, 2))}
                </DefinitionRow>
              ) : null}
              <DefinitionRow label={<span className="font-semibold text-foreground">{t('heldAsAdvance')}</span>} numeric tone={heldMinor > 0 ? 'warning' : 'default'}>
                <span className="font-semibold">{money(fromMinorUnits(heldMinor, 2))}</span>
              </DefinitionRow>
            </>
          ) : null}
        </DefinitionList>
      </RecordPanel>

      <RecordPanel title={t('historyTitle')}>
        <DefinitionList>
          <DefinitionRow label={t('recorded')}>{formatDate(payment.createdAt ?? null, locale)}</DefinitionRow>
          {payment.approvedAt ? <DefinitionRow label={t('approvedOn')}>{formatDate(payment.approvedAt, locale)}</DefinitionRow> : null}
          {payment.postedAt ? <DefinitionRow label={t('postedOn')}>{formatDate(payment.postedAt, locale)}</DefinitionRow> : null}
          {payment.reversedAt ? <DefinitionRow label={t('reversedOn')}>{formatDate(payment.reversedAt, locale)}</DefinitionRow> : null}
          {payment.cancelledAt ? <DefinitionRow label={t('cancelledOn')}>{formatDate(payment.cancelledAt, locale)}</DefinitionRow> : null}
          {payment.rejectedAt ? <DefinitionRow label={t('rejectedOn')}>{formatDate(payment.rejectedAt, locale)}</DefinitionRow> : null}
        </DefinitionList>
      </RecordPanel>
    </>
  );
}

type PaymentsT = ReturnType<typeof useTranslations<'procurement.payments'>>;

/** The method as a word; an older code (an award paid "BANK") reads as its nearest method. */
export function methodWord(t: PaymentsT, method: string): string {
  const known = method === 'BANK' ? 'BANK_TRANSFER' : method;
  return t.has(`methods.${known}` as never) ? t(`methods.${known}` as never) : method;
}

/** What the reference is called for each method: cheque number, transfer reference, transaction ID. */
export function referenceLabel(t: PaymentsT, method: string): string {
  const known = method === 'BANK' ? 'BANK_TRANSFER' : method;
  return t.has(`referenceLabel.${known}` as never) ? t(`referenceLabel.${known}` as never) : t('bankReference');
}

function Field({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 whitespace-pre-line break-words text-foreground', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
