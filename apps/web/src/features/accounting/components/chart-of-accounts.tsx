'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { accountMatches, accountName, currentVersion } from '../account-display';
import { useAccounts } from '../hooks/use-accounting';
import type { Account, AccountClass } from '../types';
import { AccountClassBadge, NormalBalanceLabel, PostingPolicyBadge } from './account-badges';

const ACCOUNT_CLASSES: AccountClass[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'COST_OF_SALES',
  'EXPENSE',
];

export function ChartOfAccounts() {
  const t = useTranslations('accounting.chartOfAccounts');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const accounts = useAccounts();

  const [search, setSearch] = useState('');
  const [accountClass, setAccountClass] = useState<AccountClass | ''>('');

  // Filtered in the browser: `GET /accounts` takes no query parameters and a chart of accounts
  // is a few hundred rows, so the whole thing is already here.
  const visible = useMemo(() => {
    const all = accounts.data ?? [];
    return all.filter((account) => {
      if (!accountMatches(account, search)) return false;
      if (!accountClass) return true;
      return currentVersion(account)?.accountClass === accountClass;
    });
  }, [accounts.data, search, accountClass]);

  const filtering = search.trim().length > 0 || accountClass !== '';

  if (accounts.isPending) {
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

  if (accounts.isError) {
    return <Alert variant="error" messages={[t('empty')]} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {accounts.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <>
          {/* Stacked on a narrow viewport; side by side once there is room. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <FormField htmlFor="coa-search" label={t('searchLabel')} className="sm:flex-1">
              <Input
                id="coa-search"
                type="search"
                value={search}
                placeholder={t('searchPlaceholder')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FormField>

            <FormField htmlFor="coa-class" label={t('filterByClass')} className="sm:w-56">
              <Select
                id="coa-class"
                value={accountClass}
                onChange={(e) => setAccountClass(e.target.value as AccountClass | '')}
              >
                <option value="">{t('allClasses')}</option>
                {ACCOUNT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('countLabel', { count: visible.length })}
            </p>
            {filtering ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setAccountClass('');
                }}
              >
                {t('clearFilters')}
              </Button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
            </div>
          ) : (
            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCode')}</TableHead>
                    <TableHead className="min-w-[180px]">{t('colName')}</TableHead>
                    <TableHead>{t('colClass')}</TableHead>
                    <TableHead>{t('colSubtype')}</TableHead>
                    <TableHead>{t('colNormalBalance')}</TableHead>
                    <TableHead>{t('colPosting')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((account) => (
                    <AccountRow key={account.id} account={account} locale={locale} />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          )}

          <p className="max-w-prose text-xs text-muted-foreground">{t('versionNote')}</p>
        </>
      )}
    </div>
  );
}

function AccountRow({ account, locale }: { account: Account; locale: 'en' | 'ar' }) {
  const t = useTranslations('accounting.chartOfAccounts');
  const version = currentVersion(account);

  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-sm tabular-nums">{account.code}</span>
      </TableCell>

      <TableCell className="min-w-[180px]">
        {version ? (
          <span className="text-sm text-foreground">{accountName(account, locale)}</span>
        ) : (
          // An account with no version is a broken record, not an empty name — saying so is
          // more useful than rendering a blank cell.
          <span className="text-sm italic text-muted-foreground">{t('noVersion')}</span>
        )}
      </TableCell>

      <TableCell>
        {version ? <AccountClassBadge accountClass={version.accountClass} /> : null}
      </TableCell>

      <TableCell>
        <span className="text-xs text-muted-foreground">{version?.accountSubtype ?? '—'}</span>
      </TableCell>

      <TableCell>
        <NormalBalanceLabel normalBalance={account.normalBalance} />
      </TableCell>

      <TableCell>
        {version ? (
          <PostingPolicyBadge
            isPostingAllowed={version.isPostingAllowed}
            isControlAccount={version.isControlAccount}
            controlPostingPolicy={version.controlPostingPolicy}
          />
        ) : null}
      </TableCell>
    </TableRow>
  );
}
