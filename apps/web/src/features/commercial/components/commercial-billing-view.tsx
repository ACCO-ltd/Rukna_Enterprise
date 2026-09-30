'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialTodoItem,
  CommercialWorkspaceResponse,
} from '@erp/types';
import { ActionList, Alert, Button, MoneyDisplay, Notice, Skeleton, StatusPill, ViewSwitcher, type ActionListItem } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { statusTone } from '@/lib/status-registry';
import { useAccountingReadiness } from '@/features/finance/hooks/use-accounting-readiness';

import { useCommercialBilling } from '../hooks/use-commercial';
import { toClientReceivableView, type ClientReceivableView } from '../lib/collection-view-model';
import { PrepareInvoiceDialog } from './prepare-invoice-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';

type InvoiceView = 'needsAction' | 'unpaid' | 'all';

/**
 * Billing: what to do next, the invoices, and the money that came in.
 *
 * The To do rows come ranked from the server (`workspace.todo`); this view only turns each into a
 * sentence and at most one command. The first row's command is the screen's only primary. A
 * command that would post is not rendered while the ledger cannot post — the row says why.
 */
export function CommercialBillingView({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: CommercialWorkspaceResponse;
}) {
  const t = useTranslations('commercial.billingView');
  const billing = useCommercialBilling(projectId);
  const readiness = useAccountingReadiness();
  const ledgerBlocked = readiness.data !== undefined && !readiness.data.ready;
  const setupLeft = readiness.data?.blockers.length ?? 0;
  // Same destination rule as the finance module's own setup notice.
  const setupHref =
    readiness.data?.blockers[0]?.code === 'NO_OPEN_PERIOD'
      ? '/finance/accounting/periods'
      : '/finance/accounting/chart-of-accounts';

  const [prepareFor, setPrepareFor] = useState<string | null>(null);
  const [paymentFor, setPaymentFor] = useState<ClientReceivableView | null | 'none'>(null);

  // D5: one overdue rule on the server clock — the billing read model's asOf, never the browser's date.
  const today = billing.data?.asOf.slice(0, 10) ?? '';
  const receivables = useMemo(
    () => (billing.data?.invoices ?? []).map((row) => toClientReceivableView(row, today)),
    [billing.data, today],
  );
  const payable = receivables.filter((row) => row.canRecordPayment);
  const { capabilities, financialsVisible } = workspace;
  const canRecordPayment = capabilities.canRecordPayment && financialsVisible;

  return (
    <div className="space-y-4">
      {ledgerBlocked ? (
        <Notice
          tone="attention"
          title={t('ledger.title')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={setupHref}>{t('ledger.action')}</Link>
            </Button>
          }
        >
          {t('ledger.body', { count: setupLeft })}
        </Notice>
      ) : null}

      <TodoPanel
        projectId={projectId}
        workspace={workspace}
        ledgerBlocked={ledgerBlocked}
        receivables={receivables}
        onPrepare={setPrepareFor}
        onRecordPayment={(invoiceId) => setPaymentFor(receivables.find((row) => row.invoiceId === invoiceId) ?? 'none')}
      />

      {billing.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : billing.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]}>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => billing.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <InvoicesPanel projectId={projectId} invoices={billing.data.invoices} financialsVisible={financialsVisible} />
          <PaymentsPanel
            receipts={billing.data.receipts}
            financialsVisible={financialsVisible}
            onRecordPayment={canRecordPayment && !ledgerBlocked && payable.length > 0 ? () => setPaymentFor('none') : undefined}
          />
        </>
      )}

      {prepareFor ? (
        <PrepareInvoiceDialog projectId={projectId} installmentId={prepareFor} open onClose={() => setPrepareFor(null)} />
      ) : null}

      {paymentFor !== null ? (
        <RecordPaymentDialog
          open
          onOpenChange={(open) => !open && setPaymentFor(null)}
          projectId={projectId}
          currency={workspace.currency}
          preselectedInvoice={paymentFor === 'none' ? null : paymentFor}
          allInvoices={payable}
        />
      ) : null}
    </div>
  );
}

