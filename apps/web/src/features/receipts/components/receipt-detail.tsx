'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@erp/ui';

import { useClient } from '@/features/clients/hooks/use-client';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { fromMinorUnits, isFullyAllocated } from '../allocation';
import { useReceipt } from '../hooks/use-receipts';
import { ReceiptAllocationsPanel, receiptTotals } from './receipt-allocations-panel';

export function ReceiptDetail({ receiptId }: { receiptId: string }) {
  const t = useTranslations('platform.receipts.detail');
  const tReceipts = useTranslations('platform.receipts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data: receipt, isPending, isError, error } = useReceipt(receiptId);

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

  return (
    <div className="space-y-8">
      <ReceiptHeader receipt={receipt} locale={locale} />
      <ReceiptAllocationsPanel receipt={receipt} />
      {receipt.notes ? (
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">{t('notes')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{receipt.notes}</p>
        </section>
      ) : null}
      <span className="sr-only">{tReceipts('title')}</span>
    </div>
  );
}

function ReceiptHeader({
  receipt,
  locale,
}: {
  receipt: Parameters<typeof receiptTotals>[0];
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.receipts.detail');
  const tReceipts = useTranslations('platform.receipts');

  // The client name is not on the receipt — only `clientId` — so it is fetched. A payment
  // screen that cannot say whose money it is would be unusable.
  const client = useClient(receipt.clientId);

  const { allocated, remaining } = receiptTotals(receipt);
  const fully = isFullyAllocated(receipt.amount, receipt.allocations);

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
            {fully ? <Badge tone="live">{t('fullyAllocated')}</Badge> : null}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            <bdi>{formatMoney(receipt.amount, receipt.currency, locale)}</bdi>
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
          value={<bdi>{formatMoney(receipt.amount, receipt.currency, locale)}</bdi>}
        />
        <Figure
          label={t('allocated')}
          value={<bdi>{formatMoney(fromMinorUnits(allocated), receipt.currency, locale)}</bdi>}
        />
        {/* The figure the whole screen exists to keep honest: what is left of this payment
            to apply. Computed in integer cents from the allocations, never in floats. */}
        <Figure
          label={t('unallocated')}
          value={
            <bdi className={remaining > 0 ? 'text-warning' : undefined}>
              {formatMoney(fromMinorUnits(remaining), receipt.currency, locale)}
            </bdi>
          }
        />
      </dl>
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
