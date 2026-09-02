'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  DatePicker,
  FormField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { accountLabel, postableAccounts } from '../account-display';
import { useAccountLedger, useAccounts } from '../hooks/use-accounting';

/** The current month — the range a ledger is read for most often. */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  };
}

export function AccountLedgerReport() {
  const t = useTranslations('accounting.ledger');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [range, setRange] = useState(currentMonth);

  const ledger = useAccountLedger(accountId, range.from, range.to);

  // Only accounts that accept postings can carry ledger entries, so offering the rest would
  // guarantee an empty report and leave the reader wondering which of the two things is wrong.
  const selectable = useMemo(() => postableAccounts(accounts.data ?? []), [accounts.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <FormField htmlFor="ledger-account" label={t('accountLabel')} className="sm:flex-1">
          <Select
            id="ledger-account"
            value={accountId}
            onChange={(value) => setAccountId(value)}
          >
            <option value="">{t('selectAccount')}</option>
            {selectable.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account, locale)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField htmlFor="ledger-from" label={tCommon('fromDate')} className="sm:w-44">
          <DatePicker
            id="ledger-from"
            value={range.from}
            onChange={(value) => setRange((r) => ({ ...r, from: value }))}
          />
        </FormField>

        <FormField htmlFor="ledger-to" label={tCommon('toDate')} className="sm:w-44">
          <DatePicker
            id="ledger-to"
            value={range.to}
            onChange={(value) => setRange((r) => ({ ...r, to: value }))}
          />
        </FormField>
      </div>

      {!accountId ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('noAccountChosen')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('noAccountChosenHint')}
          </p>
        </div>
      ) : ledger.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : ledger.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t('openingBalance'), ledger.data.openingBalance],
                [t('periodDebit'), ledger.data.periodDebit],
                [t('periodCredit'), ledger.data.periodCredit],
                [t('closingBalance'), ledger.data.closingBalance],
              ].map(([label, amount]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">
                    <bdi className="tabular-nums">{formatMoney(amount, undefined, locale)}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="text-xs text-muted-foreground">{t('postedOnlyNote')}</p>

          {ledger.data.lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colJournal')}</TableHead>
                    <TableHead className="min-w-[200px]">{t('colDescription')}</TableHead>
                    <TableHead numeric>{t('colDebit')}</TableHead>
                    <TableHead numeric>{t('colCredit')}</TableHead>
                    <TableHead numeric>{t('colBalance')}</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {ledger.data.lines.map((line) => (
                    <TableRow key={`${line.journalEntryId}-${line.accountingDate}`}>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatDate(line.accountingDate, locale)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.journalNumber}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-[200px] max-w-[320px]">
                        <span className="line-clamp-2 text-sm text-foreground">
                          {line.description}
                        </span>
                      </TableCell>
                      <TableCell numeric>
                        <bdi className="tabular-nums">
                          {formatMoney(line.debitAmount, undefined, locale)}
                        </bdi>
                      </TableCell>
                      <TableCell numeric>
                        <bdi className="tabular-nums">
                          {formatMoney(line.creditAmount, undefined, locale)}
                        </bdi>
                      </TableCell>
                      {/* The running balance is server-computed and carried forward from the
                          opening balance. Recomputing it here would be a second opinion on a
                          figure the ledger already owns. */}
                      <TableCell numeric>
                        <bdi className="text-sm font-medium tabular-nums">
                          {formatMoney(line.runningBalance, undefined, locale)}
                        </bdi>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          )}
        </>
      )}
    </div>
  );
}
