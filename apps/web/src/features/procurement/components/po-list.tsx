'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, FilterBar, FilterField, Select } from '@erp/ui';

import { formatDate } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';

import { usePurchaseOrders } from '../hooks/use-procurement';
import { latestRevision } from '../quantities';
import type { PurchaseOrder, PurchaseOrderStatus } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';

const STATUSES: PurchaseOrderStatus[] = ['OPEN', 'CLOSED', 'CANCELLED'];

/**
 * Purchase order list (§12.6).
 *
 * Two columns §12.6 asks for are missing, both because the list payload cannot support
 * them (P14). `findAll` embeds `revisions: { orderBy: revisionNumber desc, take: 1 }`
 * with **no lines**, so:
 *
 *  - "Total Amount" would need one detail fetch per row. It is omitted, and a line under
 *    the table says why rather than leaving a column silently absent.
 *  - The revision shown is the highest-numbered, which is the DRAFT whenever one is in
 *    progress — not the ACTIVE revision. The column is labelled "latest revision" and
 *    carries that revision's own status, which is what the payload actually contains.
 *
 * Calling it "Revision" and showing a draft number would be a quiet lie on a screen
 * people use to check what has been committed.
 */
export function PoList() {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const { can } = usePermissions();

  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const statusId = useId();

  const orders = usePurchaseOrders(status ? { status } : undefined);

  const columns: GridColumn<PurchaseOrder>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      plainValue: (po) => po.poNumber,
      render: (po) => <span className="font-mono text-caption font-medium">{po.poNumber}</span>,
    },
    {
      key: 'supplier',
      header: tc('supplier'),
      sortable: true,
      // `findAll` includes the whole supplier relation, so a name is expected here. The
      // fallback is for absence, not for a missing endpoint — that was P14/P16 and it is fixed.
      plainValue: (po) => po.supplier?.name ?? '',
      render: (po) => po.supplier?.name ?? <span className="text-muted-foreground">{tc('notAvailable')}</span>,
    },
    {
      key: 'revision',
      header: t('revision'),
      numeric: true,
      sortable: true,
      plainValue: (po) => latestRevision(po.revisions)?.revisionNumber ?? 0,
      render: (po) => latestRevision(po.revisions)?.revisionNumber ?? tc('notAvailable'),
    },
    {
      key: 'revisionStatus',
      header: t('revisionStatus'),
      render: (po) => {
        const revision = latestRevision(po.revisions);
        return revision ? <ProcurementStatusBadge status={revision.status} /> : null;
      },
    },
    {
      key: 'effectiveFrom',
      header: t('effectiveFrom'),
      sortable: true,
      plainValue: (po) => latestRevision(po.revisions)?.effectiveFrom ?? '',
      render: (po, ctx) => (
        <bdi>{formatDate(latestRevision(po.revisions)?.effectiveFrom, ctx.locale) ?? tc('notAvailable')}</bdi>
      ),
    },
    {
      key: 'status',
      header: tc('status'),
      render: (po) => <ProcurementStatusBadge status={po.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(PROCUREMENT_PERMISSIONS.createOrder) ? (
          <Button asChild>
            <Link href="/procurement/orders/new">{t('new')}</Link>
          </Button>
        ) : null}
      </div>

      {orders.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <PlatformDataGrid
        columns={columns}
        data={orders.data ?? []}
        rowKey={(po) => po.id}
        label={t('title')}
        isLoading={orders.isPending}
        rowHref={(po) => `/procurement/orders/${po.id}`}
        noMatchMessage={t('empty')}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id={statusId} label={tc('status')}>
              <Select
                id={statusId}
                value={status}
                onChange={(value) => setStatus(value as PurchaseOrderStatus | '')}
              >
                <option value="">{tc('all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => setStatus('')}
      />

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('totalUnavailable')}</p>
        <p>{t('latestRevisionNotice')}</p>
      </div>
    </div>
  );
}
