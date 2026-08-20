'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { lifecycleErrorKey, toLifecycleError } from '@/features/lifecycle/lifecycle-error';
import { formatDate, formatMoney } from '@/lib/format';

import { useAccounts } from '../hooks/use-accounting';
import { useInvoice, useInvoiceAction } from '../hooks/use-invoices';
import { canApprove, canPost, canReverse, invoiceBlockReason } from '../invoice-actions';
import type { ClientInvoice, PostInvoicePayload } from '../types';
import { InvoiceStatusBadges } from './invoice-status-badges';
import { PostInvoiceDialog } from './post-invoice-dialog';

type OpenDialog = 'approve' | 'post' | 'reverse' | null;

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('accounting.invoices');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('common.lifecycleErrors');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

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
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
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

  const mayManage = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  const errorMessage = action.isError
    ? tLifecycle(lifecycleErrorKey(toLifecycleError(action.error).kind))
    : undefined;

  const close = () => {
    action.reset();
    setDialog(null);
  };

  const run = (request: Parameters<typeof action.mutate>[0]) => {
    action.mutate(request, { onSuccess: () => setDialog(null) });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('detailEyebrow')}
          </p>
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            {data.invoiceNumber ?? t('unnumbered')}
          </h1>
          <InvoiceStatusBadges
            documentStatus={data.documentStatus}
            postingStatus={data.postingStatus}
          />
        </div>

        {mayManage ? (
          <div className="flex flex-wrap gap-2">
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
          </div>
        ) : null}
      </header>

      {action.isError && dialog === null ? (
        <Alert variant="error" messages={[errorMessage ?? t('actionFailed')]} />
      ) : null}

      <dl className="grid gap-x-8 gap-y-4 rounded-lg border border-border bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('fieldClient')} value={clientName ?? data.clientId.slice(-8)} />
        <Field label={t('fieldInvoiceDate')} value={formatDate(data.invoiceDate, locale)} />
        <Field label={t('fieldDueDate')} value={formatDate(data.dueDate, locale)} />
        <Field
          label={t('fieldSubtotal')}
          value={formatMoney(data.subtotal, data.currencyCode, locale)}
          numeric
        />
        <Field
          label={t('fieldVat')}
          value={formatMoney(data.vatAmount, data.currencyCode, locale)}
          numeric
        />
        <Field
          label={t('fieldTotal')}
          value={formatMoney(data.totalAmount, data.currencyCode, locale)}
          numeric
        />
        <Field
          label={t('fieldOutstanding')}
          value={formatMoney(data.outstandingAmount, data.currencyCode, locale)}
          numeric
        />
        <Field label={t('fieldTerms')} value={data.paymentTerms} />
        <Field label={t('fieldPostedAt')} value={formatDate(data.postedAt, locale)} />
      </dl>

      {/* The certificate this invoice was raised from. Present on everything except a record
          loaded by the opening-balance migration, which has no IPC behind it.
          Not a link: the certificate route is /contracts/:id/applications/:ipaId/certificates/:ipcId
          and the invoice payload carries no `ipaId`, so the URL cannot be built from here. The
          journey runs the other way — the certificate page links to the invoice. */}
      {data.sourceIpcId ? (
        <p className="text-sm text-muted-foreground">{t('generatedFromCertificate')}</p>
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

function Field({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string | null;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm text-foreground ${numeric ? 'tabular-nums' : ''}`}>
        {value ? <bdi>{value}</bdi> : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
