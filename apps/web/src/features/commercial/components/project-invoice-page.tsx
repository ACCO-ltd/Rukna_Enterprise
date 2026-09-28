'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DocumentActionBar,
  DocumentIdentity,
  EmptyState,
  LifecycleStepper,
  MoneyDisplay,
  Notice,
  SkeletonRecord,
  SummaryRail,
  type DocumentCommand,
} from '@erp/ui';
import type { CommercialInvoiceDocumentResponse } from '@erp/types';
import { ArrowLeft } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PostingStatus, StatusBadge } from '@/components/status-badge';
import { useAccountingReadiness, useLedgerBlocked } from '@/features/finance/hooks/use-accounting-readiness';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { getIssuedInvoiceDocument } from '../api/commercial-api';
import { useCommercialBilling } from '../hooks/use-commercial';
import {
  useDeleteDraftInvoice,
  useInvoiceDocument,
  useIssueInvoice,
} from '../hooks/use-commercial-invoice';
import { toClientReceivableView } from '../lib/collection-view-model';
import { CreditNoteDialog } from './credit-note-dialog';
import { InvoiceCollectionDialogs, type CollectionDialogKind } from './invoice-collection-dialogs';
import { InvoiceEditDraftDialog } from './invoice-edit-draft-dialog';
import { InvoicePaper } from './invoice-paper';
import { RecordPaymentDrawer } from './record-payment-drawer';
import { SendInvoiceDialog } from './send-invoice-dialog';

type Pending = 'issue' | 'send' | 'payment' | 'edit' | 'delete' | 'credit' | CollectionDialogKind | null;

const LIFECYCLE_STEPS = ['DRAFT', 'ISSUED', 'SENT', 'PAID'] as const;

/**
 * A client invoice inside the project's Commercial tab (commercial-tab redesign §3): the
 * DocumentActionBar with the one command valid for this state, the lifecycle, the invoice drawn
 * on paper, and a summary rail.
 *
 *  - Draft  → Issue invoice (approve + number + post in one command, decision D1)
 *  - Issued → Send to client (installment invoices — delivery is recorded per stage package)
 *  - Sent   → Record payment
 *
 * Commands render from the server's `capabilities`; an unavailable one is not rendered and a
 * blocked Issue (accounting setup unfinished) is explained in words, never greyed out.
 */
export function ProjectInvoicePage({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const t = useTranslations('commercial.invoicePage');
  const query = useInvoiceDocument(projectId, invoiceId);
  const billingHref = `/projects/${projectId}/commercial/billing`;

  const back = (
    <Button asChild variant="ghost" className="gap-1.5 px-2">
      <Link href={billingHref}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('back')}
      </Link>
    </Button>
  );

  if (query.isPending) {
    return (
      <div className="space-y-6">
        {back}
        <SkeletonRecord label={t('loading')} />
      </div>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <EmptyState
            title={t('notFoundTitle')}
            description={t('notFoundBody')}
            action={
              <Button asChild variant="outline">
                <Link href={billingHref}>{t('back')}</Link>
              </Button>
            }
          />
        ) : (
          <Alert
            variant="error"
            title={t('loadFailed')}
            messages={query.error.message ? [query.error.message] : undefined}
          />
        )}
      </div>
    );
  }

  return <InvoiceDocumentView projectId={projectId} document={query.data} back={back} />;
}

