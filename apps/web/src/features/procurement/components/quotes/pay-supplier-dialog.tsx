'use client';

/**
 * ─── Pay the supplier — wireframe F (ADR-045 §3, spec P11) ─────────────────────────────
 *
 * FINANCE_PAYS_SUPPLIER: prefilled from `GET /supplier-payments/award-draft` — the awarded store,
 * what the order still needs, the last-used account, today. Two shapes, the server's default
 * first: *Pay the invoice* (a posted bill on the order — safest) or *Pay now, before goods* (a
 * prepayment, when the store releases goods only against payment).
 *
 * The vendor-maintainer rule is pre-empted in words (R13): whoever registered the store at award
 * cannot pay it, so the button is not offered to them. An account under dual control is allowed;
 * the command then stops at APPROVED and waits for the signatories (S11).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
  Notice,
  RadioGroup,
  Select,
  Skeleton,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { useIdempotencyKey, usePayDraft, usePayFromAward, useSubmitOnce } from '../../hooks/use-quotation-payment';
import {
  amountProblem,
  bandSteps,
  blockerCodes,
  gatedInstanceOf,
  todayInMogadishu,
  toMoneyString,
  wireDay,
} from '../../quotations/payment-rules';
import type { PayDraft, PayFromAwardResult, SupplierPaymentMethod } from '../../quotations/payment-types';
import { PaymentBlockers, usePaymentRefusalText } from './payment-shared';

export interface PaySupplierDialogProps {
  requestId: string;
  storeName: string;
  currencyCode: string;
  onClose: () => void;
  /** The command stopped short: approval (bands) or bank signatures. */
  onAwaiting: (awaiting: 'APPROVAL' | 'RELEASE_SIGNATURES', approvalInstanceId: string | null) => void;
}

export function PaySupplierDialog(props: PaySupplierDialogProps) {
  const t = useTranslations('procurement.quotes.payment.pay');
  const tRelease = useTranslations('procurement.quotes.payment.release');
  const tCommon = useTranslations('common');
  const tq = useTranslations('procurement.quotes');
  const draft = usePayDraft(props.requestId);
  const pay = usePayFromAward(props.requestId);
  const name = draft.data?.supplier?.name ?? props.storeName;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t('title', { name })}
      closeLabel={tCommon('close')}
      busy={pay.isPending}
      size="md"
    >
      {draft.isPending ? (
        <FormDialogBody>
          <div role="status" className="space-y-3">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </FormDialogBody>
      ) : draft.isError || !draft.data ? (
        <>
          <FormDialogBody>
            <Alert variant="error" messages={[tRelease('loadFailed')]} />
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void draft.refetch()}>
              {tq('retry')}
            </Button>
          </FormDialogFooter>
        </>
      ) : (
        <PayForm {...props} draft={draft.data} pay={pay} />
      )}
    </FormDialog>
  );
}

const PREPAY = 'prepay';

