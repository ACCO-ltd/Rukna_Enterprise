'use client';

/**
 * PO-backed bill matching — the **outcome** surface (Slice ④, D6).
 *
 * Three-way matching is a silent control, not manual work. It runs automatically when a
 * PO-backed bill is submitted (`SupplierBillService.submit` → `runMatching`), so this
 * component never offers a "Run matching" button — it renders the *result* the auto-match
 * already produced:
 *
 *  - **Healthy** (MATCHED / MATCHED_WITH_TOLERANCE / APPROVED_EXCEPTION) → a quiet
 *    "Matched · ready" line with the PO applicable / Accepted receipts / Bill reconciliation.
 *    Nothing to operate; the bill proceeds toward posting and payment.
 *  - **Exception** (EXCEPTION) → a warning banner naming the variance, and a "Review
 *    differences" disclosure that reveals the per-line comparison. The real exception-
 *    resolution action is offered only to a user holding `approve:matching-exception`.
 *
 * Posting still requires MATCHED / MATCHED_WITH_TOLERANCE / APPROVED_EXCEPTION; the server
 * enforces it. This surface is the human-readable face of that gate, not the gate itself.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
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
  Textarea,
} from '@erp/ui';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { billMatchReconciliation } from '../bill-match-summary';
import { useApproveMatchException, useBillMatch } from '../hooks/use-procurement';
import type { BillMatchLine, BillMatchStatus, BillMatchResult, SupplierBill } from '../types';

/** The healthy verdicts — the bill is ready, silently, toward posting and payment. */
const HEALTHY: readonly BillMatchStatus[] = [
  'MATCHED',
  'MATCHED_WITH_TOLERANCE',
  'APPROVED_EXCEPTION',
];

