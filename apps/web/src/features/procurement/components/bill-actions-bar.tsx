'use client';

/**
 * The frame of a supplier bill (SB-2): the record header — number, one status, supplier, due
 * date and the balance due — with its commands, at most one notice, then the body and the rail
 * the caller passes; plus the confirmations its commands open.
 *
 * Every command is confirmed, because none can be undone from the UI — a rejected bill is final,
 * and the only exit from a posted bill is a reversal that writes a second journal. Return and
 * reject (ADR-037 amendment) and reverse each ask for a reason, which the history keeps.
 *
 * Commands follow backend state and permissions: the one valid next step is the primary
 * button, and Pay bill sits beside it while money is owed; Edit, Return for correction, Reject,
 * Cancel and Reverse sit under More, destructive ones last; anything unavailable is not rendered.
 * A blocked post is explained in words by the notice rather than by a greyed-out button.
 */

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Notice,
  RecordHeader,
  RecordLayout,
  StatusPill,
  type DocumentCommand,
} from '@erp/ui';
import { ChevronDown, ChevronLeft } from 'lucide-react';

import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PostingPreviewDialog } from '@/features/accounting/components/posting-preview-dialog';
import { useAccounts, usePostingProfiles } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { DebitNoteDialog } from '@/features/debit-notes/debit-note-dialog';
import { GatedActionButton } from '@/features/workflows/components/gated-action-button';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { todayWireDate } from '@/features/accounting/invoice-overdue';

import {
  availableBillActions,
  billNotice,
  canEditBill,
  isSettleableBill,
  planBillPost,
  primaryBillAction,
  type BillAction,
} from '../bill-actions';
import {
  useApproveSupplierBill,
  useBillMatch,
  usePostSupplierBill,
  useRejectSupplierBill,
  useCancelSupplierBill,
  useReturnSupplierBill,
  useReverseSupplierBill,
  useSubmitSupplierBill,
  useSupplierBillEligibility,
} from '../hooks/use-procurement';
import { BILL_LIST_STATE_TONE, billDaysLate, billListState } from '../bill-list-state';
import type { PostSupplierBillPayload, SupplierBill } from '../types';
import { HELD } from './bill-eligibility-panel';
import { ResolveExceptionDialog } from './bill-matching';

