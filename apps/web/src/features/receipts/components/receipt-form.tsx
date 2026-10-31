'use client';

import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Alert, Button, DatePicker, FormActionBar, FormField, MoneyInput, Select, Textarea } from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { useClients } from '@/features/clients/hooks/use-clients';
import { toDecimalString } from '@/features/contracts/contract-form-payload';
import { bankAccountLabel } from '@/features/procurement/payment-actions';
import type { ReceiptPaymentMethod } from '@/lib/api-types';
import { ApiError } from '@/lib/api-client';

import { fromMinorUnits, invoicesForClient, toMinorUnits } from '../allocation';
import { useCreateReceipt, useReceivePayment } from '../hooks/use-receipts';
import {
  ACCOUNT_KIND_FOR_METHOD,
  isPostDatedCheque,
  proofPayload,
  proofProblems,
  type ProofField,
  type ProofValues,
} from '../payment-methods';
import { ApplyInvoicesTable, useApplySplit } from './apply-invoices-table';
import { PaymentMethodPicker, PaymentProofFields, ProofFilePicker } from './payment-method-fields';

interface ReceiptFormValues {
  clientId: string;
  bankAccountId: string;
  receiptDate: string;
  amount: string;
  paymentMethod: ReceiptPaymentMethod | '';
  notes: string;
}

/**
 * Receive payment (ADR-046 §6): the money lands straight in the bank account it arrived in. With
 * `manage:receivable` the receipt is recorded, posted (Dr that bank) and applied to the client's
 * open invoices in one action, oldest due first unless the reader changes the split; whatever is
 * not applied stays on account for the client. Without it, the receipt is recorded for finance to
 * post.
 */
