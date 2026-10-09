'use client';

/**
 * ─── Apply the prepayment (ADR-045 review H1) ────────────────────────────────────────────
 *
 * Finance paid the store before the goods; the store's invoice is now a posted bill. The money is
 * already with the store, so the bill is settled by applying that prepayment (EVT-AP-005,
 * `POST /payments/:id/allocations`) — never by paying again. Prefilled from the award draft's
 * `unappliedPrepayments[]` and its bills: amount = min(unapplied prepayment, bill outstanding).
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Select,
  Skeleton,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';

import { useApplyPrepayment, usePayDraft, useSubmitOnce } from '../../hooks/use-quotation-payment';
import { prepaymentApplyAmount } from '../../quotations/payment-rules';
import type { QuotationPayment } from '../../quotations/payment-types';
import { usePaymentRefusalText } from './payment-shared';

export function ApplyPrepaymentDialog({
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
  const t = useTranslations('procurement.quotes.payment.apply');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en';
  const { fromError } = usePaymentRefusalText();
  const draft = usePayDraft(requestId);
  const apply = useApplyPrepayment(requestId);
  const once = useSubmitOnce(requestId);

  const prepayments = draft.data?.unappliedPrepayments ?? [];
  const bills = draft.data?.bills ?? [];
  const [paymentChoice, setPayment] = useState('');
  const [billChoice, setBill] = useState('');
  const prepayment = prepayments.find((p) => p.paymentId === paymentChoice) ?? prepayments[0] ?? null;
  const bill = bills.find((b) => b.id === billChoice) ?? bills[0] ?? null;
  const amount = prepaymentApplyAmount(prepayment?.unallocated, bill?.outstanding);
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currencyCode, locale) ?? '';
  const numberOf = (paymentId: string) => payment.payments?.find((p) => p.id === paymentId)?.number ?? null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('title')}
      subtitle={t('subtitle')}
      closeLabel={tCommon('close')}
      busy={apply.isPending}
      onSubmit={() => {
        if (!prepayment || !bill || !amount || !once.begin()) return;
        const minor = parseMinorUnits(amount, MONEY_SCALE)!;
        // The allocation DTO takes a JSON number; minor units keep the conversion exact.
        apply.mutate(
          { paymentId: prepayment.paymentId, supplierBillId: bill.id, amount: minor / 100 },
          {
            onSuccess: onClose,
            onError: (err) =>
              void once.landedAnyway(err).then((landed) => {
                if (landed) {
                  apply.reset();
                  onClose();
                }
              }),
          },
        );
      }}
    >
      <FormDialogBody className="space-y-4">
        {draft.isPending ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-11 w-full" />
          </div>
        ) : !prepayment || !bill ? (
          <Alert variant="info" messages={[t('nothing')]} />
        ) : (
          <>
            {prepayments.length > 1 ? (
              <FormField htmlFor="apply-payment" label={t('from')}>
                <Select id="apply-payment" value={prepayment.paymentId} onChange={setPayment}>
                  {prepayments.map((p) => (
                    <option key={p.paymentId} value={p.paymentId}>
                      {t('prepaymentOption', { number: numberOf(p.paymentId) ?? '—', amount: money(p.unallocated) })}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            {bills.length > 1 ? (
              <FormField htmlFor="apply-bill" label={t('to')}>
                <Select id="apply-bill" value={bill.id} onChange={setBill}>
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {t('billOption', { number: b.number, amount: money(b.outstanding) })}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <p className="text-body text-foreground">
              {t('summary', {
                amount: money(amount),
                payment: numberOf(prepayment.paymentId) ?? t('thePrepayment'),
                bill: bill.number,
              })}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {t('caps', { unapplied: money(prepayment.unallocated), outstanding: money(bill.outstanding) })}
            </p>
          </>
        )}
        {apply.error ? <Alert variant="error" messages={[fromError(apply.error) ?? '']} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="submit" size="lg" className="min-h-12 w-full sm:w-auto" disabled={!amount} loading={apply.isPending}>
          {amount ? t('submit', { amount: money(amount) }) : t('submitNoAmount')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
