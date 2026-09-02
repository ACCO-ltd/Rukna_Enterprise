'use client';

/**
 * Raise a supplier payment, settling its bills in one flow (Tier C + D9).
 *
 * The common path is: pick supplier + bank + method + date + **amount**, then tick the bills
 * this payment settles and let it prefill full settlement. `SupplierPaymentService.create`
 * (A16, completed in commit eb826bb) accepts `allocations[]`, writes an allocation row per entry, reduces
 * each target bill's `outstandingAmount`, and keeps the remainder as a supplier advance — all
 * in one transaction. So this is now the create-with-allocation-lines flow the plan asked for,
 * not the advance-only mitigation it used to be.
 *
 * The "Apply to bills" list is scoped to the supplier's outstanding POSTED bills in this
 * currency (`applyToBills`), which makes the server's same-supplier / same-currency / POSTED
 * guards unreachable from the UI and leaves only the two amount ceilings to mirror client-side:
 * each apply ≤ that bill's outstanding, and Σ applied ≤ the payment amount.
 *
 * The standalone allocation panel (`allocation-panel.tsx`) stays as the secondary reconciliation
 * tool for applying an advance after the fact — it is untouched by this flow.
 */

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, MoneyInput, Textarea } from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useCreateSupplierPayment, useSupplierBills } from '../hooks/use-procurement';
import {
  allocationSectionProblem,
  applyToBills,
  buildAllocations,
  prefillAmountMinor,
  rowProblem,
  totalAppliedMinor,
  unappliedMinor,
  type AllocationRowInput,
} from '../payment-allocations';
import { bankAccountLabel, payableBankAccounts } from '../payment-actions';
import { moneyToApi } from '../quantities';
import type { SupplierBill } from '../types';
import { SupplierPicker } from './supplier-picker';

/**
 * `paymentMethod` is a free `@IsString() @MaxLength(50)` on the DTO with no enum behind it,
 * so these are the UI's own vocabulary rather than the server's. Kept as stable codes and
 * translated for display, so a method chosen today still reads correctly if the labels change.
 */
export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'CHEQUE',
  'CASH',
  'CARD',
  'MOBILE_MONEY',
] as const;

/** Per-bill apply state: whether it is ticked, and the raw (comma-free) amount string. */
interface ApplyState {
  checked: boolean;
  amount: string;
}

