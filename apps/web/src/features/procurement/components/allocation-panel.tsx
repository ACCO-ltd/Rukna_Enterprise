'use client';

/**
 * Applying a posted advance to a posted bill (Tier D).
 *
 * Lives on the payment detail page rather than as its own screen: an allocation is always
 * "this advance against that bill", and the advance is the thing the user is already looking at.
 *
 * AP-6 — the panel opens on what the payment has already settled (`GET /payments/:id` carries its
 * allocations, each with its bill). Advance applied later can be reversed from its row; an
 * allocation made when the payment was raised is part of the payment's own journal and is undone
 * by reversing the payment.
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Alert, Button, FormField, MoneyDisplay, MoneyInput, Select, StatusPill } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';

import { useAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import {
  allocatableBills,
  allocationAmountProblem,
  allocationBlockReason,
  canAllocate,
  maxAllocatable,
  planAllocation,
} from '../allocation-actions';
import { useAllocateAdvance, useReverseAdvanceAllocation, useSupplierBills } from '../hooks/use-procurement';
import type { SupplierPayment, SupplierPaymentAllocationRow } from '../types';

export function AllocationPanel({ payment }: { payment: SupplierPayment }) {
  const t = useTranslations('procurement.allocation');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Scoped to this payment's supplier. The server ignores the supplier entirely (A18), so this
  // filter is the affordance; `allocatableBills` re-applies it because a list filtered by one
  // criterion is not the same as a list filtered by four.
  const bills = useSupplierBills({ supplierId: payment.supplierId });
  const accounts = useAccounts();
  const allocate = useAllocateAdvance(payment.id);
  const reverseApplication = useReverseAdvanceAllocation(payment.id);
  const [reversing, setReversing] = useState<SupplierPaymentAllocationRow | null>(null);

  const ids = { bill: useId(), amount: useId() };

  const eligible = useMemo(
    () => allocatableBills(payment, bills.data ?? []),
    [payment, bills.data],
  );

  const selected = eligible.find((bill) => bill.id === billId) ?? null;
  const amountMinor = parseMinorUnits(amount, MONEY_SCALE);
  const problem = selected ? allocationAmountProblem(amountMinor, payment, selected) : 'empty';

  const blocked = allocationBlockReason(payment, eligible.length);
  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);

  const serverError =
    allocate.error instanceof ApiError
      ? allocate.error.message
      : allocate.error
        ? tc('loadFailed')
        : null;

  function handleAllocate() {
    setShowErrors(true);
    if (!selected || amountMinor === null || problem !== null) return;

    const plan = planAllocation(amountMinor, selected.id, locale, accounts.data ?? []);
    if (!plan.ok) return;

    allocate.mutate(plan.plan.payload, {
      onSuccess: () => {
        setBillId('');
        setAmount('');
        setShowErrors(false);
      },
    });
  }

  const plan =
    selected && amountMinor !== null && problem === null
      ? planAllocation(amountMinor, selected.id, locale, accounts.data ?? [])
      : null;

  // SP-4 — a payment not yet posted, or with nothing left to apply, shows only what it paid.
  const quiet = blocked === 'payment-not-posted' || blocked === 'nothing-unallocated';
  const allocations = payment.allocations ?? [];
  if (quiet && allocations.length === 0) return null;

  return (
    <section className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-e1">
      <h2 className="text-body font-semibold text-foreground">{t('title')}</h2>

      {/* What the payment has already settled comes first: it is what an accountant looks for. */}
      {allocations.length > 0 ? (
        <div className="space-y-2">
          <ul className="divide-y divide-border rounded-control border border-border">
            {(payment.allocations ?? []).map((a) => {
              // Applied later from the unapplied balance (own journal), not at the payment's creation.
              const laterApplication = a.journalEntryId !== null && a.journalEntryId !== payment.postedJournalEntryId;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 text-body-sm">
                    <Link href={`/finance/accounting/bills/${a.supplierBillId}`} className="font-medium text-brand-primary underline-offset-2 hover:underline">
                      {a.bill?.billNumber ?? a.bill?.supplierInvoiceNumber ?? t('aBill')}
                    </Link>
                    <span className="ms-2 text-caption text-muted-foreground">
                      {formatDate(a.allocationDate, locale)} · {t(laterApplication ? 'appliedLater' : 'appliedWithPayment')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {a.postingStatus === 'REVERSED' ? <StatusPill tone="historical">{t('reversed')}</StatusPill> : null}
                    <span className={a.postingStatus === 'REVERSED' ? 'text-muted-foreground line-through' : ''}>
                      <MoneyDisplay value={a.allocatedAmount} />
                    </span>
                    {canManage && laterApplication && a.postingStatus === 'POSTED' ? (
                      <Button size="sm" variant="outline" onClick={() => setReversing(a)}>
                        {t('reverseApplication')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {reversing ? (
        <ConfirmActionDialog
          title={t('reverseApplicationTitle', { bill: reversing.bill?.billNumber ?? reversing.bill?.supplierInvoiceNumber ?? '' })}
          description={t('reverseApplicationBody')}
          confirmLabel={t('reverseApplication')}
          destructive
          isPending={reverseApplication.isPending}
          errorMessage={reverseApplication.error instanceof ApiError ? reverseApplication.error.message : reverseApplication.error ? tc('loadFailed') : undefined}
          onConfirm={() => reverseApplication.mutate(reversing.id, { onSuccess: () => setReversing(null) })}
          onDismiss={() => {
            reverseApplication.reset();
            setReversing(null);
          }}
        />
      ) : null}

      {quiet ? null : blocked ? (
        <p className="text-body-sm text-muted-foreground">{t(`blocked.${blocked}`)}</p>
      ) : canManage ? (
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-body-sm font-semibold text-foreground">{t('applyTitle', { amount: formatMoney(payment.unallocatedAmount, payment.currencyCode, locale) ?? '' })}</h3>
          <FormField htmlFor={ids.bill} label={t('bill')}>
            <Select
              id={ids.bill}
              value={billId}
              onChange={(value) => {
                const next = value;
                setBillId(next);
                // Prefill with whichever ceiling binds — the common case is settling a bill
                // outright, and the alternative is making the user retype a figure already
                // on screen.
                const bill = eligible.find((b) => b.id === next);
                setAmount(bill ? fromMinorUnits(maxAllocatable(payment, bill), MONEY_SCALE) : '');
              }}
            >
              <option value="" disabled>
                —
              </option>
              {eligible.map((bill) => (
                <option key={bill.id} value={bill.id}>
                  {bill.supplierInvoiceNumber} ·{' '}
                  {formatDate(bill.billDate, locale) ?? ''} ·{' '}
                  {formatMoney(bill.outstandingAmount, bill.currencyCode, locale)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t('billHint')}</p>
          </FormField>

          <FormField htmlFor={ids.amount} label={t('amount')}>
            <MoneyInput
              id={ids.amount}
              value={amount}
              onValueChange={setAmount}
              autoComplete="off"
              disabled={!selected}
            />
            {showErrors && problem ? (
              <p className="text-xs text-danger">{t(`amountProblem.${problem}`)}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('amountHint', {
                  unallocated:
                    formatMoney(payment.unallocatedAmount, payment.currencyCode, locale) ?? '',
                })}
              </p>
            )}
          </FormField>

          {plan?.ok ? (
            <div className="rounded-control border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t('journalPreview')}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {plan.plan.lines.map((line) => (
                  <li key={line.accountCode} className="flex justify-between gap-4">
                    <span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {line.accountCode}
                      </span>{' '}
                      {line.accountName}
                    </span>
                    <bdi className="tabular-nums">
                      {line.debit
                        ? t('debitOf', {
                            amount:
                              formatMoney(line.debit, payment.currencyCode, locale) ?? '',
                          })
                        : t('creditOf', {
                            amount:
                              formatMoney(line.credit ?? '0', payment.currencyCode, locale) ?? '',
                          })}
                    </bdi>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

          <Button
            type="button"
            onClick={handleAllocate}
            loading={allocate.isPending}
            disabled={!selected || problem !== null || !canAllocate(payment)}
          >
            {t('apply')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
