'use client';

/**
 * The body of a supplier bill (ADR-036): the facts under its identity, the Lines and Journal
 * items tabs, the totals and the summary rail.
 *
 * Only what the API can actually supply is drawn. Approvals and Activity tabs are part of the
 * design but not rendered here: there is no endpoint yet that finds a bill's approval chain or
 * its per-record audit trail, and a tab of invented rows is worse than no tab. Payments count
 * and amount paid are left out for the same reason — the bill carries its outstanding balance,
 * not its allocations, and the frontend does no money arithmetic.
 */

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  type DefinitionFact,
  MoneyDisplay,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type TotalsRow,
} from '@erp/ui';

import { useJournal } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProject } from '@/features/projects/hooks/use-project';
import { formatDate, formatNumber } from '@/lib/format';

import { useGoodsReceipts, usePurchaseOrder } from '../hooks/use-procurement';
import type { SupplierBill } from '../types';
import { ClassificationChips } from './classification-chips';

const LINK = 'font-medium text-brand-primary hover:underline';

// ─── Facts ────────────────────────────────────────────────────────────────────

function ProjectLink({ id }: { id: string }) {
  const project = useProject(id);
  if (project.isPending) return <Skeleton className="inline-block h-4 w-32" />;
  return (
    <Link href={`/projects/${id}`} className={LINK}>
      {project.data?.name ?? id.slice(-8)}
    </Link>
  );
}

function PurchaseOrderLink({ id }: { id: string }) {
  const po = usePurchaseOrder(id);
  if (po.isPending) return <Skeleton className="inline-block h-4 w-24" />;
  return (
    <Link href={`/procurement/orders/${id}`} className={LINK}>
      {po.data?.poNumber ?? id.slice(-8)}
    </Link>
  );
}

function GoodsReceiptLinks({ purchaseOrderId }: { purchaseOrderId: string }) {
  const tc = useTranslations('procurement.common');
  const receipts = useGoodsReceipts({ purchaseOrderId });
  if (receipts.isPending) return <Skeleton className="inline-block h-4 w-24" />;
  // Posted receipts only — a draft receipt has not received anything yet.
  const posted = (receipts.data ?? []).filter((grn) => grn.status === 'POSTED');
  if (posted.length === 0) return <span className="text-muted-foreground">{tc('notAvailable')}</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {posted.map((grn) => (
        <Link key={grn.id} href={`/procurement/grn/${grn.id}`} className={LINK}>
          {grn.grnNumber}
        </Link>
      ))}
    </span>
  );
}

/** The facts under the bill's identity; source documents are links. */
export function useBillFacts(bill: SupplierBill): DefinitionFact[] {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en';

  const facts: DefinitionFact[] = [
    { label: tc('supplier'), value: bill.supplier?.name ?? tc('notAvailable') },
    { label: t('invoiceNumber'), value: bill.supplierInvoiceNumber },
  ];
  if (bill.projectId) facts.push({ label: tc('project'), value: <ProjectLink id={bill.projectId} /> });
  if (bill.purchaseOrderId) {
    facts.push({ label: t('purchaseOrder'), value: <PurchaseOrderLink id={bill.purchaseOrderId} /> });
    facts.push({ label: t('goodsReceipt'), value: <GoodsReceiptLinks purchaseOrderId={bill.purchaseOrderId} /> });
  }
  facts.push(
    { label: t('billDate'), value: formatDate(bill.billDate, locale) ?? tc('notAvailable') },
    { label: t('dueDate'), value: formatDate(bill.dueDate, locale) ?? tc('notAvailable') },
  );
  return facts;
}

// ─── Lines ────────────────────────────────────────────────────────────────────

