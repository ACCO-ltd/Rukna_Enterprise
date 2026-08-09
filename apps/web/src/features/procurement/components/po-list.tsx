'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { usePurchaseOrders } from '../hooks/use-procurement';
import { SUPPLIER_ENDPOINT_AVAILABLE } from '../api/procurement-api';
import { latestRevision } from '../quantities';
import type { PurchaseOrderStatus } from '../types';
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
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const statusId = useId();

  const orders = usePurchaseOrders(status ? { status } : undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Built, tested, and not reachable: POST /purchase-orders requires a supplierId
            and no endpoint lists suppliers (#26). Disabled with the reason attached beats
            a button that 400s, and beats omitting the action as though it were never
            designed. */}
        {can(PROCUREMENT_PERMISSIONS.createOrder) ? (
          SUPPLIER_ENDPOINT_AVAILABLE ? (
            <Button asChild>
              <Link href="/procurement/orders/new">{t('new')}</Link>
            </Button>
          ) : (
            <Button type="button" disabled title={t('createBlockedBody')}>
              {t('new')}
            </Button>
          )
        ) : null}
      </div>

      {can(PROCUREMENT_PERMISSIONS.createOrder) && !SUPPLIER_ENDPOINT_AVAILABLE ? (
        <Alert
          variant="warning"
          title={t('createBlockedTitle')}
          messages={[t('createBlockedBody')]}
        />
      ) : null}

      <div className="flex flex-wrap gap-4">
        <div className="min-w-44 flex-1">
          <label htmlFor={statusId} className="mb-1 block text-xs font-medium text-muted-foreground">
            {tc('status')}
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | '')}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{tc('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {orders.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('number')}</TableHead>
              <TableHead>{tc('supplier')}</TableHead>
              <TableHead>{tc('currency')}</TableHead>
              <TableHead className="text-end">{t('revision')}</TableHead>
              <TableHead>{t('revisionStatus')}</TableHead>
              <TableHead>{t('effectiveFrom')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(orders.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>{t('empty')}</TableEmpty>
            ) : (
              (orders.data ?? []).map((po) => {
                const revision = latestRevision(po.revisions);
                return (
                  <TableRow key={po.id}>
                    <TableCell>
                      <Link
                        href={`/procurement/orders/${po.id}`}
                        className="font-mono text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
                      >
                        {po.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {po.supplier?.name ?? (
                        <span className="text-muted-foreground" title={tc('supplierUnavailableHint')}>
                          {tc('supplierUnavailable')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {revision?.currencyCode ?? tc('notAvailable')}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {revision?.revisionNumber ?? tc('notAvailable')}
                    </TableCell>
                    <TableCell>
                      {revision ? <ProcurementStatusBadge status={revision.status} /> : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <bdi>
                        {formatDate(revision?.effectiveFrom, locale) ?? tc('notAvailable')}
                      </bdi>
                    </TableCell>
                    <TableCell>
                      <ProcurementStatusBadge status={po.status} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableScroll>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('totalUnavailable')}</p>
        <p>{t('latestRevisionNotice')}</p>
      </div>
    </div>
  );
}
