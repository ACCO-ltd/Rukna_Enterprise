'use client';

/**
 * The commands on a supplier payment (SP-4), for the record header: the one next step as the
 * primary button — Approve (through the ADR-011 approval gate), Sign release (an account under
 * dual control, ADR-022), or Post — with the remittance PDF beside it once posted, and the rest
 * under More: the supplier paid money back, reject or cancel an unposted payment, reverse a
 * posted one. Anything unavailable is not rendered.
 */

import { Fragment, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@erp/ui';

import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PostingPreviewDialog } from '@/features/accounting/components/posting-preview-dialog';
import { ApiError } from '@/lib/api-client';
import { useAccounts, useBankAccounts, useSignatories } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';
import { useSession } from '@/features/auth/session/use-session';
import { SupplierRefundDialog } from '@/features/supplier-refunds/supplier-refund-dialog';

import {
  useApproveSupplierPayment,
  useEndSupplierPayment,
  useOpenSupplierPaymentDocument,
  usePostSupplierPayment,
  useReleaseSupplierPayment,
  useReverseSupplierPayment,
} from '../hooks/use-procurement';
import { availablePaymentActions, canEndPayment, planPaymentPost } from '../payment-actions';
import type { PostSupplierPaymentPayload, SupplierPayment } from '../types';

type Dialog = 'release' | 'post' | 'reverse' | 'end' | 'refund' | null;

const serverMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.message ? error.message : fallback;

/** Whether the payment's account is under dual control: it has at least one active signatory. */
export function useDualControl(bankAccountId: string): boolean {
  const signatories = useSignatories(bankAccountId);
  return (signatories.data ?? []).length > 0;
}

