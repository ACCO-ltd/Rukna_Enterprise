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
import { Alert, Button, Checkbox, cn, DatePicker, FormField, Input, MoneyInput, Select, Textarea } from '@erp/ui';

import { useModuleTrail } from '@/components/layout/module-chrome';
import { useBankAccounts, useFiscalYears } from '@/features/accounting/hooks/use-accounting';
import { makeClosedPeriodPredicate } from '@/features/accounting/open-period';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { PaymentMethodPicker } from '@/features/receipts/components/payment-method-fields';
import { ACCOUNT_KIND_FOR_METHOD, MOBILE_MONEY_PROVIDERS } from '@/features/receipts/payment-methods';
import type { ReceiptPaymentMethod } from '@/lib/api-types';

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

/** Per-bill apply state: whether it is ticked, and the raw (comma-free) amount string. */
interface ApplyState {
  checked: boolean;
  amount: string;
}

/**
 * `prefill` opens the form for one bill (SB-2's Pay bill): its supplier chosen, the bill ticked
 * and the amount set to what it still owes. Everything stays editable.
 */
export function SupplierPaymentForm({
  prefill,
}: {
  prefill?: { supplierId: string; billId?: string; amount?: string };
} = {}) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  useModuleTrail(t('createTitle'));
  const { can } = usePermissions();

  const [supplierId, setSupplierId] = useState(prefill?.supplierId ?? '');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayWireDate());
  const [accountingDate, setAccountingDate] = useState('');
  // Single-currency platform (ADR-024): USD is implicit, never entered.
  const currencyCode = 'USD';
  const [totalAmount, setTotalAmount] = useState(prefill?.amount ?? '');
  // SP-4 — until the amount is typed, it is the sum of the bills ticked (tick bills, then pay).
  const [amountTouched, setAmountTouched] = useState(Boolean(prefill?.amount));
  const [paymentMethod, setPaymentMethod] = useState<ReceiptPaymentMethod>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');
  // SP-3 — the rest of the proof, all optional; only the fields the method shows are sent.
  const [proof, setProof] = useState<{ instrumentDate: string; provider: string; payeeAccount: string; payeeName: string }>({
    instrumentDate: '',
    provider: '',
    payeeAccount: '',
    payeeName: '',
  });
  const [otherBookingDate, setOtherBookingDate] = useState(false);
  const [notes, setNotes] = useState('');

  // This date is what lands in the ledger, so it carries the same period rule a manual
  // journal does. The payment date itself is a bank fact and is deliberately unconstrained.
  const { data: fiscalYears } = useFiscalYears();
  const isClosedPeriod = useMemo(() => makeClosedPeriodPredicate(fiscalYears), [fiscalYears]);
  const [showErrors, setShowErrors] = useState(false);

  // Keyed by bill id. A bill with no entry is unchecked with no amount.
  const [apply, setApply] = useState<Record<string, ApplyState>>(
    prefill?.billId && prefill.amount ? { [prefill.billId]: { checked: true, amount: prefill.amount } } : {},
  );

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
  // PM-3 — cash leaves a cash box and mobile money a wallet; an account whose kind is not set yet
  // stays offered for every method.
  const fitting = payable.filter((account) => !account.kind || account.kind === ACCOUNT_KIND_FOR_METHOD[paymentMethod]);

  // Oldest due first: what is overdue is what gets paid.
  const eligibleBills = useMemo(
    () =>
      (supplierId ? applyToBills(supplierId, currencyCode, bills.data ?? []) : []).sort((a, b) =>
        (a.dueDate ?? '').localeCompare(b.dueDate ?? ''),
      ),
    [supplierId, bills.data],
  );
  const owedMinor = eligibleBills.reduce((sum, bill) => sum + toMinorUnits(bill.outstandingAmount, MONEY_SCALE), 0);

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
  const amountMinor = amountTouched ? parseMinorUnits(totalAmount, MONEY_SCALE) : appliedMinor > 0 ? appliedMinor : null;
  const amountValid = amountMinor !== null && amountMinor > 0;
  const amountShown = amountTouched ? totalAmount : appliedMinor > 0 ? fromMinorUnits(appliedMinor, MONEY_SCALE) : '';
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
    // No amount typed yet: a ticked bill is paid in full and the amount follows.
    if (!amountTouched) return Number.MAX_SAFE_INTEGER;
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
        accountingDate: (otherBookingDate && accountingDate) || paymentDate,
        currencyCode,
        totalAmount: moneyToApi(amountMinor),
        paymentMethod,
        ...(bankReference.trim() ? { bankReference: bankReference.trim() } : {}),
        ...proofPayload(paymentMethod, proof),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(allocations.length > 0 ? { allocations } : {}),
      },
      { onSuccess: (payment) => router.push(`/finance/accounting/payments/${payment.id}`) },
    );
  }

  const chooseMethod = (method: ReceiptPaymentMethod) => {
    setPaymentMethod(method);
    // The account must suit the new method; the old one is dropped when it does not.
    const current = payable.find((account) => account.id === bankAccountId);
    if (current?.kind && current.kind !== ACCOUNT_KIND_FOR_METHOD[method]) setBankAccountId('');
  };
  const shows = PROOF_SHOWN[paymentMethod];
  const usd = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), currencyCode, locale) ?? '';

  return (
    <div className="space-y-8">
      <div>
        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{t('eyebrow')}</p>
        <h2 className="mt-1 text-display font-semibold tracking-tight text-foreground">{t('createTitle')}</h2>
      </div>

      {noBanks ? <Alert variant="error" title={t('noBanksTitle')} messages={[t('noBanksBody')]} /> : null}

      <section className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <FormField htmlFor={ids.supplier} label={tc('supplier')}>
          <SupplierPicker id={ids.supplier} value={supplierId} onChange={setSupplierId} required />
          {supplierId && !bills.isPending && !bills.isError ? (
            <p className="text-caption text-muted-foreground">
              {eligibleBills.length > 0 ? t('owedNote', { amount: usd(owedMinor), count: eligibleBills.length }) : t('owedNothing')}
            </p>
          ) : null}
        </FormField>
        <FormField htmlFor={ids.amount} label={t('totalAmount')}>
          <MoneyInput
            id={ids.amount}
            value={amountShown}
            onValueChange={(value) => {
              setAmountTouched(true);
              setTotalAmount(value);
            }}
            autoComplete="off"
          />
          {showErrors && !amountValid ? <p className="text-caption text-danger">{t('amountError')}</p> : null}
        </FormField>
      </section>

      <section className="space-y-4">
        <PaymentMethodPicker value={paymentMethod} onChange={chooseMethod} label={t('methodQuestion')} />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <FormField htmlFor={ids.bank} label={t('paidFrom')}>
            <Select id={ids.bank} value={bankAccountId} onChange={(value) => setBankAccountId(value)}>
              <option value="" disabled>
                {t('chooseAccount')}
              </option>
              {fitting.map((account) => (
                <option key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </option>
              ))}
            </Select>
            {showErrors && !bankAccountId ? <p className="text-caption text-danger">{t('accountError')}</p> : null}
          </FormField>
          <FormField htmlFor={ids.paymentDate} label={t('paymentDate')}>
            <DatePicker id={ids.paymentDate} value={paymentDate} onChange={(value) => setPaymentDate(value)} />
            {otherBookingDate ? null : (
              <button
                type="button"
                className="self-start text-caption font-medium text-brand-primary hover:underline"
                onClick={() => setOtherBookingDate(true)}
              >
                {t('bookOtherDate')}
              </button>
            )}
          </FormField>
          {otherBookingDate ? (
            <FormField htmlFor={ids.accountingDate} label={t('accountingDate')}>
              <DatePicker
                id={ids.accountingDate}
                value={accountingDate}
                onChange={(value) => setAccountingDate(value)}
                isDateDisabled={isClosedPeriod}
              />
              <p className="text-caption text-muted-foreground">{t('accountingDateHint')}</p>
            </FormField>
          ) : null}
          <FormField htmlFor={ids.reference} label={`${t(`referenceLabel.${paymentMethod}`)} (${tc('optional')})`}>
            <Input
              id={ids.reference}
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              maxLength={100}
              autoComplete="off"
              className="font-mono"
            />
          </FormField>
          {shows.includes('instrumentDate') ? (
            <FormField htmlFor={`${ids.reference}-date`} label={`${t('proof.chequeDate')} (${tc('optional')})`}>
              <DatePicker
                id={`${ids.reference}-date`}
                value={proof.instrumentDate}
                onChange={(value) => setProof((p) => ({ ...p, instrumentDate: value }))}
              />
            </FormField>
          ) : null}
          {shows.includes('provider') ? (
            <FormField htmlFor={`${ids.reference}-provider`} label={`${t('proof.provider')} (${tc('optional')})`}>
              <Select
                id={`${ids.reference}-provider`}
                value={proof.provider}
                onChange={(value) => setProof((p) => ({ ...p, provider: value }))}
              >
                <option value="">—</option>
                {MOBILE_MONEY_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {t(`providers.${provider}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {shows.includes('payeeAccount') ? (
            <FormField
              htmlFor={`${ids.reference}-account`}
              label={`${t(paymentMethod === 'MOBILE_MONEY' ? 'proof.payeePhone' : 'proof.payeeAccount')} (${tc('optional')})`}
            >
              <Input
                id={`${ids.reference}-account`}
                value={proof.payeeAccount}
                onChange={(e) => setProof((p) => ({ ...p, payeeAccount: e.target.value }))}
                inputMode={paymentMethod === 'MOBILE_MONEY' ? 'tel' : undefined}
                maxLength={50}
                autoComplete="off"
              />
            </FormField>
          ) : null}
          {shows.includes('payeeName') ? (
            <FormField
              htmlFor={`${ids.reference}-name`}
              label={`${t(`proof.nameLabel.${paymentMethod}`)} (${tc('optional')})`}
            >
              <Input
                id={`${ids.reference}-name`}
                value={proof.payeeName}
                onChange={(e) => setProof((p) => ({ ...p, payeeName: e.target.value }))}
                maxLength={150}
                autoComplete="off"
              />
            </FormField>
          ) : null}
          <FormField htmlFor={ids.notes} label={`${tc('notes')} (${tc('optional')})`} className="sm:col-span-2">
            <Textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
          </FormField>
        </div>
      </section>

      {/* ─── Bills to pay ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="border-b border-border pb-2 text-body font-semibold text-foreground">{t('apply.title')}</h2>

        <ApplyBody
          supplierId={supplierId}
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

        <div className="flex flex-wrap items-baseline justify-end gap-x-8 gap-y-1 border-t border-border pt-3 text-body-sm">
          <span className="tabular-nums text-foreground">{t('apply.applied', { amount: usd(appliedMinor) })}</span>
          <span className={cn('tabular-nums font-medium', amountValid && unapplied > 0 ? 'text-warning' : 'text-foreground')}>
            {t('apply.unapplied', { amount: usd(unapplied) })}
          </span>
        </div>

        {showErrors && sectionProblem === 'exceeds-amount' ? (
          <Alert variant="error" messages={[t('apply.exceedsAmount')]} />
        ) : null}
      </section>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc('cancel')}
        </Button>
        <Button type="button" onClick={handleSubmit} loading={create.isPending} disabled={noBanks || !canManage}>
          {t('record')}
        </Button>
      </div>
    </div>
  );
}

/** The proof each method shows beyond its reference number (SP-3); all optional. */
const PROOF_SHOWN: Record<ReceiptPaymentMethod, ('instrumentDate' | 'provider' | 'payeeAccount' | 'payeeName')[]> = {
  BANK_TRANSFER: ['payeeAccount', 'payeeName'],
  CHEQUE: ['instrumentDate', 'payeeName'],
  MOBILE_MONEY: ['provider', 'payeeAccount', 'payeeName'],
  CARD: [],
  CASH: ['payeeName'],
};

/** Only the proof the method shows, trimmed; an empty field is not sent. */
export function proofPayload(
  method: ReceiptPaymentMethod,
  proof: { instrumentDate: string; provider: string; payeeAccount: string; payeeName: string },
): Partial<Record<'instrumentDate' | 'provider' | 'payeeAccount' | 'payeeName', string>> {
  const out: Partial<Record<'instrumentDate' | 'provider' | 'payeeAccount' | 'payeeName', string>> = {};
  for (const field of PROOF_SHOWN[method]) {
    const value = proof[field].trim();
    if (value) out[field] = value;
  }
  return out;
}

/**
 * The body of the "Apply to bills" section — the state ladder for the bill list:
 * no supplier → loading → error (degrade) → empty (pure advance) → the rows.
 */
function ApplyBody({
  supplierId,
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-body-sm">
        <thead>
          <tr className="border-b border-border text-start text-caption text-muted-foreground">
            <th className="w-8 py-2" aria-label={t('apply.payColumn')} />
            <th className="py-2 text-start font-medium">{t('apply.billColumn')}</th>
            <th className="py-2 text-start font-medium">{t('apply.dueColumn')}</th>
            <th className="py-2 text-end font-medium">{t('apply.owedColumn')}</th>
            <th className="w-40 py-2 ps-4 text-end font-medium">{t('apply.payColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = apply[row.bill.id];
            const problem = showErrors ? rowProblem(row) : null;
            const late = row.bill.dueDate ? row.bill.dueDate.slice(0, 10) < todayWireDate() : false;
            return (
              <tr key={row.bill.id} className={cn('border-b border-border align-top', row.checked && 'bg-brand-accent/40')}>
                <td className="py-2.5">
                  <Checkbox
                    checked={row.checked}
                    onChange={(e) => onToggle(row.bill, e.target.checked)}
                    aria-label={t('apply.tick', { invoice: row.bill.billNumber ?? row.bill.supplierInvoiceNumber })}
                  />
                </td>
                <td className="py-2.5">
                  <span className="block font-mono text-foreground">{row.bill.billNumber ?? row.bill.supplierInvoiceNumber}</span>
                  {row.bill.billNumber ? (
                    <span className="block text-caption text-muted-foreground">{row.bill.supplierInvoiceNumber}</span>
                  ) : null}
                </td>
                <td className={cn('whitespace-nowrap py-2.5', late ? 'font-medium text-danger' : 'text-muted-foreground')}>
                  {formatDate(row.bill.dueDate, locale) ?? '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 text-end tabular-nums">
                  {formatMoney(row.bill.outstandingAmount, currencyCode, locale)}
                </td>
                <td className="py-1.5 ps-4">
                  {row.checked ? (
                    <>
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
                      {problem ? <p className="mt-1 text-caption text-danger">{t(`apply.rowProblem.${problem}`)}</p> : null}
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
