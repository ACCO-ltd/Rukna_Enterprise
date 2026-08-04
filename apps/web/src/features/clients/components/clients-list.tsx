'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ClientStatus } from '@erp/types';
import {
  Alert,
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

import { filterClients } from '../filter-clients';
import { useClients } from '../hooks/use-clients';
import { CLIENT_STATUS_ORDER, type Client } from '../types';
import { ClientStatusBadge } from './client-status-badge';

export function ClientsList() {
  const t = useTranslations('platform.clients');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useClients();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | 'ALL'>('ALL');

  const visible = useMemo(
    () => filterClients(data ?? [], { search, status }),
    [data, search, status],
  );

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

  // No clients at all is a different situation from no clients matching a filter — they
  // need different wording and different escape routes.
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/clients/new">{t('newClient')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const hasFilters = search.trim() !== '' || status !== 'ALL';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="client-search" className="sr-only">
            {t('searchLabel')}
          </Label>
          <Input
            id="client-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <Label htmlFor="client-status" className="sr-only">
            {t('filterByStatus')}
          </Label>
          <Select
            id="client-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ClientStatus | 'ALL');
            }}
          >
            <option value="ALL">{t('allStatuses')}</option>
            {CLIENT_STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Announced politely so filtering feedback reaches screen readers without
          interrupting typing. */}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('countLabel', { count: visible.length })}
      </p>

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.code')}</TableHead>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.taxNumber')}</TableHead>
              <TableHead>{t('columns.currency')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
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
                        setStatus('ALL');
                      }}
                    >
                      {t('clearFilters')}
                    </Button>
                  </div>
                ) : null}
              </TableEmpty>
            ) : (
              visible.map((client) => (
                <ClientRow key={client.id} client={client} locale={locale} />
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}

function ClientRow({ client, locale }: { client: Client; locale: 'en' | 'ar' }) {
  const t = useTranslations('platform.clients');

  const displayName = locale === 'ar' && client.nameAr ? client.nameAr : client.name;
  const unset = <span className="text-muted-foreground">{t('notSet')}</span>;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {client.code}
      </TableCell>
      <TableCell>
        {/* The link lives on the name rather than the row: a clickable <tr> cannot be
            reached by keyboard or announced as a link, and wrapping every cell in an
            anchor breaks the table semantics screen readers rely on. */}
        <Link
          href={`/clients/${client.id}`}
          className="-my-3 flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          {displayName}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{client.taxNumber || unset}</TableCell>
      <TableCell className="whitespace-nowrap">{client.defaultCurrency || unset}</TableCell>
      <TableCell>
        <ClientStatusBadge status={client.status} />
      </TableCell>
    </TableRow>
  );
}
