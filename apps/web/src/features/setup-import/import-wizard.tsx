'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import {
  Alert,
  Button,
  CheckboxField,
  DatePicker,
  Disclosure,
  FileDrop,
  FormField,
  Input,
  Notice,
  Select,
  StatusPill,
  WizardRail,
  useWizard,
  type StatusTone,
  type WizardStep,
} from '@erp/ui';
import {
  PERMISSIONS,
  type SetupImportAction,
  type SetupImportCheck,
  type SetupImportField,
  type SetupImportKind,
  type SetupImportResult,
  type SetupImportRow,
  type SetupImportRowResult,
} from '@erp/types';

import { CountrySelect } from '@/components/country-select';
import { usePermissions } from '@/features/auth/permissions/can';
import { exportCsv } from '@/features/accounting/lib/export-csv';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { DEFAULT_PHONE_COUNTRY } from '@/lib/phone';
import { parseSpreadsheet, type ParsedSheet } from '@/lib/spreadsheet';

import { checkSetupImport, runSetupImport } from './api';
import { guessMapping, IMPORT_FIELDS, missingRequired, toImportRows, type ColumnMapping } from './columns';

type StepId = 'upload' | 'match' | 'check' | 'import';

const STATUS_TONE: Record<SetupImportRowResult['status'], StatusTone> = {
  ERROR: 'danger',
  WARNING: 'attention',
  READY: 'success',
  SKIPPED: 'neutral',
};

/** Where the imported records are listed, and the caches an import makes stale. */
const LIST_HREF: Record<SetupImportKind, string> = { suppliers: '/procurement/suppliers', clients: '/clients' };
const INVALIDATES: Record<SetupImportKind, ReadonlyArray<readonly string[]>> = {
  suppliers: [['procurement'], ['accounting']],
  clients: [['clients'], ['accounting']],
};

/** Problems first: errors, then rows to review, then skipped. */
const STATUS_ORDER: Record<SetupImportRowResult['status'], number> = { ERROR: 0, WARNING: 1, SKIPPED: 2, READY: 3 };

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;

/**
 * Step 5 (ADR-047) — import suppliers or clients from a spreadsheet: Upload → Match columns →
 * Check → Import.
 *
 * The browser reads the file and matches its columns; the server checks the rows and imports them
 * (`POST /finance/import/:kind/check`, then `POST /finance/import/:kind`). The check step shows
 * problems first and says, before anything is saved, exactly what the import will do. A row can be
 * fixed in place, a likely duplicate merged into the existing record, and rows with errors
 * skipped. Any edit makes the check stale, so the import waits for "Check again".
 */
