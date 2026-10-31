'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ellipsis, ListTree, Search } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  SkeletonTable,
  StatusPill,
  cn,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import { accountName, currentVersion } from '../account-display';
import { useAccountingSetupStatus, useAccounts, useSetAccountStatus, useTrialBalance } from '../hooks/use-accounting';
import { chartSections, minorToText, searchSections, type ChartRow } from '../coa-tree';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import type { Account, AccountClass } from '../types';
import { AccountingSetupDialog } from './accounting-setup-dialog';
import { PartialSetupNotice } from './partial-setup-notice';
import { CreateAccountForm } from './create-account-form';
import { EditAccountForm } from './edit-account-form';
import { ImportCoaForm } from './import-coa-form';

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
  // G-3 — each account's balance today, from the trial balance (posted lines only).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const trial = useTrialBalance(today, false);
  const balanceOf = useMemo(() => {
    const map = new Map<string, { debit: string; credit: string }>();
    for (const line of trial.data?.lines ?? []) map.set(line.accountId, { debit: line.closingDebit, credit: line.closingCredit });
    return map;
  }, [trial.data]);

  const [accountClass, setAccountClass] = useState<AccountClass | ''>('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const { can } = usePermissions();

  // Both write actions — create and edit — are gated on the same permission every account
  // write endpoint requires (`manage:account`).
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);

  // The guide's first setup step links here with `?setup=template` (ADR-040): the Set up
  // accounting dialog opens on arrival, but only for someone who may run it and only while the
  // install is still allowed. Closing it drops the parameter so a reload does not reopen it.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const setupRequested = searchParams?.get('setup') === 'template';
  // Asked when it matters: arriving from the guide link, or looking at an empty chart (where the
  // empty state offers the install — or explains why it cannot run).
  const chartEmpty = accounts.isSuccess && accounts.data.length === 0;
  const setupStatus = useAccountingSetupStatus({
    enabled: mayManage && (setupRequested || chartEmpty),
  });
  const [setupParamHandled, setSetupParamHandled] = useState(false);
  const openFromLink =
    setupRequested && !setupParamHandled && mayManage && setupStatus.data?.canInstall === true;

  function closeSetup() {
    setSettingUp(false);
    if (setupRequested) {
      setSetupParamHandled(true);
      router.replace(pathname);
    }
  }

  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [statusFor, setStatusFor] = useState<Account | null>(null);
  const setStatus = useSetAccountStatus();

  const all = useMemo(() => accounts.data ?? [], [accounts.data]);
  const sections = useMemo(() => {
    const built = chartSections(all, balanceOf, { showInactive });
    const narrowed = accountClass ? built.filter((s) => s.accountClass === accountClass) : built;
    return searchSections(narrowed, search, (a) => accountName(a));
  }, [all, balanceOf, showInactive, accountClass, search]);
  const inactiveCount = all.filter((a) => a.status !== 'ACTIVE').length;

  // The subtype's plain name ("Cash and bank"), not its code.
  const subtypeLabel = (subtype: string | undefined) =>
    subtype ? (t.has(`create.subtypeName.${subtype}`) ? t(`create.subtypeName.${subtype}`) : subtype) : '';
  const usd = (minor: number) => (minor === 0 ? '' : (formatMoney(minorToText(minor), 'USD') ?? minorToText(minor)));

  const rowMenu = (row: ChartRow) =>
    mayManage && currentVersion(row.account) ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('rowMenu', { code: row.account.code })}>
            <Ellipsis size={20} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(row.account)}>{t('edit.action')}</DropdownMenuItem>
          {!row.heading ? (
            <DropdownMenuItem asChild>
              <Link href={`/finance/accounting/ledger?accountId=${row.account.id}`}>{t('openLedger')}</Link>
            </DropdownMenuItem>
          ) : null}
          {!row.systemKept ? (
            <DropdownMenuItem onSelect={() => setStatusFor(row.account)}>
              {row.account.status === 'ACTIVE' ? t('deactivate') : t('reactivate')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const nameCell = (row: ChartRow) => (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {currentVersion(row.account) ? (
        <span className={cn('text-body-sm', row.heading ? 'font-semibold text-foreground' : 'text-foreground')}>
          {accountName(row.account)}
        </span>
      ) : (
        // A versionless account is a broken record, not an empty name.
        <span className="text-body-sm italic text-muted-foreground">{t('noVersion')}</span>
      )}
      {row.systemKept ? <StatusPill tone="neutral">{t('tagSystem')}</StatusPill> : null}
      {row.account.status !== 'ACTIVE' ? <StatusPill tone="historical">{t('tagInactive')}</StatusPill> : null}
    </span>
  );
  const indent = ['ps-3', 'ps-8', 'ps-12', 'ps-16'];
  const balanceCell = (row: ChartRow) =>
    row.heading ? (
      <span className="font-semibold tabular-nums">{usd(row.balanceMinor)}</span>
    ) : row.balanceMinor !== 0 ? (
      <Link href={`/finance/accounting/ledger?accountId=${row.account.id}`} className="tabular-nums text-brand-primary underline-offset-2 hover:underline">
        {usd(row.balanceMinor)}
      </Link>
    ) : null;

  // Import sits beside New account: a fresh org brings in a whole chart at once, then maintains
  // it one account at a time.
  const createAction = mayManage ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setImporting(true)}>
        {t('import.action')}
      </Button>
      <Button type="button" onClick={() => setCreating(true)}>
        {t('create.new')}
      </Button>
    </div>
  ) : null;

  const chart = (
    <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <label className="relative min-w-0 flex-1 sm:max-w-sm">
          <span className="sr-only">{t('searchLabel')}</span>
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-10" />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-body-sm text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4" />
          {t('showInactive')}
        </label>
      </div>
      <div role="tablist" aria-label={t('classesLabel')} className="flex gap-1 overflow-x-auto border-b border-border px-3">
        {(['', ...ACCOUNT_CLASSES] as const).map((c) => (
          <button
            key={c || 'all'}
            type="button"
            role="tab"
            aria-selected={accountClass === c}
            onClick={() => setAccountClass(c)}
            className={cn(
              'min-h-10 whitespace-nowrap border-b-2 px-3 text-body-sm font-medium',
              accountClass === c ? 'border-brand-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {c ? t(`classSection.${c}`) : t('allClassesTab')}
          </button>
        ))}
      </div>
      {sections.length === 0 ? (
        <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{t('noMatches')}</p>
      ) : (
        sections.map((section) => (
          <section key={section.accountClass} aria-labelledby={`coa-${section.accountClass}`} className="border-b border-border last:border-b-0">
            <h3 id={`coa-${section.accountClass}`} className="bg-surface-subtle px-4 py-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`classSection.${section.accountClass}`)}
            </h3>
            <ul className="divide-y divide-border sm:hidden">
              {section.rows.map((row) => (
                <li key={row.account.id} className={cn('flex items-start justify-between gap-3 py-2.5 pe-2 ps-4', row.depth > 0 && 'ps-8')}>
                  <span className="min-w-0">
                    {nameCell(row)}
                    <span className="block font-mono text-caption text-muted-foreground">{row.account.code}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-body-sm">
                    {balanceCell(row)}
                    {rowMenu(row)}
                  </span>
                </li>
              ))}
            </ul>
            <table className="hidden w-full table-fixed text-body-sm sm:table">
              <caption className="sr-only">{t(`classSection.${section.accountClass}`)}</caption>
              <thead>
                <tr className="border-b border-border text-caption text-muted-foreground">
                  <th scope="col" className="w-28 px-4 py-2 text-start font-medium">{t('colCode')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colName')}</th>
                  <th scope="col" className="hidden w-56 px-3 py-2 text-start font-medium lg:table-cell">{t('colSubtype')}</th>
                  <th scope="col" className="w-40 px-3 py-2 text-end font-medium">{t('colBalance')}</th>
                  <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">{t('rowMenu', { code: '' })}</span></th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.account.id} className={cn('border-b border-border last:border-b-0', row.account.status !== 'ACTIVE' && 'text-muted-foreground')}>
                    <td className="px-4 py-2 font-mono text-caption tabular-nums">{row.account.code}</td>
                    <th scope="row" className={cn('px-3 py-2 text-start font-normal', indent[Math.min(row.depth, indent.length - 1)])}>
                      {nameCell(row)}
                    </th>
                    <td className="hidden px-3 py-2 text-caption text-muted-foreground lg:table-cell">
                      {row.heading ? '' : subtypeLabel(currentVersion(row.account)?.accountSubtype)}
                    </td>
                    <td className="px-3 py-2 text-end">{balanceCell(row)}</td>
                    <td className="px-2 py-1 text-end">{rowMenu(row)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <th scope="row" colSpan={3} className="px-4 py-2 text-start">
                    {t('classTotal', { name: t(`classSection.${section.accountClass}`).toLowerCase() })}
                  </th>
                  <td className="px-3 py-2 text-end tabular-nums">{usd(section.totalMinor) || formatMoney('0', 'USD')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </section>
        ))
      )}
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ADR-039: each form is its own FormDialog, mounted to open it. */}
      {creating ? (
        <CreateAccountForm title={t('create.title')} onDone={() => setCreating(false)} />
      ) : null}

      {settingUp || openFromLink ? <AccountingSetupDialog onDone={closeSetup} /> : null}

      {importing ? (
        <ImportCoaForm title={t('import.title')} onDone={() => setImporting(false)} />
      ) : null}

      {editing ? (
        // Keyed so switching from one account's menu to another re-seeds the form from the
        // new account rather than keeping the first one's draft.
        <EditAccountForm
          key={editing.id}
          title={t('edit.title', { name: accountName(editing) })}
          account={editing}
          onDone={() => setEditing(null)}
        />
      ) : null}

      <ListPageHeader
        title={t('title')}
        summary={all.length > 0 ? t('summary', { count: all.length - inactiveCount, inactive: inactiveCount }) : undefined}
        actions={createAction}
      />
      {accounts.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void accounts.refetch()} />
      ) : accounts.isPending ? (
        <SkeletonTable rows={10} columns={4} label={t('title')} />
      ) : all.length === 0 ? (
        <EmptyState
        icon={<ListTree size={36} aria-hidden="true" />}
        title={t('empty')}
        description={t('emptyHint')}
        // ADR-040: an empty chart is set up from the template in one step — importing or
        // adding accounts one by one cannot create the control accounts posting needs.
        action={
          mayManage ? (
            setupStatus.data?.canInstall ? (
              <Button type="button" onClick={() => setSettingUp(true)}>
                {t('setUp')}
              </Button>
            ) : setupStatus.data?.reason === 'PARTIAL_SETUP' ? (
              <div className="mx-auto max-w-prose text-start">
                <PartialSetupNotice records={setupStatus.data.existingRecords} />
              </div>
            ) : undefined
          ) : (
            <p className="text-sm font-medium text-foreground">{t('emptyAdminOnly')}</p>
          )
        }
            />
      ) : (
        chart
      )}

      {statusFor ? (
        <ConfirmActionDialog
          title={t(statusFor.status === 'ACTIVE' ? 'deactivateTitle' : 'reactivateTitle', { name: `${statusFor.code} ${accountName(statusFor)}` })}
          description={t(statusFor.status === 'ACTIVE' ? 'deactivateBody' : 'reactivateBody')}
          confirmLabel={statusFor.status === 'ACTIVE' ? t('deactivate') : t('reactivate')}
          isPending={setStatus.isPending}
          errorMessage={setStatus.isError ? (setStatus.error instanceof ApiError && setStatus.error.message ? setStatus.error.message : t('statusFailed')) : undefined}
          onConfirm={() =>
            setStatus.mutate(
              { id: statusFor.id, status: statusFor.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
              { onSuccess: () => setStatusFor(null) },
            )
          }
          onDismiss={() => {
            setStatus.reset();
            setStatusFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