export function ReceiptForm() {
  const t = useTranslations('platform.receipts.create');
  const tApply = useTranslations('platform.receipts.apply');
  const tCommon = useTranslations('common');

  const { can } = usePermissions();
  const mayPost = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  useModuleTrail(mayPost ? t('title') : t('recordTitle'));
  const searchParams = useSearchParams();
  const create = useCreateReceipt();
  const receive = useReceivePayment();
  const clients = useClients();
  const banks = useBankAccounts();
  const invoices = useInvoices();

  const [proof, setProof] = useState<ProofValues>({});
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ReceiptFormValues>({
    defaultValues: {
      // "Record receipt from …" (⌘K) arrives with the client chosen.
      clientId: searchParams?.get('clientId') ?? '',
      // One account taking receipts is the answer; more than one is the reader's choice.
      bankAccountId: '',
      receiptDate: todayWireDate(),
      // "Record payment" on an invoice arrives with its balance as the amount.
      amount: searchParams?.get('amount') ?? '',
      paymentMethod: '',
      notes: '',
    },
  });
  const clientId = useWatch({ control, name: 'clientId' });
  const amount = useWatch({ control, name: 'amount' });
  const bankAccountId = useWatch({ control, name: 'bankAccountId' });
  const method = useWatch({ control, name: 'paymentMethod' });
  const receiptDate = useWatch({ control, name: 'receiptDate' });

  // PM-3 — the method decides the kind of account: cash box, mobile wallet or bank.
  const kind = method ? ACCOUNT_KIND_FOR_METHOD[method] : null;
  const receivingBanks = (banks.data ?? []).filter(
    (b) => b.status === 'ACTIVE' && b.allowsReceipts && (!kind || (b.kind ?? 'BANK') === kind),
  );
  const onlyBankId = receivingBanks.length === 1 ? receivingBanks[0]!.id : null;
  const bankFits = receivingBanks.some((b) => b.id === bankAccountId);
  useEffect(() => {
    if (!mayPost) return;
    if (bankAccountId && !bankFits) setValue('bankAccountId', onlyBankId ?? '');
    else if (!bankAccountId && onlyBankId) setValue('bankAccountId', onlyBankId);
  }, [mayPost, onlyBankId, bankAccountId, bankFits, setValue]);

  const problems = method ? proofProblems(method, proof) : {};
  const held = isPostDatedCheque(method, proof.instrumentDate, receiptDate);

  const open = useMemo(() => (clientId ? invoicesForClient(invoices.data ?? [], clientId) : []), [clientId, invoices.data]);
  const amountMinor = Number.isFinite(Number(amount)) ? Math.max(0, toMinorUnits(amount || '0')) : 0;
  // From an invoice's "Record payment" the money goes to that invoice; otherwise oldest due first.
  const split = useApplySplit(open, amountMinor, searchParams?.get('invoiceId') ?? null);
  const overApplied = split.appliedMinor > amountMinor;

  const onSubmit = (values: ReceiptFormValues) => {
    if (!values.paymentMethod || Object.keys(problems).length > 0) return;
    const base = {
      clientId: values.clientId,
      receiptDate: values.receiptDate,
      amount: toDecimalString(values.amount),
      // Single-currency platform (ADR-024): USD is implicit, never entered.
      currency: 'USD',
      paymentMethod: values.paymentMethod,
      ...proofPayload(values.paymentMethod, proof),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    };
    if (!mayPost) {
      create.mutate({ payload: base, proof: proofFile });
      return;
    }
    if (!held && (overApplied || split.overInvoice)) return;
    receive.mutate({
      payload: { ...base, bankAccountId: values.bankAccountId, allocations: held ? [] : split.allocations() },
      proof: proofFile,
    });
  };

  const failure = receive.error ?? create.error;
  const errorMessages = failure
    ? [failure instanceof ApiError && failure.messages.length > 0 ? failure.message : t('failed')]
    : [];
  const pending = receive.isPending || create.isPending;

  return (
    <form
      onSubmit={(e) => {
        setAttempted(true);
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
    >
      <FormActionBar
        back={
          <Button variant="ghost" className="gap-1.5 px-2" asChild>
            <Link href="/receipts">
              <ArrowLeft size={16} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
        }
        save={
          <Button type="submit" loading={pending} loadingText={t('saving')}>
            {held && mayPost ? t('submitHold') : mayPost ? t('submitReceive') : t('submit')}
          </Button>
        }
        discard={
          <Button variant="ghost" asChild>
            <Link href="/receipts">{t('cancel')}</Link>
          </Button>
        }
        saveState={isDirty ? 'dirty' : 'new'}
        saveStateLabels={{
          new: tCommon('formState.new'),
          dirty: tCommon('formState.dirty'),
          clean: tCommon('formState.clean'),
        }}
      />

      <div className="space-y-8">
        <h2 className="text-h2 font-semibold text-foreground">{mayPost ? t('title') : t('recordTitle')}</h2>

        {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}
        {clients.isError ? <LoadError message={t('loadFailed')} onRetry={() => void clients.refetch()} /> : null}
        {mayPost && banks.isError ? <LoadError message={t('banksLoadFailed')} onRetry={() => void banks.refetch()} /> : null}

        <div className="grid gap-x-10 gap-y-5 rounded-panel border border-border bg-surface p-5 sm:p-6 lg:grid-cols-2">
          <FormField htmlFor="receipt-client" label={t('client')} error={errors.clientId?.message}>
            <Controller
              control={control}
              name="clientId"
              rules={{ required: t('clientRequired') }}
              render={({ field }) => (
                <Select
                  id="receipt-client"
                  disabled={clients.isPending}
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    split.reset();
                  }}
                >
                  <option value="">{clients.isPending ? tCommon('loading') : t('clientPlaceholder')}</option>
                  {(clients.data ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>

          <div className="grid content-start gap-5 sm:grid-cols-2">
            <FormField htmlFor="receipt-date" label={t('receiptDate')} error={errors.receiptDate?.message}>
              <Controller
                control={control}
                name="receiptDate"
                rules={{ required: t('dateRequired') }}
                render={({ field }) => <DatePicker id="receipt-date" value={field.value} onChange={field.onChange} />}
              />
            </FormField>

            <FormField htmlFor="receipt-amount" label={t('amount')} error={errors.amount?.message}>
              <Controller
                name="amount"
                control={control}
                rules={{
                  validate: (v) => {
                    if (v.trim() === '') return t('amountRequired');
                    if (!Number.isFinite(Number(v))) return t('amountInvalid');
                    return Number(v) > 0 || t('amountNotPositive');
                  },
                }}
                render={({ field }) => (
                  <MoneyInput
                    id="receipt-amount"
                    aria-invalid={Boolean(errors.amount)}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                )}
              />
            </FormField>
          </div>
        </div>

        <section aria-labelledby="receipt-payment" className="space-y-5">
          <h3 id="receipt-payment" className="border-b border-border pb-2 text-body font-semibold text-foreground">
            {t('paymentTitle')}
          </h3>
          <Controller
            control={control}
            name="paymentMethod"
            rules={{ required: t('methodRequired') }}
            render={({ field }) => (
              <PaymentMethodPicker
                value={field.value}
                onChange={(next) => {
                  // Each method's proof means something else (a cheque number is not a transaction ID).
                  if (next !== field.value) setProof({});
                  field.onChange(next);
                }}
                error={errors.paymentMethod?.message}
              />
            )}
          />

          {method ? (
            <div className="space-y-5 rounded-panel border border-border bg-surface p-5 sm:p-6">
              {mayPost ? (
                <FormField htmlFor="receipt-bank" label={t('bank')} error={errors.bankAccountId?.message} className="max-w-xl">
                  <Controller
                    control={control}
                    name="bankAccountId"
                    rules={{ required: t('bankRequired') }}
                    render={({ field }) => (
                      <Select id="receipt-bank" disabled={banks.isPending} value={field.value} onChange={field.onChange}>
                        <option value="">{banks.isPending ? tCommon('loading') : t('bankPlaceholder')}</option>
                        {receivingBanks.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bankAccountLabel(bank)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                </FormField>
              ) : null}
              {mayPost && banks.isSuccess && receivingBanks.length === 0 && kind ? (
                <Alert variant="warning" messages={[t(`noAccountOfKind.${kind}`)]} />
              ) : null}

              <PaymentProofFields
                method={method}
                values={proof}
                onChange={(field: ProofField, value: string) => setProof((current) => ({ ...current, [field]: value }))}
                problems={attempted ? problems : {}}
              />
              <ProofFilePicker file={proofFile} onChange={setProofFile} />
              {held ? <Alert variant="info" messages={[t('heldCheque')]} /> : null}
            </div>
          ) : null}
        </section>

        {mayPost && clientId && !held ? (
          <section aria-labelledby="receipt-apply" className="space-y-4">
            <h3 id="receipt-apply" className="border-b border-border pb-2 text-body font-semibold text-foreground">
              {t('applyTitle')}
            </h3>
            {invoices.isError ? (
              <LoadError message={t('invoicesLoadFailed')} onRetry={() => void invoices.refetch()} />
            ) : (
              <ApplyInvoicesTable
                options={open}
                split={split}
                amountMinor={amountMinor}
                amountLabel={tApply('received')}
                // Ticking invoices before typing the amount (or past it) makes the amount their total.
                onToggled={(appliedMinor) => {
                  if (appliedMinor > amountMinor) {
                    setValue('amount', fromMinorUnits(appliedMinor), { shouldDirty: true, shouldValidate: true });
                  }
                }}
              />
            )}
          </section>
        ) : null}

        <FormField htmlFor="receipt-notes" label={t('notes')} className="max-w-2xl">
          <Textarea id="receipt-notes" rows={2} maxLength={500} {...register('notes')} />
        </FormField>
      </div>
    </form>
  );
}
