'use client';

/**
 * Raise a supplier payment (Tier C).
 *
 * **There are no allocation lines, deliberately.** `CreateSupplierPaymentDto` accepts an
 * `allocations[]` array and `supplier-payment.service.ts:62` sums it into `allocatedAmount`,
 * but no `SupplierPaymentAllocation` row is ever written and the bill's `outstandingAmount` is
 * never reduced (A16 / #34). A payment created that way debits AP at post while the bill it
 * names still reads as fully unpaid, and no row links the two — the GL and the AP subledger
 * disagree, permanently and silently.
 *
 * So a payment is raised here as an unallocated advance and settled afterwards through
 * `POST /payments/:id/allocations` (Tier D), which writes the row, moves the payment's
 * allocated/unallocated pair, reduces the bill and posts its own journal. That is the only
 * path where the two ledgers agree.
 *
 * The build plan called this "create with allocation lines". This is the deviation, and the
 * reason for it.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, MoneyInput, Textarea } from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { useCreateSupplierPayment } from '../hooks/use-procurement';
import { bankAccountLabel, payableBankAccounts } from '../payment-actions';
import { moneyToApi } from '../quantities';
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

export function SupplierPaymentForm() {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();

  const [supplierId, setSupplierId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [totalAmount, setTotalAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateSupplierPayment();
  const bankAccounts = useBankAccounts();

  const ids = {
    supplier: useId(),
    bank: useId(),
    paymentDate: useId(),
    accountingDate: useId(),
    currency: useId(),
    amount: useId(),
    method: useId(),
    reference: useId(),
    notes: useId(),
  };

  const payable = payableBankAccounts(bankAccounts.data ?? []);
  const noBanks = !bankAccounts.isPending && payable.length === 0;

  const amountMinor = parseMinorUnits(totalAmount, MONEY_SCALE);
  const amountValid = amountMinor !== null && amountMinor > 0;
  const complete = Boolean(supplierId && bankAccountId && paymentDate && paymentMethod) && amountValid;

  const serverError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? tc('loadFailed')
        : null;

  function handleSubmit() {
    setShowErrors(true);
    if (!complete || amountMinor === null) return;

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

      <Alert variant="info" messages={[t('advanceOnlyNotice')]} />

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

          <FormField htmlFor={ids.currency} label={tc('currency')} className="min-w-32 flex-1">
            <Input
              id={ids.currency}
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              maxLength={3}
              className="uppercase"
            />
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm">
          <span className="text-muted-foreground">{t('totalAmount')}: </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(fromMinorUnits(amountMinor ?? 0, MONEY_SCALE), currencyCode, locale)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={create.isPending || noBanks}>
            {tc('create')}
          </Button>
        </div>
      </div>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
    </div>
  );
}
