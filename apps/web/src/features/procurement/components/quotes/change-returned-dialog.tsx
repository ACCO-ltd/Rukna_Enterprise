'use client';

/**
 * ─── Change returned (ADR-045 §2, S6, P13) ──────────────────────────────────────────────
 *
 * The buyer hands back what the receipt did not use. Finance counts it and types it — the buyer
 * never does. Prefilled with what the buyer still holds, capped there (the cap is said in words;
 * the server enforces it, R11). The money lands in a cash or bank account: the destination is
 * required for every method, since cash goes back into the cash box (EVT-AP-009).
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  MoneyInput,
  RadioGroup,
  Select,
} from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { formatDate, formatMoney } from '@/lib/format';

import { useGetBuyerAdvance } from '../../hooks/use-procurement';
import {
  useBuyerCashReadiness,
  useIdempotencyKey,
  useRecordAdvanceReturn,
  useSubmitOnce,
} from '../../hooks/use-quotation-payment';
import {
  amountProblem,
  outstandingAdvances,
  returnDestinations,
  todayInMogadishu,
  toMoneyString,
} from '../../quotations/payment-rules';
import type { CashPaymentMethod, QuotationPayment } from '../../quotations/payment-types';
import { usePaymentRefusalText } from './payment-shared';

const METHODS: CashPaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'BANK'];

export function ChangeReturnedDialog({
  requestId,
  payment,
  currencyCode,
  onClose,
}: {
  requestId: string;
  payment: QuotationPayment;
  currencyCode: string;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.payment.change');
  const tRelease = useTranslations('procurement.quotes.payment.release');
  const tMethod = useTranslations('procurement.quotes.payment.method');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en';
  const { fromError } = usePaymentRefusalText();
  const record = useRecordAdvanceReturn(requestId);
  const banks = useBankAccounts();
  // One key for this open: a double tap or a retry records one return.
  const idempotencyKey = useIdempotencyKey(true);
  const once = useSubmitOnce(requestId);

  const open = outstandingAdvances(payment);
  const [advanceId, setAdvanceId] = useState(open[0]?.id ?? '');
  const advance = open.find((a) => a.id === advanceId) ?? null;
  const [typed, setTyped] = useState<string | null>(null);
  const amount = typed ?? advance?.outstanding ?? '';
  const [method, setMethod] = useState<CashPaymentMethod>('CASH');
  const active = (banks.data ?? []).filter((b) => b.status === 'ACTIVE' && b.currencyCode === currencyCode);
  // The account the cash came from, and the accounts without signatories (cash box, EVC float).
  const source = useGetBuyerAdvance(advance?.id ?? '');
  const readiness = useBuyerCashReadiness();
  const cashIds = readiness.data ? new Set(readiness.data.cashAccounts.map((a) => a.bankAccountId)) : null;
  const { options: accounts, defaultId } = returnDestinations(
    method,
    active,
    cashIds,
    source.data?.disbursementBankAccountId ?? null,
  );
  const [destination, setDestination] = useState('');
  const destinationId = accounts.some((a) => a.id === destination) ? destination : defaultId;
  const [receivedAt, setDate] = useState(todayInMogadishu());
  const [touched, setTouched] = useState(false);

  const money = (value: string | null | undefined) => formatMoney(value ?? null, currencyCode, locale) ?? '';
  const cap = advance?.outstanding ?? null;
  const problem = amountProblem(amount, cap);
  const amountText = toMoneyString(amount);
  const ready = advance !== null && problem === null && Boolean(destinationId) && Boolean(receivedAt);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('title')}
      subtitle={advance?.recipientName ? t('subtitle', { name: advance.recipientName }) : undefined}
      closeLabel={tCommon('close')}
      busy={record.isPending}
      onSubmit={() => {
        setTouched(true);
        if (!ready || !advance || !amountText || !once.begin()) return;
        record.mutate(
          {
            advanceId: advance.id,
            payload: { idempotencyKey, amount: amountText, returnMethod: method, destinationBankAccountId: destinationId, receivedAt },
          },
          {
            onSuccess: onClose,
            onError: (err) =>
              void once.landedAnyway(err).then((landed) => {
                if (landed) {
                  record.reset();
                  onClose();
                }
              }),
          },
        );
      }}
    >
      <FormDialogBody className="space-y-4">
        {open.length > 1 ? (
          <FormField htmlFor="change-advance" label={t('which')}>
            <Select id="change-advance" value={advanceId} onChange={setAdvanceId}>
              {open.map((a) => (
                <option key={a.id} value={a.id}>
                  {t('advanceOption', {
                    date: formatDate(a.advancedAt, locale) ?? '',
                    outstanding: money(a.outstanding),
                  })}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <FormField
          htmlFor="change-amount"
          label={t('amount')}
          hint={cap ? t('cap', { cap: money(cap), name: advance?.recipientName ?? t('theBuyer') }) : undefined}
          error={
            touched && problem
              ? problem === 'over'
                ? t('over', { cap: money(cap) })
                : tRelease(problem === 'zero' ? 'amountZero' : 'amountEmpty')
              : undefined
          }
        >
          <MoneyInput
            id="change-amount"
            value={amount}
            onValueChange={(raw) => {
              setTouched(true);
              setTyped(raw);
            }}
            className="text-lg"
          />
        </FormField>

        <RadioGroup
          label={t('method')}
          name="change-method"
          value={method}
          onChange={(next) => {
            setMethod(next);
            setDestination('');
          }}
          options={METHODS.map((m) => ({ value: m, label: tMethod(m) }))}
        />

        <FormField htmlFor="change-into" label={t('into')} hint={t('intoHint')}>
          <Select id="change-into" value={destinationId} onChange={setDestination}>
            {accounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bankName === b.accountName ? b.accountName : `${b.accountName} · ${b.bankName}`}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField htmlFor="change-date" label={t('date')}>
          <DatePicker id="change-date" value={receivedAt} onChange={setDate} />
        </FormField>

        {record.error ? <Alert variant="error" messages={[fromError(record.error) ?? '']} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" size="lg" className="min-h-12 w-full sm:w-auto" disabled={!advance} loading={record.isPending}>
          {amountText ? t('submit', { amount: money(amountText) }) : t('submitNoAmount')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