export function SupplierPaymentForm() {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const { can } = usePermissions();

  const [supplierId, setSupplierId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  // Single-currency platform (ADR-024): USD is implicit, never entered.
  const currencyCode = 'USD';
  const [totalAmount, setTotalAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Keyed by bill id. A bill with no entry is unchecked with no amount.
  const [apply, setApply] = useState<Record<string, ApplyState>>({});

  const create = useCreateSupplierPayment();
  const bankAccounts = useBankAccounts();
  // Only fetched once a supplier is chosen — the list is supplier-scoped, and there is nothing
  // to show before then. `GET /bills` has no outstanding/POSTED filter (A7), so `applyToBills`
  // does the scoping.
  const bills = useSupplierBills(
    supplierId ? { supplierId } : undefined,
    { enabled: Boolean(supplierId) },
  );

  const ids = {
    supplier: useId(),
    bank: useId(),
    paymentDate: useId(),
    accountingDate: useId(),
    amount: useId(),
    method: useId(),
    reference: useId(),
    notes: useId(),
  };

  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);
  const payable = payableBankAccounts(bankAccounts.data ?? []);
  const noBanks = !bankAccounts.isPending && payable.length === 0;

  const amountMinor = parseMinorUnits(totalAmount, MONEY_SCALE);
  const amountValid = amountMinor !== null && amountMinor > 0;

  const eligibleBills = useMemo(
    () => (supplierId ? applyToBills(supplierId, currencyCode, bills.data ?? []) : []),
    [supplierId, bills.data],
  );

  // The validation rows: one per eligible bill, carrying its checked/amount state and outstanding.
  const rows: (AllocationRowInput & { bill: SupplierBill })[] = eligibleBills.map((bill) => {
    const state = apply[bill.id];
    return {
      billId: bill.id,
      bill,
      checked: state?.checked ?? false,
      amountMinor: state ? parseMinorUnits(state.amount, MONEY_SCALE) : null,
      outstandingMinor: toMinorUnits(bill.outstandingAmount, MONEY_SCALE),
    };
  });

  const appliedMinor = totalAppliedMinor(rows);
  const unapplied = unappliedMinor(amountMinor ?? 0, appliedMinor);
  const sectionProblem =
    amountMinor !== null ? allocationSectionProblem(rows, amountMinor) : null;

  const complete =
    Boolean(supplierId && bankAccountId && paymentDate && paymentMethod) &&
    amountValid &&
    sectionProblem === null;

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  /** Remaining unallocated money to prefill the next ticked bill with — amount minus what the
   *  other ticked bills already claim. */
  function remainingFor(billId: string): number {
    if (amountMinor === null) return 0;
    const otherApplied = rows.reduce(
      (sum, r) =>
        r.billId !== billId && r.checked && r.amountMinor !== null ? sum + r.amountMinor : sum,
      0,
    );
    return Math.max(0, amountMinor - otherApplied);
  }

  function toggleBill(bill: SupplierBill, checked: boolean) {
    setApply((prev) => {
      if (!checked) return { ...prev, [bill.id]: { checked: false, amount: '' } };
      const prefill = prefillAmountMinor(
        toMinorUnits(bill.outstandingAmount, MONEY_SCALE),
        remainingFor(bill.id),
      );
      return { ...prev, [bill.id]: { checked: true, amount: fromMinorUnits(prefill, MONEY_SCALE) } };
    });
  }

  function setBillAmount(billId: string, amount: string) {
    setApply((prev) => ({
      ...prev,
      [billId]: { checked: prev[billId]?.checked ?? true, amount },
    }));
  }

  function handleSubmit() {
    setShowErrors(true);
    if (!complete || amountMinor === null) return;

    const allocations = buildAllocations(rows);

    create.mutate(
      {
        supplierId,
        bankAccountId,
        paymentDate,
        // Defaults to paymentDate server-side. Sent explicitly so the date that lands in the
        // ledger is the one the user saw, rather than one the server chose on their behalf.
        accountingDate: accountingDate || paymentDate,
        currencyCode,
        totalAmount: moneyToApi(amountMinor),
        paymentMethod,
        ...(bankReference.trim() ? { bankReference: bankReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(allocations.length > 0 ? { allocations } : {}),
      },
      { onSuccess: (payment) => router.push(`/finance/accounting/payments/${payment.id}`) },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('createSubtitle')}</p>
      </div>

      {noBanks ? (
        <Alert variant="error" title={t('noBanksTitle')} messages={[t('noBanksBody')]} />
      ) : null}

      <div className="max-w-xl space-y-4">
        <FormField htmlFor={ids.supplier} label={tc('supplier')}>
          <SupplierPicker id={ids.supplier} value={supplierId} onChange={setSupplierId} required />
        </FormField>

        <FormField htmlFor={ids.bank} label={t('bankAccount')}>
          <select
            id={ids.bank}
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="" disabled>
              —
            </option>
            {payable.map((account) => (
              <option key={account.id} value={account.id}>
                {bankAccountLabel(account)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('bankAccountHint')}</p>
        </FormField>

        <div className="flex flex-wrap gap-4">
          <FormField
            htmlFor={ids.paymentDate}
            label={t('paymentDate')}
            className="min-w-44 flex-1"
          >
            <Input
              id={ids.paymentDate}
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </FormField>

          <FormField
            htmlFor={ids.accountingDate}
            label={`${t('accountingDate')} (${tc('optional')})`}
            className="min-w-44 flex-1"
          >
            <Input
              id={ids.accountingDate}
              type="date"
              value={accountingDate}
              onChange={(e) => setAccountingDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('accountingDateHint')}</p>
          </FormField>
        </div>

        <div className="flex flex-wrap gap-4">
          <FormField htmlFor={ids.amount} label={t('totalAmount')} className="min-w-44 flex-1">
            <MoneyInput
              id={ids.amount}
              value={totalAmount}
              onValueChange={setTotalAmount}
              autoComplete="off"
            />
            {showErrors && !amountValid ? (
              <p className="text-xs text-danger">{t('amountError')}</p>
            ) : null}
          </FormField>
        </div>

        <FormField htmlFor={ids.method} label={t('method')}>
          <select
            id={ids.method}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`methods.${method}`)}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          htmlFor={ids.reference}
          label={`${t('bankReference')} (${tc('optional')})`}
        >
          <Input
            id={ids.reference}
            value={bankReference}
            onChange={(e) => setBankReference(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </FormField>

        <FormField htmlFor={ids.notes} label={`${tc('notes')} (${tc('optional')})`}>
          <Textarea
            id={ids.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
          />
        </FormField>
      </div>

      {/* ─── Apply to bills ─────────────────────────────────────────────────────── */}
      <section className="max-w-xl space-y-3 border-t border-border pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t('apply.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('apply.hint')}</p>
        </div>

        <ApplyBody
          supplierId={supplierId}
          amountEntered={amountValid}
          billsPending={bills.isPending}
          billsError={bills.isError}
          rows={rows}
          apply={apply}
          showErrors={showErrors}
          locale={locale}
          currencyCode={currencyCode}
          onToggle={toggleBill}
          onAmountChange={setBillAmount}
          t={t}
        />

        {/* Live footer: pinned regardless of state so the split is always legible. Applied and
            Unapplied are peers — neither out-weights the other; money stays neutral. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          <span className="tabular-nums font-medium text-foreground">
            {t('apply.applied', {
              amount: formatMoney(fromMinorUnits(appliedMinor, MONEY_SCALE), currencyCode, locale) ?? '',
            })}
          </span>
          <span className="tabular-nums font-medium text-foreground">
            {t('apply.unapplied', {
              amount: formatMoney(fromMinorUnits(unapplied, MONEY_SCALE), currencyCode, locale) ?? '',
            })}
          </span>
        </div>
        {/* Whenever any money is left over — including a whole-amount pure advance — say what
            becomes of it. This is the single most consequential fact about the payment. */}
        {amountValid && unapplied > 0 ? (
          <p className="text-xs text-muted-foreground">{t('apply.unappliedHint')}</p>
        ) : null}

        {showErrors && sectionProblem === 'exceeds-amount' ? (
          <Alert variant="error" messages={[t('apply.exceedsAmount')]} />
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc('cancel')}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || noBanks || !canManage}
        >
          {t('record')}
        </Button>
      </div>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
    </div>
  );
}

/**
 * The body of the "Apply to bills" section — the state ladder for the bill list:
 * no amount yet → no supplier → loading → error (degrade) → empty (pure advance) → the rows.
 */
function ApplyBody({
  supplierId,
  amountEntered,
  billsPending,
  billsError,
  rows,
  apply,
  showErrors,
  locale,
  currencyCode,
  onToggle,
  onAmountChange,
  t,
}: {
  supplierId: string;
  amountEntered: boolean;
  billsPending: boolean;
  billsError: boolean;
  rows: (AllocationRowInput & { bill: SupplierBill })[];
  apply: Record<string, ApplyState>;
  showErrors: boolean;
  locale: 'en' | 'ar';
  currencyCode: string;
  onToggle: (bill: SupplierBill, checked: boolean) => void;
  onAmountChange: (billId: string, amount: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!amountEntered) {
    return <p className="text-xs text-muted-foreground">{t('apply.enterAmountFirst')}</p>;
  }
  if (!supplierId) {
    return <p className="text-xs text-muted-foreground">{t('apply.selectSupplierFirst')}</p>;
  }
  if (billsPending) {
    return (
      <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {t('apply.loading')}
      </div>
    );
  }
  if (billsError) {
    return <Alert variant="warning" messages={[t('apply.loadFailed')]} />;
  }
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('apply.none')}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const state = apply[row.bill.id];
        const problem = showErrors ? rowProblem(row) : null;
        const outstanding =
          formatMoney(row.bill.outstandingAmount, currencyCode, locale) ?? '';
        const date = formatDate(row.bill.billDate, locale) ?? '';

        return (
          <li
            key={row.bill.id}
            // A ticked bill gets a quiet accent left-rule so "which bills are in this payment"
            // is scannable at a glance, without a bg fill competing with the primary action.
            className={`space-y-2 border-s-2 ps-2 ${
              row.checked ? 'border-brand-primary' : 'border-transparent'
            }`}
          >
            {/* One line: checkbox + invoice/date, then the outstanding pinned to the end. */}
            <label className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => onToggle(row.bill, e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-brand-primary"
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm text-foreground">
                    {row.bill.supplierInvoiceNumber}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <bdi>{date}</bdi>
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-xs text-foreground">
                {t('apply.outstanding', { amount: outstanding })}
              </span>
            </label>

            {/* Apply input: full-width below the row, only when the bill is ticked. */}
            {row.checked ? (
              <div className="ps-6">
                <label className="sr-only" htmlFor={`apply-${row.bill.id}`}>
                  {t('apply.applyLabel', { invoice: row.bill.supplierInvoiceNumber })}
                </label>
                <MoneyInput
                  id={`apply-${row.bill.id}`}
                  value={state?.amount ?? ''}
                  onValueChange={(v) => onAmountChange(row.bill.id, v)}
                  autoComplete="off"
                  aria-invalid={problem ? true : undefined}
                />
                {problem ? (
                  <p className="mt-1 text-xs text-danger">{t(`apply.rowProblem.${problem}`)}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
