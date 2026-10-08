'use client';

/**
 * ─── Release cash — wireframe B (ADR-045 §2, spec P11/P13) ──────────────────────────────
 *
 * The buyer is standing at the store. Everything is prefilled from `GET
 * /buyer-advances/release-draft`: the buyer (the request's creator), the amount the order still
 * needs, the last-used cash account, today in Mogadishu. Finance checks it and taps once.
 *
 * Only accounts the server lists can be chosen — a cash box or EVC float without signatories
 * (Q1); the cap, SoD and the approval band are the server's, said here only as words. A 409 with
 * `approvalInstanceId` closes the dialog into "Sent for approval" (`onGated`).
 *
 * `mode="topUp"`: the receipt came in above the cash released (S7). Same command, the amount is
 * the difference and `applyToBillId` settles the bill in the same transaction.
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
  Select,
  Skeleton,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

import {
  useIdempotencyKey,
  useReleaseCash,
  useReleaseDraft,
} from '../../hooks/use-quotation-payment';
import {
  amountProblem,
  bandSteps,
  blockerCodes,
  gatedInstanceOf,
  todayInMogadishu,
  toMoneyString,
  wireDay,
} from '../../quotations/payment-rules';
import type { ReleaseDraft } from '../../quotations/payment-types';
import { PaymentBlockers, usePaymentRefusalText } from './payment-shared';

export interface ReleaseCashDialogProps {
  requestId: string;
  storeName: string;
  mode?: 'release' | 'topUp';
  /** Top-up: the posted bill the new cash settles (S7). */
  applyToBillId?: string | null;
  onClose: () => void;
  onGated: (approvalInstanceId: string) => void;
}

export function ReleaseCashDialog(props: ReleaseCashDialogProps) {
  const t = useTranslations('procurement.quotes.payment.release');
  const tCommon = useTranslations('common');
  const tq = useTranslations('procurement.quotes');
  const draft = useReleaseDraft(props.requestId);
  const release = useReleaseCash(props.requestId);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={props.mode === 'topUp' ? t('topUpTitle') : t('title')}
      subtitle={
        draft.data?.purchaseOrder
          ? t('subtitle', { po: draft.data.purchaseOrder.poNumber, store: props.storeName })
          : props.storeName
      }
      closeLabel={tCommon('close')}
      busy={release.isPending}
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
            <Alert variant="error" messages={[t('loadFailed')]} />
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void draft.refetch()}>
              {tq('retry')}
            </Button>
          </FormDialogFooter>
        </>
      ) : (
        <ReleaseForm {...props} draft={draft.data} release={release} />
      )}
    </FormDialog>
  );
}