// ─── To do ───────────────────────────────────────────────────────────────────

function TodoPanel({
  projectId,
  workspace,
  ledgerBlocked,
  receivables,
  onPrepare,
  onRecordPayment,
}: {
  projectId: string;
  workspace: CommercialWorkspaceResponse;
  ledgerBlocked: boolean;
  receivables: ClientReceivableView[];
  onPrepare: (installmentId: string) => void;
  onRecordPayment: (invoiceId: string) => void;
}) {
  const t = useTranslations('commercial.billingView');
  const locale = useLocale() as 'en' | 'ar';
  const { todo, capabilities, financialsVisible } = workspace;
  // Verifying a milestone is manage:project (Progress → Review); others see the wait in words.
  const canVerify = usePermissions().can('manage:project');

  const items: ActionListItem[] = todo.map((item, index) => {
    // One primary per screen: the first row's command. Everything else is secondary.
    const variant = index === 0 ? 'default' : 'outline';
    return {
      key: item.id,
      tone: statusTone(item.kind, 'commercialTodo'),
      title: todoTitle(item, t),
      description: todoDescription(item, t, locale),
      amount:
        item.amount !== null || !financialsVisible ? (
          <MoneyDisplay value={item.amount} hidden={!financialsVisible} hiddenLabel={t('hidden')} />
        ) : undefined,
      action: todoAction(item, {
        projectId,
        variant,
        t,
        ledgerBlocked,
        canBill: capabilities.canBill,
        canVerify,
        canRecordPayment: capabilities.canRecordPayment && financialsVisible && receivables.some((row) => row.invoiceId === item.invoiceId && row.canRecordPayment),
        onPrepare,
        onRecordPayment,
      }),
    };
  });

  return (
    <section aria-labelledby="commercial-todo-title" className="rounded-panel border border-border bg-surface shadow-e1">
      <h2 id="commercial-todo-title" className="border-b border-border px-4 py-3 text-h3 font-semibold text-foreground">
        {t('todo.title', { count: todo.length })}
      </h2>
      {items.length > 0 ? (
        <ActionList items={items} aria-label={t('todo.label')} />
      ) : (
        <p className="px-4 py-4 text-body-sm text-muted-foreground">{t('todo.empty')}</p>
      )}
    </section>
  );
}

type Translate = ReturnType<typeof useTranslations>;

function stageLabel(item: CommercialTodoItem, t: Translate): string {
  return item.stageNumber
    ? t('todo.stage', { number: item.stageNumber, name: item.installmentName ?? '' })
    : (item.installmentName ?? '');
}

export function todoTitle(item: CommercialTodoItem, t: Translate): string {
  switch (item.kind) {
    case 'OVERDUE_INVOICE':
      return t('todo.overdueTitle', { number: item.invoiceNumber ?? '', days: item.daysOverdue ?? 0 });
    case 'READY_TO_INVOICE':
      return t('todo.readyTitle', { stage: stageLabel(item, t) });
    case 'DRAFT_INVOICE':
      return t('todo.draftTitle', { source: item.sourceLabel ?? stageLabel(item, t) });
    case 'ISSUED_NOT_SENT':
      return t('todo.notSentTitle', { number: item.invoiceNumber ?? '' });
    case 'BLOCKED_STAGE':
      return t('todo.blockedTitle', { stage: stageLabel(item, t) });
  }
}

