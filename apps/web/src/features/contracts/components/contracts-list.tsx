'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ContractStatus } from '@erp/types';
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

import { formatDate, formatMoney } from '@/lib/format';

import { filterContracts } from '../filter-contracts';
import { useContracts } from '../hooks/use-contracts';
import { CONTRACT_STATUS_ORDER, type Contract } from '../types';
import { ContractStatusBadge } from './contract-status-badge';

interface ContractsListProps {
  /** Scopes the query server-side — the one filter `GET /contracts` offers. */
  projectId?: string;
}

export function ContractsList({ projectId }: ContractsListProps = {}) {
  const t = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useContracts(projectId);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus | 'ALL'>('ALL');

  const visible = useMemo(
    () => filterContracts(data ?? [], { search, status }),
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

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/contracts/new">{t('newContract')}</Link>
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
          <Label htmlFor="contract-search" className="sr-only">
            {t('searchLabel')}
          </Label>
          <Input
            id="contract-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <Label htmlFor="contract-status" className="sr-only">
            {t('filterByStatus')}
          </Label>
          <Select
            id="contract-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ContractStatus | 'ALL');
            }}
          >
            <option value="ALL">{t('allStatuses')}</option>
            {CONTRACT_STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
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
              <TableHead>{t('columns.number')}</TableHead>
              <TableHead numeric>{t('columns.value')}</TableHead>
              <TableHead>{t('columns.billing')}</TableHead>
              <TableHead>{t('columns.dates')}</TableHead>
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
              visible.map((contract) => (
                <ContractRow key={contract.id} contract={contract} locale={locale} />
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}

function ContractRow({ contract, locale }: { contract: Contract; locale: 'en' | 'ar' }) {
  const t = useTranslations('platform.contracts');

  const value = formatMoney(contract.contractValue, contract.currency, locale);
  const start = formatDate(contract.startDate, locale);
  const unset = <span className="text-muted-foreground">{t('notSet')}</span>;

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {/* The link sits on the number, not the row: a clickable <tr> is unreachable by
            keyboard and breaks the table semantics screen readers rely on. */}
        <Link
          href={`/contracts/${contract.id}`}
          className="-my-3 flex min-h-11 items-center font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          {contract.contractNumber}
        </Link>
      </TableCell>
      <TableCell numeric className="whitespace-nowrap font-medium">
        {value ?? unset}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {t(`billingModel.${contract.billingModel}`)}
      </TableCell>
      <TableCell className="whitespace-nowrap">{start ?? unset}</TableCell>
      <TableCell>
        <ContractStatusBadge status={contract.status} />
      </TableCell>
    </TableRow>
  );
}
