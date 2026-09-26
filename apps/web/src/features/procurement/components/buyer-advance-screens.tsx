'use client';

import { useState } from 'react';
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
import { WalletIcon } from '@phosphor-icons/react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useGetBuyerAdvance, useListBuyerAdvances, usePostBuyerAdvance } from '../hooks/use-procurement';
import type { BuyerAdvance, BillPostingStatus } from '../types';
import { PostingStatusBadge } from './procurement-badges';

const POSTING_STATUSES: BillPostingStatus[] = ['NOT_POSTED', 'POSTED', 'REVERSED', 'FAILED'];

// ─── List ────────────────────────────────────────────────────────────────────────

export function BuyerAdvancesList() {
  const t = useTranslations('procurement.advances');
  const tc = useTranslations('procurement.common');
  const tPosting = useTranslations('procurement.postingStatus');
  const locale = useLocale() as 'en';

  // The advances list requires a purchaseOrderId, but on the standalone advances
  // page we show all advances. The API requires purchaseOrderId so we use the
  // per-PO list when coming from a PO. For the standalone nav entry the user
  // can navigate directly to advances from the PO settlement tab.
  // This list is intentionally read-only — advances are created from the PO.

  const [postingFilter, setPostingFilter] = useState<BillPostingStatus | ''>('');
  const [purchaseOrderId] = useState<string | undefined>(undefined);

  // The API requires purchaseOrderId; on the standalone page we can't list all
  // advances. Disable the query and show the empty state with a hint.
  const query = useListBuyerAdvances(purchaseOrderId ?? '');
  const enabled = Boolean(purchaseOrderId);

  const data = enabled ? (query.data ?? []) : [];
  const visible = postingFilter
    ? data.filter((a) => a.postingStatus === postingFilter)
    : data;

  const columns: GridColumn<BuyerAdvance>[] = [
    {
      key: 'po',
      header: t('colPo'),
      render: (adv) => (
        <Link href={`/procurement/orders/${adv.purchaseOrderId}`} className="font-mono text-xs hover:underline">
          {adv.purchaseOrderId.slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: 'advancedAt',
      header: t('colAdvancedAt'),
      sortable: true,
      plainValue: (adv) => adv.advancedAt,
      render: (adv, ctx) => (
        <span className="text-muted-foreground">{formatDate(adv.advancedAt, ctx.locale)}</span>
      ),
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      sortable: true,
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
      plainValue: (adv) => Number(adv.outstanding),
      render: (adv, ctx) => (
        <bdi className="tabular-nums">{formatMoney(adv.outstanding, adv.currencyCode, ctx.locale)}</bdi>
      ),
    },
    {
      key: 'posting',
      header: t('colPosting'),
      render: (adv) => <PostingStatusBadge status={adv.postingStatus} />,
    },
  ];

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <EmptyState
          icon={<WalletIcon size={28} aria-hidden="true" />}
          title={t('empty')}
          description={t('emptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(adv) => adv.id}
        label={t('title')}
        isLoading={query.isPending && enabled}
        isError={query.isError}
        errorMessage={tc('loadFailed')}
        rowHref={(adv) => `/procurement/advances/${adv.id}`}
        emptyState={
          data.length === 0 ? (
            <EmptyState
              icon={<WalletIcon size={28} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyDesc')}
            />
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="adv-posting-status" label={t('filterByPostingStatus')}>
              <Select
                id="adv-posting-status"
                value={postingFilter}
                onChange={(value) => setPostingFilter(value as BillPostingStatus | '')}
              >
                <option value="">{t('allPostingStatuses')}</option>
                {POSTING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tPosting(s)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={postingFilter !== '' ? () => setPostingFilter('') : undefined}
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('detailTitle')}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PostingStatusBadge status={advance.postingStatus} />
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
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