function PayForm({
  requestId,
  currencyCode,
  onClose,
  onAwaiting,
  draft,
  pay,
}: PaySupplierDialogProps & { draft: PayDraft; pay: ReturnType<typeof usePayFromAward> }) {
  const t = useTranslations('procurement.quotes.payment.pay');
  const tRelease = useTranslations('procurement.quotes.payment.release');
  const tMethod = useTranslations('procurement.quotes.payment.method');
  const tCommon = useTranslations('common');
  const { fromError } = usePaymentRefusalText();
  const idempotencyKey = useIdempotencyKey(true);
  const once = useSubmitOnce(requestId);
  const currency = draft.currencyCode ?? currencyCode;
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency) ?? '';

  const billsWithOutstanding = draft.bills;
  // A posted bill still owed is paid as such — the server refuses a prepayment then (BILL_TO_PAY).
  const billOwed = billsWithOutstanding.length > 0;
  const defaultTarget =
    (draft.shape === 'PAY_BILL' || billOwed) && billsWithOutstanding[0] ? billsWithOutstanding[0].id : PREPAY;
  const lastUsed = draft.accounts.find((a) => a.lastUsed) ?? draft.accounts[0];

  const [target, setTarget] = useState(defaultTarget);
  const bill = billsWithOutstanding.find((b) => b.id === target) ?? null;
  const capFor = (next: string) =>
    next === PREPAY ? draft.remainingToFund : (billsWithOutstanding.find((b) => b.id === next)?.outstanding ?? null);
  const [amount, setAmount] = useState(capFor(defaultTarget) ?? '');
  const [bankAccountId, setAccount] = useState(lastUsed?.bankAccountId ?? '');
  const [method, setMethod] = useState<SupplierPaymentMethod | ''>(draft.methods[0] ?? '');
  const [paymentDate, setDate] = useState(wireDay(draft.defaultPaymentDate) || todayInMogadishu());
  const [touched, setTouched] = useState(false);

  const account = draft.accounts.find((a) => a.bankAccountId === bankAccountId) ?? null;
  const cap = capFor(target);
  const problem = amountProblem(amount, cap);
  const blockers = blockerCodes(draft.blockers).filter(
    // Said once, in its own words, below — not twice.
    (code) => code !== 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
  );
  const maintainer = draft.supplier?.isVendorMaintainer === true;
  const steps = bandSteps(draft.bandHint);
  const amountText = toMoneyString(amount);
  const ready = !maintainer && blockers.length === 0 && problem === null && account !== null && method !== '';
  const error = pay.error && !gatedInstanceOf(pay.error) ? fromError(pay.error) : undefined;

  const shapeOptions = [
    ...billsWithOutstanding.map((b) => ({
      value: b.id,
      label: b.outstanding ? t('payBillAmount', { number: b.number, amount: money(b.outstanding) }) : t('payBill', { number: b.number }),
    })),
    ...(billOwed ? [] : [{ value: PREPAY, label: t('prepay'), description: t('prepayHint') }]),
  ];

  // 200 may still stop short of posting: the account needs its bank signatures (S11). The DoA gate
  // is a 409 APPROVAL_REQUIRED, handled in onError.
  const finish = (result: PayFromAwardResult | undefined) => {
    if (result?.awaiting === 'RELEASE_SIGNATURES') onAwaiting('RELEASE_SIGNATURES', null);
    onClose();
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!ready || !account || !amountText || !method || !once.begin()) return;
        pay.mutate(
          {
            idempotencyKey,
            quotationRequestId: requestId,
            bankAccountId: account.bankAccountId,
            paymentMethod: method,
            paymentDate,
            amount: amountText,
            shape: bill ? 'PAY_BILL' : 'PREPAY',
            ...(bill ? { supplierBillId: bill.id } : {}),
          },
          {
            onSuccess: finish,
            onError: (err) => {
              const instance = gatedInstanceOf(err);
              if (instance) {
                onAwaiting('APPROVAL', instance);
                onClose();
                return;
              }
              void once.landedAnyway(err).then((landed) => {
                if (landed) {
                  pay.reset();
                  onClose();
                }
              });
            },
          },
        );
      }}
    >
      <FormDialogBody className="space-y-4">
        {maintainer ? (
          <Notice tone="attention">
            {draft.supplier?.maintainerName ? t('maintainerNamed', { name: draft.supplier.maintainerName }) : t('maintainer')}
          </Notice>
        ) : null}
        <PaymentBlockers codes={blockers} />

        <RadioGroup
          label={t('what')}
          name="pay-shape"
          value={target}
          orientation="vertical"
          onChange={(next) => {
            setTarget(next);
            if (!touched) setAmount(capFor(next) ?? '');
          }}
          options={shapeOptions}
        />

        <FormField
          htmlFor="pay-amount"
          label={t('amount')}
          hint={cap ? t('amountHint', { cap: money(cap) }) : undefined}
          error={
            touched && problem
              ? problem === 'over'
                ? tRelease('amountOver', { cap: money(cap) })
                : tRelease(problem === 'zero' ? 'amountZero' : 'amountEmpty')
              : undefined
          }
        >
          <MoneyInput
            id="pay-amount"
            value={amount}
            onValueChange={(raw) => {
              setTouched(true);
              setAmount(raw);
            }}
            className="text-lg"
          />
        </FormField>

        <FormField htmlFor="pay-from" label={t('from')}>
          <Select id="pay-from" value={bankAccountId} onChange={setAccount}>
            {draft.accounts.map((a) => (
              <option key={a.bankAccountId} value={a.bankAccountId}>
                {a.underDualControl ? t('dualControl', { name: a.name }) : a.name}
              </option>
            ))}
          </Select>
        </FormField>

        {draft.methods.length > 1 ? (
          <RadioGroup
            label={t('method')}
            name="pay-method"
            value={method}
            onChange={setMethod}
            options={draft.methods.map((m) => ({ value: m, label: tMethod(m) }))}
          />
        ) : null}

        <FormField htmlFor="pay-date" label={t('date')}>
          <DatePicker id="pay-date" value={paymentDate} onChange={setDate} />
        </FormField>

        {/* One sentence for who still has to act: the approvers (bands), the signatories, both or
            nobody — never "needs two signatures" next to "no approval needed". */}
        <p className="rounded-control bg-surface-subtle px-3 py-2 text-body-sm text-foreground">
          {draft.bandHint ? (
            <>
              {tRelease('approval', { band: draft.bandHint.name })}
              {steps.length ? <span className="block text-caption text-muted-foreground">{steps.join(' → ')}</span> : null}
              {account?.underDualControl ? <span className="block">{t('thenSignatures')}</span> : null}
            </>
          ) : account?.underDualControl ? (
            t('signaturesOnly')
          ) : (
            tRelease('noApproval')
          )}
        </p>

        {error ? <Alert variant="error" messages={[error]} /> : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="submit"
          size="lg"
          className="min-h-12 w-full sm:w-auto"
          disabled={maintainer || blockers.length > 0 || draft.accounts.length === 0}
          loading={pay.isPending}
        >
          {amountText ? t('submit', { amount: money(amountText) }) : t('submitNoAmount')}
        </Button>
      </FormDialogFooter>
    </form>
  );
}
