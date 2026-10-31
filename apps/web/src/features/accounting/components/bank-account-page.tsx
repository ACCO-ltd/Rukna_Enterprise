'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeftRight, ChevronDown, ChevronLeft } from 'lucide-react';
import {
  Button,
  DefinitionList,
  DefinitionRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  MoneyDisplay,
  Notice,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  SkeletonTable,
  StatusPill,
  cn,
} from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useBankTransfers } from '@/features/bank-transfers/transfers-api';
import { bankStatementsApi } from '@/features/bank-reconciliation/api';
import { statementKeys } from '@/features/bank-reconciliation/statements-list';
import { useUsers } from '@/features/users/hooks/use-users';
import { formatDate, formatMoney } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import { ledgerLineHref, maskedAccountNumber, moneyInOut } from '../bank-account-figures';
import { useAccountLedger, useBankAccounts, useSignatories } from '../hooks/use-accounting';
import { todayIso } from '../posting-profile-setup';
import type { BankAccount } from '../types';
import { EditBankAccountDialog, accountNumberRecorded } from './bank-account-edit';
import { BankAccountStatusDialog, SignatoriesDialog } from './bank-accounts';

type Range = 'month' | 'quarter' | 'year';
const RANGES: readonly Range[] = ['month', 'quarter', 'year'];

/** The first day of the range that ends today. */
function rangeStart(range: Range, today: string): string {
  if (range === 'month') return `${today.slice(0, 7)}-01`;
  if (range === 'year') return `${today.slice(0, 4)}-01-01`;
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 89);
  return d.toISOString().slice(0, 10);
}

/**
 * BK — one bank account, cash box or wallet: what the books say it holds, every movement through it
 * with the running balance (each opening the payment, receipt or transfer behind it), its
 * transfers, its statements, and who signs for it.
 */
