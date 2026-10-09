'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button, StatusPill, type StatusTone } from '@erp/ui';
import type { PurchaseOrderBillPaymentRow, SupplierBillPaymentState } from '@erp/types';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';

import { usePurchaseOrderBillPayments } from '../hooks/use-procurement';

const STATE_TONE: Record<SupplierBillPaymentState, StatusTone> = {
  NOT_POSTED: 'neutral',
  UNPAID: 'attention',
  PAYMENT_IN_PROGRESS: 'progress',
  PARTIALLY_PAID: 'progress',
  PAID: 'success',
  // ADR-045: settled from the buyer's cash (a posted advance application), not a bank payment.
  PAID_BY_BUYER_CASH: 'success',
  REVERSED: 'historical',
};

/**
 * ADR-043 decision 4 — the supplier bills raised against a purchase order and how far each is
 * paid (paid, in progress, outstanding, last payment), from
 * `GET /procurement/purchase-orders/:id/bill-payments`. Every figure is the server's.
 *
 * Rendered — and the endpoint called — ONLY for holders of `view:procurement` AND
 * `view:commitment-ledger` (the endpoint's gate): Procurement Manager, Construction Director,
 * Finance. Project Managers and Site Engineers stay money-blind on supplier payments.
 * A row links to the accounting bill page only for holders of `manage:payable` (its gate).
 */
export function PoBillPaymentsSection({ purchaseOrderId }: { purchaseOrderId: string }) {
  const t = useTranslations('procurement.po.billPayments');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const allowed = can(PROCUREMENT_PERMISSIONS.view) && can(PROCUREMENT_PERMISSIONS.viewCommitments);
  const canOpenBill = can(ACCOUNTING_PERMISSIONS.managePayables);
  const query = usePurchaseOrderBillPayments(purchaseOrderId, { enabled: allowed });

  if (!allowed) return null;

  const money = (row: PurchaseOrderBillPaymentRow, value: string) => (
    <bdi className="tabular-nums">{formatMoney(value, row.currencyCode, locale) ?? value}</bdi>
  );

  const columns: GridColumn<PurchaseOrderBillPaymentRow>[] = [
    {
      key: 'bill',
      header: t('bill'),
      sticky: true,
      card: 'title',
      plainValue: (row) => [row.billNumber, row.supplierInvoiceNumber].filter(Boolean).join(' '),
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-foreground">{row.billNumber ?? t('draft')}</span>
          <span className="block text-caption font-normal text-muted-foreground">
            {t('supplierRef', { ref: row.supplierInvoiceNumber })}
          </span>
        </span>
      ),
    },
    { key: 'total', header: t('total'), numeric: true, card: 'amount', render: (row) => money(row, row.totalAmount) },
    { key: 'paid', header: t('paid'), numeric: true, render: (row) => money(row, row.paidAmount) },
    { key: 'pending', header: t('pending'), numeric: true, render: (row) => money(row, row.pendingAmount) },
    { key: 'outstanding', header: t('outstanding'), numeric: true, render: (row) => money(row, row.outstandingAmount) },
    {
      key: 'lastPayment',
      header: t('lastPayment'),
      card: 'meta',
      render: (row) => (
        <span className="text-muted-foreground">{formatDate(row.lastPaymentDate, locale) ?? t('none')}</span>
      ),
    },
    {
      key: 'status',
      header: t('status'),
      card: 'status',
      render: (row) => <StatusPill tone={STATE_TONE[row.paymentStatus] ?? 'neutral'}>{t(`state.${row.paymentStatus}`)}</StatusPill>,
    },
  ];

  return (
    <section
      aria-labelledby="po-bill-payments-title"
      data-po-bill-payments
      className="space-y-3 rounded-panel border border-border bg-surface p-4 shadow-e1"
    >
      <div>
        <h2 id="po-bill-payments-title" className="text-h3 font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="text-caption text-muted-foreground">{t('hint')}</p>
      </div>
      {query.isError ? (
        <div className="space-y-2">
          <p className="text-body-sm text-danger">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <PlatformDataGrid
          label={t('title')}
          columns={columns}
          data={query.data?.bills ?? []}
          rowKey={(row) => row.billId}
          isLoading={query.isPending}
          toolbar={false}
          sortControl={false}
          rowHref={canOpenBill ? (row) => `/finance/accounting/bills/${row.billId}` : undefined}
          emptyState={<p className="p-4 text-body-sm text-muted-foreground">{t('empty')}</p>}
        />
      )}
    </section>
  );
}
