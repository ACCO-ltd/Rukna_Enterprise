'use client';

/**
 * Opening a fiscal year (tenant bootstrap, tier 2).
 *
 * Nothing posts without a period, and the Fiscal Periods screen has been read-only since
 * Sprint 4 — so an organisation with a chart of accounts still had nowhere to put a journal.
 *
 * Two things this form does not do, both deliberate:
 *
 *  - **It does not promise January.** `fiscal-year.service.ts:41` takes the start month from
 *    the organisation's `FiscalCalendarPolicy`, and no endpoint exposes that record, so the UI
 *    cannot know it. §6.14 says "Jan–Dec", which is true only while the policy says 1 — as the
 *    seed sets it. The form says twelve monthly periods from the organisation's start month,
 *    and the periods list underneath shows what was actually created.
 *  - **It does not offer a free-text retained-earnings code.** The account has to exist (404
 *    otherwise), so it is picked from the chart. §6.14's own example — `3100` — is four digits
 *    against a five-digit seeded chart and resolves to nothing (A8).
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { accountName, currentVersion } from '../account-display';
import { useAccounts, useCreateFiscalYear, useFiscalYears } from '../hooks/use-accounting';
import type { Account } from '../types';

/**
 * The accounts that may serve as retained earnings.
 *
 * Narrowed to EQUITY accounts carrying the `RETAINED_EARNINGS` subtype — that is what the
 * year-end close credits, and offering the whole chart here invites someone to close a year
 * into a bank account. The server accepts any code that resolves, so this is the only filter.
 *
 * Falls back to every EQUITY account when nothing carries the subtype, rather than showing an
 * empty picker on a chart that has equity accounts but has not marked one.
 */
export function retainedEarningsCandidates(accounts: readonly Account[]): Account[] {
  const active = accounts.filter((account) => account.status === 'ACTIVE');

  const marked = active.filter(
    (account) => currentVersion(account)?.accountSubtype === 'RETAINED_EARNINGS',
  );
  if (marked.length > 0) return marked.sort((a, b) => a.code.localeCompare(b.code));

  return active
    .filter((account) => currentVersion(account)?.accountClass === 'EQUITY')
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Years already opened, so the form can refuse a duplicate before the server answers 409. */
export function openedYears(fiscalYears: readonly { name: string }[]): Set<number> {
  const years = new Set<number>();
  for (const year of fiscalYears) {
    const match = /(\d{4})/.exec(year.name);
    if (match) years.add(Number(match[1]));
  }
  return years;
}

export type FiscalYearProblem = 'year-range' | 'year-exists' | 'retained-earnings';

export function fiscalYearProblem(
  year: number | null,
  retainedEarningsAccountCode: string,
  taken: Set<number>,
): FiscalYearProblem | null {
  // `@IsInt() @Min(2000) @Max(2100)`.
  if (year === null || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return 'year-range';
  }
  if (taken.has(year)) return 'year-exists';
  if (!retainedEarningsAccountCode) return 'retained-earnings';
  return null;
}

export function CreateFiscalYearForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('accounting.periods.create');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [year, setYear] = useState('');
  const [retainedCode, setRetainedCode] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const accounts = useAccounts();
  const fiscalYears = useFiscalYears();
  const create = useCreateFiscalYear();

  const ids = { year: useId(), retained: useId() };

  const candidates = useMemo(
    () => retainedEarningsCandidates(accounts.data ?? []),
    [accounts.data],
  );
  const taken = useMemo(() => openedYears(fiscalYears.data ?? []), [fiscalYears.data]);

  const parsedYear = /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : null;
  const problem = fiscalYearProblem(parsedYear, retainedCode, taken);

  const serverError = create.error instanceof ApiError ? create.error.message : null;
  const noCandidates = !accounts.isPending && candidates.length === 0;

  function handleSubmit() {
    setShowErrors(true);
    if (problem !== null || parsedYear === null) return;

    create.mutate(
      { year: parsedYear, retainedEarningsAccountCode: retainedCode },
      { onSuccess: onDone },
    );
  }

  if (noCandidates) {
    return (
      <Alert variant="error" title={t('noRetainedTitle')} messages={[t('noRetainedBody')]} />
    );
  }

  return (
    <div className="space-y-4">
      <Alert variant="info" messages={[t('periodsNotice')]} />

      <FormField htmlFor={ids.year} label={t('year')}>
        <Input
          id={ids.year}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t('yearHint')}</p>
      </FormField>

      <FormField htmlFor={ids.retained} label={t('retainedEarnings')}>
        <select
          id={ids.retained}
          value={retainedCode}
          onChange={(e) => setRetainedCode(e.target.value)}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="" disabled>
            —
          </option>
          {candidates.map((account) => (
            <option key={account.id} value={account.code}>
              {account.code} · {accountName(account, locale)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('retainedEarningsHint')}</p>
      </FormField>

      {showErrors && problem ? (
        <Alert variant="error" messages={[t(`problem.${problem}`)]} />
      ) : null}

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={create.isPending}>
          {create.isPending ? tCommon('saving') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