export function BankAccountPage({ id }: { id: string }) {
  const t = useTranslations('accounting.bankAccounts.page');
  const tList = useTranslations('accounting.bankAccounts');
  const tKind = useTranslations('accounting.bankAccounts.kind');
  const locale = useLocale() as 'en';
  const { can } = usePermissions();
  const mayManage = can(ACCOUNTING_PERMISSIONS.manageChart);
  const banks = useBankAccounts();
  const [dialog, setDialog] = useState<null | 'edit' | 'signatories' | BankAccount['status']>(null);

  if (banks.isError) return <LoadError message={tList('loadFailed')} onRetry={() => void banks.refetch()} />;
  if (banks.isPending) return <SkeletonTable rows={6} columns={4} label={t('loading')} />;
  const bank = banks.data.find((b) => b.id === id);
  if (!bank) return <EmptyState title={t('notFound')} description={t('notFoundHint')} />;

  const masked = maskedAccountNumber(bank.accountNumber, accountNumberRecorded);
  const open = bank.status !== 'CLOSED';
  const canPay = bank.status === 'ACTIVE' && bank.allowsPayments;
  const linkButton = 'inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-body-sm font-medium';

  return (
    <RecordLayout
      header={
        <RecordHeader
          headingLevel="h2"
          breadcrumb={
            <Link href="/finance/accounting/bank-accounts" className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground">
              <ChevronLeft size={14} aria-hidden="true" />
              {t('back')}
            </Link>
          }
          title={bank.accountName}
          statusPlacement="title"
          status={<StatusPill tone={statusTone(bank.status, 'masterData')}>{tList(`status.${bank.status}`)}</StatusPill>}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground">
              <span className="font-medium text-foreground">{bank.bankName}</span>
              <span>· {tKind(bank.kind ?? 'BANK')}</span>
              {masked ? <span className="font-mono">· {masked}</span> : null}
            </span>
          }
          figure={{ label: tList('colBalance'), value: <span className="tabular-nums">{formatMoney(bank.bookBalance ?? '0', 'USD', locale) ?? bank.bookBalance}</span> }}
          actions={
            open ? (
              <div className="flex flex-wrap items-center gap-2">
                {canPay ? (
                  <Link href={`/finance/accounting/transfers?new=1&from=${bank.id}`} className={cn(linkButton, 'bg-brand-primary text-brand-on-primary hover:bg-brand-primary-hover')}>
                    <ArrowLeftRight size={16} aria-hidden="true" />
                    {tList('transferMoney')}
                  </Link>
                ) : null}
                <Link href={`/finance/accounting/bank-reconciliation?account=${bank.id}`} className={cn(linkButton, 'border border-border bg-surface text-foreground hover:bg-surface-subtle')}>
                  {tList('reconcile')}
                </Link>
                {mayManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        {t('more')}
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog('edit')}>{tList('editAction')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDialog('signatories')}>{tList('signatories.title')}</DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/finance/accounting/ledger?accountId=${bank.glAccountId}`}>{t('openLedger')}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {bank.status === 'ACTIVE' ? (
                        <DropdownMenuItem onSelect={() => setDialog('SUSPENDED')}>{tList('suspend')}</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setDialog('ACTIVE')}>{tList('reactivate')}</DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-danger" onSelect={() => setDialog('CLOSED')}>{tList('close')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : undefined
          }
        />
      }
      banner={
        bank.status === 'SUSPENDED' ? (
          <Notice tone="attention" title={t('suspendedTitle')}>{t('suspendedBody')}</Notice>
        ) : bank.status === 'CLOSED' ? (
          <Notice tone="historical" title={t('closedTitle')}>{t('closedBody')}</Notice>
        ) : null
      }
      rail={<BankAccountRail bank={bank} onManageSignatories={mayManage && open ? () => setDialog('signatories') : undefined} />}
    >
      <TransactionsPanel bank={bank} />
      <TransfersPanel bank={bank} />
      <StatementsPanel bank={bank} />

      {dialog === 'edit' ? <EditBankAccountDialog bank={bank} onClose={() => setDialog(null)} /> : null}
      {dialog === 'signatories' ? <SignatoriesDialog bank={bank} onClose={() => setDialog(null)} /> : null}
      {dialog === 'ACTIVE' || dialog === 'SUSPENDED' || dialog === 'CLOSED' ? (
        <BankAccountStatusDialog bank={bank} to={dialog} onDone={() => setDialog(null)} />
      ) : null}
    </RecordLayout>
  );
}

/** Every posted movement in the range, with money in, money out and the running balance. */
function TransactionsPanel({ bank }: { bank: BankAccount }) {
  const t = useTranslations('accounting.bankAccounts.page');
  const locale = useLocale() as 'en';
  const [range, setRange] = useState<Range>('quarter');
  const today = todayIso();
  const from = rangeStart(range, today);
  const ledger = useAccountLedger(bank.glAccountId, from, today);
  const usd = (value: string | null) => (value === null ? '' : (formatMoney(value, 'USD', locale) ?? value));

  return (
    <RecordPanel
      title={t('transactionsTitle')}
      padded={false}
      action={
        <div role="group" aria-label={t('rangeLabel')} className="inline-flex rounded-control border border-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={cn(
                'min-h-9 rounded-control px-2.5 text-caption font-medium',
                range === r ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
      }
    >
      {ledger.isError ? (
        <div className="p-4"><LoadError message={t('transactionsFailed')} onRetry={() => void ledger.refetch()} /></div>
      ) : ledger.isPending ? (
        <div className="p-4"><SkeletonTable rows={5} columns={5} label={t('loading')} /></div>
      ) : (
        <>
        <ul className="divide-y divide-border border-t border-border sm:hidden" aria-label={t('transactionsTitle')}>
          {ledger.data.lines.length === 0 ? (
            <li className="px-4 py-6 text-center text-body-sm text-muted-foreground">{t('noTransactions')}</li>
          ) : (
            ledger.data.lines.map((line, i) => {
              const { moneyIn, moneyOut } = moneyInOut(line);
              return (
                <li key={`${line.journalEntryId}-${i}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-body-sm">
                  <span className="min-w-0">
                    <Link href={ledgerLineHref(line)} className="font-medium text-foreground hover:underline">{line.description}</Link>
                    <span className="block text-caption text-muted-foreground">{formatDate(line.accountingDate, locale)}</span>
                  </span>
                  <span className="shrink-0 text-end tabular-nums">
                    <span className={cn('block font-medium', moneyIn && 'text-success')}>{moneyIn ? `+${usd(moneyIn)}` : `−${usd(moneyOut)}`}</span>
                    <span className="block text-caption text-muted-foreground">{usd(line.runningBalance)}</span>
                  </span>
                </li>
              );
            })
          )}
          <li className="flex justify-between px-4 py-2.5 text-body-sm font-semibold">
            <span>{t('closingBalance')}</span>
            <span className="tabular-nums">{usd(ledger.data.closingBalance)}</span>
          </li>
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[640px] text-body-sm">
            <caption className="sr-only">{t('transactionsTitle')}</caption>
            <thead>
              <tr className="border-y border-border bg-surface-subtle text-caption text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-start font-medium">{t('colDate')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDetails')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t('colIn')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t('colOut')}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t('colBalance')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border text-muted-foreground">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatDate(from, locale)}</td>
                <td className="px-3 py-2" colSpan={3}>{t('openingBalance')}</td>
                <td className="px-4 py-2 text-end tabular-nums">{usd(ledger.data.openingBalance)}</td>
              </tr>
              {ledger.data.lines.length === 0 ? (
                <tr className="border-b border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('noTransactions')}</td>
                </tr>
              ) : (
                ledger.data.lines.map((line, i) => {
                  const { moneyIn, moneyOut } = moneyInOut(line);
                  return (
                    <tr key={`${line.journalEntryId}-${i}`} className="border-b border-border">
                      <td className="whitespace-nowrap px-4 py-2 align-top tabular-nums">{formatDate(line.accountingDate, locale)}</td>
                      <td className="px-3 py-2 align-top">
                        <Link href={ledgerLineHref(line)} className="font-medium text-foreground hover:text-brand-primary hover:underline">
                          {line.description}
                        </Link>
                        <span className="block font-mono text-caption text-muted-foreground">{line.journalNumber}</span>
                      </td>
                      <td className="px-3 py-2 text-end align-top tabular-nums text-success">{usd(moneyIn)}</td>
                      <td className="px-3 py-2 text-end align-top tabular-nums">{usd(moneyOut)}</td>
                      <td className="px-4 py-2 text-end align-top tabular-nums">{usd(line.runningBalance)}</td>
                    </tr>
                  );
                })
              )}
              <tr className="font-semibold">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatDate(today, locale)}</td>
                <td className="px-3 py-2">{t('closingBalance')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{usd(ledger.data.periodDebit)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{usd(ledger.data.periodCredit)}</td>
                <td className="px-4 py-2 text-end tabular-nums">{usd(ledger.data.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      )}
    </RecordPanel>
  );
}

