'use client';

/**
 * ─── Finance — the Payment section on `/finance/quotes/[id]` (ADR-045, wireframes A, C, F) ──
 *
 * The buyer is waiting at the store, so the section is built around ONE primary button chosen
 * from the server's `allowedActions` in work order — finish, record, release, pay — named for the
 * person or store it is for ("Release cash to Ahmed", "Pay Bakaara Steel"). Its dialog is
 * prefetched, so the tap opens it already filled.
 *
 * A disabled action still shows, with the server's reason in words (dual-control account, the
 * vendor maintainer, missing Staff advances set-up…). The frontend decides none of these rules.
 *
 * DoA: a release or payment above the finance officer's band answers 409 `approvalInstanceId`
 * (or `awaiting: 'APPROVAL'`). The section then shows "Sent for approval" with the approval panel
 * for whoever holds the current step, and — once approved — "Release now" re-drives the exact
 * same body (kept by the hook), as the award flow does.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Notice, cn } from '@erp/ui';
import { ArrowRight, Banknote, Camera, CircleCheck, CircleDashed, Clock } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PAYMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';
import { WorkflowTransactionType } from '@/features/workflows/types';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';
import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';

import {
  pendingPaymentStore,
  useCanPay,
  useChangePaymentPath,
  usePayDraft,
  usePayFromAward,
  useReleaseCash,
  useReleaseDraft,
} from '../../hooks/use-quotation-payment';
import {
  SETUP_BLOCKERS,
  blockerCodes,
  cashHolderName,
  findPaymentAction,
  gatedInstanceOf,
  latestStoreDocument,
  offersAction,
  paymentActionEnabled,
  primaryFinanceAction,
  topUpBillId,
} from '../../quotations/payment-rules';
import type { PaymentAllowedAction, QuotationPayment } from '../../quotations/payment-types';
import type { QuotationRequestDetail } from '../../quotations/types';
import { PayDialogs, type PaymentDialog } from './payment-dialogs';
import { PaymentBlockers, PaymentStatePill, StoreDocumentStatusPill, usePaymentRefusalText } from './payment-shared';

/** Both buyer advances and supplier payments are bound to the supplier-payment bands (ADR-045 §2). */
const PAYMENT_APPROVAL = WorkflowTransactionType.SUPPLIER_PAYMENT;

type Dialog = PaymentDialog;

export function PaymentSection({ detail }: { detail: QuotationRequestDetail }) {
  const payment = detail.payment;
  if (!payment) return null;
  return <PaymentBody detail={detail} payment={payment} />;
}