/** The server's words for a refused command (e.g. the bill changed state meanwhile), else a fallback. */
function commandError(error: unknown, fallback: string): string | undefined {
  if (!error) return undefined;
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export function BillDocumentHeader({
  bill,
  rail,
  back,
  children,
}: {
  bill: SupplierBill;
  /**
   * Where "back" goes. Defaults to the Accounting bills list; a project workspace passes its
   * own tab so a bill opened inside a project returns there (flow plan PR 4).
   */
  back?: { href: string; label: string };
  /** The summary rail, beside the body from `lg`, under it below. */
  rail?: React.ReactNode;
  /** The document body — tabs and totals. */
  children?: React.ReactNode;
}) {
  const t = useTranslations('procurement.bills');
  const tc = useTranslations('procurement.common');
  const tMatch = useTranslations('procurement.matchStatus');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const router = useRouter();

  const [pending, setPending] = useState<BillAction | 'cancel' | null>(null);
  const [debitNoteOpen, setDebitNoteOpen] = useState(false);

  const accounts = useAccounts();
  const eligibility = useSupplierBillEligibility(bill.id, { enabled: can(ACCOUNTING_PERMISSIONS.managePayables) && isSettleableBill(bill) });
  const profiles = usePostingProfiles();

  const submit = useSubmitSupplierBill();
  const approve = useApproveSupplierBill();
  const post = usePostSupplierBill();
  const reverse = useReverseSupplierBill();
  const returnBill = useReturnSupplierBill();
  const reject = useRejectSupplierBill();
  const cancel = useCancelSupplierBill();

  const canManage = can(ACCOUNTING_PERMISSIONS.managePayables);
  const viewerId = useSession().user?.id ?? null;
  const allowed = canManage ? availableBillActions(bill, viewerId) : [];
  const primary = canManage ? primaryBillAction(bill) : null;
  const plan = planBillPost(bill, accounts.data ?? [], profiles.data ?? [], locale);
  const hasPoLink = Boolean(bill.purchaseOrderRevisionId ?? bill.purchaseOrderId);
  const notice = billNotice(bill);

  const close = () => setPending(null);

  // Posting held by an open match exception: resolving it is the one next step, so it takes the
  // primary slot — for whoever holds the authority to resolve it.
  const canResolveException = can(PROCUREMENT_PERMISSIONS.approveMatchException);

  const primaryButton =
    notice === 'post-blocked' && canResolveException && bill.matchStatus === 'EXCEPTION' ? (
      <ResolveExceptionAction billId={bill.id} />
    ) : primary === 'submit' ? (
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

  const editHref = `/finance/accounting/bills/${bill.id}/edit`;
  const canEdit = canManage && canEditBill(bill);
  const billName = bill.billNumber ?? t('thisBill');

  const commands: DocumentCommand[] = [
    ...(canEdit ? [{ key: 'edit', label: t('editBill'), onSelect: () => router.push(editHref) }] : []),
    ...(allowed.includes('return')
      ? [{ key: 'return', label: t('returnForCorrection'), onSelect: () => setPending('return') }]
      : []),
    // AP-4 — a credit the supplier gave against a posted bill with a balance left to pay.
    ...(canManage && bill.postingStatus === 'POSTED' && Number(bill.outstandingAmount) > 0
      ? [{ key: 'debit-note', label: t('recordDebitNote'), onSelect: () => setDebitNoteOpen(true) }]
      : []),
    ...(allowed.includes('reject')
      ? [{ key: 'reject', label: t('reject'), onSelect: () => setPending('reject'), destructive: true }]
      : []),
    // AP-2 — a draft that will never be submitted (a duplicate, the wrong supplier).
    ...(canManage && bill.documentStatus === 'DRAFT'
      ? [{ key: 'cancel', label: t('cancelDraft'), onSelect: () => setPending('cancel'), destructive: true }]
      : []),
    ...(allowed.includes('reverse')
      ? [{ key: 'reverse', label: t('reverse'), onSelect: () => setPending('reverse'), destructive: true }]
      : []),
  ];

  const state = billListState(bill, todayWireDate());
  const settleable = isSettleableBill(bill);
  const owed = settleable && Number(bill.outstandingAmount) > 0;
  const daysLate = billDaysLate(bill, todayWireDate());
  const money = (value: string) => formatMoney(value, bill.currencyCode, locale) ?? value;
  const title =
    bill.billNumber ??
    (bill.postingStatus === 'OPENING_BALANCE' ? t('titleOpening') : t(`titleUnnumbered.${state}` as never));
  const payHref = `/finance/accounting/payments/new?supplier=${bill.supplierId}&bill=${bill.id}&amount=${Number(bill.outstandingAmount).toFixed(2)}`;
  // A bill on hold (an opening balance that does not tie, a closed period) cannot be paid yet.
  const held = Boolean(eligibility.data?.blockedReason && HELD.has(eligibility.data.blockedReason));
  const payButton =
    canManage && owed && !held ? (
      <Button asChild variant={primaryButton ? 'outline' : 'default'}>
        <Link href={payHref}>{t('payBill')}</Link>
      </Button>
    ) : null;

  return (
    <>
      <RecordLayout
        header={
          <RecordHeader
            headingLevel="h2"
            breadcrumb={
              <Link
                href={back?.href ?? '/finance/accounting/bills'}
                className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                {back?.label ?? t('backToList')}
              </Link>
            }
            title={<span className={cn(bill.billNumber && 'font-mono')}>{title}</span>}
            statusPlacement="title"
            status={<StatusPill tone={BILL_LIST_STATE_TONE[state]}>{t(`listState.${state}`)}</StatusPill>}
            meta={
              <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
                <span className="font-medium text-foreground">{bill.supplier?.name ?? tc('notAvailable')}</span>
                <span>· {t('supplierRef', { ref: bill.supplierInvoiceNumber })}</span>
                <span>
                  · {t('dueOn', { date: formatDate(bill.dueDate, locale) ?? '—' })}
                  {daysLate > 0 ? <span className="font-medium text-danger"> · {t('daysLate', { days: daysLate })}</span> : null}
                </span>
                {hasPoLink ? (
                  <span>
                    · {tMatch('axis')}: {tMatch(bill.matchStatus)}
                  </span>
                ) : null}
              </span>
            }
            figure={{
              label: settleable ? t('balanceDue') : t('totalAmount'),
              value: <span className="tabular-nums">{money(settleable ? bill.outstandingAmount : bill.totalAmount)}</span>,
            }}
            actions={
              <>
                {primaryButton}
                {payButton}
                {commands.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        {tc('moreActions')}
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {commands.map((command, i) => (
                        <Fragment key={command.key}>
                          {command.destructive && i > 0 && !commands[i - 1]!.destructive ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem className={cn(command.destructive && 'text-danger')} onSelect={command.onSelect}>
                            {command.label}
                          </DropdownMenuItem>
                        </Fragment>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            }
          />
        }
        banner={
          notice === 'returned' ? (
            <Notice
              tone="attention"
              title={t('notice.returnedTitle', { date: formatDate(bill.returnedAt, locale) ?? '' })}
              action={
                canEdit ? (
                  <Button asChild variant="outline">
                    <Link href={editHref}>{t('editBill')}</Link>
                  </Button>
                ) : undefined
              }
            >
              {bill.returnReason ?? ''}
            </Notice>
          ) : notice === 'rejected' ? (
            <Notice tone="danger" title={t('notice.rejectedTitle', { date: formatDate(bill.rejectedAt, locale) ?? '' })}>
              {bill.rejectionReason ?? ''}
            </Notice>
          ) : bill.documentStatus === 'CANCELLED' ? (
            <Notice tone="historical" title={t('notice.cancelledTitle', { date: formatDate(bill.cancelledAt ?? null, locale) ?? '' })}>
              {bill.cancellationReason ?? ''}
            </Notice>
          ) : notice === 'post-blocked' ? (
            <Notice
              tone="attention"
              title={t('notice.postBlockedTitle')}
              action={
                <Button asChild variant="outline">
                  <a href="#bill-matching">{t('notice.reviewMatch')}</a>
                </Button>
              }
            >
              {t('notice.postBlockedBody', { match: tMatch(bill.matchStatus) })}
            </Notice>
          ) : notice === 'post-failed' ? (
            <Notice
              tone="danger"
              title={t('notice.postFailedTitle')}
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
            <Notice tone="info" title={t('notice.postingPendingTitle')}>
              {t('notice.postingPendingBody')}
            </Notice>
          ) : notice === 'reversed' ? (
            <Notice tone="historical" title={t('notice.reversedTitle')}>
              {t('notice.reversedBody')}
            </Notice>
          ) : null
        }
        rail={rail}
      >
        {children}
      </RecordLayout>

      {pending === 'approve' ? (
        <ConfirmActionDialog
          title={t('approveTitle')}
          description={t('approveBody')}
          confirmLabel={t('approve')}
          isPending={approve.isPending}
          errorMessage={commandError(approve.error, tc('loadFailed'))}
          onConfirm={() => approve.mutate(bill.id, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'return' ? (
        <ConfirmActionDialog
          title={t('returnTitle', { bill: billName })}
          description={t('returnBody')}
          confirmLabel={t('returnForCorrection')}
          reason={{ label: t('returnReason'), required: true }}
          isPending={returnBill.isPending}
          errorMessage={commandError(returnBill.error, tc('loadFailed'))}
          onConfirm={(reason) => returnBill.mutate({ id: bill.id, reason }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      <DebitNoteDialog open={debitNoteOpen} onOpenChange={setDebitNoteOpen} billId={bill.id} leftToPay={bill.outstandingAmount} />

      {pending === 'cancel' ? (
        <ConfirmActionDialog
          title={t('cancelTitle', { bill: billName })}
          description={t('cancelBody')}
          confirmLabel={t('cancelDraft')}
          reason={{ label: t('cancelReason'), required: true }}
          destructive
          isPending={cancel.isPending}
          errorMessage={commandError(cancel.error, tc('loadFailed'))}
          onConfirm={(reason) => cancel.mutate({ id: bill.id, reason }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'reject' ? (
        <ConfirmActionDialog
          title={t('rejectTitle', { bill: billName })}
          description={t('rejectBody')}
          confirmLabel={t('rejectConfirm')}
          reason={{ label: t('rejectReason'), required: true }}
          destructive
          isPending={reject.isPending}
          errorMessage={commandError(reject.error, tc('loadFailed'))}
          onConfirm={(reason) => reject.mutate({ id: bill.id, reason }, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}

      {pending === 'post' ? (
        <PostDialog
          bill={bill}
          plan={plan}
          isPending={post.isPending}
          // The server's reason — e.g. POSTING_PROFILE_NOT_EXPENSE names the profile a line uses.
          errorMessage={commandError(post.error, tc('loadFailed')) ?? null}
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
          errorMessage={commandError(reverse.error, tc('loadFailed'))}
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
 * The post confirmation, showing the exact journal the server will write — the shared
 * `PostingPreviewDialog`, so posting a bill reads exactly like posting an invoice.
 *
 * Unlike the invoice's fixed three lines, a bill has one debit per line and a single credit, so
 * this preview is as long as the bill: `lg` (ADR-039).
 */
function PostDialog({
  bill,
  plan,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: {
  bill: SupplierBill;
  plan: ReturnType<typeof planBillPost>;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: (payload: PostSupplierBillPayload) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('procurement.bills');

  return (
    <PostingPreviewDialog
      title={t('postTitle')}
      description={t('postBody')}
      size="lg"
      currencyCode={bill.currencyCode}
      lines={plan.ok ? plan.plan.lines : undefined}
      accountHeading={t('postPreview')}
      debitHeading={t('postDebit')}
      creditHeading={t('postCredit')}
      unbalanced={plan.ok && !plan.plan.balanced ? t('postUnbalanced') : null}
      problems={plan.ok ? undefined : [t('postAccountProblem')]}
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

// ─── Resolve a match exception ─────────────────────────────────────────────────────

/**
 * The header's primary command while posting is held by a fresh match exception. It opens the
 * same dialog as Matching's "Resolve exception" — one dialog, one set of rules. Renders nothing
 * once the exception already carries a resolution (a PO revision or a receipt correction is
 * pending): there is nothing left to resolve here, and Matching explains what to do instead.
 *
 * Labelled "Resolve", not "Approve": the reason chosen in the dialog can equally dispute the
 * invoice or send it back for a PO revision, and a button must not promise one outcome of several.
 */
function ResolveExceptionAction({ billId }: { billId: string }) {
  const t = useTranslations('procurement.matching');
  const match = useBillMatch(billId);
  const [open, setOpen] = useState(false);

  if (match.data?.status !== 'EXCEPTION' || match.data.resolutionAction) return null;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('resolveException')}
      </Button>
      {open ? <ResolveExceptionDialog billId={billId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