/** Money moved between this account and the company's others, newest first. */
function TransfersPanel({ bank }: { bank: BankAccount }) {
  const t = useTranslations('accounting.bankAccounts.page');
  const tStatus = useTranslations('finance.transfers.status');
  const locale = useLocale() as 'en';
  const transfers = useBankTransfers(bank.id);
  const rows = (transfers.data ?? []).slice(0, 5);
  if (transfers.isPending || transfers.isError || rows.length === 0) return null;
  return (
    <RecordPanel
      title={t('transfersTitle')}
      padded={false}
      action={<Link href={`/finance/accounting/transfers?account=${bank.id}`} className="text-body-sm font-medium text-brand-primary hover:underline">{t('seeAll')}</Link>}
    >
      <ul className="divide-y divide-border">
        {rows.map((tr) => {
          const out = tr.fromBankAccountId === bank.id;
          return (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-body-sm">
              <span className="min-w-0">
                <Link href={`/finance/accounting/transfers?highlight=${tr.id}`} className="font-medium text-foreground hover:underline">
                  {out ? t('transferTo', { name: tr.toAccountName }) : t('transferFrom', { name: tr.fromAccountName })}
                </Link>
                <span className="block text-caption text-muted-foreground">
                  {[tr.transferNumber, formatDate(tr.transferDate, locale), tr.memo].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {tr.status !== 'POSTED' ? <StatusPill tone={tr.status === 'PENDING_APPROVAL' ? 'attention' : 'historical'}>{tStatus(tr.status)}</StatusPill> : null}
                <span className={cn('tabular-nums', tr.status === 'REVERSED' || tr.status === 'REJECTED' ? 'text-muted-foreground line-through' : out ? '' : 'text-success')}>
                  {out ? '−' : '+'}
                  <MoneyDisplay value={tr.amount} />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </RecordPanel>
  );
}

/** The account's imported statements, each opening to its reconciliation. */
function StatementsPanel({ bank }: { bank: BankAccount }) {
  const t = useTranslations('accounting.bankAccounts.page');
  const tRec = useTranslations('finance.bankRec');
  const locale = useLocale() as 'en';
  const list = useQuery({ queryKey: [...statementKeys.list(), bank.id], queryFn: () => bankStatementsApi.list(bank.id) });
  const rows = (list.data ?? []).slice(0, 4);
  if (list.isPending || list.isError || rows.length === 0) return null;
  return (
    <RecordPanel
      title={t('statementsTitle')}
      padded={false}
      action={<Link href={`/finance/accounting/bank-reconciliation?account=${bank.id}`} className="text-body-sm font-medium text-brand-primary hover:underline">{t('seeAll')}</Link>}
    >
      <ul className="divide-y divide-border">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-body-sm">
            <Link href={`/finance/accounting/bank-reconciliation/${s.id}`} className="font-medium text-foreground hover:underline">
              {formatDate(s.periodStart, locale)} – {formatDate(s.statementDate, locale)}
            </Link>
            <span className="flex items-center gap-3">
              <StatusPill tone={s.status === 'RECONCILED' ? 'success' : 'attention'}>
                {s.status === 'OPEN' ? tRec('toMatch', { unmatched: s.unmatchedCount, total: s.lineCount }) : tRec(`status.${s.status}`)}
              </StatusPill>
              <span className="tabular-nums"><MoneyDisplay value={s.closingBalance} /></span>
            </span>
          </li>
        ))}
      </ul>
    </RecordPanel>
  );
}

function BankAccountRail({ bank, onManageSignatories }: { bank: BankAccount; onManageSignatories?: () => void }) {
  const t = useTranslations('accounting.bankAccounts.page');
  const tList = useTranslations('accounting.bankAccounts');
  const tKind = useTranslations('accounting.bankAccounts.kind');
  const locale = useLocale() as 'en';
  const signatories = useSignatories(bank.id);
  const users = useUsers();
  const active = (signatories.data ?? []).filter((s) => s.isActive);
  const nameOf = (userId: string) => {
    const u = (users.data ?? []).find((x) => x.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : userId;
  };
  const usedFor = [bank.allowsReceipts ? t('receiving') : null, bank.allowsPayments ? t('paying') : null].filter(Boolean).join(', ') || t('neither');

  return (
    <>
      <RecordPanel title={t('reconciliationTitle')}>
        <DefinitionList>
          <DefinitionRow label={tList('colBalance')} numeric>
            {formatMoney(bank.bookBalance ?? '0', 'USD', locale)}
          </DefinitionRow>
          {bank.lastReconciledTo ? (
            <>
              <DefinitionRow label={t('reconciledTo')}>{formatDate(bank.lastReconciledTo, locale)}</DefinitionRow>
              <DefinitionRow label={t('bankSaid')} numeric>{formatMoney(bank.lastStatementBalance ?? '0', 'USD', locale)}</DefinitionRow>
            </>
          ) : (
            <DefinitionRow label={t('reconciledTo')} tone="warning">{tList('neverReconciled')}</DefinitionRow>
          )}
        </DefinitionList>
      </RecordPanel>

      <RecordPanel title={t('detailsTitle')}>
        <DefinitionList>
          <DefinitionRow label={t('bank')}>{bank.bankName}</DefinitionRow>
          <DefinitionRow label={t('number')}>
            {accountNumberRecorded(bank.accountNumber) ? <span className="font-mono">{bank.accountNumber}</span> : tList('numberNotRecorded')}
          </DefinitionRow>
          <DefinitionRow label={t('type')}>{tKind(bank.kind ?? 'BANK')}</DefinitionRow>
          <DefinitionRow label={t('usedFor')}>{usedFor}</DefinitionRow>
          <DefinitionRow label={t('ledgerAccount')}>
            <Link href={`/finance/accounting/ledger?accountId=${bank.glAccountId}`} className="font-mono text-brand-primary hover:underline">
              {bank.glAccount?.code ?? '—'}
            </Link>
          </DefinitionRow>
          <DefinitionRow label={t('currency')}>{bank.currencyCode}</DefinitionRow>
        </DefinitionList>
      </RecordPanel>

      <RecordPanel
        title={tList('signatories.title')}
        action={onManageSignatories ? <Button size="sm" variant="ghost" onClick={onManageSignatories}>{t('manage')}</Button> : undefined}
      >
        {active.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('noSignatories')}</p>
        ) : (
          <>
            <ul className="space-y-1 text-body-sm">
              {active.map((s) => <li key={s.id}>{nameOf(s.userId)}</li>)}
            </ul>
            <p className="mt-2 text-caption text-muted-foreground">{t('twoToRelease')}</p>
          </>
        )}
      </RecordPanel>
    </>
  );
}
