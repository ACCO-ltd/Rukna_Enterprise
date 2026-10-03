'use client';

/**
 * The body of a supplier bill (ADR-036): the facts under its identity, the Lines and Journal
 * items tabs, the totals and the summary rail.
 *
 * Every figure and row comes from the API: the approval chain, history and payment totals from
 * the ADR-036 read endpoints (`/bills/:id/approvals`, `/activity`, `/payments`), with money
 * computed server-side — the frontend does no money arithmetic.
 */

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ActivityTimeline,
  ApprovalTimeline,
  type ApprovalStep,
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
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';
import { statusLabel } from '@/lib/status-registry';

import {
  useGoodsReceipts,
  usePurchaseOrder,
  useSupplierBillActivity,
  useSupplierBillApprovals,
  useSupplierBillPayments,
} from '../hooks/use-procurement';
import { isSettleableBill } from '../bill-actions';
import { savedNetVariance } from '../bill-create';
import type { BillApprovalStepState, SupplierBill } from '../types';
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
                <NetVarianceNote line={line} />
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

/**
 * A line whose net was typed over `quantity × unit price` says so — the difference the clerk
 * accepted stays visible on the bill (Eng Ahmed, 2026-09-27).
 */
function NetVarianceNote({ line }: { line: NonNullable<SupplierBill['lines']>[number] }) {
  const t = useTranslations('procurement.bills');
  const locale = useLocale() as 'en';
  const variance = savedNetVariance(line);
  if (!variance) return null;
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), 'USD', locale) ?? '';
  return (
    <span className="mt-1 block text-caption text-warning">
      {t('netDiffers', {
        net: money(variance.netMinor),
        diff: money(Math.abs(variance.diffMinor)),
        direction: variance.diffMinor > 0 ? 'more' : 'less',
        qty: formatNumber(line.quantity) ?? line.quantity ?? '',
        price: formatMoney(line.unitPrice, 'USD', locale) ?? line.unitPrice ?? '',
        computed: money(variance.computedMinor),
      })}
    </span>
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
    return (
      <p className="py-6 text-body-sm text-muted-foreground">
        {bill.postedJournalNumber
          ? t('journal.noAccessNumbered', { number: bill.postedJournalNumber })
          : t('journal.noAccess')}
      </p>
    );
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
  const payments = useSupplierBillPayments(bill.id);
  const live = isSettleableBill(bill);
  const paid = payments.data;
  const rows: TotalsRow[] = [
    {
      label: t('amountPaid'),
      value: <MoneyDisplay value={paid?.paidAmount} loading={payments.isPending} />,
    },
  ];
  // Money allocated by payments not yet posted is already off the balance; say where it went.
  if (paid && Number(paid.pendingAmount) > 0) {
    rows.push({ label: t('pendingPayments'), value: <MoneyDisplay value={paid.pendingAmount} /> });
  }
  return [
    ...rows,
    {
      label: t('balanceDue'),
      // Only a posted bill is owed; before posting, or once reversed, there is no balance.
      value: live ? <MoneyDisplay value={bill.outstandingAmount} /> : <MoneyDisplay value={null} />,
    },
    { label: t('paymentCount'), value: payments.isPending ? '…' : String(paid?.paymentCount ?? '—') },
    { label: t('dueDate'), value: formatDate(bill.dueDate, locale) ?? '—' },
    {
      label: t('postedAt'),
      value: bill.postedAt ? formatDate(bill.postedAt, locale) : tPosting(bill.postingStatus),
    },
  ];
}

// ─── Approvals ────────────────────────────────────────────────────────────────

const STEP_STATE: Record<BillApprovalStepState, ApprovalStep['state']> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
  SKIPPED: 'skipped',
  // Steps a stopped chain never reached were not required in the end.
  CANCELLED: 'skipped',
};

/** Role codes (`FINANCE_MANAGER`) as words ("Finance manager"). */
const roleWords = (role: string) => statusLabel(role);

export function useBillApprovalCount(bill: SupplierBill): number | undefined {
  const approvals = useSupplierBillApprovals(bill.id);
  const chain = approvals.data?.instances[0];
  if (chain) return chain.steps.length;
  return approvals.data?.directApproval ? 1 : undefined;
}

export function BillApprovalsTab({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const locale = useLocale() as 'en';
  const approvals = useSupplierBillApprovals(bill.id);

  if (approvals.isPending) return <Skeleton className="h-32 w-full" />;
  if (approvals.isError || !approvals.data) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('approvals.loadFailed')}</p>;
  }

  const { instances, directApproval } = approvals.data;
  const chain = instances[0];

  if (!chain) {
    return (
      <p className="py-6 text-body-sm text-muted-foreground">
        {directApproval
          ? t('approvals.direct', {
              name: directApproval.actor.name,
              at: formatDateTime(directApproval.at, locale) ?? '',
            })
          : t('approvals.none')}
      </p>
    );
  }

  const amount = chain.evaluatedAmount ? formatMoney(chain.evaluatedAmount, bill.currencyCode, locale) : null;
  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">
        {amount
          ? t('approvals.policy', { policy: chain.policyName, amount })
          : t('approvals.policyNoAmount', { policy: chain.policyName })}
      </p>
      <ApprovalTimeline
        label={t('approvals.label')}
        upcomingLabel={t('approvals.notReached')}
        steps={chain.steps.map((step) => ({
          id: String(step.stepOrder),
          title: roleWords(step.roleRequired),
          actor: step.actor?.name,
          at: step.actedAt ? (formatDateTime(step.actedAt, locale) ?? undefined) : undefined,
          state: STEP_STATE[step.state],
          comment: step.notes ?? undefined,
        }))}
      />
    </div>
  );
}

// ─── Activity ─────────────────────────────────────────────────────────────────

const KNOWN_CODES = new Set([
  'bills.create',
  'bills.update',
  'bills.submit',
  'bills.approve',
  'bills.post',
  'bills.reverse',
  'bills.return',
  'bills.reject',
  'approval.approve',
  'approval.reject',
  'bill-matching.run',
  'bill-matching.approve-exception',
  'bill-matching.resolve',
]);

/** Message keys cannot contain dots: `bill-matching.run` is looked up as `bill_matching_run`. */
const codeKey = (code: string) => code.replace(/[.-]/g, '_');

export function useBillActivityCount(bill: SupplierBill): number | undefined {
  return useSupplierBillActivity(bill.id).data?.length;
}

export function BillActivityTab({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const locale = useLocale() as 'en';
  const activity = useSupplierBillActivity(bill.id);

  if (activity.isPending) return <Skeleton className="h-32 w-full" />;
  if (activity.isError || !activity.data) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('activity.loadFailed')}</p>;
  }
  if (activity.data.length === 0) {
    return <p className="py-6 text-body-sm text-muted-foreground">{t('activity.empty')}</p>;
  }

  return (
    <ActivityTimeline
      entries={activity.data.map((entry) => ({
        id: entry.id,
        actor: entry.actor.name,
        action: (
          <>
            {KNOWN_CODES.has(entry.code)
              ? t(`activity.code.${codeKey(entry.code)}` as 'activity.code.bills_create', {
                  role: entry.detail ? roleWords(entry.detail) : '',
                })
              : t('activity.other', { code: entry.code })}
            {/* Return and reject carry the reason given — the history is where it is kept. */}
            {entry.reason ? (
              <span className="text-muted-foreground"> {t('activity.reason', { reason: entry.reason })}</span>
            ) : null}
          </>
        ),
        at: formatDateTime(entry.at, locale) ?? entry.at,
        code: entry.code,
      }))}
    />
  );
}
