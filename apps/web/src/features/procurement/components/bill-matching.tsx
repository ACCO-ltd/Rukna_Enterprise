'use client';

/**
 * PO-backed bill matching — the **outcome** surface (Slice ④, D6).
 *
 * Three-way matching runs automatically when a PO-backed bill is submitted. This
 * component renders the result:
 *
 *  - **Healthy** (MATCHED / MATCHED_WITH_TOLERANCE / APPROVED_EXCEPTION) → quiet
 *    "Matched · ready" strip with PO applicable / Accepted receipts / Bill total.
 *  - **Exception** (EXCEPTION, no resolutionAction yet) → warning banner + "Review
 *    differences" disclosure + "Resolve exception" structured drawer.
 *  - **Pending PO revision / Receipt correction** (EXCEPTION with resolutionAction set)
 *    → informational banner explaining what to do + re-run button.
 *  - **Disputed** (DISPUTED) → error banner + re-run button for after the supplier
 *    reissues the corrected invoice.
 *
 * The server enforces all gates. This surface is the human-readable face of those gates.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Dialog,
  DialogContent,
  DialogTitle,
  Select,
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
import {
  useBillMatch,
  useResolveMatchException,
  useRunBillMatch,
} from '../hooks/use-procurement';
import type {
  BillMatchLine,
  BillMatchResult,
  BillMatchStatus,
  MatchExceptionReason,
  MatchResolutionAction,
  SupplierBill,
} from '../types';

const HEALTHY: readonly BillMatchStatus[] = [
  'MATCHED',
  'MATCHED_WITH_TOLERANCE',
  'APPROVED_EXCEPTION',
];

const REASONS: MatchExceptionReason[] = [
  'ROUNDING_VARIANCE',
  'FREIGHT_OR_ADDITIONAL_CHARGE',
  'OTHER',
  'SUPPLIER_INVOICE_ERROR',
  'AGREED_PRICE_CHANGE',
  'PO_QUANTITY_CHANGE',
  'RECEIPT_CORRECTION',
];

const REASON_TO_ACTION: Record<MatchExceptionReason, MatchResolutionAction> = {
  ROUNDING_VARIANCE: 'APPROVE',
  FREIGHT_OR_ADDITIONAL_CHARGE: 'APPROVE',
  OTHER: 'APPROVE',
  SUPPLIER_INVOICE_ERROR: 'DISPUTE',
  AGREED_PRICE_CHANGE: 'REQUIRE_PO_REVISION',
  PO_QUANTITY_CHANGE: 'REQUIRE_PO_REVISION',
  RECEIPT_CORRECTION: 'REQUIRE_RECEIPT_CORRECTION',
};

export function BillMatchSummary({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();

  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const match = useBillMatch(bill.id);

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

  if (status === 'NOT_RUN' || !result) {
    return <p className="text-sm text-muted-foreground">{t('pendingSubmit')}</p>;
  }

  const canResolve = can(PROCUREMENT_PERMISSIONS.approveMatchException);

  if (HEALTHY.includes(status)) {
    return <HealthyMatch bill={bill} result={result} status={status} locale={locale} />;
  }

  if (status === 'DISPUTED') {
    return <DisputedMatch bill={bill} result={result} locale={locale} canRerun={canResolve} />;
  }

  // EXCEPTION sub-states — after a resolve call that doesn't change status
  if (result.resolutionAction === 'REQUIRE_PO_REVISION') {
    return (
      <PendingActionMatch
        bill={bill}
        result={result}
        locale={locale}
        kind="po-revision"
        canRerun={canResolve}
      />
    );
  }

  if (result.resolutionAction === 'REQUIRE_RECEIPT_CORRECTION') {
    return (
      <PendingActionMatch
        bill={bill}
        result={result}
        locale={locale}
        kind="receipt-correction"
        canRerun={canResolve}
      />
    );
  }

  // Fresh EXCEPTION — not yet resolved
  return (
    <ExceptionMatch
      bill={bill}
      result={result}
      locale={locale}
      canResolve={canResolve}
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
    <div className={divider ? 'sm:border-s sm:border-border sm:ps-4 sm:ms-4' : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── Exception (fresh — not yet resolved) ─────────────────────────────────────────

function ExceptionMatch({
  bill,
  result,
  locale,
  canResolve,
}: {
  bill: SupplierBill;
  result: BillMatchResult;
  locale: 'en';
  canResolve: boolean;
}) {
  const t = useTranslations('procurement.matching');
  const [reviewing, setReviewing] = useState(false);
  const [resolving, setResolving] = useState(false);

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

        {canResolve ? (
          <Button type="button" onClick={() => setResolving(true)}>
            {t('resolveException')}
          </Button>
        ) : null}
      </div>

      {reviewing ? (
        <DifferencesTable bill={bill} lines={result.lines} locale={locale} />
      ) : null}

      {resolving ? (
        <ResolveExceptionDrawer billId={bill.id} onClose={() => setResolving(false)} />
      ) : null}
    </div>
  );
}

// ─── Disputed ─────────────────────────────────────────────────────────────────────

function DisputedMatch({
  bill,
  result,
  locale,
  canRerun,
}: {
  bill: SupplierBill;
  result: BillMatchResult;
  locale: 'en';
  canRerun: boolean;
}) {
  const t = useTranslations('procurement.matching');

  return (
    <div className="space-y-3">
      <Alert variant="error" title={t('disputedTitle')} messages={[
        t('disputedBody'),
        ...(result.resolutionNotes ? [t('resolvedNotes', { notes: result.resolutionNotes })] : []),
      ]} />

      {canRerun ? <RerunMatchButton billId={bill.id} /> : null}
    </div>
  );
}

// ─── Pending action (REQUIRE_PO_REVISION / REQUIRE_RECEIPT_CORRECTION) ─────────────

function PendingActionMatch({
  bill,
  result,
  locale,
  kind,
  canRerun,
}: {
  bill: SupplierBill;
  result: BillMatchResult;
  locale: 'en';
  kind: 'po-revision' | 'receipt-correction';
  canRerun: boolean;
}) {
  const t = useTranslations('procurement.matching');
  const [reviewing, setReviewing] = useState(false);

  const title = kind === 'po-revision' ? t('pendingPoRevisionTitle') : t('pendingReceiptCorrectionTitle');
  const body = kind === 'po-revision' ? t('pendingPoRevisionBody') : t('pendingReceiptCorrectionBody');

  return (
    <div className="space-y-3">
      <Alert variant="warning" title={title} messages={[
        body,
        ...(result.resolutionNotes ? [t('resolvedNotes', { notes: result.resolutionNotes })] : []),
      ]} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setReviewing((open) => !open)}
          aria-expanded={reviewing}
        >
          {reviewing ? t('hideDifferences') : t('reviewDifferences')}
        </Button>

        {canRerun ? <RerunMatchButton billId={bill.id} /> : null}
      </div>

      {reviewing ? (
        <DifferencesTable bill={bill} lines={result.lines} locale={locale} />
      ) : null}
    </div>
  );
}

// ─── Re-run button ─────────────────────────────────────────────────────────────────

function RerunMatchButton({ billId }: { billId: string }) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const [confirming, setConfirming] = useState(false);
  const rerun = useRunBillMatch();

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        {t('rerunMatch')}
      </Button>

      {confirming ? (
        <Dialog open onOpenChange={(next) => (next ? undefined : setConfirming(false))}>
          <DialogContent className="p-6 sm:max-w-md">
            <DialogTitle className="text-lg font-semibold text-foreground">
              {t('rerunMatchTitle')}
            </DialogTitle>

            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">{t('rerunMatchBody')}</p>

              {rerun.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={rerun.isPending}
                >
                  {tc('cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={rerun.isPending}
                  onClick={() =>
                    rerun.mutate(billId, { onSuccess: () => setConfirming(false) })
                  }
                >
                  {t('rerunMatch')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

// ─── Differences table ─────────────────────────────────────────────────────────────

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

// ─── Resolve exception drawer ──────────────────────────────────────────────────────

function ResolveExceptionDrawer({
  billId,
  onClose,
}: {
  billId: string;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const resolve = useResolveMatchException();

  const [reason, setReason] = useState<MatchExceptionReason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const derivedAction = reason ? REASON_TO_ACTION[reason] : null;
  const needsNotes = derivedAction === 'DISPUTE';
  const isApprove = derivedAction === 'APPROVE';

  const reasonError = submitted && !reason ? t('reasonRequired') : undefined;
  const notesError = submitted && needsNotes && !notes.trim() ? t('resolveNotesRequired') : undefined;

  function handleSubmit() {
    setSubmitted(true);
    if (!reason) return;
    if (needsNotes && !notes.trim()) return;

    resolve.mutate(
      {
        billId,
        payload: {
          reason,
          action: REASON_TO_ACTION[reason],
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="p-6 sm:max-w-lg">
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t('resolveExceptionTitle')}
        </DialogTitle>

        <div className="mt-5 space-y-4">
          <FormField
            htmlFor="resolve-reason"
            label={t('reasonLabel')}
            error={reasonError}
          >
            <Select
              id="resolve-reason"
              value={reason}
              onChange={(v) => setReason(v as MatchExceptionReason)}
            >
              <option value="">—</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reason.${r}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </FormField>

          {derivedAction ? (
            <Alert
              variant={derivedAction === 'DISPUTE' ? 'error' : 'info'}
              messages={[t(`actionConsequence.${derivedAction}` as Parameters<typeof t>[0])]}
            />
          ) : null}

          {isApprove ? (
            <p className="text-xs text-muted-foreground">{t('cfoRequired')}</p>
          ) : null}

          <FormField
            htmlFor="resolve-notes"
            label={`${t('resolveNotesLabel')}${needsNotes ? '' : ` (${tc('optional')})`}`}
            error={notesError}
          >
            <Textarea
              id="resolve-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>

          {resolve.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={resolve.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              disabled={resolve.isPending}
              onClick={handleSubmit}
            >
              {t('resolveException')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
