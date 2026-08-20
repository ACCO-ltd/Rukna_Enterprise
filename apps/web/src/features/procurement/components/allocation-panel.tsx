'use client';

/**
 * Applying a posted advance to a posted bill (Tier D).
 *
 * Lives on the payment detail page rather than as its own screen: an allocation is always
 * "this advance against that bill", and the advance is the thing the user is already looking at.
 *
 * **There is no reverse action here.** `POST /payments/:id/allocations/:allocationId/reverse`
 * exists, but no endpoint returns an allocation id — allocating returns only the journal, the
 * payment payload embeds no allocations, and nothing lists them (A17 / #35). A button that
 * cannot be given its argument is worse than no button, so the panel says the history is
 * unavailable instead of implying one.
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, MoneyInput } from '@erp/ui';

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
import { useAllocateAdvance, useSupplierBills } from '../hooks/use-procurement';
import type { SupplierPayment } from '../types';

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

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* A17. Stated before the form, because the first thing an accountant will look for is
          what this payment has already settled — and the answer is that the API cannot say. */}
      <Alert variant="info" messages={[t('historyUnavailable')]} />

      {blocked ? (
        <Alert variant="warning" messages={[t(`blocked.${blocked}`)]} />
      ) : canManage ? (
        <div className="space-y-4">
          <FormField htmlFor={ids.bill} label={t('bill')}>
            <select
              id={ids.bill}
              value={billId}
              onChange={(event) => {
                const next = event.target.value;
                setBillId(next);
                // Prefill with whichever ceiling binds — the common case is settling a bill
                // outright, and the alternative is making the user retype a figure already
                // on screen.
                const bill = eligible.find((b) => b.id === next);
                setAmount(bill ? fromMinorUnits(maxAllocatable(payment, bill), MONEY_SCALE) : '');
              }}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
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
            </select>
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
            <div className="rounded-md border border-border bg-muted/40 p-3">
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
            disabled={allocate.isPending || !selected || problem !== null || !canAllocate(payment)}
          >
            {t('apply')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
