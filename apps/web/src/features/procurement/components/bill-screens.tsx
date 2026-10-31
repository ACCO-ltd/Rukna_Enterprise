'use client';

/**
 * Supplier bills — the list and the bill page (SB-2).
 *
 * The list opens on what is owed: unpaid, overdue and due-this-week totals over the grid, and
 * views for each step a bill waits on. One New bill button; the form asks whether the bill is
 * against a purchase order.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Avatar,
  Button,
  cn,
  entityTintClass,
  StatusPill,
  StatTile,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  DefinitionList,
  DefinitionRow,
  DocumentTabs,
  MoneyDisplay,
  RecordPanel,
  SectionHeader,
  SkeletonRecord,
  TotalsBlock,
} from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { Plus, Receipt } from 'lucide-react';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
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
import { formatDate, formatMoney } from '@/lib/format';

import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';

import { isSettleableBill } from '../bill-actions';
import {
  BILL_LIST_STATE_TONE,
  billDaysLate,
  billListState,
  isBillOverdue,
} from '../bill-list-state';
import { useSupplierBill, useSupplierBillPayments, useSupplierBills } from '../hooks/use-procurement';
import { useDebitNotes } from '@/features/debit-notes/debit-notes';
import type { BillDocumentStatus, BillPostingStatus, SupplierBill } from '../types';
import { BillDocumentHeader } from './bill-actions-bar';
import { BillEligibilityPanel } from './bill-eligibility-panel';
import { DebitNotesPanel } from '@/features/debit-notes/debit-notes-panel';
import { BillEvidence } from './bill-evidence';
import {
  BillActivityTab,
  BillApprovalsTab,
  BillJournalTab,
  BillLinesTab,
  useBillActivityCount,
  useBillApprovalCount,
  useBillFacts,
  useBillTotals,
} from './bill-document-body';
import { BillMatchSummary } from './bill-matching';
import { BillMatchStatusBadge } from './procurement-badges';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';

const BILL_DOC_STATUSES: BillDocumentStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
];
const BILL_POSTING_STATUSES: BillPostingStatus[] = [
  'NOT_POSTED',
  'PENDING',
  'POSTED',
  'FAILED',
  'REVERSED',
];

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList({
  projectId,
}: {
  /**
   * ADR-043 Phase 2: fixes the list to one project (the Finance project workspace's Payables
   * tab). The project filter is then not offered, and the page title block is left to the tab.
   */
  projectId?: string;
} = {}) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const tPosting = useTranslations('procurement.postingStatus');
  const tGrid = useTranslations('common.grid');
  const { can } = usePermissions();
  const today = todayWireDate();

  const projectFilter = useProjectFilter();
  const view = useListViewState(
    DEFAULT_BILL_SORT,
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const { filters } = view;
  const bills = useSupplierBills({ projectId: projectId ?? (filters.project || undefined) });

  const all = useMemo(() => bills.data ?? [], [bills.data]);
  const visible = useMemo(
    () => all.filter((bill) => billMatchesFilters(bill, filters, today)),
    [all, filters, today],
  );

  // Supplier options come from the bills themselves: a filter offering a supplier with no bills
  // can only ever produce an empty list.
  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const bill of all) {
      if (bill.supplier && !seen.has(bill.supplierId))
        seen.set(bill.supplierId, bill.supplier.name);
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
    {
      key: 'due',
      type: 'select',
      label: t('filterByDue'),
      options: [
        { value: 'overdue', label: t('dueFilter.overdue') },
        { value: 'notOverdue', label: t('dueFilter.notOverdue') },
      ],
    },
    {
      key: 'balance',
      type: 'select',
      label: t('filterByBalance'),
      options: [
        { value: 'unpaid', label: t('balanceFilter.unpaid') },
        { value: 'paid', label: t('balanceFilter.paid') },
      ],
    },
    { key: 'supplier', type: 'select', label: tc('supplier'), options: supplierOptions },
    ...(projectId
      ? []
      : [
          {
            key: 'project',
            type: 'select' as const,
            label: tc('project'),
            options: projectFilter.options,
          },
        ]),
  ];

  const state = (bill: SupplierBill) => billListState(bill, today);
  const unnumbered = (bill: SupplierBill) =>
    bill.postingStatus === 'OPENING_BALANCE' ? t('titleOpening') : t('notNumbered');

  const columns: GridColumn<SupplierBill>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (bill) => [bill.billNumber, bill.supplierInvoiceNumber].filter(Boolean).join(' '),
      exportValue: (bill) => bill.billNumber ?? unnumbered(bill),
      // The document number is the row's one link — the grid wraps this cell in it.
      render: (bill) => (
        <span className="block">
          {bill.billNumber ? (
            <span className="block font-mono text-body-sm font-semibold text-brand-primary">{bill.billNumber}</span>
          ) : (
            <span className="block text-body-sm font-medium text-brand-primary">{unnumbered(bill)}</span>
          )}
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
          <span className="flex items-center gap-2.5">
            <Avatar
              name={bill.supplier.name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(bill.supplierId))}
            />
            <span className="block max-w-[18rem] truncate font-medium">{bill.supplier.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        ),
    },
    {
      key: 'billDate',
      header: t('billDate'),
      sortable: true,
      plainValue: (bill) => bill.billDate,
      render: (bill, ctx) => (
        <span className="whitespace-nowrap">{formatDate(bill.billDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: t('dueDate'),
      sortable: true,
      card: 'meta',
      plainValue: (bill) => bill.dueDate,
      render: (bill, ctx) => (
        <span className="whitespace-nowrap">
          {formatDate(bill.dueDate, ctx.locale)}
          {billDaysLate(bill, today) > 0 ? (
            <span className="font-medium text-danger">
              {' '}
              · {t('daysLate', { days: billDaysLate(bill, today) })}
            </span>
          ) : null}
        </span>
      ),
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
      key: 'outstanding',
      header: t('balance'),
      numeric: true,
      sortable: true,
      plainValue: (bill) => (isSettleableBill(bill) ? Number(bill.outstandingAmount) : null),
      // The bill's stored balance — what no payment covers yet. Only meaningful once in the
      // ledger (posted, or carried in as an opening balance).
      render: (bill) =>
        isSettleableBill(bill) ? (
          <span className={cn('font-semibold', state(bill) === 'OVERDUE' && 'text-danger')}>
            <MoneyDisplay value={bill.outstandingAmount} />
          </span>
        ) : (
          <span className="text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{tc('notAvailable')}</span>
          </span>
        ),
    },
    {
      key: 'status',
      header: tc('status'),
      card: 'status',
      plainValue: (bill) => t(`listState.${state(bill)}`),
      render: (bill) => (
        <StatusPill tone={BILL_LIST_STATE_TONE[state(bill)]}>
          {t(`listState.${state(bill)}`)}
        </StatusPill>
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

  // One entry point: the form's first question is whether the bill is against a purchase order (D6).
  const canCreate = can(ACCOUNTING_PERMISSIONS.managePayables);
  const createActions = canCreate ? (
    <Button asChild className="gap-1.5">
      <Link href="/finance/accounting/bills/new" data-shortcut-new="">
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

  // Views (Step 2a). A count is shown only while the view's project matches the loaded one —
  // the project filter is the API's.
  const countFor = (viewState: SavedViewState): number | undefined => {
    const f = viewState.filters ?? {};
    if (!projectId && (f.project ?? '') !== (filters.project ?? '')) return undefined;
    return searchRows(
      all.filter((bill) => billMatchesFilters(bill, f, today)),
      viewState.search ?? '',
      columns,
    ).length;
  };
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_BILL_SORT } },
    {
      id: 'unpaid',
      label: t('views.unpaid'),
      state: { filters: { balance: 'unpaid' }, sort: { key: 'dueDate', direction: 'asc' } },
    },
    {
      id: 'toApprove',
      label: t('views.toApprove'),
      state: { filters: { status: 'SUBMITTED' }, sort: DEFAULT_BILL_SORT },
    },
    {
      id: 'toPost',
      label: t('views.toPost'),
      state: { filters: { status: 'APPROVED', posting: 'NOT_POSTED' }, sort: DEFAULT_BILL_SORT },
    },
    {
      id: 'overdue',
      label: t('views.overdue'),
      state: { filters: { due: 'overdue' }, sort: { key: 'dueDate', direction: 'asc' } },
    },
    {
      id: 'drafts',
      label: t('views.drafts'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_BILL_SORT },
    },
    { id: 'paid', label: t('views.paid'), state: { filters: { balance: 'paid' }, sort: DEFAULT_BILL_SORT } },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const owedMinor = all.reduce((sum, bill) => sum + Math.max(billOwesMinor(bill) ?? 0, 0), 0);
  const weekAhead = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  const tile = (pick: (bill: SupplierBill) => boolean) => {
    const rows = all.filter((bill) => (billOwesMinor(bill) ?? 0) > 0 && pick(bill));
    return { count: rows.length, minor: rows.reduce((sum, bill) => sum + billOwesMinor(bill)!, 0) };
  };
  const overdueTile = tile((bill) => isBillOverdue(bill, today));
  const weekTile = tile((bill) => !isBillOverdue(bill, today) && bill.dueDate.slice(0, 10) <= weekAhead);
  const unpaidTile = tile(() => true);
  const approvalCount = all.filter((bill) => bill.documentStatus === 'SUBMITTED').length;
  const usd = (minor: number) => formatMoney(fromMinorUnits(minor, 2), 'USD') ?? '—';
  const tiles =
    all.length === 0 ? null : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t('tiles.unpaid')} value={usd(unpaidTile.minor)} note={t('tiles.bills', { count: unpaidTile.count })} />
        <StatTile label={t('tiles.overdue')} value={usd(overdueTile.minor)} note={t('tiles.bills', { count: overdueTile.count })} />
        <StatTile label={t('tiles.dueWeek')} value={usd(weekTile.minor)} note={t('tiles.bills', { count: weekTile.count })} />
        <StatTile label={t('tiles.toApprove')} value={String(approvalCount)} note={t('tiles.toApproveNote')} />
      </div>
    );
  const currencies = new Set(all.map((bill) => bill.currencyCode));
  const headerSummary =
    all.length === 0
      ? undefined
      : currencies.size === 1
        ? t('headerSummary', {
            count: all.length,
            owed: formatMoney(fromMinorUnits(owedMinor, 2), [...currencies][0]) ?? '—',
          })
        : t('headerCount', { count: all.length });

  const grid = (
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
      columnVisibility
      listState={view.listState}
      savedViews={
        <ListViewsBar
          listKey={projectId ? 'project-bills' : 'bills'}
          builtIns={builtIns}
          current={view.current}
          onApply={view.applyView}
          countFor={countFor}
          label={t('views.label')}
        />
      }
      groupOptions={[
        {
          key: 'supplier',
          label: t('groupSupplier'),
          groupOf: (bill) => ({
            id: bill.supplierId,
            label: bill.supplier?.name ?? tc('notAvailable'),
          }),
        },
        {
          key: 'state',
          label: t('groupStatus'),
          groupOf: (bill) => ({ id: state(bill), label: t(`listState.${state(bill)}`) }),
        },
      ]}
      totals={
        currencies.size === 1
          ? {
              label: (count) => t('countLabel', { count }),
              columns: {
                total: (rows) =>
                  sumBillMoney(rows, (bill) => bill.totalAmount, [...currencies][0]!),
                outstanding: (rows) =>
                  sumBillMoney(
                    rows.filter(isSettleableBill),
                    (bill) => bill.outstandingAmount,
                    [...currencies][0]!,
                  ),
              },
            }
          : undefined
      }
      exportAs={{ fileName: `bills-${today}`, sheetName: t('title') }}
      shortcuts={
        projectId
          ? undefined
          : {
              onNew: canCreate
                ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
                : undefined,
            }
      }
      searchPlaceholder={t('searchPlaceholder')}
      searchLabel={tGrid('searchLabel')}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={view.setFilters}
      toolbarActions={projectId ? createActions : undefined}
    />
  );

  if (projectId) return grid;
  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('pageTitle')}
        summary={headerSummary}
        actions={createActions ?? undefined}
      />
      {tiles}
      {grid}
    </div>
  );
}

