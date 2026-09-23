'use client';

import { useState } from 'react';
import {
  ChevronDown,
  CircleDollarSign,
  MessageSquare,
  ReceiptText,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, LtrValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';
import type {
  CommercialBillingPosition,
  CommercialBillingResponse,
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialSummaryResponse,
} from '@erp/types';

import { useOpenInvoiceDocument } from '@/features/accounting/hooks/use-invoices';
import { formatDate, formatMoney } from '@/lib/format';

import { useCommercialBilling } from '../hooks/use-commercial';
import {
  toClientReceivableView,
  toClientPaymentView,
  type ClientReceivableView,
  type ClientPaymentView,
  type CollectionPaymentState,
} from '../lib/collection-view-model';
import {
  getAttentionReasons,
  getLatestFollowUp,
  getLatestPromise,
  getOpenDispute,
  isMissedPromise,
  buildInvoiceTimeline,
  type TimelinePaymentEntry,
} from '../lib/collection-events';
import {
  CollectionEventProvider,
} from '../lib/collection-event-context';
import { RecordFollowUpDialog } from './record-followup-dialog';
import { RecordPromiseDialog } from './record-promise-dialog';
import { OpenDisputeDialog } from './open-dispute-dialog';
import { InvoiceTimelineDialog } from './invoice-timeline';
import { CreditNoteDesignDialog } from './credit-note-design-dialog';
import { AttentionList, SectionCard } from './commercial-ui';
import { errorText } from './commercial-workspace';
import { RecordPaymentDrawer } from './record-payment-drawer';

// ─── Main tab ────────────────────────────────────────────────────────────────

export function BillingCollectionTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.billing');
  const query = useCommercialBilling(projectId);
  const contract = summary.mainContract;
  const locale = useLocale() as 'en';
  const today = new Date().toISOString().slice(0, 10);

  if (!contract) {
    return (
      <EmptyState
        variant="page"
        title={t('noContractTitle')}
        description={t('noContractHint')}
      />
    );
  }

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('loadFailed')}
        messages={[errorText(query.error, t('loadFailedHint'))]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const billing = query.data;
  const currency = billing.currency ?? contract.currency;

  const receivables = billing.invoices.map((inv) => toClientReceivableView(inv, today));
  const payments = billing.receipts.map(toClientPaymentView);

  // Payment map for timeline: invoiceId → sorted allocation entries
  const paymentsByInvoice = buildPaymentsByInvoice(billing.receipts);

  // Build allEvents from server data (Slice 6B: replaces client-side context store)
  const allEvents = buildServerEventsMap(billing.invoices);

  return (
    // CollectionEventProvider kept as a no-op wrapper for any remaining consumers
    <CollectionEventProvider>
      <BillingCollectionInner
        projectId={projectId}
        summary={summary}
        billing={billing}
        currency={currency}
        locale={locale}
        today={today}
        receivables={receivables}
        payments={payments}
        paymentsByInvoice={paymentsByInvoice}
        allEvents={allEvents}
      />
    </CollectionEventProvider>
  );
}

/**
 * Build a CollectionEvent map from the server-side invoice rows.
 * Converts the Slice 6B server DTOs to the CollectionEvent union used by
 * the collection-events.ts utility functions.
 */
function buildServerEventsMap(
  invoices: CommercialInvoiceRow[],
): Map<string, import('../lib/collection-events').CollectionEvent[]> {
  const map = new Map<string, import('../lib/collection-events').CollectionEvent[]>();
  for (const inv of invoices) {
    const events: import('../lib/collection-events').CollectionEvent[] = [];

    for (const fu of inv.followUps ?? []) {
      events.push({
        kind: 'FOLLOW_UP',
        id: fu.id,
        invoiceId: inv.id,
        method: fu.method as import('../lib/collection-events').FollowUpMethod,
        contactPerson: fu.contactPerson,
        note: fu.note,
        recordedAt: fu.recordedAt,
      });
    }

    for (const p of inv.promises ?? []) {
      events.push({
        kind: 'PROMISE',
        id: p.id,
        invoiceId: inv.id,
        promisedDate: p.promisedDate,
        promisedAmount: p.promisedAmount,
        note: p.note,
        recordedAt: p.recordedAt,
      });
    }

    if (inv.openDispute) {
      events.push({
        kind: 'DISPUTE',
        id: inv.openDispute.id,
        invoiceId: inv.id,
        disputedAmount: inv.openDispute.disputedAmount,
        reason: inv.openDispute.reason as import('../lib/collection-events').DisputeReason,
        note: inv.openDispute.note,
        openedAt: inv.openDispute.openedAt,
        resolvedAt: inv.openDispute.resolvedAt,
      });
    }

    map.set(inv.id, events);
  }
  return map;
}