function ReleaseForm({
  requestId,
  mode = 'release',
  applyToBillId,
  onClose,
  onGated,
  draft,
  release,
}: ReleaseCashDialogProps & { draft: ReleaseDraft; release: ReturnType<typeof useReleaseCash> }) {
  const t = useTranslations('procurement.quotes.payment.release');
  const tMethod = useTranslations('procurement.quotes.payment.method');
  const tCommon = useTranslations('common');
  const { fromError } = usePaymentRefusalText();
  // One key for this open: a retry after a lost response cannot release twice.
  const idempotencyKey = useIdempotencyKey(true);

  const creator = draft.recipients.find((r) => r.isRequestCreator) ?? draft.recipients[0];
  const lastUsed = draft.accounts.find((a) => a.lastUsed) ?? draft.accounts[0];
  const [recipientUserId, setRecipient] = useState(creator?.userId ?? '');
  // Untyped, the amount follows the draft — a refetched draft (after a release elsewhere) never
  // leaves a stale prefill behind.
  const [typed, setTyped] = useState<string | null>(null);
  const amount = typed ?? draft.remainingToFund ?? '';
  const [bankAccountId, setAccount] = useState(lastUsed?.bankAccountId ?? '');
  const [advancedAt, setDate] = useState(wireDay(draft.defaultAdvancedAt) || todayInMogadishu());
  const [touched, setTouched] = useState(false);

  const account = draft.accounts.find((a) => a.bankAccountId === bankAccountId) ?? null;
  const cap = draft.remainingToFund;
  const problem = amountProblem(amount, cap);
  const blockers = blockerCodes(draft.blockers);
  const steps = bandSteps(draft.bandHint);
  const money = (value: string | null | undefined) => formatMoney(value ?? null, draft.currencyCode) ?? '';
  const amountText = toMoneyString(amount);
  const canSubmit =
    blockers.length === 0 && problem === null && Boolean(recipientUserId) && Boolean(account) && Boolean(advancedAt);
  const error = release.error && !gatedInstanceOf(release.error) ? fromError(release.error) : undefined;

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!canSubmit || !account || !amountText) return;
        release.mutate(
          {
            idempotencyKey,
            quotationRequestId: requestId,
            recipientUserId,
            amount: amountText,
            bankAccountId: account.bankAccountId,
            paymentMethod: account.method,
            advancedAt,
            ...(mode === 'topUp' && applyToBillId ? { applyToBillId } : {}),
          },
          {
            onSuccess: () => onClose(),
            onError: (err) => {
              const instance = gatedInstanceOf(err);
              if (instance) {
                onGated(instance);
                onClose();
              }
            },
          },
        );
      }}
    >
      <FormDialogBody className="space-y-4">
        <PaymentBlockers codes={blockers} />
        {draft.accounts.length === 0 && !blockers.length ? <PaymentBlockers codes={['NO_ELIGIBLE_CASH_ACCOUNT']} /> : null}

        <FormField htmlFor="release-to" label={t('to')}>
          {draft.recipients.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('noRecipients')}</p>
          ) : (
            <Select id="release-to" value={recipientUserId} onChange={setRecipient}>
              {draft.recipients.map((r) => (
                <option key={r.userId} value={r.userId}>
                  {r.isRequestCreator ? t('requestCreator', { name: r.name }) : r.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          htmlFor="release-amount"
          label={t('amount')}
          hint={cap ? t(mode === 'topUp' ? 'topUpHint' : 'amountHint', { cap: money(cap) }) : undefined}
          error={
            touched && problem
              ? problem === 'over'
                ? t('amountOver', { cap: money(cap) })
                : t(problem === 'zero' ? 'amountZero' : 'amountEmpty')
              : undefined
          }
        >
          <MoneyInput
            id="release-amount"
            value={amount}
            onValueChange={(raw) => {
              setTouched(true);
              setTyped(raw);
            }}
            className="text-lg"
          />
        </FormField>

        <FormField htmlFor="release-from" label={t('from')} hint={t('fromHint')}>
          {draft.accounts.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('noAccounts')}</p>
          ) : (
            <Select id="release-from" value={bankAccountId} onChange={setAccount}>
              {draft.accounts.map((a) => (
                <option key={a.bankAccountId} value={a.bankAccountId}>
                  {a.name} · {a.glCode}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {account ? (
          <p className="text-body-sm text-muted-foreground">
            {t('method')}: <span className="font-medium text-foreground">{tMethod(account.method)}</span>
          </p>
        ) : null}

        <FormField htmlFor="release-date" label={t('date')}>
          <DatePicker id="release-date" value={advancedAt} onChange={setDate} />
        </FormField>

        <p className="rounded-control bg-surface-subtle px-3 py-2 text-body-sm text-foreground">
          {draft.bandHint ? (
            <>
              {t('approval', { band: draft.bandHint.name })}
              {steps.length ? <span className="block text-caption text-muted-foreground">{steps.join(' → ')}</span> : null}
            </>
          ) : (
            t('noApproval')
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
          disabled={blockers.length > 0 || draft.accounts.length === 0 || draft.recipients.length === 0}
          loading={release.isPending}
        >
          {amountText ? t('submit', { amount: money(amountText) }) : t('submitNoAmount')}
        </Button>
      </FormDialogFooter>
    </form>
  );
}
