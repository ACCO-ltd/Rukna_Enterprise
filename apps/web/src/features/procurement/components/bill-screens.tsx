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

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Avatar,
  Button,
  cn,
  entityTintClass,
  StatusPill,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  DocumentTabs,
  MoneyDisplay,
  SectionHeader,
  SkeletonRecord,
  SummaryRail,
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
import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import type { BillDocumentStatus, BillPostingStatus, SupplierBill } from '../types';
import { BillDocumentHeader } from './bill-actions-bar';
import { BillEligibilityPanel } from './bill-eligibility-panel';
import { BillEvidence } from './bill-evidence';
import {
  BillActivityTab,
  BillApprovalsTab,
  BillJournalTab,
  BillLinesTab,
  useBillActivityCount,
  useBillApprovalCount,
  useBillFacts,
  useBillSummary,
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

  const columns: GridColumn<SupplierBill>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (bill) => [bill.billNumber, bill.supplierInvoiceNumber].filter(Boolean).join(' '),
      exportValue: (bill) => bill.billNumber ?? tStatus('DRAFT'),
      // The document number is the row's one link — the grid wraps this cell in it.
      render: (bill) => (
        <span className="block">
          <span className="block font-mono text-body-sm font-semibold text-brand-primary">
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

  // Two controlled paths (D6): a PO-backed bill that auto-matches on submit — the primary —
  // and a genuine non-PO bill (utilities, rent, one-off) that never matches.
  const canCreate = can(ACCOUNTING_PERMISSIONS.managePayables);
  const createActions = canCreate ? (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href="/finance/accounting/bills/new">{t('newNonPo')}</Link>
      </Button>
      <Button asChild className="gap-1.5">
        <Link href="/finance/accounting/bills/new?po=1" data-shortcut-new="">
          <Plus size={16} aria-hidden="true" />
          {t('newPo')}
          <kbd
            className="hidden rounded border border-white/40 px-1 font-mono text-micro md:inline"
            aria-hidden="true"
          >
            N
          </kbd>
        </Link>
      </Button>
    </div>
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
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const owedMinor = all
    .filter((bill) => isSettleableBill(bill) && bill.postingStatus !== 'REVERSED')
    .reduce((sum, bill) => sum + toMinorUnits(bill.outstandingAmount, 2), 0);
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
  return true;
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
  const tStatusTrail = useTranslations('procurement.status');
  useModuleTrail(
    query.data ? (query.data.billNumber ?? tStatusTrail(query.data.documentStatus)) : undefined,
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
 * The bill as a document (ADR-035/036): action bar, identity + facts, one notice, the body
 * tabs, totals, and the summary rail — then the purchase-order match, which is the bill's own
 * procurement concern and keeps its section.
 */
function SupplierBillDocument({
  bill,
  back,
}: {
  bill: SupplierBill;
  back?: { href: string; label: string };
}) {
  const t = useTranslations('procurement.bills');
  const tMatch = useTranslations('procurement.matching');
  const facts = useBillFacts(bill);
  const totals = useBillTotals(bill);
  const summary = useBillSummary(bill);
  const lineCount = bill.lines?.length ?? 0;
  const approvalCount = useBillApprovalCount(bill);
  const activityCount = useBillActivityCount(bill);

  return (
    <BillDocumentHeader
      bill={bill}
      back={back}
      facts={facts}
      rail={<SummaryRail title={t('summaryTitle')} rows={summary} />}
    >
      {/* ADR-043 Phase 2: what stands between this bill and payment, step by step. */}
      {bill.documentStatus === 'CANCELLED' || bill.documentStatus === 'REJECTED' ? null : (
        <BillEligibilityPanel className="mb-6" billId={bill.id} currencyCode={bill.currencyCode} />
      )}

      <DocumentTabs
        label={t('sectionsLabel')}
        tabs={[
          {
            key: 'lines',
            label: t('tabLines'),
            count: lineCount,
            content: (
              <div className="space-y-6">
                <BillLinesTab bill={bill} />
                <TotalsBlock
                  className="ms-auto max-w-sm"
                  rows={totals.rows}
                  total={totals.total}
                  amountDue={isSettleableBill(bill) ? totals.amountDue : undefined}
                />
              </div>
            ),
          },
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

      {/* Matching — the auto-match outcome (D6). BillMatchSummary self-suppresses to "not
          applicable" for a genuine non-PO bill. The blocked-posting notice links here. */}
      <section
        id="bill-matching"
        aria-labelledby="bill-matching-heading"
        className="mt-10 scroll-mt-40 space-y-4"
      >
        <SectionHeader id="bill-matching-heading" title={tMatch('title')} />
        <BillMatchSummary bill={bill} />
      </section>
    </BillDocumentHeader>
  );
}
