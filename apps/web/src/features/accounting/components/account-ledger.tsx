'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { DateRangePicker, EmptyState, FilterBar, FilterField, Select, SkeletonTable, StatTile, cn } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { formatDate, formatMoney } from '@/lib/format';

import { accountLabel, currentVersion } from '../account-display';
import { CLASS_ORDER } from '../coa-tree';
import { useAccountLedger, useAccounts } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { journalHref, sourceDocumentHref, sourceKey } from '../journal-source';
import { exportCsv, reportFilename } from '../lib/export-csv';
import type { Account } from '../types';
import { BOOK_RANGES, bookRange, type BookRange } from './journal-book';
import { ReportActions } from './report-actions';

/** GL-L — balances come as debits less credits; a credit-side account reads them the other way round. */
export function onNormalSide(value: string, normalBalance: 'DEBIT' | 'CREDIT' | undefined): string {
  if (normalBalance !== 'CREDIT') return value;
  const n = -Number(value);
  return (Object.is(n, -0) ? 0 : n).toFixed(2);
}

/**
 * Accounts that can carry entries: everything but a heading. Control and system-only accounts
 * (receivables, payables) are kept by the system but have ledgers worth reading.
 */
export function ledgerAccounts(accounts: readonly Account[]): Account[] {
  return accounts
    .filter((a) => {
      const v = currentVersion(a);
      return !!v && (v.isPostingAllowed || v.isControlAccount || v.controlPostingPolicy === 'SYSTEM_ONLY');
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * GL-L — one account's ledger for a period: what it held at the start, every posted entry with the
 * balance after it (each opening its journal and the document behind it), and what it held at the
 * end. The reports link in with `?accountId=&from=&to=`; the address follows the account chosen.
 */
export function AccountLedgerReport() {
  const t = useTranslations('accounting.ledger');
  const tClass = useTranslations('accounting.chartOfAccounts.classSection');
  const tSource = useTranslations('accounting.journalBook.source');
  const tBook = useTranslations('accounting.journalBook');
  const locale = useLocale() as 'en';
  const router = useRouter();
  const pathname = usePathname() ?? '/finance/accounting/ledger';
  const searchParams = useSearchParams();
  const accounts = useAccounts();

  const [accountId, setAccountId] = useState(() => searchParams?.get('accountId') ?? '');
  const [preset, setPreset] = useState<BookRange | null>(() => (searchParams?.get('from') && searchParams?.get('to') ? null : 'month'));
  const [custom, setCustom] = useState(() => ({ from: searchParams?.get('from') ?? '', to: searchParams?.get('to') ?? '' }));
  const range = preset ? bookRange(preset, todayWireDate()) : custom;

  const ledger = useAccountLedger(accountId, range.from, range.to);
  const selectable = useMemo(() => ledgerAccounts(accounts.data ?? []), [accounts.data]);
  const byClass = useMemo(
    () => CLASS_ORDER.map((c) => ({ c, rows: selectable.filter((a) => currentVersion(a)?.accountClass === c) })).filter((g) => g.rows.length > 0),
    [selectable],
  );

  const side = ledger.data?.normalBalance;
  const usd = (value: string) => formatMoney(value, 'USD', locale) ?? value;
  const balance = (value: string) => usd(onNormalSide(value, side));
  const amount = (value: string) => (Number(value) === 0 ? '' : usd(value));

  function chooseAccount(id: string) {
    setAccountId(id);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (id) next.set('accountId', id);
    else next.delete('accountId');
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`);
  }

  const handleExport = () => {
    if (!ledger.data) return;
    exportCsv(
      reportFilename('account-ledger', ledger.data.accountCode, range.from, range.to),
      [t('csvJournal'), t('csvDate'), t('csvDescription'), t('csvReference'), t('csvDebit'), t('csvCredit'), t('csvBalance')],
      ledger.data.lines.map((line) => [
        line.journalNumber, line.accountingDate.slice(0, 10), line.description, line.reference ?? '',
        line.debitAmount, line.creditAmount, onNormalSide(line.runningBalance, side),
      ]),
    );
  };

  return (
    <div className="space-y-5">
      <ListPageHeader title={t('title')} actions={<ReportActions onExport={handleExport} exportDisabled={!ledger.data} />} />

      <FilterBar>
        <FilterField id="ledger-account" label={t('accountLabel')} grow>
          <Select id="ledger-account" value={accountId} onChange={chooseAccount}>
            <option value="">{t('selectAccount')}</option>
            {byClass.map(({ c, rows }) => (
              <optgroup key={c} label={tClass(c)}>
                {rows.map((account) => (
                  <option key={account.id} value={account.id}>{accountLabel(account, locale)}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FilterField>
        <FilterField id="ledger-range" label={t('periodLabel')}>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t('periodLabel')} className="inline-flex flex-wrap rounded-control border border-border p-0.5">
              {BOOK_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={preset === r}
                  onClick={() => setPreset(r)}
                  className={cn(
                    'min-h-9 rounded-control px-2.5 text-caption font-medium',
                    preset === r ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tBook(`range.${r}`)}
                </button>
              ))}
            </div>
            <DateRangePicker
              id="ledger-range"
              fromValue={range.from}
              toValue={range.to}
              onChange={(next) => {
                setCustom(next);
                setPreset(null);
              }}
            />
          </div>
        </FilterField>
      </FilterBar>

      {!accountId ? (
        <EmptyState title={t('noAccountChosen')} />
      ) : ledger.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void ledger.refetch()} />
      ) : ledger.isPending ? (
        <SkeletonTable rows={8} columns={6} label={t('title')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('openingBalance')} value={balance(ledger.data.openingBalance)} note={formatDate(range.from, locale) ?? undefined} />
            <StatTile label={t('periodDebit')} value={usd(ledger.data.periodDebit)} />
            <StatTile label={t('periodCredit')} value={usd(ledger.data.periodCredit)} />
            <StatTile label={t('closingBalance')} value={balance(ledger.data.closingBalance)} note={formatDate(range.to, locale) ?? undefined} />
          </div>

          <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
            {ledger.data.lines.length === 0 ? (
              <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <>
                <ul className="divide-y divide-border sm:hidden" aria-label={t('title')}>
                  {ledger.data.lines.map((line, i) => (
                    <li key={`${line.journalEntryId}-${i}`}>
                      <Link href={journalHref(line.journalEntryId)} className="flex items-start justify-between gap-3 px-4 py-3 text-body-sm hover:bg-surface-subtle">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{line.description}</span>
                          <span className="block text-caption text-muted-foreground">
                            {line.journalNumber} · {formatDate(line.accountingDate, locale)}
                          </span>
                        </span>
                        <span className="shrink-0 text-end tabular-nums">
                          <span className="block">{Number(line.debitAmount) > 0 ? `${t('dr')} ${usd(line.debitAmount)}` : `${t('cr')} ${usd(line.creditAmount)}`}</span>
                          <span className="block text-caption text-muted-foreground">{balance(line.runningBalance)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[760px] text-body-sm">
                    <caption className="sr-only">{t('title')}</caption>
                    <thead>
                      <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                        <th scope="col" className="px-4 py-2 text-start font-medium">{t('colDate')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('colJournal')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDescription')}</th>
                        <th scope="col" className="px-3 py-2 text-end font-medium">{t('colDebit')}</th>
                        <th scope="col" className="px-3 py-2 text-end font-medium">{t('colCredit')}</th>
                        <th scope="col" className="px-4 py-2 text-end font-medium">{t('colBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border text-muted-foreground">
                        <td className="whitespace-nowrap px-4 py-2">{formatDate(range.from, locale)}</td>
                        <td colSpan={4} className="px-3 py-2">{t('openingBalance')}</td>
                        <td className="px-4 py-2 text-end tabular-nums">{balance(ledger.data.openingBalance)}</td>
                      </tr>
                      {ledger.data.lines.map((line, i) => {
                        const doc = sourceDocumentHref(line.sourceDocumentType, line.sourceDocumentId);
                        return (
                          <tr key={`${line.journalEntryId}-${i}`} className="border-b border-border hover:bg-surface-subtle">
                            <td className="whitespace-nowrap px-4 py-2">{formatDate(line.accountingDate, locale)}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <Link href={journalHref(line.journalEntryId)} className="font-mono font-medium text-brand-primary hover:underline" aria-label={t('openJournal', { journal: line.journalNumber })}>
                                {line.journalNumber}
                              </Link>
                            </td>
                            <td className="max-w-[26rem] px-3 py-2">
                              <span className="block truncate">{line.description}</span>
                              <span className="block text-caption text-muted-foreground">
                                {doc ? <Link href={doc} className="hover:underline">{tSource(sourceKey(line.sourceDocumentType))}</Link> : tSource(sourceKey(line.sourceDocumentType))}
                                {line.reference && line.reference !== line.description && !line.reference.trim().endsWith(':') ? ` · ${line.reference}` : ''}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums">{amount(line.debitAmount)}</td>
                            <td className="px-3 py-2 text-end tabular-nums">{amount(line.creditAmount)}</td>
                            <td className="px-4 py-2 text-end font-medium tabular-nums">{balance(line.runningBalance)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-subtle font-semibold">
                        <th scope="row" colSpan={3} className="px-4 py-2 text-start">{t('closingBalance')}</th>
                        <td className="px-3 py-2 text-end tabular-nums">{usd(ledger.data.periodDebit)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{usd(ledger.data.periodCredit)}</td>
                        <td className="px-4 py-2 text-end tabular-nums">{balance(ledger.data.closingBalance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
