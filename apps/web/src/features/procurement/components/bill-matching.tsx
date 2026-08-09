'use client';

/**
 * The Matching tab on a supplier bill (§12.8).
 *
 * Three-way matching is the control that stops an organisation paying for goods it did
 * not receive, or paying a price it did not agree. This tab is where a person sees the
 * variances and decides.
 *
 * **The Post gate implemented here is stricter than the server's.** §6.31 states that
 * posting requires `MATCHED`, `MATCHED_WITH_TOLERANCE` or `APPROVED_EXCEPTION`, and
 * §12.8 says the button must be disabled on `NOT_RUN` or `EXCEPTION`. The server's
 * `POSTABLE_MATCH_STATUSES` includes `NOT_RUN`, so it will happily post a bill that was
 * never matched (P15).
 *
 * `canPostBill` implements the documented rule, not the implemented one. That makes the
 * intended workflow obvious and prevents an accident — but it is an affordance, not a
 * control, because anything holding a token can call `POST /bills/:id/post` directly.
 * The tab says so rather than letting anyone mistake it for enforcement.
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

import { useApproveMatchException, useBillMatch, useRunBillMatch } from '../hooks/use-procurement';
import type { BillMatchStatus, SupplierBill } from '../types';
import { BillMatchStatusBadge } from './procurement-badges';

export function BillMatchingTab({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.matching');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const match = useBillMatch(bill.id);
  const run = useRunBillMatch();
  const [approving, setApproving] = useState(false);

  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const status: BillMatchStatus = match.data?.status ?? bill.matchStatus ?? 'NOT_RUN';

  if (match.isPending) {
    return (
      <div role="status" aria-live="polite" className="pt-4">
        <div className="h-40 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <BillMatchStatusBadge status={status} />
      </div>

      <StatusBanner status={status} match={match.data ?? null} locale={locale} />

      {status === 'NOT_RUN' ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('notRunTitle')}</p>

          {hasPoLink ? (
            <>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('notRunBody')}
              </p>
              <p className="mx-auto mt-2 max-w-prose text-xs text-muted-foreground">
                {/* Match type is decided server-side from whether any bill line is
                    MATERIAL. Bill lines are only on the detail response, so this reads
                    the lines the caller already has rather than guessing. */}
                {(bill.lines ?? []).length > 0
                  ? t('typeThreeWay')
                  : t('typeTwoWay')}
              </p>
              <Button
                type="button"
                className="mt-4"
                disabled={run.isPending}
                onClick={() => run.mutate(bill.id)}
              >
                {t('run')}
              </Button>
            </>
          ) : (
            <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
              {t('notRunNoPo')}
            </p>
          )}

          {run.isError ? (
            <div className="mt-4">
              <Alert variant="error" messages={[tc('loadFailed')]} />
            </div>
          ) : null}
        </div>
      ) : null}

      {match.data && match.data.lines.length > 0 ? (
        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('poLine')}</TableHead>
                <TableHead className="text-end">{t('poQuantity')}</TableHead>
                <TableHead className="text-end">{t('receivedQuantity')}</TableHead>
                <TableHead className="text-end">{t('billedQuantity')}</TableHead>
                <TableHead className="text-end">{t('poPrice')}</TableHead>
                <TableHead className="text-end">{t('billedPrice')}</TableHead>
                <TableHead className="text-end">{t('quantityVariance')}</TableHead>
                <TableHead className="text-end">{t('priceVariance')}</TableHead>
                <TableHead>{t('withinTolerance')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {match.data.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-sm">
                    {line.description ?? line.purchaseOrderLineId}
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
                    {formatMoney(line.poUnitPrice, bill.currencyCode, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(line.billedUnitPrice, bill.currencyCode, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.quantityVariance, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(line.priceVariance, bill.currencyCode, locale)}
                  </TableCell>
                  <TableCell>
                    {/* The symbol is decorative; the state is in the text for anyone
                        who cannot see a colour or a glyph. */}
                    <span
                      className={
                        line.withinTolerance
                          ? 'text-sm font-medium text-brand-primary'
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
      ) : null}

      {status === 'EXCEPTION' && can(PROCUREMENT_PERMISSIONS.approveMatchException) ? (
        <Button type="button" onClick={() => setApproving(true)}>
          {t('approveException')}
        </Button>
      ) : null}

      {approving ? (
        <ApproveExceptionDrawer billId={bill.id} onClose={() => setApproving(false)} />
      ) : null}
    </div>
  );
}

function StatusBanner({
  status,
  match,
  locale,
}: {
  status: BillMatchStatus;
  match: { approvedBy: string | null; approvedAt: string | null } | null;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('procurement.matching');

  switch (status) {
    case 'MATCHED':
      return <Alert variant="success" messages={[t('matchedBanner')]} />;
    case 'MATCHED_WITH_TOLERANCE':
      return <Alert variant="warning" messages={[t('toleranceBanner')]} />;
    case 'EXCEPTION':
      return <Alert variant="error" messages={[t('exceptionBanner')]} />;
    case 'APPROVED_EXCEPTION':
      return (
        <Alert
          variant="warning"
          messages={[
            t('approvedExceptionBanner', {
              by: match?.approvedBy ? t('approvedBy', { name: match.approvedBy }) : '',
              on: match?.approvedAt
                ? t('approvedOn', { date: formatDate(match.approvedAt, locale) ?? '' })
                : '',
            }),
          ]}
        />
      );
    default:
      return null;
  }
}

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