export function PaymentHeaderActions({ payment }: { payment: SupplierPayment }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const tRefund = useTranslations('procurement.supplierRefund');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const session = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);

  const accounts = useAccounts();
  const bankAccounts = useBankAccounts();
  const underDualControl = useDualControl(payment.bankAccountId);

  const approve = useApproveSupplierPayment();
  const release = useReleaseSupplierPayment();
  const post = usePostSupplierPayment();
  const reverse = useReverseSupplierPayment();
  const openDocument = useOpenSupplierPaymentDocument();
  // AP-1 — the person who raised an unposted payment cancels it; anyone else rejects it.
  const raisedByMe = Boolean(payment.createdBy) && payment.createdBy === session.user?.id;
  const endHow: 'reject' | 'cancel' = raisedByMe ? 'cancel' : 'reject';
  const end = useEndSupplierPayment(endHow);

  const mayManage = can(ACCOUNTING_PERMISSIONS.managePayables);
  const posted = payment.postingStatus === 'POSTED';
  const allowed = mayManage ? availablePaymentActions(payment, underDualControl) : [];
  const plan = planPaymentPost(payment, accounts.data ?? [], bankAccounts.data ?? [], locale);

  const close = () => {
    release.reset();
    post.reset();
    reverse.reset();
    end.reset();
    setDialog(null);
  };

  const primary = allowed.includes('approve') ? (
    <GatedActionButton
      command={() => approve.mutateAsync(payment.id)}
      transactionType={WorkflowTransactionType.SUPPLIER_PAYMENT}
      label={t('approve')}
    />
  ) : allowed.includes('release') ? (
    <Button onClick={() => setDialog('release')}>{t('signRelease')}</Button>
  ) : allowed.includes('post') ? (
    <Button onClick={() => setDialog('post')}>{t('post')}</Button>
  ) : null;

  const more: { key: Exclude<Dialog, null>; label: string; danger?: boolean }[] = mayManage
    ? [
        // AP-5 — the supplier paid back money this payment holds unapplied.
        ...(posted && Number(payment.unallocatedAmount) > 0 ? [{ key: 'refund' as const, label: tRefund('action') }] : []),
        ...(canEndPayment(payment)
          ? [{ key: 'end' as const, label: t(endHow === 'cancel' ? 'cancelPayment' : 'rejectPayment'), danger: true }]
          : []),
        ...(allowed.includes('reverse') ? [{ key: 'reverse' as const, label: t('reverse'), danger: true }] : []),
      ]
    : [];

  // A release fails three ways the user must tell apart: not a signatory / SoD (403), already
  // signed (409), anything else.
  const releaseError = release.isError
    ? release.error instanceof ApiError && release.error.status === 403
      ? t('releaseNotSignatory')
      : release.error instanceof ApiError && release.error.status === 409
        ? t('releaseAlreadySigned')
        : serverMessage(release.error, tc('loadFailed'))
    : undefined;

  return (
    <>
      {primary}
      {posted && payment.paymentNumber && mayManage ? (
        <Button variant="outline" onClick={() => openDocument.mutate(payment.id)} disabled={openDocument.isPending}>
          <Download size={16} aria-hidden="true" />
          {t('remittance')}
        </Button>
      ) : null}
      {more.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {tc('moreActions')}
              <ChevronDown size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map((item, i) => (
              <Fragment key={item.key}>
                {item.danger && i > 0 && !more[i - 1]!.danger ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem className={cn(item.danger && 'text-danger')} onSelect={() => setDialog(item.key)}>
                  {item.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {openDocument.isError ? (
        <p className="basis-full text-body-sm text-danger" role="alert">
          {t('remittanceFailed')}
        </p>
      ) : null}

      {dialog === 'end' ? (
        <ConfirmActionDialog
          title={t(endHow === 'cancel' ? 'cancelTitle' : 'rejectTitle')}
          description={t('endBody')}
          confirmLabel={t(endHow === 'cancel' ? 'cancelPayment' : 'rejectPayment')}
          reason={{ label: t('endReason'), required: true }}
          destructive
          isPending={end.isPending}
          errorMessage={end.isError ? serverMessage(end.error, tc('loadFailed')) : undefined}
          onConfirm={(reason) => end.mutate({ id: payment.id, reason }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {dialog === 'release' ? (
        <ConfirmActionDialog
          title={t('releaseTitle')}
          description={t('releaseBody')}
          confirmLabel={t('signRelease')}
          isPending={release.isPending}
          errorMessage={releaseError}
          onConfirm={() => release.mutate(payment.id, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {dialog === 'post' ? (
        <PostPaymentDialog
          payment={payment}
          plan={plan}
          isPending={post.isPending}
          errorMessage={post.isError ? serverMessage(post.error, tc('loadFailed')) : null}
          onConfirm={(payload) => post.mutate({ id: payment.id, payload }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {dialog === 'reverse' ? (
        <ConfirmActionDialog
          title={t('reverseTitle')}
          description={t('reverseBody')}
          confirmLabel={t('reverse')}
          reason={{ label: t('reverseReason'), required: true, maxLength: 500 }}
          destructive
          isPending={reverse.isPending}
          errorMessage={reverse.isError ? serverMessage(reverse.error, tc('loadFailed')) : undefined}
          onConfirm={(reason) =>
            reverse.mutate(
              { id: payment.id, payload: { reversalDate: new Date().toISOString().slice(0, 10), reason } },
              { onSuccess: close },
            )
          }
          onDismiss={close}
        />
      ) : null}

      {mayManage && posted ? (
        <SupplierRefundDialog
          open={dialog === 'refund'}
          onOpenChange={(open) => setDialog(open ? 'refund' : null)}
          paymentId={payment.id}
          unapplied={payment.unallocatedAmount}
          currencyCode={payment.currencyCode}
        />
      ) : null}
    </>
  );
}

/**
 * The payment's post confirmation, on the shared `PostingPreviewDialog` so it reads like the
 * invoice and bill ones. `lg` (ADR-039): a payment can clear several bills.
 */
function PostPaymentDialog({
  payment,
  plan,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  payment: SupplierPayment;
  plan: ReturnType<typeof planPaymentPost>;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: (payload: PostSupplierPaymentPayload) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('procurement.payments');

  return (
    <PostingPreviewDialog
      title={t('postTitle')}
      description={t('postBody')}
      size="lg"
      currencyCode={payment.currencyCode}
      lines={plan.ok ? plan.plan.lines : undefined}
      accountHeading={t('postPreview')}
      debitHeading={t('postDebit')}
      creditHeading={t('postCredit')}
      unbalanced={plan.ok && !plan.plan.balanced ? t('postUnbalanced') : null}
      problems={plan.ok ? undefined : [plan.missingBank ? t('postBankMissing') : t('postAccountProblem')]}
      errorMessage={errorMessage}
      confirmLabel={t('post')}
      isPending={isPending}
      onConfirm={() => {
        if (plan.ok && plan.plan.balanced) onConfirm(plan.plan.payload);
      }}
      onDismiss={onDismiss}
    />
  );
}
