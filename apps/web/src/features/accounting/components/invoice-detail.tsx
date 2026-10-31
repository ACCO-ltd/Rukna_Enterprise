'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronLeft, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  cn,
  DocumentPaper,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  StatusPill,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
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
import { useAccounts, useApprovalSettings } from '../hooks/use-accounting';
import {
  invoiceKeys,
  useCancelInvoice,
  useIncomeAccounts,
  useInvoice,
  useInvoiceAction,
  useInvoiceCreditNotes,
  useOpenInvoiceDocument,
} from '../hooks/use-invoices';
import { CreditNoteDialog } from '@/features/commercial/components/credit-note-dialog';
import { WriteOffDialog } from '@/features/write-offs/write-off-dialog';
import { WriteOffsPanel } from '@/features/write-offs/write-offs-panel';
import { useWriteOffs } from '@/features/write-offs/hooks';
import { InvoiceCreditNotes } from '@/features/commercial/components/invoice-credit-notes';
import { canIssue, canPost, canReverse, invoiceBlockReason, recordPaymentHref } from '../invoice-actions';
import { invoiceDocumentModel, invoiceSettlement } from '../invoice-document-model';
import { daysLate, INVOICE_LIST_STATE_TONE, invoiceListState } from '../invoice-list-state';
import { todayWireDate } from '../invoice-overdue';
import type { ClientInvoice, PostInvoicePayload } from '../types';
import { InvoiceDocumentPreview } from './invoice-document-preview';
import { PostInvoiceDialog } from './post-invoice-dialog';
import { LoadError } from '@/components/load-error';
import { useSession } from '@/features/auth/session/use-session';
import { fromMinorUnits, MONEY_SCALE, toMinorUnits } from '@/lib/money';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';

/** An invoice's messages: the invoice sends and its reminders (ADR-042). */
const INVOICE_MESSAGE_TYPES = ['client_invoice', 'client_invoice_reminder'] as const;

type OpenDialog = 'issue' | 'approve' | 'post' | 'reverse' | 'cancel' | 'whatsapp' | 'reminder' | null;

