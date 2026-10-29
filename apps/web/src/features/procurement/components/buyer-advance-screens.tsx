'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Avatar,
  Badge,
  Button,
  cn,
  EmptyState,
  entityTintClass,
  Notice,
  StatusPill,
  SectionHeader,
  type FilterValues,
  type ListFilterField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type StatusTone,
  SkeletonRecord,
} from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { Wallet } from 'lucide-react';
import type { SavedViewState } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ListPageHeader } from '@/components/layout/list-page-header';
import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import {
  useAllBuyerAdvances,
  useGetBuyerAdvance,
  usePostBuyerAdvance,
  usePurchaseOrder,
  useSupplierBill,
} from '../hooks/use-procurement';
import { useCanPay, useReverseBuyerAdvance } from '../hooks/use-quotation-payment';
import { todayInMogadishu } from '../quotations/payment-rules';
import type { BuyerAdvance, BillPostingStatus } from '../types';
import { PostingStatusBadge } from './procurement-badges';
import { usePaymentRefusalText } from './quotes/payment-shared';

/**
 * ADR-045 §7: an advance POSTED before buyer cash reached the ledger has no journal. It is never
 * re-posted (that would date it today or double-count a manual journal) — only labelled.
 */
export function isLegacyAdvance(
  advance: Pick<BuyerAdvance, 'legacy' | 'postingStatus' | 'postedJournalEntryId'>,
): boolean {
  if (typeof advance.legacy === 'boolean') return advance.legacy;
  return advance.postingStatus === 'POSTED' && !advance.postedJournalEntryId;
}

/** Drafts (awaiting approval), cancelled and reversed advances hold no cash. */
export function holdsNothing(
  advance: Pick<BuyerAdvance, 'documentStatus' | 'postingStatus'>,
): boolean {
  return (
    advance.documentStatus === 'DRAFT' ||
    advance.documentStatus === 'CANCELLED' ||
    advance.documentStatus === 'REJECTED' ||
    advance.postingStatus === 'REVERSED'
  );
}

/** The advance's state in words: waiting for approval, cancelled, reversed — else its posting. */
function AdvanceStatus({
  advance,
}: {
  advance: Pick<BuyerAdvance, 'documentStatus' | 'postingStatus'>;
}) {
  const t = useTranslations('procurement.advances.state');
  if (advance.documentStatus === 'DRAFT')
    return <StatusPill tone="progress">{t('waiting')}</StatusPill>;
  if (advance.documentStatus === 'CANCELLED' || advance.documentStatus === 'REJECTED')
    return <StatusPill tone="historical">{t('cancelled')}</StatusPill>;
  if (advance.postingStatus === 'REVERSED')
    return <StatusPill tone="historical">{t('reversed')}</StatusPill>;
  return <PostingStatusBadge status={advance.postingStatus} />;
}

/** The PO's number: from the advance when it carries it, else read from the order (never a raw id). */
function PoNumber({ id, number }: { id: string; number: string | null }) {
  const po = usePurchaseOrder(number ? '' : id);
  return <>{number ?? po.data?.poNumber ?? '…'}</>;
}

/** A bill reference: its number, read from the bill when the row has only the id. */
function BillRef({ id, number }: { id: string; number?: string | null }) {
  const bill = useSupplierBill(number ? '' : id);
  const shown = number ?? bill.data?.billNumber ?? bill.data?.supplierInvoiceNumber ?? null;
  return (
    <Link
      href={`/finance/accounting/bills/${id}`}
      className="text-sm font-medium text-brand-primary hover:underline"
    >
      {shown ?? '…'}
    </Link>
  );
}

function LegacyBadge() {
  const t = useTranslations('procurement.advances');
  return <Badge tone="neutral">{t('legacy')}</Badge>;
}

const POSTING_STATUSES: BillPostingStatus[] = ['NOT_POSTED', 'POSTED', 'REVERSED', 'FAILED'];

/**
 * One state per list row (ADR-047): what the reader acts on next, derived from the two stored
 * axes and the outstanding cash. Nothing new is stored; the detail page keeps both axes.
 */
export type AdvanceListState =
  'WAITING' | 'TO_POST' | 'FAILED' | 'OPEN' | 'SETTLED' | 'REVERSED' | 'CANCELLED';