function InvoiceDocumentView({
  projectId,
  document,
  back,
}: {
  projectId: string;
  document: CommercialInvoiceDocumentResponse;
  back: React.ReactNode;
}) {
  const t = useTranslations('commercial.invoicePage');
  const tDoc = useTranslations('accounting.invoices.docStatus');
  const tPosting = useTranslations('accounting.invoices.postingStatus');
  const locale = useLocale() as 'en';
  const router = useRouter();

  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const ledgerBlocked = useLedgerBlocked();
  const issue = useIssueInvoice(projectId, document.id);
  const remove = useDeleteDraftInvoice(projectId, document.id);

  const caps = document.capabilities;
  const lifecycle = document.lifecycle;
  const hidden = !document.financialsVisible;
  const installmentId =
    document.source.kind === 'INSTALLMENT' && document.source.id ? document.source.id : null;

  const canIssue = lifecycle === 'DRAFT' && caps.canIssue && !ledgerBlocked;
  const issueBlockedBySetup = lifecycle === 'DRAFT' && caps.canIssue && ledgerBlocked;
  // Delivery is recorded per stage package, keyed by the installment. A separate charge has no
  // delivery route, so it is never offered Send.
  const canSend = caps.canSend && installmentId !== null && (lifecycle === 'ISSUED' || lifecycle === 'SENT');
  // A payment posts a receipt, so it waits for the ledger just like Issue (hidden, and said why).
  const payable = caps.canRecordPayment && (lifecycle === 'ISSUED' || lifecycle === 'SENT');
  const canPay = payable && !ledgerBlocked;
  const paymentBlockedBySetup = payable && ledgerBlocked;

  const primary: 'issue' | 'send' | 'payment' | null =
    canIssue ? 'issue' : lifecycle === 'ISSUED' && canSend ? 'send' : canPay ? 'payment' : null;

  // Collection tools (follow-up, promise, dispute, history) belong to issued invoices only, for a
  // viewer who may bill or collect on this contract.
  const isIssued = lifecycle === 'ISSUED' || lifecycle === 'SENT' || lifecycle === 'PAID';
  const collects = isIssued && (caps.canSend || caps.canRecordPayment);
  const hasBalance =
    document.settlementStatus === 'UNPAID' || document.settlementStatus === 'PARTIALLY_PAID';
  const chasing = collects && hasBalance && lifecycle !== 'PAID';

  const primaryLabel: Record<'issue' | 'send' | 'payment', string> = {
    issue: t('issue'),
    send: t('send'),
    payment: t('recordPayment'),
  };

  async function downloadPdf() {
    setActionError(null);
    // Opened on the click so the browser does not treat it as a pop-up, then pointed at the
    // short-lived signed URL.
    const tab = window.open('', '_blank');
    try {
      const { url } = await getIssuedInvoiceDocument(document.id);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      setActionError(err instanceof Error && err.message ? err.message : t('pdfFailed'));
    }
  }

  const commands: DocumentCommand[] = [
    ...(caps.canDownloadPdf ? [{ key: 'pdf', label: t('downloadPdf'), onSelect: () => void downloadPdf() }] : []),
    ...(lifecycle === 'DRAFT' && caps.canEditDraft
      ? [{ key: 'edit', label: t('editDraft'), onSelect: () => setPending('edit') }]
      : []),
    ...(canSend && primary !== 'send'
      ? [{ key: 'send', label: t('sendAgain'), onSelect: () => setPending('send') }]
      : []),
    ...(canPay && primary !== 'payment'
      ? [{ key: 'payment', label: t('recordPayment'), onSelect: () => setPending('payment') }]
      : []),
    ...(chasing
      ? [
          { key: 'followup', label: t('followUpMenu'), onSelect: () => setPending('followup') },
          { key: 'promise', label: t('promiseMenu'), onSelect: () => setPending('promise') },
          { key: 'dispute', label: t('disputeMenu'), onSelect: () => setPending('dispute') },
        ]
      : []),
    ...(collects ? [{ key: 'history', label: t('history'), onSelect: () => setPending('history') }] : []),
    ...(caps.canIssueCreditNote && lifecycle !== 'DRAFT' && lifecycle !== 'CANCELLED'
      ? [{ key: 'credit', label: t('creditNoteMenu'), onSelect: () => setPending('credit') }]
      : []),
    ...(lifecycle === 'DRAFT' && caps.canDeleteDraft
      ? [{ key: 'delete', label: t('deleteDraftMenu'), onSelect: () => setPending('delete'), destructive: true }]
      : []),
  ];

  const title = document.invoiceNumber ?? t('draftTitle');
  const created = formatDate(document.createdAt, locale) ?? '';
  const subtitle = [
    document.billTo.name,
    document.createdBy
      ? t('createdBy', { date: created, name: document.createdBy })
      : t('created', { date: created }),
  ].join(' · ');

  const sourceHref =
    document.source.kind === 'IPC'
      ? `/projects/${projectId}/commercial/applications`
      : document.source.kind === 'NONE'
        ? null
        : `/projects/${projectId}/commercial/contract`;
  const sourceText = document.source.label ?? t(`sourceKind.${document.source.kind}`);

  const money = (value: string | null) => (
    <MoneyDisplay value={value} hidden={hidden} hiddenLabel={t('hiddenAmount')} />
  );

  return (
    <>
      <DocumentActionBar
        back={back}
        primary={
          primary ? (
            <Button onClick={() => setPending(primary)}>{primaryLabel[primary]}</Button>
          ) : null
        }
        commands={commands}
        moreLabel={t('more')}
        lifecycle={
          <LifecycleStepper
            steps={LIFECYCLE_STEPS.map((key) => ({ key, label: t(`lifecycle.${key}`) }))}
            current={lifecycle === 'CANCELLED' ? 'DRAFT' : lifecycle}
            terminal={
              lifecycle === 'CANCELLED' ? { label: t('lifecycle.CANCELLED'), tone: 'historical' } : undefined
            }
            stepOfLabel={(n, total) => t('stepOf', { n, total })}
          />
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <DocumentIdentity
            eyebrow={t('eyebrow')}
            title={title}
            subtitle={subtitle}
            axes={[
              {
                label: t('axisDocument'),
                value: (
                  <StatusBadge
                    vocabulary="clientInvoice"
                    status={document.documentStatus}
                    label={tDoc(document.documentStatus)}
                  />
                ),
              },
              {
                label: t('axisPosting'),
                value: <PostingStatus status={document.postingStatus} label={tPosting(document.postingStatus)} />,
              },
            ]}
            className="mb-0"
          />

          {actionError ? <Alert variant="error" messages={[actionError]} /> : null}

          {issueBlockedBySetup ? <SetupBlockedNotice step="issue" /> : null}
          {paymentBlockedBySetup ? <SetupBlockedNotice step="payment" /> : null}

          {lifecycle === 'DRAFT' && !issueBlockedBySetup && caps.canIssue ? (
            <p className="text-body-sm text-muted-foreground">{t('draftExplainer')}</p>
          ) : null}

          <InvoicePaper document={document} />
        </div>

        <div className="lg:pt-1">
          <SummaryRail
            title={t('summary')}
            rows={[
              {
                label: t('source'),
                value: sourceHref ? (
                  <Link href={sourceHref} className="text-brand-primary underline-offset-4 hover:underline">
                    {sourceText}
                  </Link>
                ) : (
                  sourceText
                ),
              },
              { label: t('total'), value: money(document.total) },
              { label: t('balanceDue'), value: money(document.balanceDue) },
              {
                label: t('dueDate'),
                value:
                  formatDate(document.dueDate, locale) ??
                  (document.paymentTermsDays !== null
                    ? t('netDays', { days: document.paymentTermsDays })
                    : t('notSet')),
              },
              {
                label: t('journal'),
                value: document.journalEntryId ? (
                  <Link
                    href={`/finance/accounting/journals/${document.journalEntryId}`}
                    className="text-brand-primary underline-offset-4 hover:underline"
                  >
                    {t('viewJournal')}
                  </Link>
                ) : (
                  t('notPosted')
                ),
              },
            ]}
          />
        </div>
      </div>

      {pending === 'issue' ? (
        <ConfirmActionDialog
          title={t('issueTitle')}
          description={t('issueBody')}
          confirmLabel={t('issue')}
          isPending={issue.isPending}
          errorMessage={issue.isError ? issue.error.message || t('issueFailed') : undefined}
          onConfirm={() => issue.mutate(undefined, { onSuccess: () => setPending(null) })}
          onDismiss={() => {
            issue.reset();
            setPending(null);
          }}
        />
      ) : null}

      {pending === 'delete' ? (
        <ConfirmActionDialog
          title={t('deleteTitle')}
          description={t('deleteBody')}
          confirmLabel={t('deleteDraft')}
          destructive
          isPending={remove.isPending}
          errorMessage={remove.isError ? remove.error.message || t('deleteFailed') : undefined}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => router.push(`/projects/${projectId}/commercial/billing`),
            })
          }
          onDismiss={() => {
            remove.reset();
            setPending(null);
          }}
        />
      ) : null}

      {installmentId && canSend ? (
        <SendInvoiceDialog
          open={pending === 'send'}
          onClose={() => setPending(null)}
          projectId={projectId}
          installmentId={installmentId}
          invoiceId={document.id}
          invoiceNumber={document.invoiceNumber}
        />
      ) : null}

      {lifecycle === 'DRAFT' && caps.canEditDraft ? (
        <InvoiceEditDraftDialog
          open={pending === 'edit'}
          onOpenChange={(next) => setPending(next ? 'edit' : null)}
          projectId={projectId}
          invoiceId={document.id}
          dueDate={document.dueDate}
        />
      ) : null}

      {caps.canIssueCreditNote ? (
        <CreditNoteDialog
          open={pending === 'credit'}
          onOpenChange={(next) => setPending(next ? 'credit' : null)}
          projectId={projectId}
          invoiceId={document.id}
          invoiceNumber={document.invoiceNumber}
          balanceDue={hidden ? null : document.balanceDue}
        />
      ) : null}

      {collects &&
      (pending === 'followup' || pending === 'promise' || pending === 'dispute' || pending === 'history') ? (
        <InvoiceCollectionDialogs
          kind={pending}
          projectId={projectId}
          invoiceId={document.id}
          onClose={() => setPending(null)}
        />
      ) : null}

      {canPay && pending === 'payment' ? (
        <PaymentDialog
          projectId={projectId}
          invoiceId={document.id}
          currency={document.currency}
          onClose={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

/** Record payment needs the project's open invoices to split the receipt across. */
function PaymentDialog({
  projectId,
  invoiceId,
  currency,
  onClose,
}: {
  projectId: string;
  invoiceId: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.invoicePage');
  const billing = useCommercialBilling(projectId);

  if (billing.isPending) {
    return (
      <p role="status" className="sr-only">
        {t('loadingInvoices')}
      </p>
    );
  }
  if (billing.isError) {
    return (
      <ConfirmActionDialog
        title={t('recordPayment')}
        description={t('invoicesLoadFailed')}
        confirmLabel={t('retry')}
        isPending={false}
        onConfirm={() => void billing.refetch()}
        onDismiss={onClose}
      />
    );
  }

  // D5: one overdue rule on the server clock — the billing read model's asOf, never the browser's date.
  const today = billing.data.asOf.slice(0, 10);
  const invoices = billing.data.invoices.map((row) => toClientReceivableView(row, today));
  const preselected = invoices.find((invoice) => invoice.invoiceId === invoiceId) ?? null;

  return (
    <RecordPaymentDrawer
      open
      onOpenChange={(next) => (!next ? onClose() : undefined)}
      projectId={projectId}
      currency={billing.data.currency ?? currency}
      preselectedInvoice={preselected}
      allInvoices={invoices}
    />
  );
}

/** Issue is hidden while the ledger cannot post; this says why and where to fix it. */
function SetupBlockedNotice({ step }: { step: 'issue' | 'payment' }) {
  const t = useTranslations('commercial.invoicePage');
  const readiness = useAccountingReadiness();
  const first = readiness.data?.blockers[0]?.code;
  const href =
    first === 'NO_OPEN_PERIOD' ? '/finance/accounting/periods' : '/finance/accounting/chart-of-accounts';
  return (
    <Notice
      tone="attention"
      title={step === 'issue' ? t('setupBlockedTitle') : t('paymentBlockedTitle')}
      action={
        <Button asChild variant="outline">
          <Link href={href}>{t('setupBlockedAction')}</Link>
        </Button>
      }
    >
      {step === 'issue' ? t('setupBlockedBody') : t('paymentBlockedBody')}
    </Notice>
  );
}