/**
 * A client invoice: the document as the client reads it, what has settled it, and the one action
 * its state calls for (Issue a draft, Record payment on an open invoice). Everything else sits in
 * More. The balance is broken down by kind — paid, credited, written off — so the page reconciles
 * on its face (CI-3).
 */
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
  const td = useTranslations('accounting.invoices.detail');
  const tCommon = useTranslations('common');
  const tWriteOff = useTranslations('accounting.writeOff');
  const tLifecycle = useTranslations('common.lifecycleErrors');
  const tReminder = useTranslations('common.messaging.reminder');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const ledgerBlocked = useLedgerBlocked();
  const searchParams = useSearchParams();

  const invoice = useInvoice(invoiceId);
  const accounts = useAccounts();
  const incomeAccounts = useIncomeAccounts();
  const clients = useClients();
  const projects = useProjects();
  const action = useInvoiceAction(invoiceId);
  const cancel = useCancelInvoice();
  const openDocument = useOpenInvoiceDocument();
  const approvalSettings = useApprovalSettings();
  const { user } = useSession();

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [view, setView] = useState<'invoice' | 'pdf'>('invoice');
  // "Save and issue" on the sale form lands here with `?issue=1`: open Issue once, where offered.
  const [autoIssue, setAutoIssue] = useState(searchParams.get('issue') === '1');
  const live = invoice.data?.postingStatus === 'POSTED' || invoice.data?.postingStatus === 'OPENING_BALANCE';
  const writeOffs = useWriteOffs(invoiceId, live);
  const creditNotes = useInvoiceCreditNotes(invoiceId, invoice.data?.postingStatus === 'POSTED' || invoice.data?.postingStatus === 'REVERSED');

  useModuleTrail(invoice.data ? (invoice.data.invoiceNumber ?? t('unnumbered')) : undefined);

  if (invoice.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
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
  const today = todayWireDate();
  const client = (clients.data ?? []).find((c) => c.id === data.clientId);
  const clientName = client?.name ?? data.billingAddressSnapshot?.client?.name ?? data.clientId.slice(-8);
  const project = data.projectId ? (projects.data ?? []).find((p) => p.id === data.projectId) : undefined;
  const listState = invoiceListState(data, today);
  const late = daysLate(data, today);
  const money = (value: string | null) => formatMoney(value, data.currencyCode, locale);
  const moneyMinor = (minor: number) => money(fromMinorUnits(minor, MONEY_SCALE)) ?? '—';
  const settlement = invoiceSettlement(data);

  const mayManage = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  // ADR-046 §8 — at or above the organisation's amount, a draft waits for a second person.
  const approvalAbove = approvalSettings.data?.invoiceApprovalAbove ?? null;
  const needsApproval =
    approvalAbove !== null && toMinorUnits(data.totalAmount, MONEY_SCALE) >= toMinorUnits(approvalAbove, MONEY_SCALE);
  // ADR-042 — an issued invoice (numbered, posted, not cancelled) can be sent on WhatsApp.
  const issued = data.postingStatus === 'POSTED' && data.documentStatus !== 'CANCELLED' && Boolean(data.invoiceNumber);
  const owes = settlement.live && settlement.balanceMinor > 0;
  const remindable = canSendReminder(data);
  // AR-1 — a posted invoice with a balance can be credited (the server caps it at the balance).
  const canCredit = issued && owes;
  // AR-4 — an issued invoice or an opening balance that still owes can be written off.
  const canWriteOff = owes;
  const canCancelDraft =
    data.documentStatus !== 'CANCELLED' && data.postingStatus === 'NOT_POSTED' && data.source?.kind !== 'INSTALLMENT';
  const errorMessage = action.isError ? tLifecycle(lifecycleErrorKey(toLifecycleError(action.error).kind)) : undefined;

  // `from` is only followed when it is a same-origin path — never `//host` or an absolute URL.
  const fromParam = searchParams.get('from');
  const safeFrom = fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : null;
  const backHref = back?.href ?? safeFrom;
  const backLabel = back?.label ?? searchParams.get('fromLabel') ?? t('backToInvoices');

  const close = () => {
    action.reset();
    cancel.reset();
    setDialog(null);
  };
  const run = (request: Parameters<typeof action.mutate>[0]) => {
    action.mutate(request, { onSuccess: () => setDialog(null) });
  };
  const downloadPdf = () => openDocument.mutate(data.id);

  // ── The one primary action for this state ────────────────────────────────────────────────
  const primary = (() => {
    if (!mayManage) return null;
    if (canIssue(data) && !ledgerBlocked && !needsApproval)
      return <Button onClick={() => setDialog('issue')}>{t('issueAction')}</Button>;
    if (canIssue(data) && needsApproval && user?.id !== data.createdBy)
      return <Button onClick={() => setDialog('approve')}>{t('approve')}</Button>;
    if (canPost(data) && !ledgerBlocked) return <Button onClick={() => setDialog('post')}>{t('postAction')}</Button>;
    if (owes)
      return (
        <Button asChild>
          <Link href={recordPaymentHref(data)}>{td('recordPayment')}</Link>
        </Button>
      );
    return null;
  })();

  const issueOffered = mayManage && canIssue(data) && !ledgerBlocked && !needsApproval;
  if (autoIssue && approvalSettings.isSuccess) {
    setAutoIssue(false);
    if (issueOffered) setDialog('issue');
  }

  const moreItems: { key: string; label: string; onSelect: () => void; danger?: boolean }[] = mayManage
    ? [
        ...(issued ? [{ key: 'whatsapp', label: t('sendWhatsApp'), onSelect: () => setDialog('whatsapp') }] : []),
        ...(remindable ? [{ key: 'reminder', label: tReminder('action'), onSelect: () => setDialog('reminder') }] : []),
        ...(canCredit ? [{ key: 'credit', label: t('creditNote'), onSelect: () => setCreditOpen(true) }] : []),
        ...(canWriteOff ? [{ key: 'writeoff', label: tWriteOff('action'), onSelect: () => setWriteOffOpen(true) }] : []),
        ...(canReverse(data) ? [{ key: 'reverse', label: t('reverse'), onSelect: () => setDialog('reverse'), danger: true }] : []),
        // Step 2g — a stage-plan draft is deleted from the contract's Billing tab instead.
        ...(canCancelDraft ? [{ key: 'cancel', label: t('cancelDraft.action'), onSelect: () => setDialog('cancel'), danger: true }] : []),
      ]
    : [];

  const title = data.invoiceNumber ?? (data.documentStatus === 'CANCELLED' ? td('cancelledTitle') : td('draftTitle'));
  const dueText = data.dueDate
    ? late > 0 && owes
      ? td('dueLate', { date: formatDate(data.dueDate, locale) ?? '', days: late })
      : td('due', { date: formatDate(data.dueDate, locale) ?? '' })
    : null;

  return (
    <div className="space-y-6">
      <RecordLayout
        header={
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
            title={<span className={cn(data.invoiceNumber && 'font-mono')}>{title}</span>}
            statusPlacement="title"
            status={<StatusPill tone={INVOICE_LIST_STATE_TONE[listState]}>{t(`listState.${listState}`)}</StatusPill>}
            meta={
              <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
                <span className="font-medium text-foreground">{clientName}</span>
                {project ? <span>· {project.name}</span> : null}
                {dueText ? <span className={cn(late > 0 && owes && 'font-medium text-danger')}>· {dueText}</span> : null}
              </span>
            }
            figure={
              settlement.live
                ? { label: t('fieldBalanceDue'), value: <span className="tabular-nums">{moneyMinor(settlement.balanceMinor)}</span> }
                : { label: t('fieldDraftTotal'), value: <span className="tabular-nums">{money(data.totalAmount)}</span> }
            }
            actions={
              <>
                {canIssue(data) && needsApproval && user?.id === data.createdBy && mayManage ? (
                  <p className="self-center text-body-sm text-muted-foreground">
                    {t('needsApproval', { amount: money(approvalAbove) ?? '' })}
                  </p>
                ) : null}
                {mayManage && data.isManual && data.documentStatus === 'DRAFT' ? (
                  <Button variant="outline" asChild>
                    <Link href={`/finance/accounting/invoices/${data.id}/edit`}>{t('editDraft')}</Link>
                  </Button>
                ) : null}
                {primary}
                {!primary && mayManage && !canIssue(data) && !canPost(data) ? <BlockedHint invoice={data} /> : null}
                <Button variant="outline" onClick={downloadPdf} disabled={openDocument.isPending}>
                  <Download size={16} aria-hidden="true" />
                  {td('pdf')}
                </Button>
                {moreItems.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        {td('more')}
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {moreItems.map((item, i) => (
                        <Fragment key={item.key}>
                          {item.danger && i > 0 && !moreItems[i - 1]!.danger ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem className={cn(item.danger && 'text-danger')} onSelect={item.onSelect}>
                            {item.label}
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
          <>
            {!live ? <AccountingSetupNotice /> : null}
            {openDocument.isError ? <Alert variant="error" messages={[t('viewDocumentFailed')]} /> : null}
            {action.isError && dialog === null ? <Alert variant="error" messages={[errorMessage ?? t('actionFailed')]} /> : null}
            {data.documentStatus === 'CANCELLED' && data.cancellationReason ? (
              <Alert variant="info" messages={[td('cancelledBecause', { reason: data.cancellationReason })]} />
            ) : null}
          </>
        }
        rail={
          <>
            {settlement.live ? (
              <RecordPanel title={td('balanceTitle')}>
                <dl className="space-y-2 text-body-sm">
                  <Row label={t('fieldTotal')} value={moneyMinor(settlement.totalMinor)} />
                  <Row label={td('paid')} value={`−${moneyMinor(settlement.paidMinor)}`} muted={settlement.paidMinor === 0} />
                  {settlement.creditedMinor > 0 ? <Row label={td('credited')} value={`−${moneyMinor(settlement.creditedMinor)}`} /> : null}
                  {settlement.writtenOffMinor > 0 ? <Row label={td('writtenOff')} value={`−${moneyMinor(settlement.writtenOffMinor)}`} /> : null}
                  <div className="flex items-baseline justify-between border-t border-border pt-2 text-body font-semibold">
                    <dt>{t('fieldBalanceDue')}</dt>
                    <dd className="tabular-nums">{moneyMinor(settlement.balanceMinor)}</dd>
                  </div>
                </dl>
              </RecordPanel>
            ) : null}

            {settlement.live ? (
              <RecordPanel title={td('paymentsTitle')}>
                {(data.payments ?? []).length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">{td('noPayments')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(data.payments ?? []).map((p) => (
                      <li key={p.allocationId} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <Link href={`/receipts/${p.receiptId}`} className="font-mono text-body-sm font-medium text-brand-primary hover:underline">
                            {p.receiptNumber ?? td('receipt')}
                          </Link>
                          <span className="block text-caption text-muted-foreground">
                            {[formatDate(p.receiptDate, locale), p.paymentMethod, p.reference].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-body-sm font-medium tabular-nums">{money(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </RecordPanel>
            ) : null}

            <RecordPanel title={td('detailsTitle')}>
              <dl className="space-y-2 text-body-sm">
                <Row label={t('fieldSource')} value={humanSource(data, t)} />
                <Row label={td('taxRate')} value={data.taxRate != null ? `${formatRatePercent(data.taxRate)}%` : '—'} />
              </dl>
            </RecordPanel>

            <RecordPanel title={td('activityTitle')}>
              <ul className="space-y-2 text-body-sm">
                <Activity label={td('created')} date={formatDate(data.createdAt, locale)} />
                {data.approvedAt ? <Activity label={td('approved')} date={formatDate(data.approvedAt, locale)} /> : null}
                {data.postedAt ? <Activity label={td('issued')} date={formatDate(data.postedAt, locale)} /> : null}
                {data.reversedAt ? <Activity label={td('reversed')} date={formatDate(data.reversedAt, locale)} /> : null}
                {data.cancelledAt ? <Activity label={td('cancelled')} date={formatDate(data.cancelledAt, locale)} /> : null}
              </ul>
              {issued && mayManage ? (
                <div className="mt-4 border-t border-border pt-4">
                  <MessageHistory
                    resourceType={INVOICE_MESSAGE_TYPES}
                    resourceId={invoiceId}
                    canResolve
                    showTitle={false}
                    invalidateOnResolve={[invoiceKeys.all, ['commercial']]}
                  />
                </div>
              ) : null}
            </RecordPanel>
          </>
        }
      >
        <section aria-label={td('documentLabel')} className="space-y-3">
          <div role="tablist" aria-label={td('viewLabel')} className="inline-flex rounded-control border border-border bg-surface p-0.5">
            {(['invoice', 'pdf'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn(
                  'h-9 rounded-[calc(var(--radius-control)-2px)] px-3 text-body-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-primary',
                  view === key ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {td(`view.${key}`)}
              </button>
            ))}
          </div>
          {view === 'invoice' ? (
            <InvoiceSheet
              invoice={data}
              clientName={clientName}
              projectName={project?.name ?? null}
              accountName={(code) => incomeAccounts.data?.find((a) => a.code === code)?.name ?? null}
            />
          ) : (
            <InvoiceDocumentPreview invoiceId={invoiceId} active />
          )}
        </section>

        <InvoiceCreditNotes
          projectId={data.projectId ?? ''}
          invoiceId={data.id}
          creditNotes={creditNotes.data ?? []}
          hidden={false}
          canReverse={mayManage}
        />

        <WriteOffsPanel writeOffs={writeOffs.data ?? []} canManage={mayManage} />

        <AttachmentsPanel kind="INVOICE" ownerId={data.id} />
      </RecordLayout>

      {canWriteOff ? (
        <WriteOffDialog
          open={writeOffOpen}
          onOpenChange={setWriteOffOpen}
          invoiceId={data.id}
          balance={data.outstandingAmount}
          approvalAbove={approvalSettings.data?.writeOffApprovalAbove ?? null}
        />
      ) : null}

      {canCredit ? (
        <CreditNoteDialog
          open={creditOpen}
          onOpenChange={setCreditOpen}
          projectId={data.projectId ?? ''}
          invoiceId={data.id}
          invoiceNumber={data.invoiceNumber}
          balanceDue={data.outstandingAmount}
        />
      ) : null}

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
            run({ type: 'reverse', payload: { reversalDate: new Date().toISOString().slice(0, 10), reason } })
          }
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}

/** The invoice as the client receives it, drawn from the invoice's own figures (CI-3). */
function InvoiceSheet({
  invoice,
  clientName,
  projectName,
  accountName,
}: {
  invoice: ClientInvoice;
  clientName: string;
  projectName: string | null;
  accountName: (code: string) => string | null;
}) {
  const t = useTranslations('accounting.invoices.detail.sheet');
  const locale = useLocale() as 'en';
  const model = invoiceDocumentModel(invoice);
  const settlement = invoiceSettlement(invoice);
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, MONEY_SCALE), invoice.currencyCode, locale) ?? '—';
  const org = invoice.billingAddressSnapshot?.org;
  const billTo = invoice.billingAddressSnapshot?.client;
  const address = [billTo?.address, billTo?.city].filter(Boolean).join('\n') || null;

  const adjustments = (rows: typeof model.lessAfterTax) =>
    rows.map((a) => ({ label: t(`less.${a.kind}`), value: `−${money(a.minor)}` }));

  return (
    <DocumentPaper
      label={t('label')}
      issuer={{
        name: org?.name ?? '',
        address: org?.legalAddress ?? null,
        registration: org?.taxRegistrationNumber ? t('taxRegistration', { number: org.taxRegistrationNumber }) : null,
      }}
      title={t('title')}
      number={invoice.invoiceNumber}
      numberPendingLabel={t('numberPending')}
      billTo={{ label: t('billTo'), name: billTo?.name ?? clientName, address }}
      facts={[
        { label: t('invoiceDate'), value: formatDate(invoice.invoiceDate, locale) ?? '—' },
        { label: t('dueDate'), value: formatDate(invoice.dueDate, locale) ?? '—' },
        ...(invoice.paymentTerms ? [{ label: t('terms'), value: invoice.paymentTerms }] : []),
        ...(invoice.clientReference ? [{ label: t('yourRef'), value: invoice.clientReference }] : []),
        ...(projectName ? [{ label: t('project'), value: projectName }] : []),
      ]}
      columns={{ description: t('description'), amount: t('amount', { currency: invoice.currencyCode }) }}
      lines={model.lines.map((line) => ({
        key: line.key,
        description: line.description,
        detail:
          line.quantity !== null && line.unitPrice !== null
            ? [
                t('qtyRate', {
                  qty: line.quantity,
                  rate: formatMoney(line.unitPrice, invoice.currencyCode, locale) ?? line.unitPrice,
                }),
                line.accountCode ? `${line.accountCode} ${accountName(line.accountCode) ?? ''}`.trim() : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined,
        amount: <span className="tabular-nums">{money(line.amountMinor)}</span>,
      }))}
      totals={[
        ...adjustments(model.lessBeforeTax),
        { label: t('subtotal'), value: money(model.subtotalMinor) },
        ...(model.taxMinor > 0 || invoice.taxRate != null
          ? [
              {
                label: invoice.taxRate != null ? t('taxAt', { rate: formatRatePercent(invoice.taxRate) }) : t('tax'),
                value: money(model.taxMinor),
              },
            ]
          : []),
        ...adjustments(model.lessAfterTax),
      ]}
      total={{ label: t('total'), value: money(model.totalMinor) }}
      note={
        invoice.notes || (settlement.live && settlement.balanceMinor !== settlement.totalMinor) ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {invoice.notes ? (
              <p className="max-w-md whitespace-pre-line text-body-sm text-foreground">{invoice.notes}</p>
            ) : null}
            {settlement.live && settlement.balanceMinor !== settlement.totalMinor ? (
              <dl className="ms-auto w-full max-w-xs space-y-1 text-body-sm">
                {settlement.paidMinor > 0 ? <SheetRow label={t('paid')} value={`−${money(settlement.paidMinor)}`} /> : null}
                {settlement.creditedMinor > 0 ? <SheetRow label={t('credited')} value={`−${money(settlement.creditedMinor)}`} /> : null}
                {settlement.writtenOffMinor > 0 ? <SheetRow label={t('writtenOff')} value={`−${money(settlement.writtenOffMinor)}`} /> : null}
                <div className="flex justify-between border-t border-brand-panel/30 pt-1 font-semibold">
                  <dt>{t('balanceDue')}</dt>
                  <dd className="tabular-nums">{money(settlement.balanceMinor)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : undefined
      }
      watermark={invoice.documentStatus === 'DRAFT' ? t('watermarkDraft') : invoice.documentStatus === 'CANCELLED' || invoice.postingStatus === 'REVERSED' ? t('watermarkVoid') : settlement.live && settlement.balanceMinor === 0 ? t('watermarkPaid') : undefined}
    />
  );
}

function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-end tabular-nums', muted ? 'text-muted-foreground' : 'text-foreground')}>{value}</dd>
    </div>
  );
}

function Activity({ label, date }: { label: string; date: string | null }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-foreground">{label}</span>
      <span className="text-caption text-muted-foreground">{date ?? '—'}</span>
    </li>
  );
}

/**
 * "{Kind} · {reference}" — e.g. "Milestone · Structure", "Separate charge · Temporary site power". Falls
 * back to the bare kind word only for a migration-loaded invoice, which has no reference to show.
 */
function humanSource(invoice: ClientInvoice, t: ReturnType<typeof useTranslations<'accounting.invoices'>>): string {
  const kindText = t(`sourceKind.${invoice.source.kind}`);
  if (!invoice.source.label) return kindText;
  return `${kindText} · ${invoice.source.label}`;
}

/**
 * Why Post is unavailable, next to where the button would be. Text rather than a disabled
 * button: a disabled control with no tooltip tells the reader nothing.
 */
function BlockedHint({ invoice }: { invoice: ClientInvoice }) {
  const t = useTranslations('accounting.invoices.blocked');
  const reason = invoiceBlockReason(invoice, 'post');
  if (reason === null || reason === 'already-posted') return null;
  return <p className="self-center text-sm text-muted-foreground">{t(reason)}</p>;
}
