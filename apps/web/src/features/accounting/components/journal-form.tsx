'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Input,
  MoneyInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { accountLabel, postableAccounts } from '../account-display';
import { useAccounts, useCreateJournal, useFiscalYears } from '../hooks/use-accounting';
import { makeClosedPeriodPredicate } from '../open-period';
import {
  canSaveDraft,
  draftProblems,
  emptyDraft,
  emptyLine,
  formatDifference,
  journalTotals,
  lineProblems,
  toJournalPayload,
  type JournalDraft,
  type LineProblem,
} from '../journal-entry';

/** Today in `YYYY-MM-DD`, which is what both the date input and the API expect. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const PROBLEM_KEYS: Record<LineProblem, string> = {
  'no-account': 'lineNeedsAccount',
  'no-amount': 'lineNeedsAmount',
  'both-amounts': 'lineBothAmounts',
  'invalid-amount': 'lineAmountInvalid',
  'negative-amount': 'lineAmountNegative',
};

export function JournalForm() {
  const t = useTranslations('accounting.journalForm');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();

  const accounts = useAccounts();
  const create = useCreateJournal();

  // A posting must land in a period that is still OPEN or REOPENED. The calendar refuses
  // the rest outright, so a closed month is never a value the user has to have rejected
  // back to them after filling in the whole journal.
  const { data: fiscalYears } = useFiscalYears();
  const isClosedPeriod = useMemo(() => makeClosedPeriodPredicate(fiscalYears), [fiscalYears]);

  const [draft, setDraft] = useState<JournalDraft>(() => emptyDraft(today(), 'USD'));
  // Faults are computed from the first keystroke but only shown once the user has tried to
  // save. Marking a form invalid before it has been filled in is noise, not guidance.
  const [submitted, setSubmitted] = useState(false);

  const selectable = useMemo(
    () => postableAccounts(accounts.data ?? []),
    [accounts.data],
  );

  const totals = journalTotals(draft.lines);
  const problems = draftProblems(draft);
  const perLine = lineProblems(draft.lines);
  const canSave = canSaveDraft(draft);

  function updateLine(index: number, patch: Partial<JournalDraft['lines'][number]>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!canSave) return;

    create.mutate(toJournalPayload(draft), {
      onSuccess: (journal) => router.push(`/finance/accounting/journals/${journal.id}`),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <div>
        <Link
          href="/finance/accounting/journals"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <FormField
          htmlFor="journal-date"
          label={t('accountingDateLabel')}
          error={
            submitted && problems.includes('accounting-date-required')
              ? t('errors.accountingDateRequired')
              : undefined
          }
        >
          <DatePicker
            id="journal-date"
            value={draft.accountingDate}
            onChange={(value) => setDraft((d) => ({ ...d, accountingDate: value }))}
            isDateDisabled={isClosedPeriod}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('accountingDateHint')}</p>
        </FormField>

        <FormField htmlFor="journal-doc-date" label={t('documentDateLabel')}>
          <DatePicker
            id="journal-doc-date"
            value={draft.documentDate}
            onChange={(value) => setDraft((d) => ({ ...d, documentDate: value }))}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('documentDateHint')}</p>
        </FormField>

        <FormField
          htmlFor="journal-description"
          label={t('descriptionLabel')}
          className="sm:col-span-2"
          error={
            submitted && problems.includes('description-required')
              ? t('errors.descriptionRequired')
              : undefined
          }
        >
          <Input
            id="journal-description"
            value={draft.description}
            placeholder={t('descriptionPlaceholder')}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </FormField>

      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('linesHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('linesHint')}</p>
        </div>

        {accounts.isPending ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">{tCommon('loading')}</span>
            <div
              className="h-40 animate-pulse rounded-lg border border-border bg-muted"
              aria-hidden="true"
            />
          </div>
        ) : (
          <TableScroll aria-label={t('linesHeading')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">{t('colAccount')}</TableHead>
                  <TableHead className="min-w-[140px]">{t('colMemo')}</TableHead>
                  <TableHead numeric className="min-w-[120px]">
                    {t('colDebit')}
                  </TableHead>
                  <TableHead numeric className="min-w-[120px]">
                    {t('colCredit')}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t('removeLine')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {draft.lines.map((line, index) => {
                  const problem = submitted ? perLine.get(index) : undefined;

                  return (
                    <TableRow key={index}>
                      <TableCell className="min-w-[200px]">
                        <Select
                          aria-label={`${t('colAccount')} ${index + 1}`}
                          value={line.accountId}
                          onChange={(value) => updateLine(index, { accountId: value })}
                        >
                          <option value="">{t('selectAccount')}</option>
                          {selectable.map((account) => (
                            <option key={account.id} value={account.id}>
                              {accountLabel(account, locale)}
                            </option>
                          ))}
                        </Select>
                        {problem ? (
                          <p className="mt-1 text-xs text-danger">{t(`errors.${PROBLEM_KEYS[problem]}`)}</p>
                        ) : null}
                      </TableCell>

                      <TableCell className="min-w-[140px]">
                        <Input
                          aria-label={`${t('colMemo')} ${index + 1}`}
                          value={line.memo}
                          onChange={(e) => updateLine(index, { memo: e.target.value })}
                        />
                      </TableCell>

                      <TableCell numeric className="min-w-[120px]">
                        <MoneyInput
                          aria-label={`${t('colDebit')} ${index + 1}`}
                          className="text-end tabular-nums"
                          value={line.debit}
                          onValueChange={(v) => updateLine(index, { debit: v })}
                        />
                      </TableCell>

                      <TableCell numeric className="min-w-[120px]">
                        <MoneyInput
                          aria-label={`${t('colCredit')} ${index + 1}`}
                          className="text-end tabular-nums"
                          value={line.credit}
                          onValueChange={(v) => updateLine(index, { credit: v })}
                        />
                      </TableCell>

                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('removeLineAria', { number: index + 1 })}
                          // Two lines is the floor the server enforces, so the control goes
                          // away rather than failing when pressed.
                          disabled={draft.lines.length <= 2}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              lines: d.lines.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          ×
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}
        >
          {t('addLine')}
        </Button>
      </section>

      {/* The running balance. Live rather than on submit, because a journal is built by
          watching these two numbers converge — finding out at the end is the slow way. */}
      <section
        className="rounded-lg border border-border bg-surface p-4 sm:p-6"
        aria-live="polite"
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('totalsDebit')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi className="tabular-nums">
                {formatMoney(
                  fromMinorUnits(totals.debitMinor, MONEY_SCALE),
                  draft.currencyCode,
                  locale,
                )}
              </bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('totalsCredit')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              <bdi className="tabular-nums">
                {formatMoney(
                  fromMinorUnits(totals.creditMinor, MONEY_SCALE),
                  draft.currencyCode,
                  locale,
                )}
              </bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('difference')}</dt>
            <dd
              className={
                totals.balanced
                  ? 'mt-0.5 text-sm font-medium text-brand-primary'
                  : 'mt-0.5 text-sm font-medium text-danger'
              }
            >
              {totals.balanced ? (
                t('balanced')
              ) : (
                <bdi className="tabular-nums">
                  {formatMoney(
                    formatDifference(totals.differenceMinor),
                    draft.currencyCode,
                    locale,
                  )}
                </bdi>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {submitted && problems.length > 0 ? (
        <Alert
          variant="error"
          messages={[
            ...(problems.includes('too-few-lines') ? [t('errors.tooFewLines')] : []),
            ...(problems.includes('out-of-balance')
              ? [
                  t('errors.outOfBalance', {
                    difference: formatDifference(totals.differenceMinor),
                  }),
                ]
              : []),
          ]}
        />
      ) : null}

      {create.isError ? <Alert variant="error" messages={[t('saveFailed')]} /> : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('saving') : t('save')}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/finance/accounting/journals">{tCommon('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