export function BillLinesTab({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const lines = bill.lines ?? [];

  if (lines.length === 0) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('noLines')}</p>;
  }

  return (
    <TableScroll aria-label={t('linesTitle')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('lineItem')}</TableHead>
            <TableHead>{t('lineAccount')}</TableHead>
            <TableHead numeric>{tc('quantity')}</TableHead>
            <TableHead numeric>{tc('unitPrice')}</TableHead>
            <TableHead numeric>{tc('amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell>
                <span className="block font-medium">{line.description}</span>
                {/* Read-only classification chip (D7): a line booked to a cost target. */}
                <ClassificationChips
                  className="mt-1 flex flex-wrap items-center gap-1.5"
                  hasCostTarget={Boolean(line.boqNodeId)}
                />
              </TableCell>
              <TableCell className="font-mono text-caption text-muted-foreground">
                {line.expenseProfileCode}
              </TableCell>
              <TableCell numeric>{formatNumber(line.quantity) ?? '—'}</TableCell>
              <TableCell numeric>
                <MoneyDisplay value={line.unitPrice} />
              </TableCell>
              <TableCell numeric className="font-medium">
                <MoneyDisplay value={line.grossAmount} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

// ─── Journal items ────────────────────────────────────────────────────────────

/**
 * The ledger posting, read-only. Before posting it says so in a sentence; a user without
 * journal access is told the journal exists rather than shown an empty table.
 */
export function BillJournalTab({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const { can } = usePermissions();
  const journalId = bill.postedJournalEntryId ?? '';
  const mayRead = can(ACCOUNTING_PERMISSIONS.manageJournals);
  const journal = useJournal(mayRead ? journalId : '');

  if (!journalId) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('journal.notYet')}</p>;
  }
  if (!mayRead) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('journal.noAccess')}</p>;
  }
  if (journal.isPending) return <Skeleton className="h-32 w-full" />;
  if (journal.isError || !journal.data) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('journal.loadFailed')}</p>;
  }

  const entry = journal.data;
  return (
    <div className="space-y-3">
      <TableScroll aria-label={t('journal.title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('journal.account')}</TableHead>
              <TableHead>{t('journal.description')}</TableHead>
              <TableHead numeric>{t('postDebit')}</TableHead>
              <TableHead numeric>{t('postCredit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <span className="font-mono text-caption text-muted-foreground">{line.accountCodeSnapshot}</span>{' '}
                  {line.accountNameSnapshot}
                </TableCell>
                <TableCell className="text-muted-foreground">{line.description ?? '—'}</TableCell>
                <TableCell numeric>
                  {Number(line.debitAmount) !== 0 ? <MoneyDisplay value={line.debitAmount} /> : '—'}
                </TableCell>
                <TableCell numeric>
                  {Number(line.creditAmount) !== 0 ? <MoneyDisplay value={line.creditAmount} /> : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      <p className="text-body-sm text-muted-foreground">
        {t.rich('journal.postedAs', {
          number: entry.journalNumber ?? entry.id.slice(-8),
          link: (chunks) => (
            <Link href={`/finance/accounting/journals/${entry.id}`} className={LINK}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

// ─── Totals and summary ───────────────────────────────────────────────────────

export function useBillTotals(bill: SupplierBill) {
  const t = useTranslations('procurement.bills');
  const rows: TotalsRow[] = [
    { label: t('subtotal'), value: <MoneyDisplay value={bill.subtotal} /> },
    { label: t('vat'), value: <MoneyDisplay value={bill.vatAmount} /> },
  ];
  return {
    rows,
    total: { label: t('totalAmount'), value: <MoneyDisplay value={bill.totalAmount} /> },
    amountDue: { label: t('amountDue'), value: <MoneyDisplay value={bill.outstandingAmount} /> },
  };
}

export function useBillSummary(bill: SupplierBill): TotalsRow[] {
  const t = useTranslations('procurement.bills');
  const tPosting = useTranslations('procurement.postingStatus');
  const locale = useLocale() as 'en';
  const live = bill.postingStatus === 'POSTED';
  return [
    {
      label: t('balanceDue'),
      // Only a posted bill is owed; before posting, or once reversed, there is no balance.
      value: live ? <MoneyDisplay value={bill.outstandingAmount} /> : <MoneyDisplay value={null} />,
    },
    { label: t('dueDate'), value: formatDate(bill.dueDate, locale) ?? '—' },
    {
      label: t('postedAt'),
      value: bill.postedAt ? formatDate(bill.postedAt, locale) : tPosting(bill.postingStatus),
    },
  ];
}
