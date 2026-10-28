'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, Check, Circle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow, RecordHeader, RecordPanel } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { lifecycleErrorKey, toLifecycleError } from '@/features/lifecycle/lifecycle-error';
import { formatDate, formatMoney } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import { AccountingSetupNotice } from '@/features/finance/components/accounting-setup-notice';
import { useLedgerBlocked } from '@/features/finance/hooks/use-accounting-readiness';
import { InvoiceWhatsAppDialog } from '@/features/communications/components/invoice-whatsapp-dialog';
import { MessageHistory } from '@/features/communications/components/message-history';
import { InvoiceReminderDialog } from '@/features/communications/components/invoice-reminder-dialog';
import { canSendReminder, daysOverdue } from '@/features/communications/reminder-eligibility';

import { formatRatePercent } from '../tax-codes';
import { useAccounts } from '../hooks/use-accounting';
import { invoiceKeys, useCancelInvoice, useInvoice, useInvoiceAction } from '../hooks/use-invoices';
import {
  canIssue,
  canPost,
  canReverse,
  invoiceBlockReason,
  invoiceWorkspaceState,
} from '../invoice-actions';
import type { ClientInvoice, PostInvoicePayload } from '../types';
import { InvoiceDocumentPreview, MobileInvoicePreviewTrigger } from './invoice-document-preview';
import { InvoiceStatusBadges } from './invoice-status-badges';
import { PostInvoiceDialog } from './post-invoice-dialog';
import { LoadError } from '@/components/load-error';
import { useApprovalSettings } from '../hooks/use-accounting';
import { useSession } from '@/features/auth/session/use-session';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';

/** An invoice's messages: the invoice sends and its reminders (ADR-042). */
const INVOICE_MESSAGE_TYPES = ['client_invoice', 'client_invoice_reminder'] as const;

type OpenDialog = 'issue' | 'approve' | 'post' | 'reverse' | 'cancel' | 'whatsapp' | 'reminder' | null;

