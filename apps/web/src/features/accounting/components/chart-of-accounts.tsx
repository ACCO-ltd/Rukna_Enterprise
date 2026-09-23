'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  FilterBar,
  FilterField,
  Input,
  Select,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { accountMatches, accountName, currentVersion } from '../account-display';
import { useAccounts } from '../hooks/use-accounting';
import type { Account, AccountClass } from '../types';
import { AccountClassBadge, NormalBalanceLabel, PostingPolicyBadge } from './account-badges';
import { CreateAccountForm } from './create-account-form';

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

  const accounts = useAccounts();

  const [search, setSearch] = useState('');
  const [accountClass, setAccountClass] = useState<AccountClass | ''>('');
  const [creating, setCreating] = useState(false);
  const { can } = usePermissions();

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

  const columns: GridColumn<Account>[] = [
    {
      key: 'code',
      header: t('colCode'),
      sticky: true,
      sortable: true,
      plainValue: (account) => account.code,
      render: (account) => <span className="font-mono text-caption tabular-nums">{account.code}</span>,
    },
    {
      key: 'name',
      header: t('colName'),
      sortable: true,
      plainValue: (account) => (currentVersion(account) ? accountName(account) : ''),
      render: (account, ctx) => {
        const version = currentVersion(account);
        return version ? (
          <span className="text-sm text-foreground">{accountName(account, ctx.locale)}</span>
        ) : (
          // An account with no version is a broken record, not an empty name — saying so is
          // more useful than rendering a blank cell.
          <span className="text-sm italic text-muted-foreground">{t('noVersion')}</span>
        );
      },
    },
    {
      key: 'class',
      header: t('colClass'),
      render: (account) => {
        const version = currentVersion(account);
        return version ? <AccountClassBadge accountClass={version.accountClass} /> : null;
      },
    },
    {
      key: 'subtype',
      header: t('colSubtype'),
      render: (account) => (
        <span className="text-xs text-muted-foreground">
          {currentVersion(account)?.accountSubtype ?? '—'}
        </span>
      ),
    },
    {
      key: 'normalBalance',
      header: t('colNormalBalance'),
      render: (account) => <NormalBalanceLabel normalBalance={account.normalBalance} />,
    },
    {
      key: 'posting',
      header: t('colPosting'),
      render: (account) => {
        const version = currentVersion(account);
        return version ? (
          <PostingPolicyBadge
            isPostingAllowed={version.isPostingAllowed}
            isControlAccount={version.isControlAccount}
            controlPostingPolicy={version.controlPostingPolicy}
          />
        ) : null;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(ACCOUNTING_PERMISSIONS.manageChart) ? (
          <Button type="button" onClick={() => setCreating(true)}>
            {t('create.new')}
          </Button>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="p-6 sm:max-w-lg">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('create.title')}
          </DialogTitle>
          <div className="mt-5">
            <CreateAccountForm onDone={() => setCreating(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(account) => account.id}
        label={t('title')}
        isLoading={accounts.isPending}
        isError={accounts.isError}
        errorMessage={t('empty')}
        emptyState={
          (accounts.data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 50 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="coa-search" label={t('searchLabel')} grow>
              <Input
                id="coa-search"
                type="search"
                value={search}
                placeholder={t('searchPlaceholder')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FilterField>

            <FilterField id="coa-class" label={t('filterByClass')}>
              <Select
                id="coa-class"
                value={accountClass}
                onChange={(value) => setAccountClass(value as AccountClass | '')}
              >
                <option value="">{t('allClasses')}</option>
                {ACCOUNT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => {
          setSearch('');
          setAccountClass('');
        }}
      />

      <p className="max-w-prose text-xs text-muted-foreground">{t('versionNote')}</p>
    </div>
  );
}
