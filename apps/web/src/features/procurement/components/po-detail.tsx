'use client';

/**
 * Purchase order detail (Round 2).
 *
 * ─── D4: current revision by default, history behind a disclosure ────────────────────
 *
 * The revision tabs are gone. The current (ACTIVE) revision is shown directly. Prior
 * revisions sit in a collapsed "Revision history" disclosure, read-only, each expandable
 * in place to inspect its lines — the immutable-revision data model is untouched (the
 * commitment ledger references revisions by number, and a reader tracing a committed
 * figure still needs to see the lines it came from).
 *
 * ─── D3: no ceremonial approve ───────────────────────────────────────────────────────
 *
 * There is no approve drawer and no standalone approve button. A first issue happens on
 * the create form. Amending writes a new DRAFT revision (the only revision-creating
 * action); issuing that draft is a single "Issue revision" action here that orchestrates
 * submit → approve, preserving the real governed gate: with a DoA binding, submit returns
 * 409 and the {@link ApprovalPanel} renders until approvers act. Nothing fabricates an
 * approval.
 *
 * One piece of copy deliberately departs from §12.6, because the server does not have the
 * behaviour §12.6 describes: the cancel dialog says the order's commitment entries will
 * remain — `cancel`'s reversal covers only the uncommitted balance, so anything already
 * committed and received against is not reversed (P12). Saying the reassuring thing would
 * be easy and wrong; these figures are what a project manager reads to decide whether
 * there is budget left.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';
import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';

import {
  useApprovePurchaseOrder,
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useSubmitPurchaseOrder,
} from '../hooks/use-procurement';
import { activeRevision, revisionTotalMinor } from '../quantities';
import type { PurchaseOrder, PurchaseOrderRevision } from '../types';
import { ClassificationChips } from './classification-chips';
import { PoAmendSheet } from './po-amend-sheet';
import { ProcurementStatusBadge } from './procurement-badges';

export function PoDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();

  const po = usePurchaseOrder(id);
  const [amending, setAmending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const submit = useSubmitPurchaseOrder();
  const approve = useApprovePurchaseOrder();
  const cancel = useCancelPurchaseOrder();

  // "Issue revision" orchestration for a DRAFT (submit → approve), with the gate seam.
  const [approvalInstanceId, setApprovalInstanceId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const runIssue = useCallback(async () => {
    setIssueError(null);
    setIssuing(true);
    try {
      try {
        await submit.mutateAsync(id);
      } catch (e) {
        const instanceId =
          e instanceof ApiError && e.status === 409
            ? (e.details?.approvalInstanceId as string | undefined)
            : undefined;
        if (instanceId) {
          setApprovalInstanceId(instanceId);
          return; // pending approval — nothing faked
        }
        throw e;
      }
      setApprovalInstanceId(null);
      await approve.mutateAsync({ id });
    } catch (e) {
      setIssueError(e instanceof ApiError ? e.message : tc('loadFailed'));
    } finally {
      setIssuing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, submit, approve]);

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
  const draft = order.revisions.find((r) => r.status === 'DRAFT') ?? null;
  // The revision shown as "current": the ACTIVE one, or the draft/newest if none is active yet.
  const current =
    active ??
    draft ??
    [...order.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ??
    null;
  const history = order.revisions
    .filter((r) => r.id !== current?.id)
    .sort((a, b) => b.revisionNumber - a.revisionNumber);

  const isOpen = order.status === 'OPEN';
  const canAmend = isOpen && !draft && Boolean(active);

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              {order.poNumber}
            </span>
            <ProcurementStatusBadge status={order.status} />
          </div>

          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[28px]">
            {order.supplier?.name ?? t('detailTitle', { number: order.poNumber })}
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('revisionOf', {
              number: current?.revisionNumber ?? order.revisions.length,
              total: order.revisions.length,
            })}
          </p>
        </div>

        {/* Footer: the one revision-creating action, plus cancel. No ceremonial approve. */}
        {isOpen ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border px-5 py-3 sm:px-6">
            {canAmend ? (
              <Button type="button" size="sm" onClick={() => setAmending(true)}>
                {t('amend')}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelling(true)}>
              {t('cancelOrder')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* ── Issue a DRAFT revision (submit → approve), gated seam preserved ──── */}
      {isOpen && draft ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-panel)] sm:p-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('draftRevisionTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('draftRevisionBody')}</p>
          </div>

          {issueError ? <Alert variant="error" messages={[issueError]} /> : null}

          {approvalInstanceId ? (
            <>
              <Alert variant="info" messages={[t('issueAwaitingApproval')]} />
              <ApprovalPanel
                instanceId={approvalInstanceId}
                transactionType={WorkflowTransactionType.PURCHASE_ORDER}
              />
              <div className="border-t border-border pt-3">
                <Button type="button" disabled={issuing} onClick={() => void runIssue()}>
                  {t('completeIssue')}
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              disabled={issuing || !can(PROCUREMENT_PERMISSIONS.approveOrder)}
              onClick={() => void runIssue()}
            >
              {t('issueRevision')}
            </Button>
          )}
        </div>
      ) : order.approvalInstanceId ? (
        // A persisted instance from a prior gated submit, when no draft is in hand.
        <ApprovalPanel
          instanceId={order.approvalInstanceId}
          transactionType={WorkflowTransactionType.PURCHASE_ORDER}
        />
      ) : null}

      {/* ── Current revision ──────────────────────────────────────────────── */}
      {current ? (
        <RevisionPanel revision={current} locale={locale} isCurrent />
      ) : (
        <Alert variant="info" messages={[tc('noResults')]} />
      )}

      {/* ── Revision history (collapsed) ──────────────────────────────────── */}
      {history.length > 0 ? (
        <details className="group overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 text-sm font-medium text-foreground marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
            <span>{t('revisionHistory', { count: history.length })}</span>
            <ChevronDownIcon />
          </summary>
          <div className="space-y-3 border-t border-border p-4 sm:p-6">
            {history.map((revision) => (
              <RevisionHistoryItem key={revision.id} revision={revision} locale={locale} />
            ))}
          </div>
        </details>
      ) : null}

      {/* ── Amend sheet ───────────────────────────────────────────────────── */}
      {amending ? (
        <PoAmendSheet order={order} source={active} onClose={() => setAmending(false)} />
      ) : null}

      {/* ── Cancel confirm ────────────────────────────────────────────────── */}
      {cancelling ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { number: order.poNumber })}
          description={`${t('cancelBody')} ${t('cancelCommitmentWarning')}`}
          confirmLabel={t('cancelOrder')}
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? tc('loadFailed') : undefined}
          onConfirm={() => cancel.mutate(order.id, { onSuccess: () => setCancelling(false) })}
          onDismiss={() => setCancelling(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Revision history item (collapsed row → inline line view) ──────────────────────

function RevisionHistoryItem({
  revision,
  locale,
}: {
  revision: PurchaseOrderRevision;
  locale: 'en';
}) {
  const t = useTranslations('procurement.po');
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-start"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {t('revisionTab', { number: revision.revisionNumber })}
          </span>
          <ProcurementStatusBadge status={revision.status} />
          <span className="text-xs text-muted-foreground">
            {formatDate(revision.effectiveFrom, locale) ?? ''}
          </span>
        </span>
        <span className="text-xs font-medium text-brand-primary">
          {open ? t('hide') : t('view')}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border p-4">
          <RevisionPanel revision={revision} locale={locale} isCurrent={false} />
        </div>
      ) : null}
    </div>
  );
}

