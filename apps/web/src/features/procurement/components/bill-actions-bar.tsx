'use client';

/**
 * The top of a supplier bill (ADR-035): the sticky DocumentActionBar, the DocumentIdentity with
 * its three labelled status axes, and at most one Notice — plus the confirmations its commands
 * open.
 *
 * Every command is confirmed, because none can be undone from the UI — there is no reject
 * endpoint, nothing returns a bill to DRAFT, and the only exit from a posted bill is a reversal
 * that writes a second journal.
 *
 * Commands follow backend state and permissions: the one valid next step is the primary
 * button, Reverse sits in the kebab, and anything unavailable is not rendered. A blocked post is
 * explained in words by the Notice rather than by a greyed-out button.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DocumentActionBar,
  DocumentIdentity,
  LifecycleStepper,
  Notice,
  type DocumentCommand,
} from '@erp/ui';
import { ArrowLeft } from 'lucide-react';

import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';
import { formatDate, formatMoney } from '@/lib/format';

import {
  availableBillActions,
  BILL_STAGES,
  billLifecycle,
  billNotice,
  planBillPost,
  primaryBillAction,
  type BillAction,
} from '../bill-actions';
import {
  useApproveSupplierBill,
  usePostSupplierBill,
  useReverseSupplierBill,
  useSubmitSupplierBill,
} from '../hooks/use-procurement';
import type { SupplierBill } from '../types';
import { BillMatchStatusBadge, PostingStatusBadge, ProcurementStatusBadge } from './procurement-badges';

export function BillDocumentHeader({ bill }: { bill: SupplierBill }) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const tPosting = useTranslations('procurement.postingStatus');
  const tMatch = useTranslations('procurement.matchStatus');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [pending, setPending] = useState<BillAction | null>(null);

  const accounts = useAccounts();
  const profiles = usePostingProfiles();

  const submit = useSubmitSupplierBill();
  const approve = useApproveSupplierBill();
  const post = usePostSupplierBill();
  const reverse = useReverseSupplierBill();

  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);
  const allowed = canManage ? availableBillActions(bill) : [];
  const primary = canManage ? primaryBillAction(bill) : null;
  const plan = planBillPost(bill, accounts.data ?? [], profiles.data ?? [], locale);
  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const lifecycle = billLifecycle(bill);
  const notice = billNotice(bill);

  const close = () => setPending(null);

  const primaryButton =
    primary === 'submit' ? (
      // Submit runs through the approval gate (ADR-011): with a DoA binding configured the server
      // opens an approval instead of transitioning.
      <GatedActionButton
        command={() => submit.mutateAsync(bill.id)}
        transactionType={WorkflowTransactionType.SUPPLIER_BILL}
        label={t('submitForApproval')}
      />
    ) : primary ? (
      <Button type="button" onClick={() => setPending(primary)}>
        {t(primary)}
      </Button>
    ) : null;

  const commands: DocumentCommand[] = allowed.includes('reverse')
    ? [{ key: 'reverse', label: t('reverse'), onSelect: () => setPending('reverse'), destructive: true }]
    : [];

  return (
    <>
      <DocumentActionBar
        back={
          <Button asChild variant="ghost" className="gap-1.5 px-2">
            <Link href="/finance/accounting/bills">
              <ArrowLeft size={16} aria-hidden="true" />
              {t('backToList')}
            </Link>
          </Button>
        }
        primary={primaryButton}
        commands={commands}
        moreLabel={tc('moreActions')}
        lifecycle={
          <LifecycleStepper
            steps={BILL_STAGES.map((stage) => ({
              key: stage,
              label: stage === 'POSTED' ? tPosting('POSTED') : tStatus(stage),
            }))}
            current={lifecycle.current}
            terminal={
              lifecycle.terminal
                ? {
                    label:
                      lifecycle.terminal === 'REVERSED'
                        ? tPosting('REVERSED')
                        : tStatus(lifecycle.terminal),
                    tone: lifecycle.terminal === 'REJECTED' ? 'danger' : 'historical',
                  }
                : undefined
            }
            stepOfLabel={(n, total) => t('stepOf', { n, total })}
          />
        }
      />

      <DocumentIdentity
        eyebrow={t('eyebrow')}
        title={bill.billNumber ?? tStatus(bill.documentStatus)}
        subtitle={[
          bill.supplier?.name ?? tc('notAvailable'),
          t('supplierRef', { ref: bill.supplierInvoiceNumber }),
        ].join(' · ')}
        axes={[
          {
            label: t('axisDocument'),
            value: <ProcurementStatusBadge vocabulary="supplierBill" status={bill.documentStatus} />,
          },
          { label: tPosting('axis'), value: <PostingStatusBadge status={bill.postingStatus} /> },
          // A non-PO bill never matches; showing "Not run" there would read as a missing step (D6).
          ...(hasPoLink
            ? [{ label: tMatch('axis'), value: <BillMatchStatusBadge status={bill.matchStatus} /> }]
            : []),
        ]}
      />

      {notice === 'post-blocked' ? (
        <Notice tone="attention" title={t('notice.postBlockedTitle')} className="mb-6">
          {t('notice.postBlockedBody', { match: tMatch(bill.matchStatus) })}
        </Notice>
      ) : notice === 'post-failed' ? (
        <Notice
          tone="danger"
          title={t('notice.postFailedTitle')}
          className="mb-6"
          action={
            allowed.includes('post') ? (
              <Button variant="outline" onClick={() => setPending('post')}>
                {t('notice.retryPosting')}
              </Button>
            ) : undefined
          }
        >
          {t('notice.postFailedBody')}
        </Notice>
      ) : notice === 'posting-pending' ? (
        <Notice tone="info" title={t('notice.postingPendingTitle')} className="mb-6">
          {t('notice.postingPendingBody')}
        </Notice>
      ) : notice === 'reversed' ? (
        <Notice tone="historical" title={t('notice.reversedTitle')} className="mb-6">
          {t('notice.reversedBody')}
        </Notice>
      ) : notice === 'posted' ? (
        <Notice tone="success" title={t('notice.postedTitle')} className="mb-6">
          {t('notice.postedBody', {
            amount: formatMoney(bill.totalAmount, bill.currencyCode, locale) ?? '',
            date: formatDate(bill.billDate, locale) ?? '',
          })}
        </Notice>
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
          onConfirm={(payload) => post.mutate({ id: bill.id, payload }, { onSuccess: close })}
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
