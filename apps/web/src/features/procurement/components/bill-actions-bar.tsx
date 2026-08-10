'use client';

/**
 * The lifecycle controls on a supplier bill: submit, approve, post, reverse.
 *
 * Every action is confirmed, because none can be undone from the UI — there is no reject
 * endpoint, nothing returns a bill to DRAFT, and the only exit from a posted bill is a
 * reversal that writes a second journal.
 *
 * Unavailable actions are rendered disabled with the reason attached rather than hidden. A
 * button that is simply absent tells the user nothing about what to do next; "the bill has to
 * be submitted before it can be approved" does.
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

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { formatMoney } from '@/lib/format';

import {
  availableBillActions,
  billBlockReason,
  planBillPost,
  type BillAction,
} from '../bill-actions';
import {
  useApproveSupplierBill,
  usePostSupplierBill,
  useReverseSupplierBill,
  useSubmitSupplierBill,
} from '../hooks/use-procurement';
import type { SupplierBill } from '../types';

const ORDER: BillAction[] = ['submit', 'approve', 'post', 'reverse'];

export function BillActionBar({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [pending, setPending] = useState<BillAction | null>(null);

  const accounts = useAccounts();
  const profiles = usePostingProfiles();

  const submit = useSubmitSupplierBill();
  const approve = useApproveSupplierBill();
  const post = usePostSupplierBill();
  const reverse = useReverseSupplierBill();

  const allowed = availableBillActions(bill);
  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);

  if (!canManage) return null;

  const plan = planBillPost(bill, accounts.data ?? [], profiles.data ?? [], locale);

  function close() {
    setPending(null);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ORDER.map((action) => {
          const reason = billBlockReason(bill, action);
          const enabled = allowed.includes(action);
          return (
            <Button
              key={action}
              type="button"
              variant={action === 'reverse' ? 'outline' : 'default'}
              disabled={!enabled}
              title={reason ? t(`blockReason.${reason}`) : undefined}
              onClick={() => setPending(action)}
            >
              {t(action)}
            </Button>
          );
        })}
      </div>

      {pending === 'submit' ? (
        <ConfirmActionDialog
          title={t('submitTitle')}
          description={t('submitBody')}
          confirmLabel={t('submit')}
          isPending={submit.isPending}
          errorMessage={submit.isError ? tc('loadFailed') : undefined}
          onConfirm={() => submit.mutate(bill.id, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'approve' ? (
        <ConfirmActionDialog
          title={t('approveTitle')}
          description={t('approveBody')}
          confirmLabel={t('approve')}
          isPending={approve.isPending}
          errorMessage={approve.isError ? tc('loadFailed') : undefined}
          onConfirm={() => approve.mutate(bill.id, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'post' ? (
        <PostDialog
          bill={bill}
          plan={plan}
          isPending={post.isPending}
          isError={post.isError}
          onConfirm={(payload) =>
            post.mutate({ id: bill.id, payload }, { onSuccess: close })
          }
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
                id: bill.id,
                // The server takes any date; today is the only defensible default, and it is
                // sent explicitly rather than omitted because the DTO requires it.
                payload: { reversalDate: new Date().toISOString().slice(0, 10), reason },
              },
              { onSuccess: close },
            )
          }
          onDismiss={close}
        />
      ) : null}
    </>
  );
}

// ─── Post ────────────────────────────────────────────────────────────────────────

/**
 * The post confirmation, showing the exact journal the server will write.
 *
 * Built as a bespoke `Dialog` rather than a `ConfirmActionDialog`, following
 * `PostInvoiceDialog` — the shared confirmation takes no children, and the whole point here is
 * the preview. The markup deliberately mirrors that file so the two posting dialogs read the
 * same; an accountant posting a bill and posting an invoice should not be learning two screens.
 *
 * Unlike the invoice's fixed three lines, a bill has one debit per line and a single credit,
 * so this table is as long as the bill.
 */
function PostDialog({
  bill,
  plan,
  isPending,
  isError,
  onConfirm,
  onDismiss,
}: {
  bill: SupplierBill;
  plan: ReturnType<typeof planBillPost>;
  isPending: boolean;
  isError: boolean;
  onConfirm: (payload: { apAccountCode: string }) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('procurement.bills');
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
                            ? formatMoney(line.debit, bill.currencyCode, locale)
                            : null}
                        </bdi>
                      </td>
                      <td className="py-2 text-end">
                        <bdi className="tabular-nums">
                          {line.credit
                            ? formatMoney(line.credit, bill.currencyCode, locale)
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
            <Alert variant="error" messages={[t('postAccountProblem')]} />
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
