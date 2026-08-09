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
 *  - **Creating a bill.** Needs a `supplierId` and an `expenseProfileCode`, neither of
 *    which has an endpoint (#26). No create button is offered; the banner says why.
 *  - **The supplier's name.** Neither repository method embeds the `supplier` relation
 *    (P16) and no endpoint resolves an id, so these screens show "Supplier unavailable"
 *    rather than a raw cuid, which would be worse than nothing.
 *  - **Posting.** `POST /bills/:id/post` exists, but posting requires a posting-profile
 *    picker that #26 also blocks, so this page does not offer it. The Post gate lives in
 *    `canPostBill` ready for when it does.
 */

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import { canPostBill } from '../quantities';
import type { SupplierBill } from '../types';
import { BillMatchingTab } from './bill-matching';
import { BillMatchStatusBadge, ProcurementStatusBadge } from './procurement-badges';

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList() {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';

  const bills = useSupplierBills();

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Alert
        variant="warning"
        title={t('createBlockedTitle')}
        messages={[t('createBlockedBody'), t('readOnlyNotice')]}
      />

      {bills.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoiceNumber')}</TableHead>
              <TableHead>{tc('supplier')}</TableHead>
              <TableHead>{t('billDate')}</TableHead>
              <TableHead>{t('dueDate')}</TableHead>
              <TableHead className="text-end">{t('totalAmount')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>{t('matchStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(bills.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>{t('empty')}</TableEmpty>
            ) : (
              (bills.data ?? []).map((bill) => (
                <TableRow key={bill.id}>
                  <TableCell>
                    <Link
                      href={`/finance/accounting/bills/${bill.id}`}
                      className="font-mono text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
                    >
                      {bill.supplierInvoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className="text-sm text-muted-foreground"
                      title={tc('supplierUnavailableHint')}
                    >
                      {tc('supplierUnavailable')}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(bill.billDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(bill.dueDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatMoney(bill.totalAmount, bill.currencyCode, locale)}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={bill.status} />
                  </TableCell>
                  <TableCell>
                    <BillMatchStatusBadge status={bill.matchStatus} />
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

export function SupplierBillDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tMatch = useTranslations('procurement.matching');
  const locale = useLocale() as 'en' | 'ar';

  const query = useSupplierBill(id);

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const bill: SupplierBill = query.data;
  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const postable = canPostBill(bill.matchStatus, hasPoLink);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('detailTitle', { number: bill.supplierInvoiceNumber })}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ProcurementStatusBadge status={bill.status} />
          <BillMatchStatusBadge status={bill.matchStatus} />
          <span className="text-sm text-muted-foreground" title={tc('supplierUnavailableHint')}>
            {tc('supplierUnavailable')}
          </span>
        </div>
      </div>

      {/* The Post button is not rendered — posting needs a posting-profile picker that
          #26 also blocks. The gate is stated anyway, because it is the reason posting
          will stay unavailable on an unmatched bill once that lands. */}
      {!postable ? (
        <Alert
          variant="warning"
          messages={[tMatch('postBlockedTooltip'), tMatch('postAdvisoryNotice')]}
        />
      ) : null}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{t('tabDetails')}</TabsTrigger>
          <TabsTrigger value="matching">{t('tabMatching')}</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="space-y-4 pt-4">
            <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label={t('billDate')}
                value={formatDate(bill.billDate, locale) ?? tc('notAvailable')}
              />
              <Field
                label={t('dueDate')}
                value={formatDate(bill.dueDate, locale) ?? tc('notAvailable')}
              />
              <Field label={tc('currency')} value={bill.currencyCode} />
              <Field
                label={t('totalAmount')}
                value={formatMoney(bill.totalAmount, bill.currencyCode, locale) ?? ''}
              />
              <Field
                label={t('subtotal')}
                value={formatMoney(bill.subtotal, bill.currencyCode, locale) ?? ''}
              />
              <Field
                label={t('vat')}
                value={formatMoney(bill.vatAmount, bill.currencyCode, locale) ?? ''}
              />
            </dl>

            {bill.lines && bill.lines.length > 0 ? (
              <TableScroll aria-label={t('linesTitle')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-end">{tc('lineNumber')}</TableHead>
                      <TableHead>{tc('description')}</TableHead>
                      <TableHead className="text-end">{tc('quantity')}</TableHead>
                      <TableHead className="text-end">{tc('unitPrice')}</TableHead>
                      <TableHead className="text-end">{t('totalAmount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bill.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                        <TableCell className="text-sm">{line.description}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {line.quantity ?? tc('notAvailable')}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {formatMoney(line.unitPrice, bill.currencyCode, locale) ??
                            tc('notAvailable')}
                        </TableCell>
                        <TableCell className="text-end font-medium tabular-nums">
                          {formatMoney(line.grossAmount, bill.currencyCode, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="matching">
          <BillMatchingTab bill={bill} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