function sumBillMoney(
  rows: SupplierBill[],
  field: (bill: SupplierBill) => string,
  currency: string,
): string {
  const minor = rows.reduce((sum, bill) => sum + toMinorUnits(field(bill), 2), 0);
  return formatMoney(fromMinorUnits(minor, 2), currency) ?? '—';
}

const DEFAULT_BILL_SORT: SortState = { key: 'billDate', direction: 'desc' };

/** Whether a bill passes the list's filters (`project` is applied by the API query). */
export function billMatchesFilters(
  bill: SupplierBill,
  filters: FilterValues,
  today: string,
): boolean {
  if (filters.status && bill.documentStatus !== filters.status) return false;
  if (filters.posting && bill.postingStatus !== filters.posting) return false;
  if (filters.supplier && bill.supplierId !== filters.supplier) return false;
  if (filters.due === 'overdue' && !isBillOverdue(bill, today)) return false;
  if (filters.due === 'notOverdue' && isBillOverdue(bill, today)) return false;
  if (filters.balance) {
    const owed = billOwesMinor(bill);
    if (owed === null) return false;
    if (filters.balance === 'unpaid' && owed <= 0) return false;
    if (filters.balance === 'paid' && owed > 0) return false;
  }
  return true;
}

/** What a bill in the ledger still owes, in cents; null for a bill not in the ledger. */
function billOwesMinor(bill: SupplierBill): number | null {
  if (!isSettleableBill(bill) || bill.postingStatus === 'REVERSED' || bill.documentStatus === 'CANCELLED') return null;
  return toMinorUnits(bill.outstandingAmount, 2);
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierBillDetail({
  id,
  back,
  projectId,
}: {
  id: string;
  back?: { href: string; label: string };
  /** Set by a project route: a bill not coded to this project (header or line) is not shown. */
  projectId?: string;
}) {
  const tc = useTranslations('procurement.common');
  const query = useSupplierBill(id);
  const tBills = useTranslations('procurement.bills');
  useModuleTrail(
    query.data
      ? (query.data.billNumber ??
          (query.data.postingStatus === 'OPENING_BALANCE' ? tBills('titleOpening') : tBills('notNumbered')))
      : undefined,
  );

  if (query.isPending) {
    return <SkeletonRecord label={tc('loading')} />;
  }

  if (query.isError || !query.data) {
    return <LoadError message={tc('loadFailed')} onRetry={() => void query.refetch()} />;
  }

  if (
    projectId &&
    query.data.projectId !== projectId &&
    !(query.data.lines ?? []).some((line) => line.projectId === projectId)
  ) {
    return <Alert variant="error" messages={[tc('notInProject')]} />;
  }

  return <SupplierBillDocument bill={query.data} back={back} />;
}

/**
 * The bill page (SB-2): details, lines with totals, the payments and credits against it, then
 * files, journal, approvals and history as tabs; the balance and the dates in the rail. The
 * purchase-order match keeps its own section, on PO bills only.
 */
function SupplierBillDocument({
  bill,
  back,
}: {
  bill: SupplierBill;
  back?: { href: string; label: string };
}) {
  const { can } = usePermissions();
  const t = useTranslations('procurement.bills');
  const tMatch = useTranslations('procurement.matching');
  const facts = useBillFacts(bill);
  const totals = useBillTotals(bill);
  const approvalCount = useBillApprovalCount(bill);
  const activityCount = useBillActivityCount(bill);
  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const live = bill.documentStatus !== 'CANCELLED' && bill.documentStatus !== 'REJECTED';

  return (
    <BillDocumentHeader bill={bill} back={back} rail={<BillRail bill={bill} />}>
      {/* What stands between this bill and payment — shown only while something does. */}
      {live ? <BillEligibilityPanel billId={bill.id} /> : null}

      <RecordPanel title={t('detailsTitle')}>
        <dl className="grid gap-x-8 gap-y-4 text-body-sm sm:grid-cols-2">
          {facts.map((fact, i) => (
            <div key={i}>
              <dt className="text-caption text-muted-foreground">{fact.label}</dt>
              <dd className="mt-0.5 text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </RecordPanel>

      <RecordPanel title={t('tabLines')} padded={false}>
        <div className="space-y-6 pb-5">
          <BillLinesTab bill={bill} />
          <TotalsBlock
            className="ms-auto max-w-sm px-5"
            rows={totals.rows}
            total={totals.total}
            amountDue={isSettleableBill(bill) ? totals.amountDue : undefined}
          />
        </div>
      </RecordPanel>

      {isSettleableBill(bill) || bill.postingStatus === 'REVERSED' ? <BillPaymentsPanel bill={bill} /> : null}

      <DebitNotesPanel billId={bill.id} canManage={can(ACCOUNTING_PERMISSIONS.managePayables)} />

      <DocumentTabs
        label={t('sectionsLabel')}
        tabs={[
          // ADR-045: a bill recorded from a store receipt shows the buyer's photos as its evidence.
          ...(bill.evidence
            ? [
                {
                  key: 'evidence',
                  label: t('tabEvidence'),
                  count: bill.evidence.photos?.length ?? 0,
                  content: <BillEvidence evidence={bill.evidence} />,
                },
              ]
            : []),
          { key: 'files', label: t('tabFiles'), content: <AttachmentsPanel kind="BILL" ownerId={bill.id} /> },
          { key: 'journal', label: t('tabJournal'), content: <BillJournalTab bill={bill} /> },
          {
            key: 'approvals',
            label: t('tabApprovals'),
            count: approvalCount,
            content: <BillApprovalsTab bill={bill} />,
          },
          {
            key: 'activity',
            label: t('tabActivity'),
            count: activityCount,
            content: <BillActivityTab bill={bill} />,
          },
        ]}
      />

      {/* Matching — the auto-match outcome (D6), on PO bills only. The blocked-posting notice links here. */}
      {hasPoLink ? (
        <section
          id="bill-matching"
          aria-labelledby="bill-matching-heading"
          className="scroll-mt-40 space-y-4"
        >
          <SectionHeader id="bill-matching-heading" title={tMatch('title')} />
          <BillMatchSummary bill={bill} />
        </section>
      ) : null}
    </BillDocumentHeader>
  );
}

/** The rail: what the bill comes to and what is left to pay, then when each step happened. */
function BillRail({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const locale = useLocale() as 'en';
  const payments = useSupplierBillPayments(bill.id);
  const debitNotes = useDebitNotes(bill.id, bill.postingStatus === 'POSTED' || bill.postingStatus === 'REVERSED');
  const settleable = isSettleableBill(bill);
  const money = (value: string) => formatMoney(value, bill.currencyCode, locale) ?? value;
  const creditedMinor = (debitNotes.data ?? [])
    .filter((n) => n.status === 'POSTED')
    .reduce((sum, n) => sum + toMinorUnits(n.amount, 2), 0);
  const paid = payments.data;
  const late = isBillOverdue(bill, todayWireDate());

  return (
    <>
      <RecordPanel title={t('balanceTitle')}>
        <DefinitionList>
          <DefinitionRow label={t('totalAmount')} numeric>
            {money(bill.totalAmount)}
          </DefinitionRow>
          {settleable ? (
            <>
              <DefinitionRow label={t('amountPaid')} numeric>
                {paid ? (Number(paid.paidAmount) > 0 ? `−${money(paid.paidAmount)}` : money(paid.paidAmount)) : '…'}
              </DefinitionRow>
              {paid && Number(paid.pendingAmount) > 0 ? (
                <DefinitionRow label={t('pendingPayments')} numeric>
                  {`−${money(paid.pendingAmount)}`}
                </DefinitionRow>
              ) : null}
              {creditedMinor > 0 ? (
                <DefinitionRow label={t('creditedByDebitNotes')} numeric>
                  {`−${money(fromMinorUnits(creditedMinor, 2))}`}
                </DefinitionRow>
              ) : null}
              <DefinitionRow label={<span className="font-semibold text-foreground">{t('balanceDue')}</span>} numeric tone={late ? 'danger' : 'default'}>
                <span className="font-semibold">{money(bill.outstandingAmount)}</span>
              </DefinitionRow>
            </>
          ) : null}
        </DefinitionList>
      </RecordPanel>

      <RecordPanel title={t('datesTitle')}>
        <DefinitionList>
          <DefinitionRow label={t('recorded')}>{formatDate(bill.createdAt ?? null, locale)}</DefinitionRow>
          {bill.approvedAt ? <DefinitionRow label={t('approved')}>{formatDate(bill.approvedAt, locale)}</DefinitionRow> : null}
          {bill.postedAt ? <DefinitionRow label={t('postedAt')}>{formatDate(bill.postedAt, locale)}</DefinitionRow> : null}
          {bill.postingStatus === 'OPENING_BALANCE' ? <DefinitionRow label={t('postedAt')}>{t('openingBalanceCarried')}</DefinitionRow> : null}
          {bill.reversedAt ? <DefinitionRow label={t('reversedAt')}>{formatDate(bill.reversedAt, locale)}</DefinitionRow> : null}
          {bill.cancelledAt ? <DefinitionRow label={t('cancelledAt')}>{formatDate(bill.cancelledAt, locale)}</DefinitionRow> : null}
          {bill.rejectedAt ? <DefinitionRow label={t('rejectedAt')}>{formatDate(bill.rejectedAt, locale)}</DefinitionRow> : null}
        </DefinitionList>
      </RecordPanel>
    </>
  );
}

type BillAllocation = NonNullable<ReturnType<typeof useSupplierBillPayments>['data']>['allocations'][number];

/** Where a payment against the bill stands: posted, waiting, or no longer counting. */
function allocationState(row: BillAllocation): 'POSTED' | 'PENDING' | 'REVERSED' | 'CANCELLED' | 'REJECTED' {
  if (row.paymentStatus === 'CANCELLED' || row.paymentStatus === 'REJECTED') return row.paymentStatus;
  if (row.postingStatus === 'REVERSED') return 'REVERSED';
  return row.postingStatus === 'POSTED' ? 'POSTED' : 'PENDING';
}
const isVoid = (row: BillAllocation) => !['POSTED', 'PENDING'].includes(allocationState(row));

/** Every payment applied to the bill, each a link to the payment. */
function BillPaymentsPanel({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const locale = useLocale() as 'en';
  const payments = useSupplierBillPayments(bill.id);
  const rows = payments.data?.allocations ?? [];

  return (
    <RecordPanel title={t('paymentsTitle')}>
      {payments.isPending ? (
        <p className="text-body-sm text-muted-foreground">…</p>
      ) : rows.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t('noPayments')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-body-sm">
              <span className="min-w-0">
                <Link href={`/finance/accounting/payments/${row.paymentId}`} className="font-mono font-medium text-brand-primary hover:underline">
                  {row.paymentNumber ?? t('paymentUnnumbered')}
                </Link>
                <span className="ms-2 text-muted-foreground">{formatDate(row.paymentDate, locale)}</span>
                {allocationState(row) !== 'POSTED' ? (
                  <StatusPill tone={allocationState(row) === 'PENDING' ? 'progress' : 'historical'} className="ms-2">
                    {t(`allocationState.${allocationState(row)}`)}
                  </StatusPill>
                ) : null}
              </span>
              <span className={cn('tabular-nums font-medium', isVoid(row) && 'text-muted-foreground line-through')}>
                {formatMoney(row.allocatedAmount, bill.currencyCode, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordPanel>
  );
}
