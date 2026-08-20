'use client';

/**
 * Purchase order detail (§12.6).
 *
 * Revisions are tabs. The ACTIVE one is preselected; superseded ones stay reachable
 * because the commitment ledger references them by revision and a reader tracing a
 * committed figure needs to see the lines it came from.
 *
 * Two pieces of copy deliberately depart from §12.6, because §12.6 describes behaviour
 * the server does not have:
 *
 *  - The approve drawer does **not** say the superseded revision's "uncommitted balance
 *    will be reversed". It reverses the full original value, so if goods were already
 *    received against it, COMMITTED is reduced twice and goes negative (P11).
 *  - The cancel dialog says the order's commitment entries will remain, because `cancel`
 *    writes no reversal at all and no endpoint can correct it afterwards (P12).
 *
 * Saying the reassuring thing would be easy and wrong. These figures are what a project
 * manager reads to decide whether there is budget left.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';
import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';

import {
  useApprovePurchaseOrder,
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useSubmitPurchaseOrder,
} from '../hooks/use-procurement';
import { activeRevision, revisionTotalMinor } from '../quantities';
import type { PurchaseOrder, PurchaseOrderRevision } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';

export function PoDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const po = usePurchaseOrder(id);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const submit = useSubmitPurchaseOrder();
  const cancel = useCancelPurchaseOrder();

  if (po.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-xl border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (po.isError || !po.data) {
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[tc('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/procurement/orders">{t('backToList')}</Link>
        </Button>
      </div>
    );
  }

  const order: PurchaseOrder = po.data;
  const active = activeRevision(order.revisions);
  const draft = order.revisions.find((r) => r.status === 'DRAFT');
  const submitted = order.revisions.find((r) => r.status === 'SUBMITTED');
  const defaultTab = String((active ?? draft ?? order.revisions[0])?.revisionNumber ?? 1);

  const isOpen = order.status === 'OPEN';

  return (
    <div className="space-y-6">
      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/procurement/orders"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <ChevronStartIcon />
          {t('backToList')}
        </Link>
      </div>

      {/* ── Header card ───────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          {/* Top row: PO number + status */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              {order.poNumber}
            </span>
            <ProcurementStatusBadge status={order.status} />
          </div>

          {/* Primary heading: supplier name */}
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[28px]">
            {order.supplier?.name ?? t('detailTitle', { number: order.poNumber })}
          </h1>

          {/* Subtitle: revision count */}
          <p className="mt-1 text-sm text-muted-foreground">
            {t('revisionOf', {
              number: active?.revisionNumber ?? order.revisions.length,
              total: order.revisions.length,
            })}
          </p>
        </div>

        {/* Footer: lifecycle actions */}
        {isOpen ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border px-5 py-3 sm:px-6">
            {submitted && can(PROCUREMENT_PERMISSIONS.approveOrder) ? (
              <Button type="button" size="sm" onClick={() => setApproving(true)}>
                {t('approve')}
              </Button>
            ) : null}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCancelling(true)}
            >
              {t('cancelOrder')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* ── Approval workflow actions ──────────────────────────────────────── */}
      {/* Submitting a DRAFT revision is the governed transition (ADR-011): with a DoA binding
          configured the server opens an approval instead of moving to SUBMITTED, and the panel
          + "Complete" re-drive carry it through. Once submitted (or when no draft remains) the
          static panel shows whatever the order's own persisted instance is. */}
      {isOpen && draft ? (
        <GatedActionButton
          command={() => submit.mutateAsync(order.id)}
          transactionType={WorkflowTransactionType.PURCHASE_ORDER}
          label={t('submit')}
        />
      ) : (
        <ApprovalPanel
          instanceId={order.approvalInstanceId}
          transactionType={WorkflowTransactionType.PURCHASE_ORDER}
        />
      )}

      {/* ── Revision tabs ─────────────────────────────────────────────────── */}
      {order.revisions.length === 0 ? (
        <Alert variant="info" messages={[tc('noResults')]} />
      ) : (
        <Tabs
          defaultValue={defaultTab}
          className="rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]"
        >
          <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-4 pt-2">
            {order.revisions.map((revision) => (
              <TabsTrigger key={revision.id} value={String(revision.revisionNumber)}>
                {t('revisionTab', { number: revision.revisionNumber })}
              </TabsTrigger>
            ))}
          </TabsList>

          {order.revisions.map((revision) => (
            <TabsContent
              key={revision.id}
              value={String(revision.revisionNumber)}
              className="p-4 sm:p-6"
            >
              <RevisionPanel revision={revision} locale={locale} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* ── Approve drawer ────────────────────────────────────────────────── */}
      {approving && submitted ? (
        <ApproveDrawer
          revision={submitted}
          hasSupersededTarget={Boolean(active)}
          onClose={() => setApproving(false)}
          orderId={order.id}
          locale={locale}
        />
      ) : null}

      {/* ── Cancel confirm ────────────────────────────────────────────────── */}
      {cancelling ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { number: order.poNumber })}
          description={`${t('cancelBody')} ${t('cancelCommitmentWarning')}`}
          confirmLabel={t('cancelOrder')}
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? tc('loadFailed') : undefined}
          onConfirm={() =>
            cancel.mutate(order.id, { onSuccess: () => setCancelling(false) })
          }
          onDismiss={() => setCancelling(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Revision panel ───────────────────────────────────────────────────────────

function RevisionPanel({
  revision,
  locale,
}: {
  revision: PurchaseOrderRevision;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');

  const lines = revision.lines ?? [];
  const totalMinor = revisionTotalMinor(lines);

  return (
    <div className="space-y-5">
      {/* Revision status + label */}
      <div className="flex flex-wrap items-center gap-2">
        <ProcurementStatusBadge status={revision.status} />
        <span className="text-xs text-muted-foreground">
          {t('revisionOf', {
            number: revision.revisionNumber,
            total: revision.revisionNumber,
          })}
        </span>
      </div>

      {/* Revision metadata — gap-px tile grid */}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{tc('currency')}</dt>
          <dd className="mt-1.5 text-sm font-semibold tabular-nums text-foreground">
            {revision.currencyCode}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('effectiveFrom')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {formatDate(revision.effectiveFrom, locale) ?? tc('notAvailable')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('expectedDelivery')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {formatDate(revision.expectedDeliveryDate, locale) ?? tc('notAvailable')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('deliveryAddress')}</dt>
          <dd className="mt-1.5 truncate text-sm font-semibold text-foreground">
            {revision.deliveryAddress ?? tc('notAvailable')}
          </dd>
        </div>
        {revision.reason ? (
          <div className="bg-surface px-5 py-4 sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">{t('reason')}</dt>
            <dd className="mt-1.5 text-sm font-semibold text-foreground">{revision.reason}</dd>
          </div>
        ) : null}
        {revision.approvedAt ? (
          <div className="bg-surface px-5 py-4">
            <dt className="text-xs font-medium text-muted-foreground">{t('approve')}</dt>
            <dd className="mt-1.5 text-sm font-semibold text-foreground">
              {formatDate(revision.approvedAt, locale) ?? tc('notAvailable')}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Lines table */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="border-b border-border px-5 py-3 sm:px-6">
          <h3 className="text-[13px] font-semibold text-foreground">{tc('lines')}</h3>
        </div>
        <TableScroll aria-label={tc('lines')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-end">{tc('lineNumber')}</TableHead>
                <TableHead>{tc('type')}</TableHead>
                <TableHead>{tc('description')}</TableHead>
                <TableHead>{tc('uom')}</TableHead>
                <TableHead className="text-end">{t('orderedQuantity')}</TableHead>
                <TableHead className="text-end">{tc('unitPrice')}</TableHead>
                <TableHead className="text-end">{t('extendedAmount')}</TableHead>
                <TableHead>{tc('spendCategory')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tType(line.lineType)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {line.material ? (
                      <span className="me-2 font-mono text-xs text-muted-foreground">
                        {line.material.code}
                      </span>
                    ) : null}
                    {line.description}
                  </TableCell>
                  <TableCell>
                    <bdi className="text-sm">{line.uom?.symbol ?? line.uom?.code ?? '—'}</bdi>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.orderedQuantity, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(line.unitPrice, revision.currencyCode, locale)}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatMoney(line.extendedAmount, revision.currencyCode, locale)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.spendCategory?.name ?? tc('notAvailable')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>

        <div className="border-t border-border px-5 py-3 text-end sm:px-6">
          <span className="text-sm text-muted-foreground">{tc('total')}: </span>
          <span className="text-sm font-semibold tabular-nums">
            {formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), revision.currencyCode, locale)}
          </span>
        </div>
      </section>
    </div>
  );
}

// ─── Approve drawer ───────────────────────────────────────────────────────────

/**
 * Shows what approving will commit, and — when a revision is being superseded — what the
 * reversal actually does, which is not what §12.6 says it does (P11).
 */
function ApproveDrawer({
  revision,
  hasSupersededTarget,
  orderId,
  onClose,
  locale,
}: {
  revision: PurchaseOrderRevision;
  hasSupersededTarget: boolean;
  orderId: string;
  onClose: () => void;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const approve = useApprovePurchaseOrder();

  const totalMinor = revisionTotalMinor(revision.lines ?? []);
  const amount =
    formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), revision.currencyCode, locale) ?? '';

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="p-6">
        <SheetTitle className="text-lg font-semibold text-foreground">
          {t('approveTitle', { number: revision.revisionNumber })}
        </SheetTitle>

        <div className="mt-5 space-y-4">
          <Alert variant="info" messages={[t('approveCommitmentNotice', { amount })]} />

          {hasSupersededTarget ? (
            <Alert
              variant="warning"
              messages={[t('approveSupersedeNotice'), t('approveSupersedeWarning')]}
            />
          ) : null}

          {approve.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={approve.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate({ id: orderId }, { onSuccess: onClose })
              }
            >
              {t('approve')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