function todoDescription(item: CommercialTodoItem, t: Translate, locale: 'en' | 'ar'): string {
  const date = (value: string | null) => formatDate(value, locale) ?? '';
  switch (item.kind) {
    case 'OVERDUE_INVOICE':
      return [item.sourceLabel, item.dueDate ? t('todo.dueOn', { date: date(item.dueDate) }) : null].filter(Boolean).join('. ') + '.';
    case 'READY_TO_INVOICE': {
      const released =
        item.releasedBy?.kind === 'MILESTONE'
          ? t('todo.releasedMilestone', {
              code: item.releasedBy.milestoneCode ?? '',
              date: date(item.releasedBy.verifiedAt),
            })
          : item.releasedBy?.kind === 'DATE'
            ? t('todo.releasedDate', { date: date(item.releasedBy.date) })
            : t('todo.releasedAdvance');
      const variations = item.unbilledVariations?.count
        ? ' ' + t('todo.unbilledVariations', { refs: item.unbilledVariations.references.join(', '), count: item.unbilledVariations.count })
        : '';
      return released + variations;
    }
    case 'DRAFT_INVOICE':
      return t('todo.draftBody', { date: date(item.createdAt) });
    case 'ISSUED_NOT_SENT':
      return t('todo.notSentBody');
    case 'BLOCKED_STAGE':
      return item.blocker === 'MILESTONE_NOT_LINKED'
        ? t('todo.notLinked')
        : item.blocker === 'MILESTONE_NOT_VERIFIED'
          ? t('todo.notVerified', {
              milestone:
                item.releasedBy?.kind === 'MILESTONE'
                  ? [item.releasedBy.milestoneCode, item.releasedBy.milestoneName].filter(Boolean).join(' ')
                  : '',
            })
          : t('todo.contractNotActive');
  }
}

