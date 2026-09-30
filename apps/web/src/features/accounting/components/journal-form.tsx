'use client';

/**
 * New manual journal — a full-page document editor laid out like the New bill page (ADR-037):
 * the sticky FormActionBar (back, Save, Cancel), a FormGroup header card, the lines in the shared
 * `LineItemsEditor` (a table row from `md`, a labelled card below it), and a live balance bar.
 *
 * The rules — two lines, one side per line, debits equal credits, strict amount parsing — live in
 * `../journal-entry.ts`, pure and unit-tested. This file only lays them out.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Combobox,
  DatePicker,
  FormActionBar,
  FormField,
  FormGroup,
  Input,
  LineItemsEditor,
  MoneyInput,
  type ComboboxOption,
  type LineColumn,
} from '@erp/ui';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import { useModuleTrail } from '@/components/layout/module-chrome';
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
  type JournalLineDraft,
  type LineProblem,
} from '../journal-entry';

const JOURNALS_HREF = '/finance/accounting/journals';

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

const lineId = (index: number, column: string) => `journal-line-${index}-${column}`;

/** A line plus a stable React key, so removing a middle line does not shift the others' state. */
interface KeyedLine extends JournalLineDraft {
  key: string;
}

export function JournalForm() {
  const t = useTranslations('accounting.journalForm');
  const tCommon = useTranslations('common');
  const tForm = useTranslations('common.formState');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  useModuleTrail(t('title'));

  const accounts = useAccounts();
  const create = useCreateJournal();

  // A posting must land in a period that is still OPEN or REOPENED. The calendar refuses
  // the rest outright, so a closed month is never a value the user has to have rejected
  // back to them after filling in the whole journal.
  const { data: fiscalYears } = useFiscalYears();
  const isClosedPeriod = useMemo(() => makeClosedPeriodPredicate(fiscalYears), [fiscalYears]);

  const [initialDraft] = useState<JournalDraft>(() => emptyDraft(today(), 'USD'));
  const [draft, setDraft] = useState<JournalDraft>(initialDraft);
  // Parallel to `draft.lines`: React keys only, never sent to the API.
  const nextKey = useRef(initialDraft.lines.length);
  const [lineKeys, setLineKeys] = useState<string[]>(() => initialDraft.lines.map((_, i) => `line-${i}`));
  // Faults are computed from the first keystroke but only shown once the user has tried to
  // save. Marking a form invalid before it has been filled in is noise, not guidance.
  const [submitted, setSubmitted] = useState(false);
  // Bumped on every refused save, so the problem list is brought into view each time.
  const [refusals, setRefusals] = useState(0);
  const problemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (refusals === 0) return;
    // The list is hidden when every fault is on a field (a missing date or account); then the
    // first invalid field is what to bring into view.
    const list = problemsRef.current;
    const target =
      list && list.childElementCount > 0
        ? list
        : document.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [refusals]);

  // Code and name are both in the label, so the combobox's own filter finds an account by either.
  const accountOptions = useMemo<ComboboxOption[]>(
    () =>
      postableAccounts(accounts.data ?? []).map((account) => ({
        value: account.id,
        label: accountLabel(account, locale),
      })),
    [accounts.data, locale],
  );

  const totals = journalTotals(draft.lines);
  const problems = draftProblems(draft);
  const perLine = lineProblems(draft.lines);
  const canSave = canSaveDraft(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  // Nothing entered yet: nothing is out of balance, so the bar stays neutral rather than red.
  const nothingEntered = totals.debitMinor === 0 && totals.creditMinor === 0;

  const rows: KeyedLine[] = draft.lines.map((line, i) => ({ ...line, key: lineKeys[i] ?? `line-${i}` }));

  function updateLine(index: number, patch: Partial<JournalLineDraft>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    const key = `line-${nextKey.current++}`;
    setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }));
    setLineKeys((keys) => [...keys, key]);
  }

  function removeLine(index: number) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
    setLineKeys((keys) => keys.filter((_, i) => i !== index));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (create.isPending) return;
    if (!canSave) {
      setRefusals((n) => n + 1);
      return;
    }

    create.mutate(toJournalPayload(draft), {
      onSuccess: (journal) => router.push(`${JOURNALS_HREF}/${journal.id}`),
    });
  }

  const money = (minor: number) =>
    formatMoney(fromMinorUnits(minor, MONEY_SCALE), draft.currencyCode, locale);

  // A missing account is the account cell's fault; every other line fault is about its amounts,
  // so it spans the row under both money columns rather than sitting under one of them.
  const cellErrors = (index: number): Partial<Record<string, string>> | undefined => {
    const problem = submitted ? perLine.get(index) : undefined;
    return problem === 'no-account' ? { account: t(`errors.${PROBLEM_KEYS[problem]}`) } : undefined;
  };

  const columns: LineColumn<KeyedLine>[] = [
    {
      key: 'account',
      header: t('colAccount'),
      required: true,
      width: 'minmax(0,2fr)',
      // No controlId: the cell carries its own numbered label ("Account 2"), which is the name a
      // screen reader needs when every row's column header reads the same.
      cell: (row, i) => (
        <>
          <label htmlFor={lineId(i, 'account')} className="sr-only">
            {`${t('colAccount')} ${i + 1}`}
          </label>
          <Combobox
            id={lineId(i, 'account')}
            value={row.accountId}
            onChange={(accountId) => updateLine(i, { accountId })}
            options={accountOptions}
            placeholder={t('selectAccount')}
            searchPlaceholder={t('accountSearchPlaceholder')}
            emptyLabel={accounts.isError ? t('accountsLoadFailed') : t('accountNoMatches')}
            invalid={submitted && perLine.get(i) === 'no-account'}
            aria-required
          />
        </>
      ),
    },
    {
      key: 'memo',
      header: t('colMemo'),
      width: 'minmax(0,1.5fr)',
      controlId: (i) => lineId(i, 'memo'),
      cell: (row, i) => (
        <Input
          id={lineId(i, 'memo')}
          aria-label={`${t('colMemo')} ${i + 1}`}
          value={row.memo}
          onChange={(e) => updateLine(i, { memo: e.target.value })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'debit',
      header: t('colDebit'),
      width: '9rem',
      align: 'end',
      controlId: (i) => lineId(i, 'debit'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'debit')}
          aria-label={`${t('colDebit')} ${i + 1}`}
          className="text-end tabular-nums"
          value={row.debit}
          onValueChange={(debit) => updateLine(i, { debit })}
          autoComplete="off"
        />
      ),
    },
    {
      key: 'credit',
      header: t('colCredit'),
      width: '9rem',
      align: 'end',
      controlId: (i) => lineId(i, 'credit'),
      cell: (row, i) => (
        <MoneyInput
          id={lineId(i, 'credit')}
          aria-label={`${t('colCredit')} ${i + 1}`}
          className="text-end tabular-nums"
          value={row.credit}
          onValueChange={(credit) => updateLine(i, { credit })}
          autoComplete="off"
        />
      ),
    },
  ];

  const problemMessages = [
    ...(problems.includes('too-few-lines') ? [t('errors.tooFewLines')] : []),
    ...(problems.includes('out-of-balance')
      ? [t('errors.outOfBalance', { difference: formatDifference(totals.differenceMinor) })]
      : []),
  ];

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormActionBar
        back={
          <Button asChild variant="ghost" className="gap-1.5 px-2">
            <Link href={JOURNALS_HREF}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('back')}
            </Link>
          </Button>
        }
        save={
          <Button type="submit" loading={create.isPending} loadingText={t('saving')}>
            {t('save')}
          </Button>
        }
        discard={
          <Button variant="ghost" asChild>
            <Link href={JOURNALS_HREF}>{tCommon('cancel')}</Link>
          </Button>
        }
        saveState={dirty ? 'dirty' : 'new'}
        saveStateLabels={{ new: tForm('new'), dirty: tForm('dirty'), clean: tForm('clean') }}
      />

      <div className="space-y-8">
        <div ref={problemsRef} className="scroll-mt-32 space-y-3 empty:hidden">
          {submitted && problemMessages.length > 0 ? (
            <Alert variant="error" messages={problemMessages} />
          ) : null}
          {create.isError ? <Alert variant="error" messages={[t('saveFailed')]} /> : null}
        </div>

        <div>
          <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h2 className="mt-1 text-display font-semibold tracking-tight text-foreground">{t('title')}</h2>
          <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('intro')}</p>
        </div>

        <FormGroup title={t('detailsTitle')} description={t('detailsDescription')}>
          <FormField
            htmlFor="journal-date"
            label={t('accountingDateLabel')}
            hint={t('accountingDateHint')}
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
          </FormField>

          <FormField htmlFor="journal-doc-date" label={t('documentDateLabel')} hint={t('documentDateHint')}>
            <DatePicker
              id="journal-doc-date"
              value={draft.documentDate}
              onChange={(value) => setDraft((d) => ({ ...d, documentDate: value }))}
            />
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
        </FormGroup>

        <section className="space-y-4" aria-labelledby="journal-lines-heading">
          <div className="border-b border-border pb-2">
            <h2 id="journal-lines-heading" className="text-body font-semibold text-foreground">
              {t('linesHeading')}
            </h2>
            <p className="text-caption text-muted-foreground">{t('linesHint')}</p>
          </div>

          {accounts.isError ? <Alert variant="error" messages={[t('accountsLoadFailed')]} /> : null}

          {accounts.isPending ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">{tCommon('loading')}</span>
              <div className="h-40 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
            </div>
          ) : (
            <LineItemsEditor<KeyedLine>
              label={t('linesHeading')}
              rows={rows}
              rowKey={(row) => row.key}
              columns={columns}
              errors={cellErrors}
              note={(_row, index) => {
                const problem = submitted ? perLine.get(index) : undefined;
                return problem && problem !== 'no-account'
                  ? { tone: 'danger', text: t(`errors.${PROBLEM_KEYS[problem]}`) }
                  : null;
              }}
              cardTitle={(_row, i) => t('lineTitle', { n: i + 1 })}
              onAdd={addLine}
              addLabel={t('addLine')}
              // Two lines is the floor the server enforces, so the control goes away rather
              // than failing when pressed.
              onRemove={draft.lines.length > 2 ? removeLine : undefined}
              removeLabel={(i) => t('removeLineAria', { number: i + 1 })}
            />
          )}
        </section>

        {/* The running balance. Live rather than on submit, because a journal is built by
            watching these two numbers converge — finding out at the end is the slow way. */}
        <section
          role="status"
          aria-live="polite"
          aria-label={t('balanceLabel')}
          className={
            totals.balanced
              ? 'rounded-panel border border-success/40 bg-success-subtle p-4 sm:p-5'
              : 'rounded-panel border border-border bg-surface p-4 shadow-e1 sm:p-5'
          }
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-muted-foreground">{t('totalsDebit')}</dt>
              <dd className="mt-0.5 text-body font-semibold text-foreground">
                <bdi className="tabular-nums">{money(totals.debitMinor)}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">{t('totalsCredit')}</dt>
              <dd className="mt-0.5 text-body font-semibold text-foreground">
                <bdi className="tabular-nums">{money(totals.creditMinor)}</bdi>
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1 sm:text-end">
              <dt className="text-caption text-muted-foreground">{t('difference')}</dt>
              <dd
                className={
                  totals.balanced
                    ? 'mt-0.5 inline-flex items-center gap-1.5 text-body font-semibold text-success'
                    : nothingEntered
                      ? 'mt-0.5 text-body font-semibold text-muted-foreground'
                      : 'mt-0.5 text-body font-semibold text-danger'
                }
              >
                {totals.balanced ? (
                  <>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {t('balanced')}
                  </>
                ) : (
                  <bdi className="tabular-nums">
                    {formatMoney(formatDifference(totals.differenceMinor), draft.currencyCode, locale)}
                  </bdi>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </form>
  );
}