export function advanceListState(
  advance: Pick<BuyerAdvance, 'documentStatus' | 'postingStatus' | 'outstanding'>,
): AdvanceListState {
  if (advance.documentStatus === 'DRAFT') return 'WAITING';
  if (advance.documentStatus === 'CANCELLED' || advance.documentStatus === 'REJECTED')
    return 'CANCELLED';
  if (advance.postingStatus === 'REVERSED') return 'REVERSED';
  if (advance.postingStatus === 'FAILED') return 'FAILED';
  if (advance.postingStatus !== 'POSTED') return 'TO_POST';
  return toMinorUnits(advance.outstanding, 2) > 0 ? 'OPEN' : 'SETTLED';
}

const ADVANCE_LIST_STATE_TONE: Record<AdvanceListState, StatusTone> = {
  WAITING: 'progress',
  TO_POST: 'attention',
  FAILED: 'danger',
  OPEN: 'progress',
  SETTLED: 'success',
  REVERSED: 'historical',
  CANCELLED: 'historical',
};
const ADVANCE_LIST_STATES = Object.keys(ADVANCE_LIST_STATE_TONE) as AdvanceListState[];

const DEFAULT_ADVANCE_SORT: SortState = { key: 'advancedAt', direction: 'desc' };

function advanceMatchesFilters(advance: BuyerAdvance, filters: FilterValues): boolean {
  if (filters.state && advanceListState(advance) !== filters.state) return false;
  if (filters.posting && advance.postingStatus !== filters.posting) return false;
  if (filters.supplier && advance.supplier?.id !== filters.supplier) return false;
  return true;
}

// ─── List ────────────────────────────────────────────────────────────────────────

