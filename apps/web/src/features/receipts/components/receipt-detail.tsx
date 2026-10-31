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
import { useApprovalSettings } from '@/features/accounting/hooks/use-accounting';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useClient } from '@/features/clients/hooks/use-client';
import { MessageHistory } from '@/features/communications/components/message-history';
import { ReceiptWhatsAppDialog } from '@/features/communications/components/receipt-whatsapp-dialog';
import { AttachmentsPanel } from '@/features/finance-attachments/attachments-panel';
import { RefundDialog } from '@/features/refunds/refund-dialog';
import { RefundsPanel } from '@/features/refunds/refunds-panel';
import { useRefunds } from '@/features/refunds/refunds';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { receiptKeys, useCancelReceipt, useOpenReceiptDocument, useReceipt, useReverseReceipt } from '../hooks/use-receipts';
import { isReceiptPaymentMethod, PROOF_FIELDS } from '../payment-methods';
import { RECEIPT_LIST_STATE_TONE, receiptListState } from '../receipt-list-state';
import { PostReceiptDialog } from './post-receipt-dialog';
import { ApplyOnAccountDialog, ReceiptAllocationsPanel } from './receipt-allocations-panel';

type Dialog = 'post' | 'apply' | 'refund' | 'whatsapp' | 'reverse' | 'cancel' | null;

