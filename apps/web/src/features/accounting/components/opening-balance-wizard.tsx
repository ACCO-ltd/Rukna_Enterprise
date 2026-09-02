'use client';

/**
 * The opening balance migration (tenant bootstrap, tier 4).
 *
 * This is the cutover: the point where an organisation's existing books become this system's
 * opening position. It posts one `SYSTEM_OPENING` journal covering the whole trial balance.
 *
 * **It runs once.** The service guards on an existing `EVT-OPB-001` journal and answers 409
 * with "Reverse it first to re-import". So the screen is built around checking before running
 * rather than trying and adjusting — every failure the client can detect is detected here, all
 * of them at once, before the button is live.
 *
 * ─── What is not here ───────────────────────────────────────────────────────────
 *
 * `RunOpeningBalanceDto` also accepts `openArInvoices` and `openApBills`, which import open
 * customer invoices and supplier bills with `OPENING_BALANCE` posting status. Both are omitted
 * from this screen, deliberately and visibly:
 *
 *  - each AR row needs a `clientId` and each AP row a `supplierId` and an `expenseProfileCode`,
 *    so a paste box cannot express them and a per-row picker is a second screen's worth of work
 *  - the same one-shot 409 covers them, so importing a trial balance now would leave no way to
 *    add the invoices later
 *
 * That second point is the reason this is stated on the screen rather than quietly deferred: a
 * migration run without them cannot be topped up. Recorded in the roadmap note below.
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FormField, Input, Select, Textarea } from '@erp/ui';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { accountName } from '../account-display';
import { useAccounts, useRunOpeningBalance } from '../hooks/use-accounting';
import {
  accountsBySubtype,
  migrationBlockers,
  parseTrialBalance,
  toOpeningBalanceBody,
  trialBalanceTotals,
  unknownAccountCodes,
  zeroLines,
} from '../opening-balance';
import type { MigrationReport } from '../types';

export function OpeningBalanceWizard() {
  const t = useTranslations('accounting.openingBalance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [cutoverDate, setCutoverDate] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [arAccountCode, setArAccountCode] = useState('');
  const [apAccountCode, setApAccountCode] = useState('');
  const [paste, setPaste] = useState('');
  const [report, setReport] = useState<MigrationReport | null>(null);

  const accounts = useAccounts();
  const run = useRunOpeningBalance();

  const ids = {
    cutover: useId(),
    batch: useId(),
    ar: useId(),
    ap: useId(),
    paste: useId(),
  };

  const parsed = useMemo(() => parseTrialBalance(paste), [paste]);
  const totals = useMemo(() => trialBalanceTotals(parsed.lines), [parsed.lines]);
  const unknown = useMemo(
    () => unknownAccountCodes(parsed.lines, accounts.data ?? []),
    [parsed.lines, accounts.data],
  );
  const zeros = useMemo(() => zeroLines(parsed.lines), [parsed.lines]);

  const arCandidates = accountsBySubtype(accounts.data ?? [], 'ACCOUNTS_RECEIVABLE');
  const apCandidates = accountsBySubtype(accounts.data ?? [], 'ACCOUNTS_PAYABLE');

  const blockers = migrationBlockers({
    lines: parsed.lines,
    issues: parsed.issues,
    unknownCodes: unknown,
    totals,
    cutoverDate,
    batchReference,
    arAccountCode,
    apAccountCode,
  });

  const serverError = run.error instanceof ApiError ? run.error.message : null;
  const canRun = can(ACCOUNTING_PERMISSIONS.manageChart);

  function handleRun() {
    if (blockers.length > 0) return;

    run.mutate(
      toOpeningBalanceBody({
        lines: parsed.lines,
        cutoverDate,
        batchReference,
        arAccountCode,
        apAccountCode,
      }),
      { onSuccess: setReport },
    );
  }

  if (report) return <MigrationReportView report={report} />;

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Alert variant="warning" title={t('onceTitle')} messages={[t('onceBody')]} />
      <Alert variant="info" title={t('scopeTitle')} messages={[t('scopeBody')]} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('step1')}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor={ids.cutover} label={t('cutoverDate')}>
            <DatePicker
              id={ids.cutover}
              value={cutoverDate}
              onChange={(value) => setCutoverDate(value)}
            />
            <p className="text-xs text-muted-foreground">{t('cutoverDateHint')}</p>
          </FormField>

          <FormField htmlFor={ids.batch} label={t('batchReference')}>
            <Input
              id={ids.batch}
              value={batchReference}
              onChange={(e) => setBatchReference(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('batchReferenceHint')}</p>
          </FormField>

          <FormField htmlFor={ids.ar} label={t('arAccount')}>
            <Select
              id={ids.ar}
              value={arAccountCode}
              onChange={(value) => setArAccountCode(value)}
            >
              <option value="" disabled>
                —
              </option>
              {arCandidates.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} · {accountName(account, locale)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField htmlFor={ids.ap} label={t('apAccount')}>
            <Select
              id={ids.ap}
              value={apAccountCode}
              onChange={(value) => setApAccountCode(value)}
            >
              <option value="" disabled>
                —
              </option>
              {apCandidates.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} · {accountName(account, locale)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('step2')}</h2>

        <FormField htmlFor={ids.paste} label={t('paste')}>
          <Textarea
            id={ids.paste}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={12}
            className="font-mono text-xs"
            placeholder={t('pastePlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{t('pasteHint')}</p>
        </FormField>

        <TrialBalanceSummary
          lineCount={parsed.lines.length}
          totals={totals}
          currencyLocale={locale}
        />

        {parsed.issues.length > 0 ? (
          <Alert
            variant="error"
            title={t('issuesTitle')}
            messages={parsed.issues.map((issue) =>
              issue.kind === 'both-sides' || issue.kind === 'negative'
                ? t(`issue.${issue.kind}`, {
                    line: issue.lineNumber,
                    code: issue.accountCode,
                  })
                : t(`issue.${issue.kind}`, { line: issue.lineNumber, raw: issue.raw.trim() }),
            )}
          />
        ) : null}

        {unknown.length > 0 ? (
          <Alert
            variant="error"
            title={t('unknownTitle')}
            messages={[t('unknownBody', { codes: unknown.join(', ') })]}
          />
        ) : null}

        {/* The server drops these without a word. Warning rather than blocking: a zero row is
            not wrong, it just does nothing, and an accountant pasting a full chart will have
            several. */}
        {zeros.length > 0 ? (
          <Alert
            variant="warning"
            messages={[t('zeroRows', { count: zeros.length })]}
          />
        ) : null}
      </section>

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {blockers.length > 0 ? t(`blocker.${blockers[0]}`) : t('readyToRun')}
        </p>

        <Button
          type="button"
          onClick={handleRun}
          disabled={!canRun || blockers.length > 0 || run.isPending}
        >
          {run.isPending ? tCommon('saving') : t('run')}
        </Button>
      </div>
    </div>
  );
}

