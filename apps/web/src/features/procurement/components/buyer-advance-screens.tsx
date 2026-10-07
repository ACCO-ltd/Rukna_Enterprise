'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  EmptyState,
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
import type { BuyerAdvance, BillPostingStatus } from '../types';
import { PostingStatusBadge } from './procurement-badges';

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
      render: (adv) => <PostingStatusBadge status={adv.postingStatus} />,
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

  // poId is needed to invalidate settlement query; read from advance once loaded
  const advance = query.data;
  const poId = advance?.purchaseOrderId ?? '';
  const post = usePostBuyerAdvance(id, poId);

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
            className="font-mono text-xs text-muted-foreground hover:underline"
          >
            PO {advance.purchaseOrderId.slice(0, 8)}…
          </Link>
        </div>
      </div>

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
      {!canPost && advance.postingStatus !== 'NOT_POSTED' && (
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
                  <TableHead className="text-end">{t('colAllocated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advance.evidenceAllocations.map((ea) => (
                  <TableRow key={ea.id}>
                    <TableCell>
                      <Link
                        href={`/finance/accounting/bills/${ea.supplierBillId}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {ea.supplierBillId.slice(0, 8)}…
                      </Link>
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