export function BuyerAdvancesList() {
  const t = useTranslations('procurement.advances');
  const tc = useTranslations('procurement.common');
  const tPosting = useTranslations('procurement.postingStatus');

  // Org-wide, newest first (GET /buyer-advances without a PO). Advances are created from a
  // purchase order's settlement tab, so this page has no primary of its own.
  // GET /buyer-advances is Accounts Payable's (manage:payable): don't ask without it (QA: two 403s
  // for a Procurement Manager).
  const canPay = useCanPay();
  const query = useAllBuyerAdvances({ enabled: canPay });
  const view = useListViewState(DEFAULT_ADVANCE_SORT);
  const { filters } = view;

  const data = useMemo(() => query.data ?? [], [query.data]);
  const visible = useMemo(
    () => data.filter((a) => advanceMatchesFilters(a, filters)),
    [data, filters],
  );
  const supplierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of data)
      if (a.supplier && !seen.has(a.supplier.id)) seen.set(a.supplier.id, a.supplier.name);
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [data]);

  const columns: GridColumn<BuyerAdvance>[] = [
    {
      key: 'advancedAt',
      header: t('colAdvance'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (adv) => adv.advancedAt,
      // The grid wraps this cell in the row's one link, to the advance.
      render: (adv, ctx) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-brand-primary">
            {formatDate(adv.advancedAt, ctx.locale)}
          </span>
          {adv.reference ? (
            <span className="block truncate text-caption font-normal text-muted-foreground">
              {adv.reference}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'po',
      header: t('colPo'),
      sortable: true,
      card: 'subtitle',
      plainValue: (adv) => adv.purchaseOrder?.poNumber ?? '',
      render: (adv) =>
        adv.purchaseOrder ? (
          <Link
            href={`/procurement/orders/${adv.purchaseOrder.id}`}
            className="font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {adv.purchaseOrder.poNumber}
          </Link>
        ) : (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        ),
    },
    {
      key: 'supplier',
      header: t('colSupplier'),
      sortable: true,
      card: 'meta',
      plainValue: (adv) => adv.supplier?.name ?? '',
      render: (adv) =>
        adv.supplier ? (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={adv.supplier.name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(adv.supplier.id))}
            />
            <span className="block max-w-[16rem] truncate font-medium">{adv.supplier.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        ),
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (adv) => Number(adv.amount),
      render: (adv, ctx) => (
        <bdi className="tabular-nums">{formatMoney(adv.amount, adv.currencyCode, ctx.locale)}</bdi>
      ),
    },
    {
      key: 'outstanding',
      header: t('colOutstanding'),
      numeric: true,
      sortable: true,
      plainValue: (adv) => (holdsNothing(adv) ? null : Number(adv.outstanding)),
      // A draft, cancelled or reversed advance holds no cash: never show its amount as outstanding.
      render: (adv, ctx) =>
        holdsNothing(adv) ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <bdi className="tabular-nums">
            {formatMoney(adv.outstanding, adv.currencyCode, ctx.locale)}
          </bdi>
        ),
    },
    {
      key: 'state',
      header: t('colStatus'),
      card: 'status',
      plainValue: (adv) => t(`listState.${advanceListState(adv)}`),
      render: (adv) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill tone={ADVANCE_LIST_STATE_TONE[advanceListState(adv)]}>
            {t(`listState.${advanceListState(adv)}`)}
          </StatusPill>
          {isLegacyAdvance(adv) ? <LegacyBadge /> : null}
        </span>
      ),
    },
  ];

  const filterFields: ListFilterField[] = [
    {
      key: 'state',
      type: 'select',
      label: t('colStatus'),
      options: ADVANCE_LIST_STATES.map((s) => ({ value: s, label: t(`listState.${s}`) })),
    },
    {
      key: 'posting',
      type: 'select',
      label: t('filterByPostingStatus'),
      options: POSTING_STATUSES.map((s) => ({ value: s, label: tPosting(s) })),
    },
    { key: 'supplier', type: 'select', label: t('colSupplier'), options: supplierOptions },
  ];

  const countFor = (state: SavedViewState): number | undefined =>
    searchRows(
      data.filter((a) => advanceMatchesFilters(a, state.filters ?? {})),
      state.search ?? '',
      columns,
    ).length;
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_ADVANCE_SORT } },
    {
      id: 'open',
      label: t('views.open'),
      state: { filters: { state: 'OPEN' }, sort: DEFAULT_ADVANCE_SORT },
    },
    {
      id: 'waiting',
      label: t('views.waiting'),
      state: { filters: { state: 'WAITING' }, sort: DEFAULT_ADVANCE_SORT },
    },
    {
      id: 'toPost',
      label: t('views.toPost'),
      state: { filters: { state: 'TO_POST' }, sort: DEFAULT_ADVANCE_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  // What buyers still hold, when every advance is in one currency.
  const currencies = new Set(data.map((a) => a.currencyCode));
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  const heldMinor = data
    .filter((a) => advanceListState(a) === 'OPEN')
    .reduce((sum, a) => sum + toMinorUnits(a.outstanding, 2), 0);
  // Nothing held on any row is "nothing to add up" — never $0.
  const sumOutstanding = (rows: BuyerAdvance[]) => {
    const holding = rows.filter((a) => !holdsNothing(a));
    if (holding.length === 0) return '—';
    return (
      formatMoney(
        fromMinorUnits(
          holding.reduce((sum, a) => sum + toMinorUnits(a.outstanding, 2), 0),
          2,
        ),
        currency,
      ) ?? '—'
    );
  };
  const headerSummary =
    data.length === 0
      ? undefined
      : currency
        ? t('headerSummary', {
            count: data.length,
            held: formatMoney(fromMinorUnits(heldMinor, 2), currency) ?? '—',
          })
        : t('headerCount', { count: data.length });

  if (!canPay) {
    return <Notice tone="info">{t('financeOnly')}</Notice>;
  }

  return (
    <div className="space-y-5">
      <ListPageHeader eyebrow={t('eyebrow')} title={t('title')} summary={headerSummary} />
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(adv) => adv.id}
        label={t('title')}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage={tc('loadFailed')}
        onRetry={() => void query.refetch()}
        rowHref={(adv) => `/procurement/advances/${adv.id}`}
        emptyState={
          data.length === 0 ? (
            <EmptyState
              icon={<Wallet size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyDesc')}
            />
          ) : undefined
        }
        searchPlaceholder={t('searchPlaceholder')}
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        columnVisibility
        listState={view.listState}
        savedViews={
          <ListViewsBar
            listKey="buyer-advances"
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
            label: t('colSupplier'),
            groupOf: (adv) => ({
              id: adv.supplier?.id ?? '',
              label: adv.supplier?.name ?? tc('notAvailable'),
            }),
          },
          {
            key: 'state',
            label: t('colStatus'),
            groupOf: (adv) => ({
              id: advanceListState(adv),
              label: t(`listState.${advanceListState(adv)}`),
            }),
          },
        ]}
        totals={
          currency
            ? {
                label: (count) => t('countLabel', { count }),
                columns: {
                  amount: (rows) =>
                    formatMoney(
                      fromMinorUnits(
                        rows.reduce((sum, a) => sum + toMinorUnits(a.amount, 2), 0),
                        2,
                      ),
                      currency,
                    ) ?? '—',
                  outstanding: sumOutstanding,
                },
              }
            : undefined
        }
        exportAs={{ fileName: `buyer-advances-${todayInMogadishu()}`, sheetName: t('title') }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
      />
    </div>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function BuyerAdvanceDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.advances');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en';

  const query = useGetBuyerAdvance(id);
  // A buyer advance carries no document number of its own; the breadcrumb names the kind.
  useModuleTrail(query.data ? t('detailTitle') : undefined);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [reversing, setReversing] = useState(false);
  const canPay = useCanPay();
  const { fromError } = usePaymentRefusalText();

  // poId is needed to invalidate settlement query; read from advance once loaded
  const advance = query.data;
  const poId = advance?.purchaseOrderId ?? '';
  const post = usePostBuyerAdvance(id, poId);
  const reverse = useReverseBuyerAdvance(advance?.quotationRequestId ?? null);

  if (query.isPending) {
    return <SkeletonRecord label={tc('loading')} />;
  }

  if (query.isError || !advance) {
    return <LoadError message={tc('loadFailed')} onRetry={() => void query.refetch()} />;
  }

  const canPost = advance.postingStatus === 'NOT_POSTED';
  const legacy = isLegacyAdvance(advance);
  // The server decides (R15: nothing applied or returned); offered only on a ledger-posted advance.
  const mayReverse = canPay && advance.postingStatus === 'POSTED' && !legacy && !advance.reversedAt;
  // A DRAFT advance (waiting for approval) is cancelled by the same endpoint, without a date.
  const mayCancel =
    canPay && advance.documentStatus === 'DRAFT' && advance.postingStatus === 'NOT_POSTED';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('detailTitle')}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AdvanceStatus advance={advance} />
          <span className="text-sm text-muted-foreground">
            {formatDate(advance.advancedAt, locale)}
          </span>
          <Link
            href={`/procurement/orders/${advance.purchaseOrderId}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            <PoNumber
              id={advance.purchaseOrderId}
              number={advance.purchaseOrder?.poNumber ?? null}
            />
          </Link>
          {legacy ? <LegacyBadge /> : null}
          {advance.postedJournalEntryId ? (
            <Link
              href={`/finance/accounting/journals/${advance.postedJournalEntryId}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-brand-primary underline-offset-4 hover:underline"
            >
              {t('journalLink')}
            </Link>
          ) : null}
          {advance.quotationRequestId ? (
            <Link
              href={`/finance/quotes/${advance.quotationRequestId}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-brand-primary underline-offset-4 hover:underline"
            >
              {t('requestLink')}
            </Link>
          ) : null}
        </div>
      </div>

      {legacy ? <Notice tone="historical">{t('legacyBody')}</Notice> : null}
      {advance.reversedAt ? (
        <Notice
          tone="historical"
          title={t('reversedTitle', { date: formatDate(advance.reversedAt, locale) ?? '' })}
        >
          {advance.reversalReason ? <p className="mt-1">{advance.reversalReason}</p> : null}
          {advance.reversalJournalEntryId ? (
            <Link
              href={`/finance/accounting/journals/${advance.reversalJournalEntryId}`}
              className="mt-1 inline-flex min-h-11 items-center font-medium text-brand-primary underline underline-offset-4"
            >
              {t('reversalJournalLink')}
            </Link>
          ) : null}
        </Notice>
      ) : null}

      {mayReverse || mayCancel ? (
        <div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setReversing(true)}
          >
            {mayCancel ? t('cancelAction') : t('reverseAction')}
          </Button>
        </div>
      ) : null}

      {/* Post action */}
      {canPost && (
        <div>
          <Button onClick={() => setShowPostConfirm(true)} disabled={post.isPending}>
            {t('postAction')}
          </Button>
          {post.isError && (
            <p className="mt-2 text-sm text-destructive">
              {post.error instanceof ApiError ? post.error.message : tc('loadFailed')}
            </p>
          )}
        </div>
      )}
      {!canPost && advance.postingStatus !== 'NOT_POSTED' && !legacy && (
        <p className="text-sm text-muted-foreground">{t('alreadyPosted')}</p>
      )}

      {/* Amounts */}
      <section aria-labelledby="adv-amounts-heading" className="space-y-4">
        <SectionHeader id="adv-amounts-heading" title={t('sectionDetails')} />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={t('colAmount')}
            value={formatMoney(advance.amount, advance.currencyCode, locale) ?? ''}
          />
          <Field
            label={t('colOutstanding')}
            value={
              holdsNothing(advance)
                ? '—'
                : (formatMoney(advance.outstanding, advance.currencyCode, locale) ?? '')
            }
          />
          <Field label={t('colAdvancedAt')} value={formatDate(advance.advancedAt, locale) ?? ''} />
        </dl>
      </section>

      {/* Returns */}
      <section aria-labelledby="adv-returns-heading" className="space-y-4">
        <SectionHeader id="adv-returns-heading" title={t('sectionReturns')} />
        {advance.returns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noReturns')}</p>
        ) : (
          <TableScroll aria-label={t('sectionReturns')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colReceivedAt')}</TableHead>
                  <TableHead>{t('colReturnMethod')}</TableHead>
                  <TableHead className="text-end">{t('colAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advance.returns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDate(r.receivedAt, locale)}
                    </TableCell>
                    <TableCell className="capitalize text-sm">
                      {r.returnMethod.toLowerCase().replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-end tabular-nums font-medium">
                      {formatMoney(r.amount, advance.currencyCode, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      {/* Evidence allocations */}
      <section aria-labelledby="adv-evidence-heading" className="space-y-4">
        <SectionHeader id="adv-evidence-heading" title={t('sectionEvidence')} />
        {advance.evidenceAllocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noEvidence')}</p>
        ) : (
          <TableScroll aria-label={t('sectionEvidence')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colBill')}</TableHead>
                  <TableHead>{t('colApplied')}</TableHead>
                  <TableHead>{t('colPosting')}</TableHead>
                  <TableHead className="text-end">{t('colAllocated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advance.evidenceAllocations.map((ea) => (
                  <TableRow key={ea.id}>
                    <TableCell>
                      <BillRef id={ea.supplierBillId} number={ea.billNumber} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ea.allocationDate ?? ea.createdAt, locale)}
                    </TableCell>
                    <TableCell>
                      {ea.reversedAt ? (
                        <Badge tone="neutral">{t('applicationReversed')}</Badge>
                      ) : ea.postingStatus ? (
                        ea.journalEntryId ? (
                          <Link
                            href={`/finance/accounting/journals/${ea.journalEntryId}`}
                            className="hover:underline"
                          >
                            <PostingStatusBadge status={ea.postingStatus} />
                          </Link>
                        ) : (
                          <PostingStatusBadge status={ea.postingStatus} />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('evidenceOnly')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums font-medium">
                      {formatMoney(ea.allocatedAmount, advance.currencyCode, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </section>

      {reversing ? (
        <ConfirmActionDialog
          title={mayCancel ? t('cancelTitle') : t('reverseTitle')}
          description={
            mayCancel
              ? t('cancelBody')
              : t('reverseBody', { date: formatDate(todayInMogadishu(), locale) ?? '' })
          }
          confirmLabel={mayCancel ? t('cancelAction') : t('reverseAction')}
          reason={{ label: t('reverseReason'), required: true }}
          destructive
          isPending={reverse.isPending}
          errorMessage={reverse.error ? fromError(reverse.error) : undefined}
          onConfirm={(reason) =>
            reverse.mutate(
              {
                advanceId: advance.id,
                payload: mayCancel ? { reason } : { reason, reversalDate: todayInMogadishu() },
              },
              { onSuccess: () => setReversing(false) },
            )
          }
          onDismiss={() => {
            reverse.reset();
            setReversing(false);
          }}
        />
      ) : null}

      {/* Post confirm dialog */}
      {showPostConfirm ? (
        <ConfirmActionDialog
          title={t('postConfirmTitle')}
          description={t('postConfirmBody')}
          confirmLabel={t('postAction')}
          isPending={post.isPending}
          errorMessage={
            post.isError
              ? post.error instanceof ApiError
                ? post.error.message
                : tc('loadFailed')
              : undefined
          }
          onConfirm={() => {
            post.mutate(undefined, {
              onSuccess: () => setShowPostConfirm(false),
            });
          }}
          onDismiss={() => setShowPostConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
