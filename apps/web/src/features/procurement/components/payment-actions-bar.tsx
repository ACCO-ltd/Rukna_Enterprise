'use client';

/**
 * Lifecycle controls on a supplier payment: approve, release, post, reverse.
 *
 * Same shape as `BillActionBar` — every action confirmed, unavailable ones disabled with the
 * reason attached — with two differences worth naming:
 *  • the Post dialog previews a journal whose bank line comes from the payment's own bank
 *    account, not from a subtype scan of the chart; and
 *  • when the payment's bank account is under dual control (ADR-022 CONST-DOA-005 — the account
 *    has active signatories), a Release step sits between Approve and Post. Two distinct
 *    signatories must sign before the payment can post. The signatory list for the payment's
 *    bank account is what tells this bar whether the account is under dual control at all; who
 *    may sign is enforced server-side and surfaced as a 403.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';

import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { useAccounts, useBankAccounts, useSignatories } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';
import { formatMoney } from '@/lib/format';

import {
  useApproveSupplierPayment,
  usePostSupplierPayment,
  useReleaseSupplierPayment,
  useReverseSupplierPayment,
} from '../hooks/use-procurement';
import {
  availablePaymentActions,
  paymentBlockReason,
  planPaymentPost,
  type PaymentAction,
} from '../payment-actions';
import type { SupplierPayment } from '../types';

// Approve is rendered separately — it is the governed transition (DRAFT → APPROVED) and runs
// through the ADR-011 gate. Release, Post and Reverse keep the plain confirm-then-mutate flow.
const ORDER: PaymentAction[] = ['release', 'post', 'reverse'];

export function PaymentActionBar({ payment }: { payment: SupplierPayment }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [pending, setPending] = useState<PaymentAction | null>(null);

  const accounts = useAccounts();
  const bankAccounts = useBankAccounts();
  // Dual control is a property of the payment's bank account: it has ≥1 active signatory. The
  // payment response carries no signatory count, so this list is the only source of that fact.
  const signatories = useSignatories(payment.bankAccountId);
  const underDualControl = (signatories.data ?? []).length > 0;

  const approve = useApproveSupplierPayment();
  const release = useReleaseSupplierPayment();
  const post = usePostSupplierPayment();
  const reverse = useReverseSupplierPayment();

  if (!can(ACCOUNTING_PERMISSIONS.managePayables)) return null;

  const allowed = availablePaymentActions(payment, underDualControl);
  const plan = planPaymentPost(payment, accounts.data ?? [], bankAccounts.data ?? [], locale);

  function close() {
    release.reset();
    setPending(null);
  }

  const approveReason = paymentBlockReason(payment, 'approve', underDualControl);

  // A release can fail three ways the user must be told apart: not a signatory / SoD conflict
  // (403), already signed (409), and everything else. The message names which.
  const releaseError = release.isError
    ? release.error instanceof ApiError && release.error.status === 403
      ? t('releaseNotSignatory')
      : release.error instanceof ApiError && release.error.status === 409
        ? t('releaseAlreadySigned')
        : tc('loadFailed')
    : undefined;

  return (
    <div className="space-y-4">
      {/* Approve routes through the approval gate (ADR-011): with a DoA binding configured the
          server opens an approval instead of transitioning, and the panel + "Complete" re-drive
          carry it through. When approve is not available it stays on screen, disabled with its
          reason, matching the rest of the bar. */}
      {allowed.includes('approve') ? (
        <GatedActionButton
          command={() => approve.mutateAsync(payment.id)}
          transactionType={WorkflowTransactionType.SUPPLIER_PAYMENT}
          label={t('approve')}
        />
      ) : (
        <Button
          type="button"
          disabled
          title={approveReason ? t(`blockReason.${approveReason}`) : undefined}
        >
          {t('approve')}
        </Button>
      )}

      {/* The dual-control notice explains why a Release step exists before Post, so an APPROVED
          payment that will not post yet is understood rather than read as broken. */}
      {underDualControl && (payment.documentStatus === 'APPROVED' || payment.documentStatus === 'RELEASED') ? (
        <p className="text-caption text-muted-foreground">{t('releaseDualControlNote')}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {ORDER.map((action) => {
          // Release only appears where dual control is in force — otherwise it is not part of
          // this payment's lifecycle at all and a disabled button would be noise.
          if (action === 'release' && !underDualControl) return null;
          const reason = paymentBlockReason(payment, action, underDualControl);
          return (
            <Button
              key={action}
              type="button"
              variant={action === 'reverse' ? 'outline' : 'default'}
              disabled={!allowed.includes(action)}
              title={reason ? t(`blockReason.${reason}`) : undefined}
              onClick={() => setPending(action)}
            >
              {t(action)}
            </Button>
          );
        })}
      </div>

      {pending === 'release' ? (
        <ConfirmActionDialog
          title={t('releaseTitle')}
          description={t('releaseBody')}
          confirmLabel={t('release')}
          isPending={release.isPending}
          errorMessage={releaseError}
          onConfirm={() => release.mutate(payment.id, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'post' ? (
        <PostPaymentDialog
          payment={payment}
          plan={plan}
          isPending={post.isPending}
          isError={post.isError}
          onConfirm={(payload) => post.mutate({ id: payment.id, payload }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'reverse' ? (
        <ConfirmActionDialog
          title={t('reverseTitle')}
          description={t('reverseBody')}
          confirmLabel={t('reverse')}
          reason={{ label: t('reverseReason'), required: true }}
          isPending={reverse.isPending}
          errorMessage={reverse.isError ? tc('loadFailed') : undefined}
          onConfirm={(reason) =>
            reverse.mutate(
              {
                id: payment.id,
                payload: { reversalDate: new Date().toISOString().slice(0, 10), reason },
              },
              { onSuccess: close },
            )
          }
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}

function PostPaymentDialog({
  payment,
  plan,
  isPending,
  isError,
  onConfirm,
  onDismiss,
}: {
  payment: SupplierPayment;
  plan: ReturnType<typeof planPaymentPost>;
  isPending: boolean;
  isError: boolean;
  onConfirm: (payload: {
    apAccountCode: string;
    bankGlCode: string;
    supplierAdvanceCode: string;
  }) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const preventWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

  const postable = plan.ok && plan.plan.balanced;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isPending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventWhilePending}
        onPointerDownOutside={preventWhilePending}
        onInteractOutside={preventWhilePending}
      >
        <DialogTitle>{t('postTitle')}</DialogTitle>
        <DialogDescription>{t('postBody')}</DialogDescription>

        {isError ? (
          <div className="mt-4">
            <Alert variant="error" messages={[tc('loadFailed')]} />
          </div>
        ) : null}

        {plan.ok ? (
          <div className="mt-4 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 text-start font-medium">
                      {t('postPreview')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('postDebit')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('postCredit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.plan.lines.map((line, index) => (
                    <tr
                      key={`${line.accountCode}-${index}`}
                      className="border-b border-border/60"
                    >
                      <td className="py-2 pe-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.accountCode}
                        </span>
                        <span className="ms-2 text-foreground">{line.accountName}</span>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">
                          {line.debit
                            ? formatMoney(line.debit, payment.currencyCode, locale)
                            : null}
                        </bdi>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">
                          {line.credit
                            ? formatMoney(line.credit, payment.currencyCode, locale)
                            : null}
                        </bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plan.plan.balanced ? null : (
              <Alert variant="error" messages={[t('postUnbalanced')]} />
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[plan.missingBank ? t('postBankMissing') : t('postAccountProblem')]}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => {
              if (plan.ok && plan.plan.balanced) onConfirm(plan.plan.payload);
            }}
            disabled={isPending || !postable}
          >
            {isPending ? tCommon('saving') : t('post')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={isPending}>
            {tCommon('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