function todoAction(
  item: CommercialTodoItem,
  ctx: {
    projectId: string;
    variant: 'default' | 'outline';
    t: Translate;
    ledgerBlocked: boolean;
    canBill: boolean;
    canVerify: boolean;
    canRecordPayment: boolean;
    onPrepare: (installmentId: string) => void;
    onRecordPayment: (invoiceId: string) => void;
  },
): React.ReactNode {
  const { t, variant, projectId } = ctx;
  const afterSetup = <span className="text-caption text-muted-foreground">{t('todo.afterSetup')}</span>;
  const invoiceHref = item.invoiceId ? `/projects/${projectId}/commercial/invoices/${item.invoiceId}` : null;

  switch (item.kind) {
    case 'OVERDUE_INVOICE':
      if (!ctx.canRecordPayment || !item.invoiceId) return null;
      if (ctx.ledgerBlocked) return afterSetup;
      return (
        <Button size="sm" variant={variant} onClick={() => ctx.onRecordPayment(item.invoiceId!)}>
          {t('todo.recordPayment')}
        </Button>
      );
    case 'READY_TO_INVOICE':
      // Preparing creates drafts only — nothing posts until Issue — so the ledger does not gate it.
      if (!ctx.canBill || !item.installmentId) return null;
      return (
        <Button size="sm" variant={variant} onClick={() => ctx.onPrepare(item.installmentId!)}>
          {t('todo.prepare')}
        </Button>
      );
    case 'DRAFT_INVOICE':
      return invoiceHref && ctx.canBill ? (
        <Button asChild size="sm" variant={variant}>
          <Link href={invoiceHref}>{t('todo.reviewDraft')}</Link>
        </Button>
      ) : null;
    case 'ISSUED_NOT_SENT':
      return invoiceHref && ctx.canBill ? (
        <Button asChild size="sm" variant={variant}>
          <Link href={invoiceHref}>{t('todo.send')}</Link>
        </Button>
      ) : null;
    case 'BLOCKED_STAGE':
      // No billing button: the work is done in Progress. A link, not a command.
      if (item.blocker === 'CONTRACT_NOT_ACTIVE') return null;
      if (item.blocker === 'MILESTONE_NOT_VERIFIED' && !ctx.canVerify) {
        return <span className="text-caption text-muted-foreground">{t('todo.waitingVerification')}</span>;
      }
      return (
        <Link href={`/projects/${projectId}/progress${item.blocker === 'MILESTONE_NOT_VERIFIED' ? '/review' : ''}`} className="inline-flex min-h-11 items-center text-body-sm font-medium text-brand-primary hover:underline">
          {item.blocker === 'MILESTONE_NOT_LINKED' ? t('todo.linkInProgress') : t('todo.verifyInProgress')}
        </Link>
      );
  }
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export function invoiceNeedsAction(row: CommercialInvoiceRow): boolean {
  return (
    row.status === 'DRAFT' ||
    row.status === 'AWAITING_POSTING' ||
    row.daysOverdue > 0 ||
    (row.postingStatus === 'POSTED' && row.status !== 'PAID' && !row.sentAt)
  );
}

export function invoiceIsUnpaid(row: CommercialInvoiceRow): boolean {
  return row.status === 'UNPAID' || row.status === 'PARTIALLY_PAID';
}

/** The collection word for an issued invoice; drafts use the document vocabulary instead. */
export function collectionState(row: CommercialInvoiceRow): string {
  if (row.status === 'UNPAID') return row.daysOverdue > 0 ? 'OVERDUE' : 'AWAITING_PAYMENT';
  if (row.status === 'PARTIALLY_PAID' && row.daysOverdue > 0) return 'OVERDUE';
  return row.status;
}

function InvoicesPanel({
  projectId,
  invoices,
  financialsVisible,
}: {
  projectId: string;
  invoices: CommercialInvoiceRow[];
  financialsVisible: boolean;
}) {
  const t = useTranslations('commercial.billingView');
  const tDoc = useTranslations('commercial.billingView.documentStatus');
  const tCol = useTranslations('commercial.billingView.collectionStatus');
  const locale = useLocale() as 'en' | 'ar';
  const live = invoices.filter((row) => row.status !== 'CANCELLED');
  const needsAction = live.filter(invoiceNeedsAction);
  const unpaid = live.filter(invoiceIsUnpaid);
  const [view, setView] = useState<InvoiceView>(needsAction.length > 0 ? 'needsAction' : 'all');
  const rows = view === 'needsAction' ? needsAction : view === 'unpaid' ? unpaid : live;

  const money = (value: string | null) => (
    <MoneyDisplay value={value} hidden={!financialsVisible} hiddenLabel={t('hidden')} />
  );

  const columns: GridColumn<CommercialInvoiceRow>[] = [
    {
      key: 'invoice',
      header: t('invoices.invoice'),
      card: 'title',
      plainValue: (row) => row.invoiceNumber ?? '',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{row.invoiceNumber ?? t('invoices.draft')}</p>
          <p className="text-caption text-muted-foreground">{sourceLine(row, t)}</p>
        </div>
      ),
    },
    {
      key: 'due',
      header: t('invoices.due'),
      card: 'meta',
      plainValue: (row) => row.dueDate ?? '',
      render: (row) => (row.postingStatus === 'POSTED' ? (formatDate(row.dueDate, locale) ?? '—') : '—'),
    },
    { key: 'total', header: t('invoices.total'), numeric: true, redacted: !financialsVisible, card: 'amount', render: (row) => money(row.totalAmount) },
    {
      key: 'balance',
      header: t('invoices.balance'),
      numeric: true,
      redacted: !financialsVisible,
      // A draft has no balance yet — it is not a claim on the client until it is issued.
      render: (row) => (row.postingStatus === 'POSTED' ? money(row.outstandingAmount) : '—'),
    },
    {
      key: 'status',
      header: t('invoices.status'),
      card: 'status',
      render: (row) =>
        row.postingStatus === 'POSTED' ? (
          <StatusPill tone={statusTone(collectionState(row), 'invoiceCollection')}>{tCol(collectionState(row))}</StatusPill>
        ) : (
          <StatusPill tone={statusTone(row.status === 'AWAITING_POSTING' ? 'AWAITING_POSTING' : 'DRAFT', 'invoiceCollection')}>
            {tDoc(row.status === 'AWAITING_POSTING' ? 'AWAITING_POSTING' : 'DRAFT')}
          </StatusPill>
        ),
    },
  ];

  return (
    <section aria-labelledby="commercial-invoices-title" className="space-y-3 rounded-panel border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="commercial-invoices-title" className="text-h3 font-semibold text-foreground">
          {t('invoices.title')}
        </h2>
        <ViewSwitcher
          aria-label={t('invoices.viewLabel')}
          value={view}
          onValueChange={(value) => setView(value as InvoiceView)}
          items={[
            { value: 'needsAction', label: t('invoices.needsAction', { count: needsAction.length }) },
            { value: 'unpaid', label: t('invoices.unpaid', { count: unpaid.length }) },
            { value: 'all', label: t('invoices.all', { count: live.length }) },
          ]}
        />
      </div>
      <PlatformDataGrid
        label={t('invoices.title')}
        columns={columns}
        data={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/projects/${projectId}/commercial/invoices/${row.id}`}
        // A project holds a handful of invoices; search appears only when there are enough to need it.
        toolbar={live.length > 20}
        sortControl={false}
        emptyState={<p className="p-4 text-body-sm text-muted-foreground">{t('invoices.empty')}</p>}
      />
    </section>
  );
}

function sourceLine(row: CommercialInvoiceRow, t: Translate): string {
  const label = row.source.label ?? '';
  switch (row.source.kind) {
    case 'SEPARATE_CHARGE':
      return t('invoices.sourceSeparate', { label });
    case 'INSTALLMENT':
      return t('invoices.sourceStage', { label });
    case 'IPC':
      return t('invoices.sourceIpc', { label });
    default:
      return label;
  }
}

// ─── Payments received ───────────────────────────────────────────────────────

function PaymentsPanel({
  receipts,
  financialsVisible,
  onRecordPayment,
}: {
  receipts: CommercialReceiptRow[];
  financialsVisible: boolean;
  onRecordPayment?: () => void;
}) {
  const t = useTranslations('commercial.billingView');
  const locale = useLocale() as 'en' | 'ar';

  const columns: GridColumn<CommercialReceiptRow>[] = [
    {
      key: 'received',
      header: t('payments.received'),
      card: 'title',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{formatDate(row.receiptDate, locale) ?? '—'}</p>
          <p className="text-caption text-muted-foreground">
            {[row.receiptNumber, row.reference].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    { key: 'account', header: t('payments.into'), card: 'meta', render: (row) => row.depositAccountLabel ?? row.paymentMethod ?? '—' },
    {
      key: 'applied',
      header: t('payments.appliedTo'),
      render: (row) => row.allocations.map((allocation) => allocation.invoiceNumber).filter(Boolean).join(', ') || '—',
    },
    {
      key: 'amount',
      header: t('payments.amount'),
      numeric: true,
      redacted: !financialsVisible,
      card: 'amount',
      render: (row) => <MoneyDisplay value={row.totalAmount} hidden={!financialsVisible} hiddenLabel={t('hidden')} />,
    },
  ];

  return (
    <section aria-labelledby="commercial-payments-title" className="space-y-3 rounded-panel border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="commercial-payments-title" className="text-h3 font-semibold text-foreground">
          {t('payments.title')}
        </h2>
        {onRecordPayment ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRecordPayment}>
            <Plus size={15} aria-hidden="true" />
            {t('payments.record')}
          </Button>
        ) : null}
      </div>
      <PlatformDataGrid
        label={t('payments.title')}
        columns={columns}
        data={receipts}
        rowKey={(row) => row.id}
        toolbar={false}
        sortControl={false}
        emptyState={<p className="p-4 text-body-sm text-muted-foreground">{t('payments.empty')}</p>}
      />
    </section>
  );
}