export function SetupImportWizard({ kind }: { kind: SetupImportKind }) {
  const t = useTranslations('finance.setupImport');
  const tKind = useTranslations(`finance.setupImport.kinds.${kind}`);
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultCountry, setDefaultCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [openingDate, setOpeningDate] = useState('');
  const [rows, setRows] = useState<SetupImportRow[]>([]);
  const [sourceLine, setSourceLine] = useState<number[]>([]);
  const [check, setCheck] = useState<SetupImportCheck | null>(null);
  const [stale, setStale] = useState(false);
  const [skipErrors, setSkipErrors] = useState(false);
  const [result, setResult] = useState<SetupImportResult | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [matchTried, setMatchTried] = useState(false);

  const balancesMapped = (mapping.openingBalance ?? null) !== null;
  const request = () => ({
    rows,
    defaultCountry,
    ...(balancesMapped && openingDate ? { openingDate } : {}),
    skipRowsWithErrors: skipErrors,
  });

  const runCheck = useMutation({
    mutationFn: () => checkSetupImport(kind, request()),
    onSuccess: (data) => {
      setCheck(data);
      setStale(false);
      setStepError(null);
    },
    onError: (error) => setStepError(error instanceof ApiError ? error.message : t('checkFailed')),
  });

  const runImport = useMutation({
    mutationFn: () => runSetupImport(kind, request()),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'guide'] });
      for (const queryKey of INVALIDATES[kind]) void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => setStepError(error instanceof ApiError ? error.message : t('importFailed')),
  });

  const steps: WizardStep<StepId>[] = [
    {
      id: 'upload',
      label: t('steps.upload'),
      validate: () => {
        if (!sheet || sheet.rows.length === 0) {
          setReadError(sheet ? t('emptyFile') : t('chooseFile'));
          return false;
        }
        return true;
      },
      render: () => null,
    },
    {
      id: 'match',
      label: t('steps.match'),
      validate: async () => {
        setMatchTried(true);
        if (missingRequired(kind, mapping).length > 0) return false;
        if (balancesMapped && !openingDate) return false;
        const built = toImportRows(mapping, sheet!.rows);
        setRows(built.rows);
        setSourceLine(built.sourceLine);
        try {
          const data = await checkSetupImport(kind, { rows: built.rows, defaultCountry, ...(balancesMapped ? { openingDate } : {}) });
          setCheck(data);
          setStale(false);
          setStepError(null);
          return true;
        } catch (error) {
          setStepError(error instanceof ApiError ? error.message : t('checkFailed'));
          return false;
        }
      },
      render: () => null,
    },
    {
      id: 'check',
      label: t('steps.check'),
      validate: () => Boolean(check) && !stale && (check!.summary.withErrors === 0 || skipErrors) && importable(check!) > 0,
      render: () => null,
    },
    { id: 'import', label: t('steps.import'), render: () => null },
  ];
  const wizard = useWizard(steps);

  const onFile = async (chosen: File) => {
    setFile(chosen);
    setReadError(null);
    setCheck(null);
    try {
      const parsed = await parseSpreadsheet(chosen);
      setSheet(parsed);
      setMapping(guessMapping(kind, parsed.columns));
      if (parsed.rows.length === 0) setReadError(t('emptyFile'));
    } catch {
      setSheet(null);
      setReadError(t('unreadable'));
    }
  };

  const editRow = (index: number, patch: Partial<SetupImportRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setStale(true);
  };

  const downloadTemplate = () => {
    exportCsv(`${kind}-import-template.csv`, IMPORT_FIELDS[kind].map((f) => t(`fields.${f.field}`)), []);
  };

  const downloadProblems = () => {
    if (!check) return;
    const withProblems = check.rows.filter((r) => r.problems.length > 0);
    exportCsv(
      `${kind}-import-problems.csv`,
      [t('csv.line'), t('csv.name'), t('csv.status'), t('csv.field'), t('csv.problem')],
      withProblems.flatMap((r) =>
        r.problems.map((p) => [
          sourceLine[r.index],
          rows[r.index]?.name ?? '',
          t(`status.${r.status}`),
          p.field ? t(`fields.${p.field}`) : '',
          problemText(p, sourceLine, t),
        ]),
      ),
    );
  };

  if (result) {
    return <ImportDone kind={kind} result={result} />;
  }

  return (
    <div className="space-y-6">
      <WizardRail
        steps={steps}
        wizard={wizard}
        label={t('progress')}
        onNavigate={(id) => {
          if (steps.findIndex((s) => s.id === id) < wizard.currentIndex) wizard.goTo(id);
        }}
      />

      {stepError ? <Alert variant="error">{stepError}</Alert> : null}

      {wizard.currentId === 'upload' ? (
        <section className="space-y-4" aria-label={t('steps.upload')}>
          <FileDrop
            accept=".xlsx,.xls,.csv"
            file={file}
            onFile={(f) => void onFile(f)}
            onRemove={() => {
              setFile(null);
              setSheet(null);
              setCheck(null);
            }}
            title={tKind('dropTitle')}
            hint={t('dropHint')}
            chooseLabel={t('choose')}
            removeLabel={t('remove')}
            error={readError}
          />
          {sheet && sheet.rows.length > 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('readRows', { count: sheet.rows.length, columns: sheet.columns.length })}</p>
          ) : null}
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download size={14} aria-hidden="true" /> {t('template')}
          </Button>
        </section>
      ) : null}

      {wizard.currentId === 'match' && sheet ? (
        <MatchColumns
          kind={kind}
          sheet={sheet}
          mapping={mapping}
          setMapping={setMapping}
          defaultCountry={defaultCountry}
          setDefaultCountry={setDefaultCountry}
          openingDate={openingDate}
          setOpeningDate={setOpeningDate}
          canPostBalances={can(PERMISSIONS.accountingManage)}
          showErrors={matchTried}
        />
      ) : null}

      {wizard.currentId === 'check' && check ? (
        <CheckRows
          kind={kind}
          check={check}
          rows={rows}
          sourceLine={sourceLine}
          stale={stale}
          checking={runCheck.isPending}
          onRecheck={() => runCheck.mutate()}
          onEdit={editRow}
          skipErrors={skipErrors}
          setSkipErrors={setSkipErrors}
          onDownloadProblems={downloadProblems}
        />
      ) : null}

      {wizard.currentId === 'import' && check ? (
        <section className="space-y-4" aria-label={t('steps.import')}>
          <Notice tone="info" title={t('aboutToImport')}>
            <OutcomeSentence kind={kind} check={check} />
          </Notice>
          <p className="text-body-sm text-muted-foreground">{t('oneTransaction')}</p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {wizard.isFirst ? <span /> : (
          <Button variant="outline" onClick={() => { setStepError(null); wizard.back(); }}>
            {t('back')}
          </Button>
        )}
        {wizard.currentId === 'import' ? (
          <Button onClick={() => runImport.mutate()} loading={runImport.isPending}>
            {tKind('importButton', { count: (check?.summary.toCreate ?? 0) + (check?.summary.toMerge ?? 0) })}
          </Button>
        ) : (
          <Button onClick={() => void wizard.next()} loading={wizard.validating}>
            {wizard.currentId === 'match' ? t('checkRows') : t('next')}
          </Button>
        )}
      </div>
    </div>
  );
}