// Extracts payment allocations from receipts, keyed by invoiceId
function buildPaymentsByInvoice(
  receipts: CommercialReceiptRow[],
): Map<string, TimelinePaymentEntry[]> {
  const map = new Map<string, TimelinePaymentEntry[]>();
  for (const receipt of receipts) {
    for (const alloc of receipt.allocations) {
      const existing = map.get(alloc.invoiceId) ?? [];
      map.set(alloc.invoiceId, [
        ...existing,
        {
          date: receipt.receiptDate,
          amount: alloc.allocatedAmount,
          method: receipt.paymentMethod,
        },
      ]);
    }
  }
  return map;
}

// ─── Inner (consumes CollectionEventProvider) ────────────────────────────────

function BillingCollectionInner({
  projectId,
  summary,
  billing,
  currency,
  locale,
  today,
  receivables,
  payments,
  paymentsByInvoice,
  allEvents,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
  billing: CommercialBillingResponse;
  currency: string;
  locale: 'en';
  today: string;
  receivables: ClientReceivableView[];
  payments: ClientPaymentView[];
  paymentsByInvoice: Map<string, TimelinePaymentEntry[]>;
  allEvents: Map<string, import('../lib/collection-events').CollectionEvent[]>;
}) {
  return (
    <div className="space-y-4">
      <AttentionList items={summary.attention} />

      <ReceivablesSummaryStrip
        position={billing.position}
        financialsVisible={billing.financialsVisible}
        currency={currency}
        locale={locale}
      />

      <NeedsAttentionPanel
        receivables={receivables}
        allEvents={allEvents}
        currency={currency}
        locale={locale}
        today={today}
      />

      <OpenInvoicesPanel
        projectId={projectId}
        currency={currency}
        locale={locale}
        receivables={receivables}
        allEvents={allEvents}
        paymentsByInvoice={paymentsByInvoice}
        financialsVisible={billing.financialsVisible}
        canRecordReceipt={billing.capabilities.canRecordReceipt}
        today={today}
      />

      <RecentPaymentsPanel payments={payments} currency={currency} locale={locale} />
    </div>
  );
}

// ─── Receivables summary strip ────────────────────────────────────────────────

