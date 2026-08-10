'use client';

/**
 * Supplier payments — list and detail (Tier C).
 *
 * Hosted under `/finance/accounting/payments`, alongside bills, and living in
 * `features/procurement` for the same reason bills do: the dependency runs procurement →
 * accounting and never back.
 *
 * Neither response embeds anything — no supplier, no bank account, no allocations — so both
 * screens join against the lists they already hold. That join is why `useSuppliers` and
 * `useBankAccounts` are called here rather than only in the form.
 */

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

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';

import { useSupplierPayment, useSupplierPayments, useSuppliers } from '../hooks/use-procurement';
import { bankAccountLabel } from '../payment-actions';
import type { SupplierPayment } from '../types';
import { PaymentActionBar } from './payment-actions-bar';
import { PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierPaymentsList() {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const payments = useSupplierPayments();
  const suppliers = useSuppliers();

  const supplierById = new Map((suppliers.data ?? []).map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(ACCOUNTING_PERMISSIONS.managePayables) ? (
          <Button asChild>
            <Link href="/finance/accounting/payments/new">{t('new')}</Link>
          </Button>
        ) : null}
      </div>

      <Alert variant="info" messages={[t('advanceOnlyNotice')]} />

      {payments.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('number')}</TableHead>
              <TableHead>{tc('supplier')}</TableHead>
              <TableHead>{t('paymentDate')}</TableHead>
              <TableHead>{t('method')}</TableHead>
              <TableHead className="text-end">{t('totalAmount')}</TableHead>
              <TableHead className="text-end">{t('unallocated')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>{t('postingStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(payments.data ?? []).length === 0 ? (
              <TableEmpty colSpan={8}>{t('empty')}</TableEmpty>
            ) : (
              (payments.data ?? []).map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    <Link
                      href={`/finance/accounting/payments/${payment.id}`}
                      className="font-mono text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
                    >
                      {/* Null until the payment posts — the PMT- sequence is claimed inside
                          the posting transaction, so every draft is unnumbered. Nothing may
                          key a row on it. */}
                      {payment.paymentNumber ?? t('unnumbered')}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {supplierById.get(payment.supplierId)?.name ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(payment.paymentDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {payment.paymentMethod}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatMoney(payment.totalAmount, payment.currencyCode, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {formatMoney(payment.unallocatedAmount, payment.currencyCode, locale)}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={payment.documentStatus} />
                  </TableCell>
                  <TableCell>
                    <PostingStatusBadge status={payment.postingStatus} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────────

export function SupplierPaymentDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';

  const query = useSupplierPayment(id);
  const suppliers = useSuppliers();
  const bankAccounts = useBankAccounts();

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const payment: SupplierPayment = query.data;
  const supplier = (suppliers.data ?? []).find((s) => s.id === payment.supplierId);
  const bank = (bankAccounts.data ?? []).find((b) => b.id === payment.bankAccountId);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {payment.paymentNumber ?? t('unnumbered')}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ProcurementStatusBadge status={payment.documentStatus} />
          <PostingStatusBadge status={payment.postingStatus} />
          <span className="text-sm text-muted-foreground">
            {supplier ? `${supplier.code} · ${supplier.name}` : tc('notAvailable')}
          </span>
        </div>
      </div>

      <PaymentActionBar payment={payment} />

      <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={t('paymentDate')}
          value={formatDate(payment.paymentDate, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('accountingDate')}
          value={formatDate(payment.accountingDate, locale) ?? tc('notAvailable')}
        />
        <Field label={t('method')} value={payment.paymentMethod} />
        <Field
          label={t('bankAccount')}
          value={bank ? bankAccountLabel(bank) : tc('notAvailable')}
        />
        <Field label={t('bankReference')} value={payment.bankReference ?? tc('notAvailable')} />
        <Field
          label={t('totalAmount')}
          value={formatMoney(payment.totalAmount, payment.currencyCode, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('allocated')}
          value={
            formatMoney(payment.allocatedAmount, payment.currencyCode, locale) ??
            tc('notAvailable')
          }
        />
        <Field
          label={t('unallocated')}
          value={
            formatMoney(payment.unallocatedAmount, payment.currencyCode, locale) ??
            tc('notAvailable')
          }
        />
        <Field label={tc('notes')} value={payment.notes ?? tc('notAvailable')} />
      </dl>

      {/* There is no allocations list, and this says so rather than rendering an empty table
          that would read as "this payment settled nothing". `GET /payments/:id` advertises
          allocations and returns none, and no endpoint lists them. */}
      <Alert variant="info" title={t('allocationsTitle')} messages={[t('allocationsUnavailable')]} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
