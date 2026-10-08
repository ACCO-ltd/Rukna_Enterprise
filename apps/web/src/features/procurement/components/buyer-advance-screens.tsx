'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Notice,
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
} from '@erp/ui';
import { Wallet } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useAllBuyerAdvances, useGetBuyerAdvance, usePostBuyerAdvance } from '../hooks/use-procurement';
import { useCanPay, useReverseBuyerAdvance } from '../hooks/use-quotation-payment';
import { todayInMogadishu } from '../quotations/payment-rules';
import type { BuyerAdvance, BillPostingStatus } from '../types';
import { PostingStatusBadge } from './procurement-badges';
import { usePaymentRefusalText } from './quotes/payment-shared';

/**
 * ADR-045 §7: an advance POSTED before buyer cash reached the ledger has no journal. It is never
 * re-posted (that would date it today or double-count a manual journal) — only labelled.
 */
export function isLegacyAdvance(advance: Pick<BuyerAdvance, 'legacy' | 'postingStatus' | 'postedJournalEntryId'>): boolean {
  if (typeof advance.legacy === 'boolean') return advance.legacy;
  return advance.postingStatus === 'POSTED' && !advance.postedJournalEntryId;
}

function LegacyBadge() {
  const t = useTranslations('procurement.advances');
  return <Badge tone="neutral">{t('legacy')}</Badge>;
}

const POSTING_STATUSES: BillPostingStatus[] = ['NOT_POSTED', 'POSTED', 'REVERSED', 'FAILED'];

// ─── List ────────────────────────────────────────────────────────────────────────

export function BuyerAdvancesList() {
  const t = useTranslations('procurement.advances');
  const tc = useTranslations('procurement.common');
  const tPosting = useTranslations('procurement.postingStatus');

  // Org-wide, newest first (GET /buyer-advances without a PO). Advances are created from a
  // purchase order's settlement tab, so this page has no primary of its own.
  const query = useAllBuyerAdvances();
  const [filters, setFilters] = useState<FilterValues>({});

  const data = useMemo(() => query.data ?? [], [query.data]);
  const visible = useMemo(
    () => (filters.posting ? data.filter((a) => a.postingStatus === filters.posting) : data),
    [data, filters],
  );

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
          <span className="block font-semibold text-brand-primary">{formatDate(adv.advancedAt, ctx.locale)}</span>
          {adv.reference ? (
            <span className="block truncate text-caption font-normal text-muted-foreground">{adv.reference}</span>
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
      render: (adv) => adv.supplier?.name ?? <span className="text-muted-foreground">{tc('notAvailable')}</span>,
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (adv) => Number(adv.amount),
      render: (adv, ctx) => <bdi className="tabular-nums">{formatMoney(adv.amount, adv.currencyCode, ctx.locale)}</bdi>,
    },
    {
      key: 'outstanding',
      header: t('colOutstanding'),
      numeric: true,
      sortable: true,
      plainValue: (adv) => Number(adv.outstanding),
      render: (adv, ctx) => (
        <bdi className="tabular-nums">{formatMoney(adv.outstanding, adv.currencyCode, ctx.locale)}</bdi>
      ),
    },
    {
      key: 'posting',
      header: t('colPosting'),
      card: 'status',
      render: (adv) => (
        <span className="flex flex-wrap items-center gap-1">
          <PostingStatusBadge status={adv.postingStatus} />
          {isLegacyAdvance(adv) ? <LegacyBadge /> : null}
        </span>
      ),
    },
  ];

  const filterFields: ListFilterField[] = [
    {
      key: 'posting',
      type: 'select',
      label: t('filterByPostingStatus'),
      options: POSTING_STATUSES.map((s) => ({ value: s, label: tPosting(s) })),
    },
  ];

  return (
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
          <EmptyState icon={<Wallet size={28} aria-hidden="true" />} title={t('empty')} description={t('emptyDesc')} />
        ) : undefined
      }
      searchPlaceholder={t('searchPlaceholder')}
      noMatchMessage={t('noMatches')}
      resultLabel={(count) => t('countLabel', { count })}
      pagination={{ defaultPageSize: 25 }}
      defaultSort={{ key: 'advancedAt', direction: 'desc' }}
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={setFilters}
    />
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
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError || !advance) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const canPost = advance.postingStatus === 'NOT_POSTED';
  const legacy = isLegacyAdvance(advance);
  // The server decides (R15: nothing applied or returned); offered only on a ledger-posted advance.
  const mayReverse = canPay && advance.postingStatus === 'POSTED' && !legacy && !advance.reversedAt;
  // A DRAFT advance (waiting for approval) is cancelled by the same endpoint, without a date.
  const mayCancel = canPay && advance.documentStatus === 'DRAFT' && advance.postingStatus === 'NOT_POSTED';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('detailTitle')}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PostingStatusBadge showAxis status={advance.postingStatus} />
          <span className="text-sm text-muted-foreground">
            {formatDate(advance.advancedAt, locale)}
          </span>
          <Link
            href={`/procurement/orders/${advance.purchaseOrderId}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            {advance.purchaseOrder?.poNumber ?? `PO ${advance.purchaseOrderId.slice(0, 8)}…`}
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
        <Notice tone="historical" title={t('reversedTitle', { date: formatDate(advance.reversedAt, locale) ?? '' })}>
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
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setReversing(true)}>
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
          <Field label={t('colAmount')} value={formatMoney(advance.amount, advance.currencyCode, locale) ?? ''} />
          <Field label={t('colOutstanding')} value={formatMoney(advance.outstanding, advance.currencyCode, locale) ?? ''} />
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
                    <TableCell className="capitalize text-sm">{r.returnMethod.toLowerCase().replace('_', ' ')}</TableCell>
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
                      <Link
                        href={`/finance/accounting/bills/${ea.supplierBillId}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        {ea.billNumber ?? `${ea.supplierBillId.slice(0, 8)}…`}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ea.allocationDate ?? ea.createdAt, locale)}
                    </TableCell>
                    <TableCell>
                      {ea.reversedAt ? (
                        <Badge tone="neutral">{t('applicationReversed')}</Badge>
                      ) : ea.postingStatus ? (
                        ea.journalEntryId ? (
                          <Link href={`/finance/accounting/journals/${ea.journalEntryId}`} className="hover:underline">
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
            mayCancel ? t('cancelBody') : t('reverseBody', { date: formatDate(todayInMogadishu(), locale) ?? '' })
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
          errorMessage={post.isError ? (post.error instanceof ApiError ? post.error.message : tc('loadFailed')) : undefined}
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