export function InvoiceDetail({
  invoiceId,
  back,
  projectId,
}: {
  invoiceId: string;
  /** Set by a project-scoped route: the invoice returns to the project tab it was opened from. */
  back?: { href: string; label: string };
  /**
   * Set by a project-scoped route. An invoice of another project is shown as not found there,
   * never under the wrong project's header (flow plan PR 4 review).
   */
  projectId?: string;
}) {
  const t = useTranslations('accounting.invoices');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('common.lifecycleErrors');
  const tReminder = useTranslations('common.messaging.reminder');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const ledgerBlockedState = useLedgerBlocked();
  const searchParams = useSearchParams();

  const invoice = useInvoice(invoiceId);
  const accounts = useAccounts();
  const clients = useClients();
  const action = useInvoiceAction(invoiceId);
  const cancel = useCancelInvoice();
  const approvalSettings = useApprovalSettings();
  const { user } = useSession();

  const [dialog, setDialog] = useState<OpenDialog>(null);

  useModuleTrail(invoice.data ? (invoice.data.invoiceNumber ?? t('unnumbered')) : undefined);

  if (invoice.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (invoice.isError || !invoice.data) {
    return <LoadError message={t('loadFailed')} onRetry={() => void invoice.refetch()} />;
  }

  const data = invoice.data;
  if (projectId && data.projectId !== projectId) {
    return <Alert variant="error" messages={[t('notInProject')]} />;
  }
  const client = (clients.data ?? []).find((c) => c.id === data.clientId);
  const clientName = client ? client.name : null;
  const state = invoiceWorkspaceState(data);
  const money = (value: string | null) => formatMoney(value, data.currencyCode, locale);

  const mayManage = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  // ADR-046 §8 — at or above the organisation's amount, a draft waits for a second person.
  const approvalAbove = approvalSettings.data?.invoiceApprovalAbove ?? null;
  const needsApproval =
    approvalAbove !== null && toMinorUnits(data.totalAmount, MONEY_SCALE) >= toMinorUnits(approvalAbove, MONEY_SCALE);
  // ADR-042 — an issued invoice (numbered, posted, not cancelled) can be sent on WhatsApp.
  const issued =
    data.postingStatus === 'POSTED' &&
    data.documentStatus !== 'CANCELLED' &&
    Boolean(data.invoiceNumber);
  // ADR-042 step 4 — a manual payment / overdue reminder while something is still outstanding.
  const remindable = canSendReminder(data);
  // Post needs a ready ledger. When it is not, the action is withheld and the notice below the
  // header says why and where to fix it — never a button that fails and rolls back (A7).
  const ledgerBlocked = ledgerBlockedState;
  const errorMessage = action.isError
    ? tLifecycle(lifecycleErrorKey(toLifecycleError(action.error).kind))
    : undefined;

  // `from` is only followed when it is a same-origin path — never `//host` or an absolute URL.
  const fromParam = searchParams.get('from');
  const safeFrom =
    fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : null;
  const backHref = back?.href ?? safeFrom;
  const backLabel = back?.label ?? searchParams.get('fromLabel') ?? t('backToInvoices');

  const title =
    state === 'POSTED'
      ? t('stateTitle.POSTED', { number: data.invoiceNumber ?? t('unnumbered') })
      : t(`stateTitle.${state}`);

  const close = () => {
    action.reset();
    cancel.reset();
    setDialog(null);
  };

  const run = (request: Parameters<typeof action.mutate>[0]) => {
    action.mutate(request, { onSuccess: () => setDialog(null) });
  };

  return (
    <div className="space-y-6">
      <RecordHeader
        headingLevel="h2"
        breadcrumb={
          backHref ? (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {backLabel}
            </Link>
          ) : undefined
        }
        identifier={data.invoiceNumber ?? undefined}
        title={title}
        status={
          <InvoiceStatusBadges
            documentStatus={data.documentStatus}
            postingStatus={data.postingStatus}
          />
        }
        actions={
          mayManage ? (
            <>
              {data.isManual && data.documentStatus === 'DRAFT' ? (
                <Button variant="outline" asChild>
                  <Link href={`/finance/accounting/invoices/${data.id}/edit`}>{t('editDraft')}</Link>
                </Button>
              ) : null}
              {/* ADR-046 §2 — one action from draft to a numbered, posted invoice; §8 — a large
                  draft is approved by a second person first. */}
              {canIssue(data) && !ledgerBlocked && !needsApproval ? (
                <Button onClick={() => setDialog('issue')}>{t('issueAction')}</Button>
              ) : null}
              {canIssue(data) && needsApproval && user?.id !== data.createdBy ? (
                <Button onClick={() => setDialog('approve')}>{t('approve')}</Button>
              ) : null}
              {canIssue(data) && needsApproval && user?.id === data.createdBy ? (
                <p className="self-center text-body-sm text-muted-foreground">
                  {t('needsApproval', { amount: money(approvalSettings.data?.invoiceApprovalAbove ?? null) ?? '' })}
                </p>
              ) : null}

              {canPost(data) && !ledgerBlocked ? (
                <Button onClick={() => setDialog('post')}>{t('postAction')}</Button>
              ) : canPost(data) || canIssue(data) ? null : (
                <BlockedHint invoice={data} />
              )}

              {issued ? (
                <Button variant="outline" onClick={() => setDialog('whatsapp')}>
                  {t('sendWhatsApp')}
                </Button>
              ) : null}

              {remindable ? (
                <Button variant="outline" onClick={() => setDialog('reminder')}>
                  {tReminder('action')}
                </Button>
              ) : null}

              {canReverse(data) ? (
                <Button variant="outline" onClick={() => setDialog('reverse')}>
                  {t('reverse')}
                </Button>
              ) : null}

              {/* Step 2g — a stage-plan draft is deleted from the contract's Billing tab instead. */}
              {data.documentStatus !== 'CANCELLED' &&
              data.postingStatus === 'NOT_POSTED' &&
              data.source?.kind !== 'INSTALLMENT' ? (
                <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>
                  {t('cancelDraft.action')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {data.postingStatus !== 'POSTED' ? <AccountingSetupNotice /> : null}

      {data.isManual && data.lines && data.lines.length > 0 ? <ManualLinesTable invoice={data} locale={locale} /> : null}

      <AttachmentsPanel kind="INVOICE" ownerId={data.id} />

      {state === 'DRAFT' ? (
        <p className="text-caption text-muted-foreground">{t('approveHint')}</p>
      ) : null}
      {state === 'AWAITING_POSTING' ? (
        <p className="text-caption text-muted-foreground">{t('postHint')}</p>
      ) : null}

      {action.isError && dialog === null ? (
        <Alert variant="error" messages={[errorMessage ?? t('actionFailed')]} />
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <RecordPanel title={t('detailEyebrow')}>
            <DefinitionList>
              <DefinitionRow label={t('fieldSource')}>{humanSource(data, t)}</DefinitionRow>
              <DefinitionRow label={t('fieldClient')}>
                {clientName ?? data.clientId.slice(-8)}
              </DefinitionRow>
              <DefinitionRow label={t('fieldInvoiceDate')}>
                {formatDate(data.invoiceDate, locale)}
              </DefinitionRow>
              <DefinitionRow label={t('fieldDueDate')}>
                {formatDate(data.dueDate, locale)}
              </DefinitionRow>
              <DefinitionRow label={t('fieldTerms')}>{data.paymentTerms}</DefinitionRow>
            </DefinitionList>
            <DefinitionList className="mt-2 border-t border-border pt-2">
              <DefinitionRow label={t('fieldSubtotal')} numeric>
                {money(data.subtotal)}
              </DefinitionRow>
              <DefinitionRow
                label={
                  // The rate the invoice was raised at (ADR-041), never a rate assumed here.
                  data.taxRate != null
                    ? t('fieldVatRate', { rate: formatRatePercent(data.taxRate) })
                    : t('fieldVat')
                }
                numeric
              >
                {money(data.vatAmount)}
              </DefinitionRow>
              <DefinitionRow
                label={state === 'POSTED' ? t('fieldBalanceDue') : t('fieldDraftTotal')}
                numeric
              >
                {money(state === 'POSTED' ? data.outstandingAmount : data.totalAmount)}
              </DefinitionRow>
            </DefinitionList>
          </RecordPanel>

          <RecordPanel title={t('statusList.heading')}>
            <ApprovalPostingStatus data={data} locale={locale} />
          </RecordPanel>

          {issued && mayManage ? (
            <RecordPanel title={t('messagesHeading')}>
              <MessageHistory
                resourceType={INVOICE_MESSAGE_TYPES}
                resourceId={invoiceId}
                canResolve
                showTitle={false}
                invalidateOnResolve={[invoiceKeys.all, ['commercial']]}
              />
            </RecordPanel>
          ) : null}

          <MobileInvoicePreviewTrigger invoiceId={invoiceId} />
        </div>

        <div className="hidden min-w-0 sm:block">
          <RecordPanel title={t('document.heading')}>
            <InvoiceDocumentPreview invoiceId={invoiceId} active />
          </RecordPanel>
        </div>
      </div>

      {dialog === 'approve' ? (
        <ConfirmActionDialog
          title={t('approveTitle')}
          description={t('approveDescription')}
          confirmLabel={t('approve')}
          isPending={action.isPending}
          errorMessage={errorMessage}
          onConfirm={() => run({ type: 'approve' })}
          onDismiss={close}
        />
      ) : null}

      {dialog === 'issue' ? (
        <PostInvoiceDialog
          mode="issue"
          invoice={data}
          accounts={accounts.data ?? []}
          isPending={action.isPending}
          errorMessage={errorMessage}
          onConfirm={(payload: PostInvoicePayload) => run({ type: 'issue', payload })}
          onDismiss={close}
        />
      ) : null}

      {dialog === 'cancel' ? (
        <ConfirmActionDialog
          title={t('cancelDraft.confirmTitle')}
          description={t('cancelDraft.confirmBody')}
          confirmLabel={t('cancelDraft.confirm')}
          destructive
          reason={{ required: false, maxLength: 500 }}
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? (cancel.error instanceof ApiError ? cancel.error.message : t('cancelDraft.failed')) : undefined}
          onConfirm={(reason) =>
            cancel.mutate({ id: data.id, reason: reason.trim() || undefined }, { onSuccess: () => setDialog(null) })
          }
          onDismiss={close}
        />
      ) : null}

      {dialog === 'post' ? (
        <PostInvoiceDialog
          invoice={data}
          accounts={accounts.data ?? []}
          isPending={action.isPending}
          errorMessage={errorMessage}
          onConfirm={(payload: PostInvoicePayload) => run({ type: 'post', payload })}
          onDismiss={close}
        />
      ) : null}

      {issued && mayManage ? (
        <InvoiceWhatsAppDialog
          open={dialog === 'whatsapp'}
          onClose={() => setDialog(null)}
          invoiceId={invoiceId}
          title={t('whatsappTitle')}
          subtitle={t('whatsappSubtitle', { number: data.invoiceNumber ?? '' })}
          invalidate={[invoiceKeys.all, ['commercial']]}
        />
      ) : null}

      {remindable && mayManage ? (
        <InvoiceReminderDialog
          open={dialog === 'reminder'}
          onClose={() => setDialog(null)}
          invoiceId={invoiceId}
          invoiceNumber={data.invoiceNumber ?? ''}
          outstanding={money(data.outstandingAmount)}
          daysOverdue={daysOverdue(data.dueDate)}
          invalidate={[invoiceKeys.all, ['commercial']]}
        />
      ) : null}

      {dialog === 'reverse' ? (
        <ConfirmActionDialog
          title={t('reverseTitle')}
          description={t('reverseDescription')}
          confirmLabel={t('reverse')}
          reason={{ required: true, label: t('reverseReasonLabel'), maxLength: 500 }}
          isPending={action.isPending}
          errorMessage={errorMessage}
          onConfirm={(reason) =>
            run({
              type: 'reverse',
              payload: { reversalDate: new Date().toISOString().slice(0, 10), reason },
            })
          }
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}

/** ADR-048 — what a hand-typed invoice bills, line by line, with the income account each credits. */
function ManualLinesTable({ invoice, locale }: { invoice: ClientInvoice; locale: 'en' | 'ar' }) {
  const t = useTranslations('accounting.invoices.manual');
  const money = (value: string) => formatMoney(value, invoice.currencyCode, locale) ?? value;
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface" aria-labelledby="manual-lines-detail">
      <h2 id="manual-lines-detail" className="border-b border-border px-4 py-3 text-body font-semibold text-foreground">
        {t('linesTitle')}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-body-sm">
          <thead className="bg-surface-subtle text-caption text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('colDescription')}</th>
              <th scope="col" className="px-4 py-2 text-end font-medium">{t('colQty')}</th>
              <th scope="col" className="px-4 py-2 text-end font-medium">{t('colRate')}</th>
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('colAccount')}</th>
              <th scope="col" className="px-4 py-2 text-end font-medium">{t('colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.lines ?? []).map((line) => (
              <tr key={line.lineNo} className="border-t border-border">
                <td className="px-4 py-2.5">{line.description}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{line.quantity}</td>
                <td className="px-4 py-2.5 text-end tabular-nums">{money(line.unitPrice)}</td>
                <td className="px-4 py-2.5 font-mono text-caption text-muted-foreground">{line.revenueAccountCode}</td>
                <td className="px-4 py-2.5 text-end font-semibold tabular-nums">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * "{Kind} · {reference}" — e.g. "Milestone · Structure", "Separate charge · Temporary site power". Falls
 * back to the bare kind word only for a migration-loaded invoice, which has no reference to show.
 */
function humanSource(
  invoice: ClientInvoice,
  t: ReturnType<typeof useTranslations<'accounting.invoices'>>,
): string {
  const kindText = t(`sourceKind.${invoice.source.kind}`);
  if (!invoice.source.label) return kindText;
  return `${kindText} · ${invoice.source.label}`;
}

/**
 * Two real, server-stamped steps — never a fabricated readiness checklist. Approved and Posted
 * are the only transitions this page's own data can honestly account for; a reversal appends a
 * third step only when one actually happened.
 */
function ApprovalPostingStatus({ data, locale }: { data: ClientInvoice; locale: 'en' | 'ar' }) {
  const t = useTranslations('accounting.invoices.statusList');
  const approved = data.documentStatus !== 'DRAFT';
  const posted = data.postingStatus === 'POSTED';

  return (
    <ul className="flex flex-col gap-2.5">
      <StatusStep
        done={approved}
        label={t('approvedStep')}
        detail={approved ? formatDate(data.approvedAt, locale) : t('approvedPending')}
      />
      <StatusStep
        done={posted}
        label={t('postedStep')}
        detail={posted ? formatDate(data.postedAt, locale) : t('postedPending')}
      />
      {data.reversedAt ? (
        <StatusStep done label={t('reversedStep')} detail={formatDate(data.reversedAt, locale)} />
      ) : null}
    </ul>
  );
}

function StatusStep({
  done,
  label,
  detail,
}: {
  done: boolean;
  label: string;
  detail: string | null;
}) {
  return (
    <li className="flex items-center gap-2.5">
      {done ? (
        <Check size={16} className="shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        className={done ? 'text-body-sm text-foreground' : 'text-body-sm text-muted-foreground'}
      >
        {label}
      </span>
      <span className="text-caption text-muted-foreground">{detail}</span>
    </li>
  );
}

/**
 * Why Post is unavailable, next to where the button would be.
 *
 * An absent button tells the user nothing about what to do next; "approve this invoice first"
 * does. Rendered as text rather than a disabled button because a disabled control with no
 * tooltip is the worst of both.
 */
function BlockedHint({ invoice }: { invoice: ClientInvoice }) {
  const t = useTranslations('accounting.invoices.blocked');
  const reason = invoiceBlockReason(invoice, 'post');

  if (reason === null || reason === 'already-posted') return null;

  return <p className="self-center text-sm text-muted-foreground">{t(reason)}</p>;
}