function ReceivablesSummaryStrip({
  position,
  financialsVisible,
  currency,
  locale,
}: {
  position: CommercialBillingPosition;
  financialsVisible: boolean;
  currency: string | null;
  locale: 'en';
}) {
  const t = useTranslations('commercial.billing.collection');

  const money = (value: string | null) =>
    !financialsVisible || value === null
      ? null
      : (formatMoney(value, currency, locale) ?? null);

  return (
    <dl className="grid overflow-hidden rounded-panel border border-border bg-surface shadow-e1 sm:grid-cols-2 lg:grid-cols-4">
      {(
        [
          [t('billed'), money(position.invoiced)],
          [t('collected'), money(position.collected)],
          [t('outstanding'), money(position.outstanding)],
          [t('overdue'), money(position.overdue)],
        ] as [string, string | null][]
      ).map(([label, value]) => (
        <div
          key={label}
          className="border-b border-border p-4 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e"
        >
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-2">
            {value !== null ? (
              <LtrValue className="text-h2 font-semibold tabular-nums text-foreground">
                {value}
              </LtrValue>
            ) : (
              <span className="text-body-sm text-muted-foreground">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Needs attention panel ────────────────────────────────────────────────────

function NeedsAttentionPanel({
  receivables,
  allEvents,
  currency,
  locale,
  today,
}: {
  receivables: ClientReceivableView[];
  allEvents: Map<string, import('../lib/collection-events').CollectionEvent[]>;
  currency: string | null;
  locale: 'en';
  today: string;
}) {
  const t = useTranslations('commercial.billing.collection');

  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, currency, locale) ?? '—');

  const overdueInvoices = receivables.filter((r) => r.paymentState === 'OVERDUE');

  // Missed promises: invoices with a promise whose date has passed (and not fully paid)
  const missedPromises = receivables
    .filter((r) => r.canRecordPayment)
    .flatMap((r) => {
      const events = allEvents.get(r.invoiceId) ?? [];
      const promise = getLatestPromise(events);
      if (promise && isMissedPromise(promise, today)) {
        return [{ invoice: r, promise }];
      }
      return [];
    });

  // Disputed invoices: invoices with an open dispute
  const disputedInvoices = receivables
    .filter((r) => r.canRecordPayment)
    .flatMap((r) => {
      const events = allEvents.get(r.invoiceId) ?? [];
      const dispute = getOpenDispute(events);
      if (dispute) return [{ invoice: r, dispute }];
      return [];
    });

  const hasAnything =
    overdueInvoices.length > 0 || missedPromises.length > 0 || disputedInvoices.length > 0;

  if (!hasAnything) return null;

  return (
    <SectionCard title={t('needsAttentionTitle')}>
      <div className="space-y-4 -mx-4 -my-3 sm:-mx-5">
        {/* Overdue section */}
        {overdueInvoices.length > 0 ? (
          <div>
            <p className="border-b border-border px-4 py-1.5 text-caption font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
              {t('attentionSectionOverdue')}
            </p>
            <ul className="divide-y divide-border">
              {overdueInvoices.map((inv) => {
                const events = allEvents.get(inv.invoiceId) ?? [];
                const lastFollowUp = getLatestFollowUp(events);
                return (
                  <OverdueAttentionItem
                    key={inv.invoiceId}
                    inv={inv}
                    lastFollowUpAt={lastFollowUp?.recordedAt ?? null}
                    money={money}
                    locale={locale}
                    t={t}
                  />
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Missed promises section */}
        {missedPromises.length > 0 ? (
          <div>
            <p className="border-b border-border px-4 py-1.5 text-caption font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
              {t('attentionSectionMissed')}
            </p>
            <ul className="divide-y divide-border">
              {missedPromises.map(({ invoice, promise }) => (
                <li
                  key={invoice.invoiceId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="flex items-baseline gap-2">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                    <span className="text-body-sm font-medium text-foreground">
                      <LtrValue>{invoice.invoiceNumber ?? t('unnumbered')}</LtrValue>
                    </span>
                    <span className="text-caption text-warning">
                      {t('missedPromise', { date: formatDate(promise.promisedDate, locale) ?? promise.promisedDate })}
                    </span>
                  </div>
                  <LtrValue className="text-body-sm font-semibold tabular-nums text-warning">
                    {money(invoice.outstanding)}
                  </LtrValue>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Disputed section */}
        {disputedInvoices.length > 0 ? (
          <div>
            <p className="border-b border-border px-4 py-1.5 text-caption font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
              {t('attentionSectionDisputed')}
            </p>
            <ul className="divide-y divide-border">
              {disputedInvoices.map(({ invoice, dispute }) => (
                <li
                  key={invoice.invoiceId}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                    <div>
                      <p className="text-body-sm font-medium text-foreground">
                        <LtrValue>{invoice.invoiceNumber ?? t('unnumbered')}</LtrValue>
                      </p>
                      {dispute.disputedAmount ? (
                        <p className="text-caption text-danger">
                          {t('disputedAmount', { amount: formatMoney(dispute.disputedAmount, currency, locale) ?? dispute.disputedAmount })}
                        </p>
                      ) : null}
                      <p className="text-caption text-muted-foreground">
                        {dispute.reason.replace(/_/g, ' ').toLowerCase()}
                      </p>
                    </div>
                  </div>
                  <LtrValue className="text-body-sm font-semibold tabular-nums text-muted-foreground">
                    {money(invoice.outstanding)}
                  </LtrValue>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function OverdueAttentionItem({
  inv,
  lastFollowUpAt,
  money,
  locale,
  t,
}: {
  inv: ClientReceivableView;
  lastFollowUpAt: string | null;
  money: (v: string | null) => string;
  locale: 'en';
  t: ReturnType<typeof useTranslations<'commercial.billing.collection'>>;
}) {
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <span className="text-body-sm font-medium text-foreground">
            <LtrValue>{inv.invoiceNumber ?? t('unnumbered')}</LtrValue>
          </span>
          <span className="text-caption text-danger">
            {t('overdueBy', { days: inv.overdueDays })}
          </span>
        </div>
        <LtrValue className="text-body-sm font-semibold tabular-nums text-danger">
          {money(inv.outstanding)}
        </LtrValue>
      </div>
      <p className="mt-0.5 text-caption text-muted-foreground">
        {lastFollowUpAt
          ? t('lastContact', { date: formatDate(lastFollowUpAt.slice(0, 10), locale) ?? lastFollowUpAt.slice(0, 10) })
          : t('noFollowUp')}
      </p>
    </li>
  );
}

// ─── Open invoices panel ──────────────────────────────────────────────────────

type ActiveDialog =
  | { kind: 'followup'; invoice: ClientReceivableView }
  | { kind: 'promise'; invoice: ClientReceivableView }
  | { kind: 'dispute'; invoice: ClientReceivableView }
  | { kind: 'timeline'; invoice: ClientReceivableView }
  | { kind: 'creditNote'; invoice: ClientReceivableView };

function paymentStateTone(
  state: CollectionPaymentState,
): 'live' | 'warning' | 'danger' | 'neutral' | 'historical' {
  switch (state) {
    case 'PAID':
      return 'live';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'OVERDUE':
      return 'danger';
    case 'AWAITING_PAYMENT':
      return 'neutral';
    case 'DRAFT':
    case 'CANCELLED':
      return 'historical';
    default:
      return 'neutral';
  }
}

function OpenInvoicesPanel({
  projectId,
  currency,
  locale,
  receivables,
  allEvents,
  paymentsByInvoice,
  financialsVisible,
  canRecordReceipt,
  today,
}: {
  projectId: string;
  currency: string | null;
  locale: 'en';
  receivables: ClientReceivableView[];
  allEvents: Map<string, import('../lib/collection-events').CollectionEvent[]>;
  paymentsByInvoice: Map<string, TimelinePaymentEntry[]>;
  financialsVisible: boolean;
  canRecordReceipt: boolean;
  today: string;
}) {
  const t = useTranslations('commercial.billing.collection');
  const tCol = useTranslations('commercial.billing.col');
  const openDocument = useOpenInvoiceDocument();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preselected, setPreselected] = useState<ClientReceivableView | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog | null>(null);

  const visible = receivables.filter((r) => r.paymentState !== 'CANCELLED');
  const payable = receivables.filter((r) => r.canRecordPayment);

  const money = (value: string | null) =>
    !financialsVisible || value === null
      ? '—'
      : (formatMoney(value, currency, locale) ?? '—');

  if (visible.length === 0) {
    return (
      <SectionCard title={t('openInvoicesTitle')}>
        <div className="flex items-start gap-2.5 py-2">
          <ReceiptText size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-body-sm text-muted-foreground">{t('noOpenInvoices')}</p>
        </div>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard title={t('openInvoicesTitle')} bodyClassName="px-0 py-0">
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tCol('invoice')}</TableHead>
                <TableHead>{tCol('source')}</TableHead>
                <TableHead>{tCol('issued')}</TableHead>
                <TableHead>{tCol('due')}</TableHead>
                <TableHead className="text-end">{tCol('total')}</TableHead>
                <TableHead className="text-end">{tCol('paid')}</TableHead>
                <TableHead className="text-end">{tCol('balance')}</TableHead>
                <TableHead>{tCol('status')}</TableHead>
                <TableHead>{tCol('action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((inv) => {
                const events = allEvents.get(inv.invoiceId) ?? [];
                const attentionReasons = getAttentionReasons(events, today);
                const openDispute = getOpenDispute(events);
                return (
                  <OpenInvoiceRow
                    key={inv.invoiceId}
                    inv={inv}
                    money={money}
                    locale={locale}
                    canRecordReceipt={canRecordReceipt}
                    attentionReasons={attentionReasons}
                    hasOpenDispute={openDispute !== null}
                    onRecord={() => {
                      setPreselected(inv);
                      setDrawerOpen(true);
                    }}
                    onViewDocument={() => openDocument.mutate(inv.invoiceId)}
                    openDocumentPending={openDocument.isPending}
                    onAction={(kind) => setActiveDialog({ kind, invoice: inv })}
                  />
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
          {t('vatNote')}
        </p>
      </SectionCard>

      {/* Record payment drawer */}
      <RecordPaymentDrawer
        open={drawerOpen}
        onOpenChange={(next) => {
          setDrawerOpen(next);
          if (!next) setPreselected(null);
        }}
        projectId={projectId}
        currency={currency ?? 'USD'}
        preselectedInvoice={preselected}
        allInvoices={payable}
      />

      {/* Collection action dialogs */}
      {activeDialog?.kind === 'followup' ? (
        <RecordFollowUpDialog
          open
          onOpenChange={(next) => !next && setActiveDialog(null)}
          invoice={activeDialog.invoice}
          projectId={projectId}
        />
      ) : null}
      {activeDialog?.kind === 'promise' ? (
        <RecordPromiseDialog
          open
          onOpenChange={(next) => !next && setActiveDialog(null)}
          invoice={activeDialog.invoice}
          projectId={projectId}
        />
      ) : null}
      {activeDialog?.kind === 'dispute' ? (
        <OpenDisputeDialog
          open
          onOpenChange={(next) => !next && setActiveDialog(null)}
          invoice={activeDialog.invoice}
          currency={currency ?? 'USD'}
          projectId={projectId}
        />
      ) : null}
      {activeDialog?.kind === 'timeline' ? (
        <InvoiceTimelineDialog
          open
          onOpenChange={(next) => !next && setActiveDialog(null)}
          invoice={activeDialog.invoice}
          currency={currency ?? 'USD'}
          entries={buildInvoiceTimeline({
            issuedAt: activeDialog.invoice.issuedAt,
            sentAt: activeDialog.invoice.sentAt,
            events: allEvents.get(activeDialog.invoice.invoiceId) ?? [],
            payments: paymentsByInvoice.get(activeDialog.invoice.invoiceId) ?? [],
            today,
          })}
        />
      ) : null}
      {activeDialog?.kind === 'creditNote' ? (
        <CreditNoteDesignDialog
          open
          onOpenChange={(next) => !next && setActiveDialog(null)}
          invoice={activeDialog.invoice}
          currency={currency ?? 'USD'}
        />
      ) : null}
    </>
  );
}

function OpenInvoiceRow({
  inv,
  money,
  locale,
  canRecordReceipt,
  attentionReasons,
  hasOpenDispute,
  onRecord,
  onViewDocument,
  openDocumentPending,
  onAction,
}: {
  inv: ClientReceivableView;
  money: (value: string | null) => string;
  locale: 'en';
  canRecordReceipt: boolean;
  attentionReasons: import('../lib/collection-events').AttentionReason[];
  hasOpenDispute: boolean;
  onRecord: () => void;
  onViewDocument: () => void;
  openDocumentPending: boolean;
  onAction: (kind: ActiveDialog['kind']) => void;
}) {
  const t = useTranslations('commercial.billing.collection');
  const tBilling = useTranslations('commercial.billing');

  // Due-status chip display for approaching deadlines
  const dueBadge = (() => {
    if (!inv.dueStatus || inv.dueStatus === 'CURRENT' || inv.dueStatus === 'OVERDUE') return null;
    if (inv.dueStatus === 'DUE_TODAY') {
      return (
        <span className="ms-1 inline-block rounded px-1 py-0 text-micro font-medium bg-warning/10 text-warning">
          {t('dueToday')}
        </span>
      );
    }
    return (
      <span className="ms-1 inline-block rounded px-1 py-0 text-micro font-medium bg-warning/10 text-warning">
        {t('dueStatus.DUE_SOON')}
      </span>
    );
  })();

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        <div className="flex items-center gap-1">
          <LtrValue>{inv.invoiceNumber ?? tBilling('unnumbered')}</LtrValue>
          {attentionReasons.includes('MISSED_PROMISE') ? (
            <TriangleAlert size={12} className="text-warning" aria-label="Missed promise" />
          ) : null}
          {hasOpenDispute ? (
            <ShieldAlert size={12} className="text-danger" aria-label="Open dispute" />
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-caption text-muted-foreground">{inv.sourceLabel}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(inv.issuedAt, locale) ?? '—'}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span
          className={cn(
            inv.paymentState === 'OVERDUE' ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {formatDate(inv.dueDate, locale) ?? '—'}
          {dueBadge}
        </span>
        {inv.paymentState === 'OVERDUE' && inv.overdueDays > 0 ? (
          <span className="block text-micro text-danger">
            {t('overdueBy', { days: inv.overdueDays })}
            {inv.agingBucket ? (
              <span className="ms-1">· {t(`agingBucket.${inv.agingBucket}`)}</span>
            ) : null}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(inv.total)}</TableCell>
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {money(inv.paid)}
      </TableCell>
      <TableCell className="text-end font-medium tabular-nums">{money(inv.outstanding)}</TableCell>
      <TableCell>
        <Badge tone={paymentStateTone(inv.paymentState)}>
          {t(`paymentState.${inv.paymentState}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {inv.canRecordPayment && canRecordReceipt ? (
            <Button type="button" variant="outline" size="sm" onClick={onRecord}>
              <CircleDollarSign size={13} className="me-1" aria-hidden />
              {t('recordPayment')}
            </Button>
          ) : null}

          {/* More-actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label="More actions">
                <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {inv.canRecordPayment ? (
                  <>
                    <DropdownMenuItem onSelect={() => onAction('followup')}>
                      <MessageSquare size={13} className="me-2" aria-hidden />
                      {t('recordFollowUp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onAction('promise')}>
                      {t('recordPromise')}
                    </DropdownMenuItem>
                    {!hasOpenDispute ? (
                      <DropdownMenuItem onSelect={() => onAction('dispute')}>
                        <ShieldAlert size={13} className="me-2" aria-hidden />
                        {t('openDispute')}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => onAction('dispute')}>
                        {t('viewDispute')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onSelect={() => onAction('timeline')}>
                  {t('viewHistory')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onViewDocument}
                  disabled={openDocumentPending}
                >
                  {tBilling('viewDocument')}
                </DropdownMenuItem>
                {inv.canRecordPayment ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onAction('creditNote')}>
                      {t('issueCreditNote')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Recent payments panel ────────────────────────────────────────────────────

function RecentPaymentsPanel({
  payments,
  currency,
  locale,
}: {
  payments: ClientPaymentView[];
  currency: string | null;
  locale: 'en';
}) {
  const t = useTranslations('commercial.billing.collection');

  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, currency, locale) ?? '—');

  if (payments.length === 0) {
    return (
      <SectionCard title={t('recentPaymentsTitle')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('noRecentPayments')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('recentPaymentsTitle')} bodyClassName="px-0 py-0">
      <ul className="divide-y divide-border">
        {payments.map((payment) => (
          <PaymentRow key={payment.receiptId} payment={payment} money={money} locale={locale} />
        ))}
      </ul>
    </SectionCard>
  );
}

function PaymentRow({
  payment,
  money,
  locale,
}: {
  payment: ClientPaymentView;
  money: (value: string | null) => string;
  locale: 'en';
}) {
  const t = useTranslations('commercial.billing.collection');
  const unapplied = Number(payment.unallocated ?? 0) > 0;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-foreground">
            {formatDate(payment.receivedAt, locale) ?? '—'}
            {payment.reference ? (
              <LtrValue className="ms-2 font-mono text-caption text-muted-foreground">
                {payment.reference}
              </LtrValue>
            ) : null}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {payment.method ?? t('methodUnknown')}
          </p>
        </div>
        <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
          {money(payment.total)}
        </LtrValue>
      </div>

      <ul className="mt-2 space-y-1">
        {payment.allocations.map((alloc) => (
          <li
            key={alloc.invoiceId}
            className="flex items-baseline justify-between gap-3 text-caption text-muted-foreground"
          >
            <LtrValue className="min-w-0 truncate">
              {alloc.invoiceNumber ?? t('unnumbered')}
            </LtrValue>
            <LtrValue className="shrink-0 tabular-nums">{money(alloc.amount)}</LtrValue>
          </li>
        ))}
        {unapplied ? (
          <li className="flex items-baseline justify-between gap-3 text-caption text-warning">
            <span>{t('unapplied')}</span>
            <LtrValue className="tabular-nums">{money(payment.unallocated)}</LtrValue>
          </li>
        ) : null}
      </ul>
    </li>
  );
}