export function BillMatchSummary({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();

  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const match = useBillMatch(bill.id);

  // A genuine non-PO bill never matches — say so plainly rather than showing an empty control.
  if (!hasPoLink) {
    return <p className="text-sm text-muted-foreground">{t('notApplicable')}</p>;
  }

  if (match.isPending) {
    return (
      <div role="status" aria-live="polite">
        <div
          className="h-24 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (match.isError) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const result = match.data ?? null;
  const status: BillMatchStatus = result?.status ?? bill.matchStatus ?? 'NOT_RUN';

  // NOT_RUN on a PO-backed bill means it has not been submitted yet — matching runs on submit.
  if (status === 'NOT_RUN' || !result) {
    return <p className="text-sm text-muted-foreground">{t('pendingSubmit')}</p>;
  }

  if (HEALTHY.includes(status)) {
    return <HealthyMatch bill={bill} result={result} status={status} locale={locale} />;
  }

  return (
    <ExceptionMatch
      bill={bill}
      result={result}
      locale={locale}
      canApprove={can(PROCUREMENT_PERMISSIONS.approveMatchException)}
    />
  );
}

// ─── Healthy ───────────────────────────────────────────────────────────────────────

function HealthyMatch({
  bill,
  result,
  status,
  locale,
}: {
  bill: SupplierBill;
  result: BillMatchResult;
  status: BillMatchStatus;
  locale: 'en';
}) {
  const t = useTranslations('procurement.matching');
  const recon = billMatchReconciliation(result);

  // APPROVED_EXCEPTION reads as ready, but names who cleared it — it is a matched bill that
  // needed a decision, not a clean one.
  const readyLine =
    status === 'APPROVED_EXCEPTION'
      ? t('approvedReady', {
          by: result.approvedBy ? t('approvedBy', { name: result.approvedBy }) : '',
          on: result.approvedAt
            ? t('approvedOn', { date: formatDate(result.approvedAt, locale) ?? '' })
            : '',
        })
      : status === 'MATCHED_WITH_TOLERANCE'
        ? t('matchedToleranceReady')
        : t('matchedReady');

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span aria-hidden="true" className="text-success">
          ✓
        </span>
        {readyLine}
      </p>

      {/* PO applicable · Accepted receipts · Bill — a divider-separated metric strip that
          stacks at 375px. Money stays neutral (never coloured). */}
      <dl className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4 sm:flex-row sm:gap-0">
        <ReconCell
          label={t('poApplicable')}
          value={formatMoney(recon.poApplicable, bill.currencyCode, locale) ?? '—'}
        />
        <ReconCell
          label={t('acceptedReceipts')}
          value={formatMoney(recon.acceptedReceipts, bill.currencyCode, locale) ?? '—'}
          divider
        />
        <ReconCell
          label={t('billTotal')}
          value={formatMoney(bill.totalAmount, bill.currencyCode, locale) ?? '—'}
          divider
        />
      </dl>
    </div>
  );
}

function ReconCell({
  label,
  value,
  divider,
}: {
  label: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <div
      className={
        divider
          ? 'sm:border-s sm:border-border sm:ps-4 sm:ms-4'
          : undefined
      }
    >
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── Exception ───────────────────────────────────────────────────────────────────────

function ExceptionMatch({
  bill,
  result,
  locale,
  canApprove,
}: {
  bill: SupplierBill;
  result: BillMatchResult;
  locale: 'en';
  canApprove: boolean;
}) {
  const t = useTranslations('procurement.matching');
  const [reviewing, setReviewing] = useState(false);
  const [approving, setApproving] = useState(false);

  // Name the variance from the first out-of-tolerance line's server-provided reason, falling
  // back to a generic message. This is the ⚠ line in the owner's sketch.
  const failing = result.lines.find((l) => !l.withinTolerance);
  const variance = failing?.exceptionReason ?? t('exceptionGeneric');

  return (
    <div className="space-y-3">
      <Alert variant="warning" title={t('exceptionTitle')} messages={[variance]} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setReviewing((open) => !open)}
          aria-expanded={reviewing}
        >
          {reviewing ? t('hideDifferences') : t('reviewDifferences')}
        </Button>

        {/* The real resolution path — free-text approve-exception, gated server-side on
            approve:matching-exception. Offered only to a holder of that permission; never a
            fabricated approval. */}
        {canApprove ? (
          <Button type="button" onClick={() => setApproving(true)}>
            {t('approveException')}
          </Button>
        ) : null}
      </div>

      {reviewing ? (
        <DifferencesTable bill={bill} lines={result.lines} locale={locale} />
      ) : null}

      {approving ? (
        <ApproveExceptionDrawer billId={bill.id} onClose={() => setApproving(false)} />
      ) : null}
    </div>
  );
}

/**
 * The per-line comparison, revealed by "Review differences". A full-width disclosure whose
 * table scrolls internally at 375px (`TableScroll`). Each cell states, in words then colour,
 * whether its dimension is within tolerance.
 */
function DifferencesTable({
  bill,
  lines,
  locale,
}: {
  bill: SupplierBill;
  lines: BillMatchLine[];
  locale: 'en';
}) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');

  return (
    <TableScroll aria-label={t('differencesTitle')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('poLine')}</TableHead>
            <TableHead className="text-end">{t('poQuantity')}</TableHead>
            <TableHead className="text-end">{t('receivedQuantity')}</TableHead>
            <TableHead className="text-end">{t('billedQuantity')}</TableHead>
            <TableHead className="text-end">{t('quantityVariance')}</TableHead>
            <TableHead className="text-end">{t('poPrice')}</TableHead>
            <TableHead className="text-end">{t('billedPrice')}</TableHead>
            <TableHead className="text-end">{t('priceVariance')}</TableHead>
            <TableHead>{t('withinTolerance')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="text-sm">
                {line.purchaseOrderLine?.description ??
                  line.description ??
                  line.purchaseOrderLineId}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(line.poQuantity, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(line.receivedQuantity, locale) ?? tc('notAvailable')}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(line.billedQuantity, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                <VarianceValue withinTolerance={line.quantityWithinTolerance}>
                  {formatNumber(line.quantityVariance, locale)}
                </VarianceValue>
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(line.poUnitPrice, bill.currencyCode, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(line.billedUnitPrice, bill.currencyCode, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                <VarianceValue withinTolerance={line.priceWithinTolerance}>
                  {formatMoney(line.priceVariance, bill.currencyCode, locale)}
                </VarianceValue>
              </TableCell>
              <TableCell>
                {/* Word first, colour second — the verdict is legible without the glyph. */}
                <span
                  className={
                    line.withinTolerance
                      ? 'text-sm font-medium text-foreground'
                      : 'text-sm font-medium text-danger'
                  }
                >
                  <span aria-hidden="true">{line.withinTolerance ? '✓ ' : '✕ '}</span>
                  {line.withinTolerance ? t('yes') : t('no')}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

/** A variance figure, tinted danger only when its dimension is out of tolerance. */
function VarianceValue({
  withinTolerance,
  children,
}: {
  withinTolerance: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={withinTolerance ? 'text-foreground' : 'font-medium text-danger'}>
      {children}
    </span>
  );
}

// ─── Exception approval ──────────────────────────────────────────────────────────────

function ApproveExceptionDrawer({
  billId,
  onClose,
}: {
  billId: string;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const approve = useApproveMatchException();
  const [reason, setReason] = useState('');

  const valid = reason.trim().length > 0;

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="p-6">
        <SheetTitle className="text-lg font-semibold text-foreground">
          {t('approveExceptionTitle')}
        </SheetTitle>

        <div className="mt-5 space-y-4">
          <Alert variant="info" messages={[t('approveExceptionBody')]} />

          <FormField
            htmlFor="approve-exception-reason"
            label={t('approvalReason')}
            error={valid ? undefined : t('approvalReasonRequired')}
          >
            <Textarea
              id="approve-exception-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>

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
              disabled={!valid || approve.isPending}
              onClick={() =>
                approve.mutate(
                  { billId, payload: { approvalReason: reason.trim() } },
                  { onSuccess: onClose },
                )
              }
            >
              {t('approveException')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
