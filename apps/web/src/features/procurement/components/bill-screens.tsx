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
 *  - **Creating a bill.** Tier B. `POST /bills` is reachable now that suppliers and posting
 *    profiles have endpoints, but only for bills with no purchase order attached: a bill
 *    never records a `purchaseOrderRevisionId` (A14 / #33), so a PO-linked one can never be
 *    matched, skips the match gate entirely, and leaves its commitment stranded at ACCRUED.
 *  - **Posting.** `POST /bills/:id/post` exists and needs an `apAccountCode`. The gate lives
 *    in `canPostBill` and is deliberately stricter than the server (P15).
 *
 * The supplier's name is no longer missing. `supplier-bill.repository.ts:47` selects
 * `{ id, code, name }` on both list and detail (P16, fixed) — note it omits `nameAr`, so an
 * Arabic UI shows the English name here while a purchase order shows the Arabic one (A13).
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';

import { useSupplierBill, useSupplierBills } from '../hooks/use-procurement';
import { canPostBill } from '../quantities';
import type { SupplierBill } from '../types';
import { BillActionBar } from './bill-actions-bar';
import { ClassificationChips } from './classification-chips';
import { BillMatchingTab } from './bill-matching';
import { BillMatchStatusBadge, PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

// ─── List ────────────────────────────────────────────────────────────────────────

export function SupplierBillsList() {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const bills = useSupplierBills();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(ACCOUNTING_PERMISSIONS.managePayables) ? (
          <Button asChild>
            <Link href="/finance/accounting/bills/new">{t('new')}</Link>
          </Button>
        ) : null}
      </div>

      {/* Informational, not a block: creating a bill works, and only the PO-linked variant
          is unavailable. A warning banner over a screen whose primary action succeeds is how
          a working feature gets read as broken. */}
      <Alert variant="info" title={t('createBlockedTitle')} messages={[t('createBlockedBody')]} />

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
                    {bill.supplier ? (
                      <span className="text-sm text-foreground">
                        <span className="font-mono text-xs text-muted-foreground">
                          {bill.supplier.code}
                        </span>{' '}
                        {bill.supplier.name}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {tc('notAvailable')}
                      </span>
                    )}
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
                    <ProcurementStatusBadge status={bill.documentStatus} />
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
          <ProcurementStatusBadge status={bill.documentStatus} />
          <PostingStatusBadge status={bill.postingStatus} />
          <BillMatchStatusBadge status={bill.matchStatus} />
          <span className="text-sm text-muted-foreground">
            {bill.supplier
              ? `${bill.supplier.code} · ${bill.supplier.name}`
              : tc('notAvailable')}
          </span>
        </div>
      </div>

      {!postable ? (
        <Alert
          variant="warning"
          messages={[tMatch('postBlockedTooltip'), tMatch('postAdvisoryNotice')]}
        />
      ) : null}

      <BillActionBar bill={bill} />

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
                        <TableCell className="text-sm">
                          {line.description}
                          {/* Read-only classification chip (D7). A bill line carries a
                              boqNodeId when it is booked to a cost target; the chip states
                              that a target is set without naming the BOQ path the read model
                              does not send. */}
                          <ClassificationChips
                            className="mt-1.5 flex flex-wrap items-center gap-1.5"
                            hasCostTarget={Boolean(line.boqNodeId)}
                          />
                        </TableCell>
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
