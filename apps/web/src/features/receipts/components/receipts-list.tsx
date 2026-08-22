'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { useClients } from '@/features/clients/hooks/use-clients';
import { formatDate, formatMoney } from '@/lib/format';

import { useReceipts } from '../hooks/use-receipts';
import type { Receipt } from '../types';

export function ReceiptsList() {
  const t = useTranslations('platform.receipts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [clientId, setClientId] = useState('');
  const [search, setSearch] = useState('');

  // The client filter is applied SERVER-side — `clientId` is the one parameter
  // `GET /receipts` accepts — while the reference search is client-side, since the
  // endpoint offers no text search.
  const { data, isPending, isError, refetch, isFetching } = useReceipts(clientId || undefined);
  const clients = useClients();

  const clientNames = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.id, c.name])),
    [clients.data],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((r) => r.reference?.toLowerCase().includes(needle));
  }, [data, search]);

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
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (data.length === 0 && !clientId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/receipts/new">{t('newReceipt')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const hasFilters = search.trim() !== '' || clientId !== '';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="receipt-search" className="sr-only">
            {t('searchLabel')}
          </Label>
          <Input
            id="receipt-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <Label htmlFor="receipt-client" className="sr-only">
            {t('filterByClient')}
          </Label>
          <Select
            id="receipt-client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
            }}
          >
            <option value="">{t('allClients')}</option>
            {(clients.data ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('countLabel', { count: visible.length })}
      </p>

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.date')}</TableHead>
              <TableHead>{t('columns.reference')}</TableHead>
              <TableHead>{t('columns.client')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead numeric>{t('columns.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableEmpty colSpan={5}>
                <p>{t('noMatches')}</p>
                {hasFilters ? (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch('');
                        setClientId('');
                      }}
                    >
                      {t('clearFilters')}
                    </Button>
                  </div>
                ) : null}
              </TableEmpty>
            ) : (
              visible.map((receipt) => (
                <ReceiptRow
                  key={receipt.id}
                  receipt={receipt}
                  clientName={clientNames.get(receipt.clientId)}
                  locale={locale}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}

function ReceiptRow({
  receipt,
  clientName,
  locale,
}: {
  receipt: Receipt;
  clientName: string | undefined;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.receipts');

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {/* The link sits on the date because a receipt has no name — the date and
            reference together are how finance staff identify one. */}
        <Link
          href={`/receipts/${receipt.id}`}
          className="-my-3 flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          {formatDate(receipt.receiptDate, locale)}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        {receipt.reference ?? <span className="text-muted-foreground">{t('noReference')}</span>}
      </TableCell>
      <TableCell>
        {/* `GET /receipts` returns `clientId` with no expansion, so the name is joined from
            the clients list. Falls back to nothing rather than showing a cuid. */}
        {clientName ?? <span className="text-muted-foreground">{t('notSet')}</span>}
      </TableCell>
      <TableCell>
        <Badge
          tone={
            receipt.postingStatus === 'POSTED'
              ? 'live'
              : receipt.postingStatus === 'REVERSED'
                ? 'danger'
                : 'warning'
          }
        >
          {t(`status.${receipt.postingStatus === 'POSTED' ? 'posted' : receipt.postingStatus === 'REVERSED' ? 'reversed' : 'notPosted'}`)}
        </Badge>
      </TableCell>
      <TableCell numeric className="whitespace-nowrap font-medium">
        <bdi>{formatMoney(receipt.totalAmount, receipt.currencyCode, locale)}</bdi>
      </TableCell>
    </TableRow>
  );
}
