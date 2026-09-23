'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, LtrValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';
import type { BadgeTone } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import type { PurchaseOrderStatus } from '../../types';
import { usePurchaseOrders } from '../../hooks/use-procurement';

const STATUS_TONE: Record<PurchaseOrderStatus, BadgeTone> = {
  DRAFT: 'neutral',
  OPEN: 'live',
  CLOSED: 'historical',
  CANCELLED: 'historical',
};

export function ProjectPurchaseList({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.project.purchases');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const { can } = usePermissions();
  const query = usePurchaseOrders({ projectId });

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[t('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const orders = query.data;
  const canCreate = can(PROCUREMENT_PERMISSIONS.createOrder);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-h3 font-semibold text-foreground">{t('title')}</h3>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate ? (
          <Button asChild size="sm">
            <Link href={`/projects/${projectId}/procurement/purchases/new`}>
              {t('newPurchase')}
            </Link>
          </Button>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<ShoppingCart size={24} aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
        />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.poNumber')}</TableHead>
                <TableHead>{t('col.supplier')}</TableHead>
                <TableHead className="text-end">{t('col.amount')}</TableHead>
                <TableHead>{t('col.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((po) => {
                const revision = po.revisions[0] ?? null;
                const supplierName = po.supplier?.name ?? t('noSupplier');
                const amount = revision?.quotedAmount ?? null;
                const currency = revision?.currencyCode ?? 'USD';

                return (
                  <TableRow
                    key={po.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      router.push(`/projects/${projectId}/procurement/purchases/${po.id}`)
                    }
                  >
                    <TableCell className="whitespace-nowrap font-mono text-caption text-muted-foreground">
                      {po.poNumber}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{supplierName}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {amount !== null ? (
                        <LtrValue>
                          {formatMoney(amount, currency, locale) ?? t('noAmount')}
                        </LtrValue>
                      ) : (
                        <span className="text-muted-foreground">{t('noAmount')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[po.status]}>{t(`status.${po.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </div>
  );
}
