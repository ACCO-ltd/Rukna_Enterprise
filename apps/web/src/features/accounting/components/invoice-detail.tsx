'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, Check, Circle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow, RecordHeader, RecordPanel } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { lifecycleErrorKey, toLifecycleError } from '@/features/lifecycle/lifecycle-error';
import { formatDate, formatMoney } from '@/lib/format';

import { useAccounts } from '../hooks/use-accounting';
import { useInvoice, useInvoiceAction } from '../hooks/use-invoices';
import {
  canApprove,
  canPost,
  canReverse,
  invoiceBlockReason,
  invoiceWorkspaceState,
} from '../invoice-actions';
import type { ClientInvoice, PostInvoicePayload } from '../types';
import { InvoiceDocumentPreview, MobileInvoicePreviewTrigger } from './invoice-document-preview';
import { InvoiceStatusBadges } from './invoice-status-badges';
import { PostInvoiceDialog } from './post-invoice-dialog';

type OpenDialog = 'approve' | 'post' | 'reverse' | null;

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('accounting.invoices');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('common.lifecycleErrors');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const searchParams = useSearchParams();

  const invoice = useInvoice(invoiceId);
  const accounts = useAccounts();
  const clients = useClients();
  const action = useInvoiceAction(invoiceId);

  const [dialog, setDialog] = useState<OpenDialog>(null);

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
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  const data = invoice.data;
  const client = (clients.data ?? []).find((c) => c.id === data.clientId);
  const clientName = client ? client.name : null;
  const state = invoiceWorkspaceState(data);
  const money = (value: string | null) => formatMoney(value, data.currencyCode, locale);

  const mayManage = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  const errorMessage = action.isError
    ? tLifecycle(lifecycleErrorKey(toLifecycleError(action.error).kind))
    : undefined;

  const backHref = searchParams.get('from');
  const backLabel = searchParams.get('fromLabel') ?? t('backToInvoices');

  const title =
    state === 'POSTED' ? t('stateTitle.POSTED', { number: data.invoiceNumber ?? t('unnumbered') }) : t(`stateTitle.${state}`);

  const close = () => {
    action.reset();
    setDialog(null);
  };

  const run = (request: Parameters<typeof action.mutate>[0]) => {
    action.mutate(request, { onSuccess: () => setDialog(null) });
  };

  return (
    <div className="space-y-6">
      <RecordHeader
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
        status={<InvoiceStatusBadges documentStatus={data.documentStatus} postingStatus={data.postingStatus} />}
        actions={
          mayManage ? (
            <>
              {canApprove(data) ? (
                <Button onClick={() => setDialog('approve')}>{t('approve')}</Button>
              ) : null}

              {canPost(data) ? (
                <Button onClick={() => setDialog('post')}>{t('postAction')}</Button>
              ) : (
                <BlockedHint invoice={data} />
              )}

              {canReverse(data) ? (
                <Button variant="outline" onClick={() => setDialog('reverse')}>
                  {t('reverse')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {state === 'DRAFT' ? <p className="text-caption text-muted-foreground">{t('approveHint')}</p> : null}
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
              <DefinitionRow label={t('fieldClient')}>{clientName ?? data.clientId.slice(-8)}</DefinitionRow>
              <DefinitionRow label={t('fieldInvoiceDate')}>{formatDate(data.invoiceDate, locale)}</DefinitionRow>
              <DefinitionRow label={t('fieldDueDate')}>{formatDate(data.dueDate, locale)}</DefinitionRow>
              <DefinitionRow label={t('fieldTerms')}>{data.paymentTerms}</DefinitionRow>
            </DefinitionList>
            <DefinitionList className="mt-2 border-t border-border pt-2">
              <DefinitionRow label={t('fieldSubtotal')} numeric>{money(data.subtotal)}</DefinitionRow>
              <DefinitionRow label={t('fieldVat')} numeric>{money(data.vatAmount)}</DefinitionRow>
              <DefinitionRow label={state === 'POSTED' ? t('fieldBalanceDue') : t('fieldDraftTotal')} numeric>
                {money(state === 'POSTED' ? data.outstandingAmount : data.totalAmount)}
              </DefinitionRow>
            </DefinitionList>
          </RecordPanel>

          <RecordPanel title={t('statusList.heading')}>
            <ApprovalPostingStatus data={data} locale={locale} />
          </RecordPanel>

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

/**
 * "{Kind} · {reference}" — e.g. "Milestone · Structure", "Separate charge · shamiito". Falls
 * back to the bare kind word only for a migration-loaded invoice, which has no reference to show.
 */
function humanSource(invoice: ClientInvoice, t: ReturnType<typeof useTranslations<'accounting.invoices'>>): string {
  const kindText = t(`sourceKind.${invoice.source.kind}`);
  if (!invoice.source.label) return kindText;
  return `${kindText} · ${invoice.source.label}`;
}

/**
 * Two real, server-stamped steps — never a fabricated readiness checklist. Approved and Posted
 * are the only transitions this page's own data can honestly account for; a reversal appends a
 * third step only when one actually happened.
 */
function ApprovalPostingStatus({
  data,
  locale,
}: {
  data: ClientInvoice;
  locale: 'en' | 'ar';
}) {
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

function StatusStep({ done, label, detail }: { done: boolean; label: string; detail: string | null }) {
  return (
    <li className="flex items-center gap-2.5">
      {done ? (
        <Check size={16} className="shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={done ? 'text-body-sm text-foreground' : 'text-body-sm text-muted-foreground'}>
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
