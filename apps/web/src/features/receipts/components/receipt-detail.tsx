'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@erp/ui';

import { useClient } from '@/features/clients/hooks/use-client';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { fromMinorUnits, isFullyAllocated, isOverAllocated } from '../allocation';
import { useReceipt } from '../hooks/use-receipts';
import type { ReceiptDetail as ReceiptDetailModel } from '../types';
import { ReceiptAllocationsPanel, receiptTotals } from './receipt-allocations-panel';
import { PostReceiptDialog } from './post-receipt-dialog';

export function ReceiptDetail({ receiptId }: { receiptId: string }) {
  const t = useTranslations('platform.receipts.detail');
  const tPost = useTranslations('platform.receipts.post');
  const tReceipts = useTranslations('platform.receipts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: receipt, isPending, isError, error } = useReceipt(receiptId);
  const [posting, setPosting] = useState(false);

  if (isPending) {
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

  const notPosted = receipt.postingStatus === 'NOT_POSTED';

  return (
    <div className="space-y-8">
      <ReceiptHeader receipt={receipt} locale={locale} />

      {notPosted ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{tPost('title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tPost('intro')}</p>
          </div>
          <Button onClick={() => setPosting(true)}>{tPost('action')}</Button>
        </section>
      ) : (
        <ReceiptAllocationsPanel receipt={receipt} />
      )}

      {receipt.notes ? (
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">{t('notes')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{receipt.notes}</p>
        </section>
      ) : null}

      {posting ? <PostReceiptDialog receipt={receipt} onClose={() => setPosting(false)} /> : null}

      <span className="sr-only">{tReceipts('title')}</span>
    </div>
  );
}

function ReceiptHeader({
  receipt,
  locale,
}: {
  receipt: ReceiptDetailModel;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.receipts.detail');
  const tReceipts = useTranslations('platform.receipts');

  const client = useClient(receipt.clientId);

  const { allocated, remaining } = receiptTotals(receipt);
  const fully = isFullyAllocated(receipt);
  const over = isOverAllocated(receipt);

  const statusTone =
    receipt.postingStatus === 'POSTED'
      ? 'live'
      : receipt.postingStatus === 'REVERSED'
        ? 'danger'
        : 'warning';
  const statusLabel =
    receipt.postingStatus === 'POSTED'
      ? t('statusPosted')
      : receipt.postingStatus === 'REVERSED'
        ? t('statusReversed')
        : t('statusNotPosted');

  return (
    <div>
      <Link
        href="/receipts"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {receipt.reference ?? tReceipts('noReference')}
            </span>
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {over ? <Badge tone="danger">{t('overAllocated')}</Badge> : null}
            {fully ? <Badge tone="live">{t('fullyAllocated')}</Badge> : null}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            <bdi>{formatMoney(receipt.totalAmount, receipt.currencyCode, locale)}</bdi>
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.data ? client.data.name : tReceipts('notSet')}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-4 sm:p-6">
        <Figure label={t('received')} value={formatDate(receipt.receiptDate, locale) ?? ''} />
        <Figure
          label={t('amount')}
          value={<bdi>{formatMoney(receipt.totalAmount, receipt.currencyCode, locale)}</bdi>}
        />
        <Figure
          label={t('allocated')}
          value={<bdi>{formatMoney(fromMinorUnits(allocated), receipt.currencyCode, locale)}</bdi>}
        />
        <Figure
          label={t('unallocated')}
          value={
            <bdi
              className={
                remaining < 0 ? 'text-danger' : remaining > 0 ? 'text-warning' : undefined
              }
            >
              {formatMoney(fromMinorUnits(remaining), receipt.currencyCode, locale)}
            </bdi>
          }
        />
      </dl>

      {over ? (
        <div className="mt-4">
          <Alert variant="error" messages={[t('overAllocatedHint')]} />
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