export function ReceiptDetail({ receiptId }: { receiptId: string }) {
  const t = useTranslations('platform.receipts.detail');
  const tReceipts = useTranslations('platform.receipts');
  const tMethod = useTranslations('platform.receipts.method');
  const tProof = useTranslations('platform.receipts.proof');
  const tProvider = useTranslations('platform.receipts.provider');
  const tCard = useTranslations('platform.receipts.cardType');
  const proofFailed = useSearchParams()?.get('proof') === 'failed';
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: receipt, isPending, isError, error } = useReceipt(receiptId);
  const client = useClient(receipt?.clientId ?? '');
  const [dialog, setDialog] = useState<Dialog>(null);
  const live = receipt?.postingStatus === 'POSTED' || receipt?.postingStatus === 'REVERSED';
  const refunds = useRefunds(receiptId, live);
  const approvalSettings = useApprovalSettings();
  const reverse = useReverseReceipt(receiptId, receipt?.receiptDate);
  const cancel = useCancelReceipt(receiptId);
  const openDocument = useOpenReceiptDocument();
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageReceivables);

  const cancelled = receipt?.documentStatus === 'CANCELLED';
  const onHand = receipt ? receiptListState(receipt) === 'CHEQUE_ON_HAND' : false;
  const title = receipt?.receiptNumber ?? (cancelled ? t('cancelledTitle') : onHand ? t('onHandTitle') : t('notPostedTitle'));
  useModuleTrail(receipt ? title : undefined);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/receipts">{t('back')}</Link>
        </Button>
      </div>
    );
  }

  const money = (value: string | number) => formatMoney(String(value), receipt.currencyCode, locale);
  const fromMinor = (minor: number) => money((minor / 10 ** MONEY_SCALE).toFixed(MONEY_SCALE));
  const totalMinor = toMinorUnits(receipt.totalAmount, MONEY_SCALE);
  const refundedMinor = toMinorUnits(receipt.refundedAmount ?? '0', MONEY_SCALE);
  const onAccountMinor = toMinorUnits(receipt.unallocatedAmount, MONEY_SCALE);
  const appliedMinor = totalMinor - refundedMinor - onAccountMinor;

  const state = receiptListState(receipt);
  const notPosted = receipt.postingStatus === 'NOT_POSTED' && !cancelled;
  const posted = receipt.postingStatus === 'POSTED';
  // Same eligibility as the API: only a POSTED, numbered receipt has a PDF and can be sent.
  const issued = posted && Boolean(receipt.receiptNumber);
  const method = isReceiptPaymentMethod(receipt.paymentMethod) ? tMethod(receipt.paymentMethod) : receipt.paymentMethod;
  const clientName = client.data?.name ?? tReceipts('notSet');

  const primary = !mayManage ? null : notPosted ? (
    <Button onClick={() => setDialog('post')}>{onHand ? t('depositAction') : t('postAction')}</Button>
  ) : posted && onAccountMinor > 0 ? (
    <Button onClick={() => setDialog('apply')}>{t('applyAction')}</Button>
  ) : null;

  const moreItems: { key: Exclude<Dialog, null>; label: string; danger?: boolean }[] = mayManage
    ? [
        ...(issued ? [{ key: 'whatsapp' as const, label: t('sendWhatsApp') }] : []),
        ...(issued && onAccountMinor > 0 ? [{ key: 'refund' as const, label: t('refundAction') }] : []),
        ...(posted ? [{ key: 'reverse' as const, label: t('reverse.action'), danger: true }] : []),
        ...(notPosted ? [{ key: 'cancel' as const, label: t('cancel.action'), danger: true }] : []),
      ]
    : [];

  return (
    <div className="space-y-6">
      <RecordLayout
        header={
          <RecordHeader
            headingLevel="h2"
            breadcrumb={
              <Link
                href="/receipts"
                className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                {t('back')}
              </Link>
            }
            title={<span className={cn(receipt.receiptNumber && 'font-mono')}>{title}</span>}
            statusPlacement="title"
            status={<StatusPill tone={RECEIPT_LIST_STATE_TONE[state]}>{tReceipts(`listState.${state}`)}</StatusPill>}
            meta={
              <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
                <span className="font-medium text-foreground">{clientName}</span>
                <span>· {formatDate(receipt.receiptDate, locale)}</span>
                {method ? <span>· {method}</span> : null}
              </span>
            }
            figure={{ label: t('amountReceived'), value: <span className="tabular-nums">{money(receipt.totalAmount)}</span> }}
            actions={
              <>
                {primary}
                {issued && mayManage ? (
                  <Button variant="outline" onClick={() => openDocument.mutate(receipt.id)} disabled={openDocument.isPending}>
                    <Download size={16} aria-hidden="true" />
                    {t('pdf')}
                  </Button>
                ) : null}
                {moreItems.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        {t('more')}
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {moreItems.map((item, i) => (
                        <Fragment key={item.key}>
                          {item.danger && i > 0 && !moreItems[i - 1]!.danger ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem className={cn(item.danger && 'text-danger')} onSelect={() => setDialog(item.key)}>
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
            {openDocument.isError ? <Alert variant="error" messages={[t('downloadFailed')]} /> : null}
            {proofFailed ? <Alert variant="warning" messages={[t('proofFailed')]} /> : null}
            {receipt.postingStatus === 'REVERSED' ? (
              <Alert
                variant="info"
                messages={[
                  receipt.reversalReason
                    ? t('reverse.reversedBecause', { date: formatDate(receipt.reversedAt ?? null, locale) ?? '', reason: receipt.reversalReason })
                    : t('reverse.reversedOn', { date: formatDate(receipt.reversedAt ?? null, locale) ?? '' }),
                ]}
              />
            ) : null}
            {cancelled ? (
              <Alert variant="info" messages={[t('cancel.cancelledBecause', { reason: receipt.cancellationReason ?? '—' })]} />
            ) : null}
          </>
        }
        rail={
          <>
            <RecordPanel title={t('balanceTitle')}>
              <dl className="space-y-2 text-body-sm">
                <Row label={t('amountReceived')} value={money(receipt.totalAmount)} />
                {live ? (
                  <>
                    <Row label={t('applied')} value={`−${fromMinor(Math.max(appliedMinor, 0))}`} muted={appliedMinor <= 0} />
                    {refundedMinor > 0 ? <Row label={t('refunded')} value={`−${fromMinor(refundedMinor)}`} /> : null}
                  </>
                ) : null}
                {/* Nothing is held for the client until the receipt posts (a cheque on hand, a draft). */}
                <div className="flex items-baseline justify-between border-t border-border pt-2 text-body font-semibold">
                  <dt>{t('onAccount')}</dt>
                  <dd className={cn('tabular-nums', posted && onAccountMinor > 0 && 'text-warning')}>
                    {posted ? fromMinor(onAccountMinor) : '—'}
                  </dd>
                </div>
              </dl>
            </RecordPanel>

            <RecordPanel title={t('activityTitle')}>
              <ul className="space-y-2 text-body-sm">
                <Activity label={t('recorded')} date={formatDate(receipt.createdAt, locale)} />
                {receipt.postedAt ? <Activity label={t('posted')} date={formatDate(receipt.postedAt, locale)} /> : null}
                {receipt.reversedAt ? <Activity label={t('reversed')} date={formatDate(receipt.reversedAt, locale)} /> : null}
                {receipt.cancelledAt ? <Activity label={t('cancelled')} date={formatDate(receipt.cancelledAt, locale)} /> : null}
              </ul>
              {mayManage && live ? (
                <div className="mt-4">
                  <MessageHistory
                    resourceType="payment_receipt"
                    resourceId={receipt.id}
                    canResolve
                    hideWhenEmpty
                    showTitle={false}
                    invalidateOnResolve={[receiptKeys.detail(receipt.id)]}
                  />
                </div>
              ) : null}
            </RecordPanel>
          </>
        }
      >
        <RecordPanel title={t('detailsTitle')}>
          <dl className="grid gap-x-8 gap-y-4 text-body-sm sm:grid-cols-2">
            <Field label={t('receivedFrom')} value={clientName} />
            <Field label={t('dateReceived')} value={formatDate(receipt.receiptDate, locale) ?? '—'} />
            <Field
              label={t('receivedInto')}
              value={receipt.bankAccount ? `${receipt.bankAccount.bankName} · ${receipt.bankAccount.accountName}` : '—'}
            />
            <Field label={t('method')} value={method ?? '—'} />
            {isReceiptPaymentMethod(receipt.paymentMethod)
              ? PROOF_FIELDS[receipt.paymentMethod]
                  .filter(({ field }) => receipt[field])
                  .map(({ field, input }) => {
                    const raw = receipt[field]!;
                    const value =
                      input === 'date'
                        ? (formatDate(raw, locale) ?? raw)
                        : input === 'provider'
                          ? tProvider(raw as never)
                          : input === 'card'
                            ? tCard(raw as never)
                            : input === 'last4'
                              ? `•••• ${raw}`
                              : raw;
                    return (
                      <Field
                        key={field}
                        label={tProof(`${receipt.paymentMethod}.${field}` as never)}
                        value={value}
                        mono={field === 'instrumentNumber'}
                      />
                    );
                  })
              : null}
            {receipt.reference ? <Field label={t('reference')} value={receipt.reference} mono /> : null}
            {!receipt.instrumentNumber && !receipt.reference ? <Field label={t('reference')} value={t('noProof')} /> : null}
            {receipt.notes ? <Field label={t('notes')} value={receipt.notes} wide /> : null}
          </dl>
        </RecordPanel>

        {live ? <ReceiptAllocationsPanel receipt={receipt} canManage={mayManage} /> : null}

        <RefundsPanel receiptId={receipt.id} refunds={refunds.data ?? []} canManage={mayManage} />

        <AttachmentsPanel kind="RECEIPT" ownerId={receipt.id} />
      </RecordLayout>

      {dialog === 'post' ? <PostReceiptDialog receipt={receipt} onClose={() => setDialog(null)} /> : null}
      {dialog === 'apply' ? <ApplyOnAccountDialog receipt={receipt} onClose={() => setDialog(null)} /> : null}

      {issued && mayManage ? (
        <RefundDialog
          open={dialog === 'refund'}
          onOpenChange={(open) => setDialog(open ? 'refund' : null)}
          receiptId={receipt.id}
          onAccount={receipt.unallocatedAmount}
          currencyCode={receipt.currencyCode}
          approvedUpTo={approvalSettings.data?.paymentAutoApproveUpTo ?? null}
        />
      ) : null}

      {issued && mayManage ? (
        <ReceiptWhatsAppDialog
          open={dialog === 'whatsapp'}
          onClose={() => setDialog(null)}
          receiptId={receipt.id}
          title={t('whatsappTitle')}
          subtitle={t('whatsappSubtitle', { number: title })}
          blockedText={{ NOT_POSTED: t('blockedNotPosted'), REVERSED: t('blockedReversed') }}
          invalidate={[receiptKeys.detail(receipt.id)]}
        />
      ) : null}

      {dialog === 'reverse' ? (
        <ConfirmActionDialog
          title={t('reverse.title', { number: title })}
          description={t('reverse.body')}
          confirmLabel={t('reverse.action')}
          reason={{ required: true, label: t('reverse.reasonLabel'), maxLength: 500 }}
          destructive
          isPending={reverse.isPending}
          errorMessage={reverse.isError ? (reverse.error instanceof ApiError ? reverse.error.message : t('reverse.failed')) : undefined}
          onConfirm={(reason) => reverse.mutate(reason, { onSuccess: () => setDialog(null) })}
          onDismiss={() => {
            reverse.reset();
            setDialog(null);
          }}
        />
      ) : null}

      {dialog === 'cancel' ? (
        <ConfirmActionDialog
          title={t('cancel.title')}
          description={t('cancel.body')}
          confirmLabel={t('cancel.confirm')}
          reason={{ required: true, label: t('cancel.reasonLabel'), maxLength: 500 }}
          destructive
          isPending={cancel.isPending}
          errorMessage={cancel.isError ? (cancel.error instanceof ApiError ? cancel.error.message : t('cancel.failed')) : undefined}
          onConfirm={(reason) => cancel.mutate(reason, { onSuccess: () => setDialog(null) })}
          onDismiss={() => {
            cancel.reset();
            setDialog(null);
          }}
        />
      ) : null}
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

function Field({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn(wide && 'sm:col-span-2')}>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 whitespace-pre-line text-foreground', mono && 'font-mono')}>{value}</dd>
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