function importable(check: SetupImportCheck): number {
  return check.summary.toCreate + check.summary.toMerge;
}

type T = ReturnType<typeof useTranslations>;

function problemText(problem: SetupImportRowResult['problems'][number], sourceLine: number[], t: T): string {
  if (problem.relatedIndex !== undefined) {
    const line = sourceLine[problem.relatedIndex] ?? problem.relatedIndex + 1;
    return problem.code === 'DUPLICATE_IN_FILE' ? t('sameAsLine', { line }) : t('codeUsedOnLine', { line });
  }
  return problem.message;
}

// ── Match columns ──────────────────────────────────────────────────────────────

function MatchColumns(props: {
  kind: SetupImportKind;
  sheet: ParsedSheet;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  defaultCountry: string;
  setDefaultCountry: (c: string) => void;
  openingDate: string;
  setOpeningDate: (d: string) => void;
  canPostBalances: boolean;
  showErrors: boolean;
}) {
  const t = useTranslations('finance.setupImport');
  const { kind, sheet, mapping, setMapping } = props;
  const missing = missingRequired(kind, mapping);
  const balancesMapped = (mapping.openingBalance ?? null) !== null;
  const sample = (column: number | null | undefined) =>
    column === null || column === undefined ? '' : (sheet.rows.find((r) => r[column]?.trim())?.[column] ?? '');

  return (
    <section className="space-y-5" aria-label={t('steps.match')}>
      <p className="text-body-sm text-muted-foreground">{t('matchIntro')}</p>
      <div className="divide-y divide-border rounded-panel border border-border">
        {IMPORT_FIELDS[kind].map((spec) => {
          const id = `map-${spec.field}`;
          const column = mapping[spec.field] ?? null;
          return (
            <div key={spec.field} className="grid gap-2 px-4 py-3 sm:grid-cols-[12rem_1fr_1fr] sm:items-center">
              <label htmlFor={id} className="text-body-sm font-medium text-foreground">
                {t(`fields.${spec.field}`)}
                {spec.required ? <span className="text-danger"> *</span> : null}
              </label>
              <Select
                id={id}
                value={column === null ? '' : String(column)}
                onChange={(value) => setMapping({ ...mapping, [spec.field]: value === '' ? null : Number(value) })}
              >
                <option value="">{t('notImported')}</option>
                {sheet.columns.map((name, index) => (
                  <option key={`${index}-${name}`} value={String(index)}>
                    {name || t('columnN', { n: index + 1 })}
                  </option>
                ))}
              </Select>
              <span className="truncate text-caption text-muted-foreground">
                {column === null ? '' : t('sample', { value: sample(column) || '—' })}
              </span>
            </div>
          );
        })}
      </div>
      {missing.length > 0 && props.showErrors ? (
        <p className="text-body-sm text-danger">{t('matchRequired', { fields: missing.map((f) => t(`fields.${f}`)).join(', ') })}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="import-country" label={t('defaultCountry')} hint={t('defaultCountryHint')}>
          <CountrySelect id="import-country" value={props.defaultCountry} onChange={props.setDefaultCountry} />
        </FormField>
        {balancesMapped ? (
          <FormField
            htmlFor="import-opening-date"
            label={t('openingDate')}
            hint={t('openingDateHint')}
            required
            error={props.showErrors && !props.openingDate ? t('openingDateRequired') : undefined}
          >
            <DatePicker id="import-opening-date" value={props.openingDate} onChange={(value) => props.setOpeningDate(value ?? '')} />
          </FormField>
        ) : null}
      </div>
      {balancesMapped && !props.canPostBalances ? <Notice tone="attention">{t('balancesNeedAccounting')}</Notice> : null}
    </section>
  );
}

// ── Check ──────────────────────────────────────────────────────────────────────

const EDITABLE: SetupImportField[] = ['name', 'code', 'contactName', 'phone', 'email', 'paymentTerms', 'currency', 'country', 'clientType', 'openingBalance'];

function CheckRows(props: {
  kind: SetupImportKind;
  check: SetupImportCheck;
  rows: SetupImportRow[];
  sourceLine: number[];
  stale: boolean;
  checking: boolean;
  onRecheck: () => void;
  onEdit: (index: number, patch: Partial<SetupImportRow>) => void;
  skipErrors: boolean;
  setSkipErrors: (v: boolean) => void;
  onDownloadProblems: () => void;
}) {
  const t = useTranslations('finance.setupImport');
  const { check, rows, sourceLine } = props;
  const attention = check.rows
    .filter((r) => r.status !== 'READY')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.index - b.index);
  const ready = check.rows.filter((r) => r.status === 'READY');
  const { summary } = check;

  return (
    <section className="space-y-5" aria-label={t('steps.check')}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['ready', summary.total - summary.withErrors - summary.withWarnings - summary.skipped],
          ['warnings', summary.withWarnings],
          ['errors', summary.withErrors],
          ['skipped', summary.skipped],
        ].map(([key, value]) => (
          <div key={key} className="rounded-panel border border-border px-3 py-2">
            <dt className="text-caption text-muted-foreground">{t(`counts.${key}`)}</dt>
            <dd className="text-heading-sm font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <Notice tone={props.stale ? 'attention' : 'info'} title={props.stale ? t('staleTitle') : t('willHappen')}>
        {props.stale ? t('staleBody') : <OutcomeSentence kind={props.kind} check={check} />}
      </Notice>

      {!check.openingBalancesOpen ? <Notice tone="attention">{t('balancesClosed')}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={props.stale ? 'default' : 'outline'} size="sm" onClick={props.onRecheck} loading={props.checking}>
          {t('checkAgain')}
        </Button>
        {attention.some((r) => r.problems.length > 0) ? (
          <Button variant="ghost" size="sm" onClick={props.onDownloadProblems}>
            <Download size={14} aria-hidden="true" /> {t('downloadProblems')}
          </Button>
        ) : null}
      </div>

      {attention.length > 0 ? (
        <ul className="space-y-3" aria-label={t('problemRows')}>
          {attention.map((r) => (
            <ProblemRow
              key={r.index}
              result={r}
              row={rows[r.index]}
              line={sourceLine[r.index]}
              sourceLine={sourceLine}
              onEdit={(patch) => props.onEdit(r.index, patch)}
            />
          ))}
        </ul>
      ) : null}

      {ready.length > 0 ? (
        <Disclosure label={t('readyRows', { count: ready.length })}>
          <ul className="divide-y divide-border text-body-sm">
            {ready.map((r) => (
              <li key={r.index} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground tabular-nums">{t('line', { line: sourceLine[r.index] })} · </span>
                  {rows[r.index]?.name}
                </span>
                {r.openingBalance ? <span className="shrink-0 tabular-nums">{usd(r.openingBalance)}</span> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {summary.withErrors > 0 ? (
        <CheckboxField
          id="skip-errors"
          checked={props.skipErrors}
          onChange={(e) => props.setSkipErrors(e.target.checked)}
          label={t('skipErrors', { count: summary.withErrors })}
          description={t('skipErrorsHint')}
        />
      ) : null}
    </section>
  );
}

function ProblemRow(props: {
  result: SetupImportRowResult;
  row: SetupImportRow | undefined;
  line: number;
  sourceLine: number[];
  onEdit: (patch: Partial<SetupImportRow>) => void;
}) {
  const t = useTranslations('finance.setupImport');
  const { result, row } = props;
  if (!row) return null;
  const fields = [...new Set(result.problems.map((p) => p.field).filter((f): f is SetupImportField => f !== null && EDITABLE.includes(f)))];
  const action = row.action ?? 'CREATE';
  const setAction = (value: SetupImportAction) =>
    props.onEdit(value === 'MERGE' ? { action: value, mergeIntoId: result.duplicateOf?.id } : { action: value, mergeIntoId: undefined });

  return (
    <li className="rounded-panel border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-body-sm">
          <span className="text-muted-foreground tabular-nums">{t('line', { line: props.line })} · </span>
          <span className="font-medium text-foreground">{row.name || t('noName')}</span>
        </p>
        <StatusPill tone={STATUS_TONE[result.status]}>{t(`status.${result.status}`)}</StatusPill>
      </div>

      {result.problems.length > 0 ? (
        <ul className="mt-2 space-y-1 text-body-sm">
          {result.problems.map((p, i) => (
            <li key={`${p.code}-${i}`} className={p.severity === 'ERROR' ? 'text-danger' : 'text-warning'}>
              {p.field ? <span className="font-medium">{t(`fields.${p.field}`)}: </span> : null}
              {problemText(p, props.sourceLine, t)}
            </li>
          ))}
        </ul>
      ) : null}

      {fields.length > 0 && action !== 'SKIP' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <FormField key={field} htmlFor={`fix-${result.index}-${field}`} label={t('fix', { field: t(`fields.${field}`) })}>
              <Input
                id={`fix-${result.index}-${field}`}
                value={row[field] ?? ''}
                onChange={(e) => props.onEdit({ [field]: e.target.value })}
              />
            </FormField>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`action-${result.index}`} className="text-caption text-muted-foreground">{t('whatToDo')}</label>
        <Select id={`action-${result.index}`} value={action} onChange={(value) => setAction((value || 'CREATE') as SetupImportAction)}>
          <option value="CREATE">{t('actions.CREATE')}</option>
          {result.duplicateOf ? (
            <option value="MERGE">{t('actions.MERGE', { name: result.duplicateOf.name, code: result.duplicateOf.code })}</option>
          ) : null}
          <option value="SKIP">{t('actions.SKIP')}</option>
        </Select>
      </div>
    </li>
  );
}

function OutcomeSentence({ kind, check }: { kind: SetupImportKind; check: SetupImportCheck }) {
  const t = useTranslations('finance.setupImport');
  const tKind = useTranslations(`finance.setupImport.kinds.${kind}`);
  const { summary } = check;
  const parts = [tKind('willCreate', { count: summary.toCreate })];
  if (summary.toMerge > 0) parts.push(tKind('willMerge', { count: summary.toMerge }));
  if (summary.openingItems > 0) parts.push(tKind('willRecordBalance', { amount: usd(summary.openingBalanceTotal), count: summary.openingItems }));
  const notImported = summary.skipped + summary.withErrors;
  return (
    <span>
      {parts.join('; ')}.
      {notImported > 0 ? ` ${t('notImportedRows', { count: notImported })}` : ''}
    </span>
  );
}

// ── Done ───────────────────────────────────────────────────────────────────────

function ImportDone({ kind, result }: { kind: SetupImportKind; result: SetupImportResult }) {
  const t = useTranslations('finance.setupImport');
  const tKind = useTranslations(`finance.setupImport.kinds.${kind}`);
  return (
    <section className="space-y-4" aria-label={t('doneTitle')}>
      <Notice tone="success" title={t('doneTitle')}>
        {tKind('done', { created: result.created, merged: result.merged })}
        {result.openingItems > 0
          ? ` ${tKind('doneBalance', { amount: usd(result.openingBalanceTotal), count: result.openingItems })}`
          : ''}
      </Notice>
      {result.openingItems > 0 ? <p className="text-body-sm text-muted-foreground">{tKind('tieOut', { amount: usd(result.openingBalanceTotal) })}</p> : null}
      <p className="text-caption text-muted-foreground">{t('batch', { reference: result.batchReference })}</p>
      <div className="flex flex-wrap gap-2">
        <Link href={LIST_HREF[kind]} className="inline-flex min-h-10 items-center rounded-control bg-brand-primary px-4 text-body-sm font-medium text-brand-on-primary hover:bg-brand-primary-hover">
          {tKind('openList')}
        </Link>
        <Link href="/finance" className="inline-flex min-h-10 items-center rounded-control border border-border px-4 text-body-sm font-medium text-foreground hover:bg-muted">
          {t('backToChecklist')}
        </Link>
      </div>
    </section>
  );
}