// ─── Totals ──────────────────────────────────────────────────────────────────────

function TrialBalanceSummary({
  lineCount,
  totals,
  currencyLocale,
}: {
  lineCount: number;
  totals: ReturnType<typeof trialBalanceTotals>;
  currencyLocale: 'en' | 'ar';
}) {
  const t = useTranslations('accounting.openingBalance');

  if (lineCount === 0) return null;

  const money = (minor: number) =>
    formatMoney(fromMinorUnits(minor, MONEY_SCALE), 'USD', currencyLocale) ?? '';

  return (
    <div
      className={`rounded-md border p-4 ${
        totals.balanced ? 'border-border bg-muted/40' : 'border-danger bg-danger/5'
      }`}
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('totalDebits')}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{money(totals.debitMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('totalCredits')}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{money(totals.creditMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('lineCount')}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{lineCount}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm font-medium">
        {totals.balanced
          ? t('balanced')
          : t('outOfBalance', { difference: money(Math.abs(totals.differenceMinor)) })}
      </p>
    </div>
  );
}

// ─── Report ──────────────────────────────────────────────────────────────────────

function MigrationReportView({ report }: { report: MigrationReport }) {
  const t = useTranslations('accounting.openingBalance.report');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {t('subtitle', {
            journal: report.openingBalanceJournalNumber,
            batch: report.batchReference,
          })}
        </p>
      </div>

      <Alert
        variant={report.zeroVariance ? 'success' : 'warning'}
        title={report.zeroVariance ? t('reconciledTitle') : t('varianceTitle')}
        messages={[report.zeroVariance ? t('reconciledBody') : t('varianceBody')]}
      />

      <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('journal')}</dt>
          <dd className="mt-0.5 font-mono text-sm">{report.openingBalanceJournalNumber}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('arImported')}</dt>
          <dd className="mt-0.5 text-sm tabular-nums">{report.arInvoicesImported}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('apImported')}</dt>
          <dd className="mt-0.5 text-sm tabular-nums">{report.apBillsImported}</dd>
        </div>
      </dl>

      {report.reconciliation.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 text-start font-medium">
                  {t('colAccount')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('colGl')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('colSubledger')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('colVariance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.reconciliation.map((line) => (
                <tr key={line.label} className="border-b border-border/60">
                  <td className="py-2 pe-3">{line.label}</td>
                  <td className="py-2 text-end tabular-nums">
                    <bdi>{formatMoney(line.glBalance, 'USD', locale)}</bdi>
                  </td>
                  <td className="py-2 text-end tabular-nums">
                    <bdi>{formatMoney(line.subledgerBalance, 'USD', locale)}</bdi>
                  </td>
                  <td
                    className={`py-2 text-end tabular-nums ${
                      line.reconciled ? '' : 'font-semibold text-danger'
                    }`}
                  >
                    <bdi>{formatMoney(line.variance, 'USD', locale)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* `readyForCfoApproval` is the server's judgement and there is no approval endpoint
          behind it — it is an instruction to a person, not a status on a record. */}
      {report.readyForCfoApproval ? (
        <Alert variant="info" messages={[t('cfoApproval')]} />
      ) : null}
    </div>
  );
}
