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
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
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
import { Plus, Receipt } from 'lucide-react';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { formatDate } from '@/lib/format';

import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';

import { isSettleableBill } from '../bill-actions';
import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import type { BillDocumentStatus, BillPostingStatus, SupplierBill } from '../types';
import { BillDocumentHeader } from './bill-actions-bar';
import { BillEligibilityPanel } from './bill-eligibility-panel';
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
import { BillMatchStatusBadge, PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

const BILL_DOC_STATUSES: BillDocumentStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const BILL_POSTING_STATUSES: BillPostingStatus[] = ['NOT_POSTED', 'PENDING', 'POSTED', 'FAILED', 'REVERSED'];

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList({
  projectId,
}: {
  /**
   * ADR-043 Phase 2: fixes the list to one project (the Finance project workspace's Payables
   * tab). The project filter is then not offered, and an Outstanding column is added.
   */
  projectId?: string;
} = {}) {
  const t = useTranslations('procurement.bills');
  const tProject = useTranslations('finance.projects.payables');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const tPosting = useTranslations('procurement.postingStatus');
  const { can } = usePermissions();

  const projectFilter = useProjectFilter();
  const [filters, setFilters] = useState<FilterValues>(() => {
    const initial: FilterValues = {};
    if (projectFilter.initialProjectId) initial.project = projectFilter.initialProjectId;
    return initial;
  });
  const bills = useSupplierBills({ projectId: projectId ?? (filters.project || undefined) });

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
    ...(projectId
      ? []
      : [{ key: 'project', type: 'select' as const, label: tc('project'), options: projectFilter.options }]),
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
    ...(projectId
      ? [
          {
            key: 'outstanding',
            header: tProject('outstanding'),
            numeric: true,
            sortable: true,
            plainValue: (bill: SupplierBill) => Number(bill.outstandingAmount),
            // The bill's stored balance — what no payment covers yet. Only meaningful once in the
            // ledger (posted, or carried in as an opening balance).
            render: (bill: SupplierBill) =>
              isSettleableBill(bill) ? (
                <MoneyDisplay value={bill.outstandingAmount} />
              ) : (
                <span className="text-muted-foreground">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{tc('notAvailable')}</span>
                </span>
              ),
          } satisfies GridColumn<SupplierBill>,
        ]
      : []),
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
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
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
function SupplierBillDocument({ bill, back }: { bill: SupplierBill; back?: { href: string; label: string } }) {
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
      <BillEligibilityPanel className="mb-6" billId={bill.id} currencyCode={bill.currencyCode} />

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
      <section id="bill-matching" aria-labelledby="bill-matching-heading" className="mt-10 scroll-mt-40 space-y-4">
        <SectionHeader id="bill-matching-heading" title={tMatch('title')} />
        <BillMatchSummary bill={bill} />
      </section>
    </BillDocumentHeader>
  );
}