function PaymentBody({ detail, payment }: { detail: QuotationRequestDetail; payment: QuotationPayment }) {
  const t = useTranslations('procurement.quotes.payment');
  const tActions = useTranslations('procurement.quotes.payment.actions');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const session = useSession();
  const canPay = useCanPay();
  const { fromError, fromCode } = usePaymentRefusalText();

  const [dialog, setDialog] = useState<Dialog>(null);
  const [gated, setGated] = useState<{ instanceId: string | null; kind: 'release' | 'pay' } | null>(null);
  const [awaitingSignatures, setAwaitingSignatures] = useState(false);

  const currency = detail.currencyCode ?? 'USD';
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency, locale);
  const storeName = detail.award?.supplier?.name ?? detail.quotes.find((q) => q.id === detail.award?.quoteId)?.store.name ?? '—';
  const buyerCash = payment.path === 'BUYER_CASH';

  // Prefetch the draft behind the primary action so the tap opens a filled dialog — and the button
  // can name the buyer.
  const releaseOffered = canPay && (offersAction(payment, 'RELEASE_CASH') || offersAction(payment, 'TOP_UP'));
  const payOffered = canPay && (offersAction(payment, 'PAY_SUPPLIER') || offersAction(payment, 'FINISH_PAYMENT'));
  const releaseDraft = useReleaseDraft(detail.id, { enabled: releaseOffered });
  usePayDraft(detail.id, { enabled: payOffered && offersAction(payment, 'PAY_SUPPLIER') });

  // Re-drive (ADR-015): the same body the gate answered, from this browser.
  const release = useReleaseCash(detail.id);
  const pay = usePayFromAward(detail.id);
  const redrive = () => {
    const pending = pendingPaymentStore.get(detail.id);
    if (pending?.kind === 'release') {
      release.mutate(pending.body, { onSuccess: () => setGated(null), onError: () => undefined });
    } else if (pending?.kind === 'pay') {
      pay.mutate(pending.body, {
        onSuccess: (result) => {
          setGated(null);
          setAwaitingSignatures(result?.awaiting === 'RELEASE_SIGNATURES');
        },
        onError: () => undefined,
      });
    } else {
      setDialog(buyerCash ? 'release' : 'pay');
    }
  };
  const redriveError = [release.error, pay.error].find((e) => e && !gatedInstanceOf(e));

  const creator = releaseDraft.data?.recipients.find((r) => r.isRequestCreator) ?? releaseDraft.data?.recipients[0];
  const primary = canPay ? primaryFinanceAction(payment) : null;
  const instanceId = payment.approval?.instanceId ?? gated?.instanceId ?? null;
  const approvalPending = payment.state === 'AWAITING_APPROVAL' || gated !== null;
  const chainApproved = payment.approval?.status === 'APPROVED';
  const roles = session.user?.roles ?? [];
  const currentRole = payment.approval?.currentStepRole ?? null;
  const mayActOnStep =
    can('manage:workflow') || (currentRole !== null && roles.includes(currentRole)) || (!payment.approval && Boolean(gated));
  const mayChangePath = canPay && can(PAYMENT_PERMISSIONS.changePath) && offersAction(payment, 'CHANGE_PATH');
  const latestDoc = latestStoreDocument(payment);
  const submittedDoc = latestStoreDocument(payment, 'SUBMITTED');
  const holder = cashHolderName(payment);
  // Only the set-up gaps are said here (P14); the dialog says the rest.
  const setupBlockers = blockerCodes(releaseDraft.data?.blockers).filter((code) => SETUP_BLOCKERS.has(code));

  const primaryLabel = (action: PaymentAllowedAction) => {
    switch (action.action) {
      case 'RELEASE_CASH':
        return creator ? tActions('releaseTo', { name: firstName(creator.name) }) : tActions('RELEASE_CASH');
      case 'PAY_SUPPLIER':
        return tActions('payTo', { name: storeName });
      default:
        return tActions(action.action);
    }
  };

  const runPrimary = (action: PaymentAllowedAction) => {
    if (action.action === 'RELEASE_CASH') setDialog('release');
    else if (action.action === 'PAY_SUPPLIER') setDialog('pay');
    else if (action.action === 'FINISH_PAYMENT') redrive();
  };

  const funded = parseMinorUnits(payment.funded, MONEY_SCALE) ?? 0;

  return (
    <section
      aria-labelledby="payment-title"
      className="space-y-4 rounded-panel border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="payment-title" className="text-body font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="text-body-sm text-muted-foreground">{t(`path.${payment.path}`)}</p>
        </div>
        <PaymentStatePill state={payment.state} />
      </div>
      <p className="text-body-sm text-muted-foreground">{t(`stateHint.${payment.state}`)}</p>

      {/* ── Money (hidden for money-blind roles) ─────────────────────────────── */}
      {payment.moneyVisible ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
          <Fact label={t('facts.ordered')} value={money(payment.orderedAmount)} />
          <Fact label={t(buyerCash ? 'facts.released' : 'facts.paid')} value={money(payment.funded)} />
          {buyerCash && funded > 0 ? (
            <Fact
              label={holder ? t('facts.withBuyer', { name: firstName(holder) }) : t('facts.withBuyerNoName')}
              value={money(payment.withBuyer)}
              emphasis
            />
          ) : null}
          <Fact label={t('facts.remaining')} value={money(payment.remainingToFund)} />
        </dl>
      ) : (
        <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p>
      )}

      {/* ── Where it stands: order, receipt, goods (wireframe C) ──────────────── */}
      {payment.purchaseOrder ? (
        <ul className="space-y-1.5 text-body-sm">
          <ProgressRow
            done
            label={t('facts.order')}
            value={
              <Link
                href={`/procurement/orders/${payment.purchaseOrder.id}`}
                // A 44 px hit area without stretching the row: the negative margin gives it back.
                className="-my-3 inline-flex min-h-11 items-center font-medium text-brand-primary underline-offset-4 hover:underline"
              >
                {payment.purchaseOrder.poNumber}
              </Link>
            }
          />
          <ProgressRow
            done={latestDoc?.status === 'SUBMITTED' || latestDoc?.status === 'RECORDED'}
            label={t('facts.receipt')}
            value={
              latestDoc
                ? latestDoc.status === 'SUBMITTED'
                  ? t('receiptLine.SUBMITTED', {
                      name: firstName(latestDoc.uploadedByName ?? '—'),
                      when: relativeTime(latestDoc.createdAt, locale) ?? '',
                    })
                  : t(`receiptLine.${latestDoc.status}`)
                : t('receiptLine.none')
            }
          />
          <ProgressRow
            done={payment.receivingStatus === 'RECEIVED'}
            label={t('facts.goods')}
            value={t(`receiving.${payment.receivingStatus}`)}
          />
        </ul>
      ) : (
        <Notice tone="info">{t('noOrder')}</Notice>
      )}

      {/* ── Approval (DoA gate) ─────────────────────────────────────────────── */}
      {approvalPending ? (
        <div className="space-y-3">
          <Notice
            tone={chainApproved ? 'success' : 'info'}
            title={chainApproved ? t('approval.approvedTitle') : t('approval.gatedTitle')}
          >
            <p className="mt-1">
              {chainApproved
                ? t('approval.approvedBody')
                : currentRole
                  ? t('approval.waitingFor', { role: currentRole })
                  : t(gated?.kind === 'pay' || !buyerCash ? 'approval.gatedBodyPay' : 'approval.gatedBody')}
            </p>
          </Notice>
          {!chainApproved && mayActOnStep && instanceId ? (
            <ApprovalPanel instanceId={instanceId} transactionType={PAYMENT_APPROVAL} />
          ) : null}
          {canPay ? (
            <Button
              type="button"
              variant={chainApproved ? 'default' : 'outline'}
              className="min-h-11 w-full sm:w-auto"
              loading={release.isPending || pay.isPending}
              onClick={redrive}
            >
              {buyerCash ? tActions('completeRelease') : tActions('complete')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {payment.state === 'AWAITING_SIGNATURES' || awaitingSignatures ? (
        <Notice tone="info" title={t('signatures.title')}>
          <p className="mt-1">{t('signatures.body')}</p>
          {(payment.payments ?? []).filter((p) => p.documentStatus === 'APPROVED').map((p) => (
            <Link
              key={p.id}
              href={`/finance/accounting/payments/${p.id}`}
              className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-brand-primary underline underline-offset-4"
            >
              {tActions('openPayment', { number: p.number })}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ))}
        </Notice>
      ) : null}

      {redriveError ? <Alert variant="error" messages={[fromError(redriveError) ?? '']} /> : null}

      {/* ── Set-up blockers, explained with a link (P14) ────────────────────── */}
      {canPay && findPaymentAction(payment, 'RELEASE_CASH') ? (
        <PaymentBlockers codes={setupBlockers} />
      ) : null}

      {/* ── The one primary action ───────────────────────────────────────────── */}
      {primary && !(approvalPending && primary.action !== 'RECORD_RECEIPT') ? (
        <div className="space-y-1">
          {primary.action === 'RECORD_RECEIPT' && primary.enabled && submittedDoc ? (
            <Button asChild size="lg" className="h-14 w-full text-base">
              <Link href={`/finance/quotes/${detail.id}/receipt/${submittedDoc.id}`}>
                <Camera className="size-5" aria-hidden="true" />
                {tActions('RECORD_RECEIPT')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              disabled={!primary.enabled || (primary.action === 'RECORD_RECEIPT' && !submittedDoc)}
              aria-describedby={!primary.enabled && primary.reason ? 'payment-primary-reason' : undefined}
              loading={primary.action === 'FINISH_PAYMENT' && (release.isPending || pay.isPending)}
              onClick={() => runPrimary(primary)}
            >
              <Banknote className="size-5" aria-hidden="true" />
              {primaryLabel(primary)}
            </Button>
          )}
          {!primary.enabled && primary.reason ? (
            <p id="payment-primary-reason" className="text-center text-body-sm text-muted-foreground">
              {fromCode(primary.reason) ?? primary.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── Secondary actions ────────────────────────────────────────────────── */}
      <SecondaryActions
        payment={payment}
        canPay={canPay}
        mayChangePath={mayChangePath}
        onTopUp={() => setDialog('topUp')}
        onReturn={() => setDialog('return')}
        onChangePath={() => setDialog('path')}
      />

      <StoreDocuments detail={detail} payment={payment} canPay={canPay} />
      <History payment={payment} currency={currency} />

      <PayDialogs
        open={dialog}
        detail={detail}
        payment={payment}
        storeName={storeName}
        topUpBillId={topUpBillId(payment)}
        onClose={() => setDialog(null)}
        onGated={(instance, kind) => setGated({ instanceId: instance, kind })}
        onAwaitingSignatures={() => setAwaitingSignatures(true)}
      />
      {dialog === 'path' ? <ChangePathDialog detail={detail} payment={payment} storeName={storeName} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function Fact({ label, value, emphasis = false }: { label: string; value: string | null; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums text-foreground', emphasis ? 'text-body font-semibold' : 'font-medium')}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

function ProgressRow({ done, label, value }: { done: boolean; label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </li>
  );
}

function SecondaryActions({
  payment,
  canPay,
  mayChangePath,
  onTopUp,
  onReturn,
  onChangePath,
}: {
  payment: QuotationPayment;
  canPay: boolean;
  mayChangePath: boolean;
  onTopUp: () => void;
  onReturn: () => void;
  onChangePath: () => void;
}) {
  const t = useTranslations('procurement.quotes.payment');
  const tActions = useTranslations('procurement.quotes.payment.actions');
  if (!canPay) return null;
  const topUp = paymentActionEnabled(payment, 'TOP_UP');
  const ret = paymentActionEnabled(payment, 'RECORD_RETURN');
  const path = mayChangePath && paymentActionEnabled(payment, 'CHANGE_PATH');
  if (!topUp && !ret && !path) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {topUp ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={onTopUp}>
          {tActions('TOP_UP')}
        </Button>
      ) : null}
      {ret ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={onReturn}>
          {tActions('RECORD_RETURN')}
        </Button>
      ) : null}
      {path ? (
        <span className="inline-flex flex-wrap items-center gap-1 text-body-sm text-muted-foreground">
          {t(`changePathHint.${payment.path}`)}
          <Button type="button" variant="link" className="min-h-11 px-1" onClick={onChangePath}>
            {tActions('CHANGE_PATH')}
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function StoreDocuments({
  detail,
  payment,
  canPay,
}: {
  detail: QuotationRequestDetail;
  payment: QuotationPayment;
  canPay: boolean;
}) {
  const t = useTranslations('procurement.quotes.payment.documents');
  const locale = useLocale() as 'en';
  if (payment.storeDocuments.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {payment.storeDocuments.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">
                {doc.number} · {t(`kind.${doc.kind}`)}
              </p>
              <p className="text-caption text-muted-foreground">
                {[doc.uploadedByName, formatDate(doc.createdAt, locale)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StoreDocumentStatusPill status={doc.status} />
              {canPay && doc.status === 'SUBMITTED' ? (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link href={`/finance/quotes/${detail.id}/receipt/${doc.id}`}>{t('record')}</Link>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ payment, currency }: { payment: QuotationPayment; currency: string }) {
  const t = useTranslations('procurement.quotes.payment.history');
  const locale = useLocale() as 'en';
  const advances = payment.advances ?? [];
  const payments = payment.payments ?? [];
  if (advances.length === 0 && payments.length === 0) return null;
  const money = (value: string | null | undefined) => formatMoney(value ?? null, currency, locale) ?? '—';
  return (
    <div className="space-y-2">
      <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
      <ul className="divide-y divide-border rounded-panel border border-border">
        {advances.map((advance) => {
          const out = (parseMinorUnits(advance.outstanding, MONEY_SCALE) ?? 0) > 0;
          return (
            <li key={advance.id}>
              <Link
                href={`/procurement/advances/${advance.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
              >
                <span className="min-w-0">
                  <span className="block text-body-sm font-medium text-foreground">
                    {t('advance', { name: advance.recipientName ?? '—' })}
                  </span>
                  <span className="block text-caption text-muted-foreground">
                    {out
                      ? t('advanceMeta', { date: formatDate(advance.advancedAt, locale) ?? '', outstanding: money(advance.outstanding) })
                      : t('advanceSettled', { date: formatDate(advance.advancedAt, locale) ?? '' })}
                    {advance.legacy ? ` · ${t('legacy')}` : ''}
                  </span>
                </span>
                <span className="tabular-nums text-body-sm font-medium text-foreground">{money(advance.amount)}</span>
              </Link>
            </li>
          );
        })}
        {payments.map((p) => (
          <li key={p.id}>
            <Link
              href={`/finance/accounting/payments/${p.id}`}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
            >
              <span className="min-w-0">
                <span className="block text-body-sm font-medium text-foreground">{t('payment', { number: p.number })}</span>
                {p.shape ? <span className="block text-caption text-muted-foreground">{t(`shape.${p.shape}`)}</span> : null}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums text-body-sm font-medium text-foreground">
                {p.postingStatus !== 'POSTED' ? <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
                {money(p.amount)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangePathDialog({
  detail,
  payment,
  storeName,
  onClose,
}: {
  detail: QuotationRequestDetail;
  payment: QuotationPayment;
  storeName: string;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.payment.changePath');
  const { fromError } = usePaymentRefusalText();
  const change = useChangePaymentPath(detail.id);
  const toSupplier = payment.path === 'BUYER_CASH';
  return (
    <ConfirmActionDialog
      title={t('title')}
      description={t(toSupplier ? 'toSupplier' : 'toCash', { store: storeName })}
      confirmLabel={t(toSupplier ? 'confirmToSupplier' : 'confirmToCash')}
      reason={{ label: t('reason'), required: true }}
      isPending={change.isPending}
      errorMessage={change.error ? fromError(change.error) : undefined}
      onConfirm={(reason) =>
        change.mutate(
          { paymentPath: toSupplier ? 'FINANCE_PAYS_SUPPLIER' : 'BUYER_CASH', reason },
          { onSuccess: onClose },
        )
      }
      onDismiss={() => {
        change.reset();
        onClose();
      }}
    />
  );
}