// ─── Revision panel ───────────────────────────────────────────────────────────

function RevisionPanel({
  revision,
  locale,
  isCurrent,
}: {
  revision: PurchaseOrderRevision;
  locale: 'en';
  isCurrent: boolean;
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');

  const lines = revision.lines ?? [];
  const totalMinor = revisionTotalMinor(lines);

  return (
    <div className="space-y-5">
      {isCurrent ? (
        <div className="flex flex-wrap items-center gap-2">
          <ProcurementStatusBadge status={revision.status} />
          <span className="text-xs text-muted-foreground">
            {t('revisionTab', { number: revision.revisionNumber })}
          </span>
        </div>
      ) : null}

      {/* Revision metadata — gap-px tile grid */}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-2 lg:grid-cols-4">
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
      </dl>

      {/* Lines — read-only, with classification chips (D7 consistency). Rendered as
          stacked cards rather than a table so a line's classification chips read cleanly
          at 375px without horizontal scroll. */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="border-b border-border px-5 py-3 sm:px-6">
          <h3 className="text-[13px] font-semibold text-foreground">{tc('lines')}</h3>
        </div>
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.id} className="px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="me-2 tabular-nums text-muted-foreground">{line.lineNumber}.</span>
                    {line.material ? (
                      <span className="me-2 font-mono text-xs text-muted-foreground">
                        {line.material.code}
                      </span>
                    ) : null}
                    {line.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {formatNumber(line.orderedQuantity, locale)} {line.uom?.symbol ?? line.uom?.code ?? ''}
                    {' × '}
                    {formatMoney(line.unitPrice, revision.currencyCode, locale)}
                  </p>
                  {/* Read-only classification chips (D7). Spend category shows the value
                      when the line carries one, or "Derived on issue" until then. The
                      cost-target chip names the project + BOQ node when the line carries one
                      (A3/D7, no. 148); an org/overhead line has none, so no chip renders. */}
                  <ClassificationChips
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    lineType={line.lineType}
                    spendCategoryName={line.spendCategory?.name ?? t('derivedOnIssue')}
                    costTargetLabel={
                      line.project && line.boqNode
                        ? `${line.project.code} · ${line.boqNode.code} ${line.boqNode.description}`
                        : null
                    }
                  />
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(line.extendedAmount, revision.currencyCode, locale)}
                </p>
              </div>
            </li>
          ))}
        </ul>

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

function ChevronDownIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 transition-transform group-open:rotate-180"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
