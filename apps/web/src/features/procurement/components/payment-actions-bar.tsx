'use client';

/**
 * Lifecycle controls on a supplier payment: approve, post, reverse.
 *
 * Same shape as `BillActionBar` — every action confirmed, unavailable ones disabled with the
 * reason attached — with one difference worth naming: the Post dialog previews a journal whose
 * bank line comes from the payment's own bank account, not from a subtype scan of the chart.
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
import { useAccounts, useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';
import { formatMoney } from '@/lib/format';

import {
  useApproveSupplierPayment,
  usePostSupplierPayment,
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
// through the ADR-011 gate. The rest keep the plain confirm-then-mutate flow.
const ORDER: PaymentAction[] = ['post', 'reverse'];

export function PaymentActionBar({ payment }: { payment: SupplierPayment }) {
  const t = useTranslations('procurement.payments');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [pending, setPending] = useState<PaymentAction | null>(null);

  const accounts = useAccounts();
  const bankAccounts = useBankAccounts();

  const approve = useApproveSupplierPayment();
  const post = usePostSupplierPayment();
  const reverse = useReverseSupplierPayment();

  if (!can(ACCOUNTING_PERMISSIONS.managePayables)) return null;

  const allowed = availablePaymentActions(payment);
  const plan = planPaymentPost(payment, accounts.data ?? [], bankAccounts.data ?? [], locale);

  function close() {
    setPending(null);
  }

  const approveReason = paymentBlockReason(payment, 'approve');

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

      <div className="flex flex-wrap gap-2">
        {ORDER.map((action) => {
          const reason = paymentBlockReason(payment, action);
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
