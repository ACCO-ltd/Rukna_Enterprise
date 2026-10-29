'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FileDrop, FormField, Input, Notice, Select } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import { parseSpreadsheet, type ParsedSheet } from '@/lib/spreadsheet';

import { bankStatementsApi } from './api';
import { columnsReady, guessStatementColumns, readStatement, type DateOrder, type StatementColumns, type StatementField } from './statement-file';
import { statementKeys } from './statements-list';

const FIELDS: StatementField[] = ['date', 'description', 'reference', 'amount', 'moneyIn', 'moneyOut'];
const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;

/**
 * Step 6 — import a bank statement: choose the account, drop the bank's export, match its columns,
 * and give the opening and closing balances. Before anything is sent, the screen checks the file
 * adds up (opening + lines = closing) and names any row it could not read; the server checks again.
 */
export function StatementImport() {
  const t = useTranslations('finance.bankRec.import');
  const router = useRouter();
  const queryClient = useQueryClient();
  const banks = useBankAccounts();

  const [bankAccountId, setBankAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [columns, setColumns] = useState<StatementColumns>({});
  const [order, setOrder] = useState<DateOrder>('DMY');
  const [periodStart, setPeriodStart] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');

  // The last statement's closing balance is the next one's opening (B-3: the server insists on it).
  const previous = useQuery({
    queryKey: [...statementKeys.list(), bankAccountId],
    queryFn: () => bankStatementsApi.list(bankAccountId),
    enabled: Boolean(bankAccountId),
  });
  const lastClosing =
    [...(previous.data ?? [])].sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]?.closingBalance ?? null;

  const read = useMemo(() => (sheet && columnsReady(columns) ? readStatement(sheet.rows, columns, order) : null), [sheet, columns, order]);
  // Left blank, the opening balance is the last statement's closing balance.
  const openingText = opening || lastClosing || '';
  const openingMinor = parseMinorUnits(openingText.replace(/,/g, ''), MONEY_SCALE);
  const closingMinor = parseMinorUnits(closing.replace(/,/g, ''), MONEY_SCALE);
  const computedClosing = read && openingMinor !== null ? openingMinor + read.netMinor : null;
  const addsUp = computedClosing !== null && closingMinor !== null && computedClosing === closingMinor;

  const submit = useMutation({
    mutationFn: () =>
      bankStatementsApi.import({
        bankAccountId,
        periodStart: periodStart || read!.firstDate!,
        statementDate: statementDate || read!.lastDate!,
        openingBalance: fromMinorUnits(openingMinor!, MONEY_SCALE),
        closingBalance: fromMinorUnits(closingMinor!, MONEY_SCALE),
        fileName: file?.name,
        lines: read!.lines,
      }),
    onSuccess: (w) => {
      queryClient.setQueryData(statementKeys.one(w.statement.id), w);
      void queryClient.invalidateQueries({ queryKey: statementKeys.list() });
      router.push(`/finance/accounting/bank-reconciliation/${w.statement.id}`);
    },
  });

  const onFile = async (chosen: File) => {
    setFile(chosen);
    setReadError(null);
    try {
      const parsed = await parseSpreadsheet(chosen);
      setSheet(parsed);
      setColumns(guessStatementColumns(parsed.columns));
      if (parsed.rows.length === 0) setReadError(t('emptyFile'));
    } catch {
      setSheet(null);
      setReadError(t('unreadable'));
    }
  };

  const ready = Boolean(bankAccountId) && read !== null && read.lines.length > 0 && read.problems.length === 0 && addsUp;

  return (
    <div className="max-w-3xl space-y-6">
      <ListPageHeader title={t('title')} summary={t('subtitle')} />

      <FormField htmlFor="statement-bank" label={t('bankAccount')} required>
        <Select id="statement-bank" value={bankAccountId} onChange={(v) => { setBankAccountId(v); setOpening(''); }}>
          <option value="">{t('chooseBank')}</option>
          {(banks.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{`${b.bankName} · ${b.accountName}`}</option>
          ))}
        </Select>
      </FormField>

      <FileDrop
        accept=".csv,.xlsx,.xls"
        file={file}
        onFile={(f) => void onFile(f)}
        onRemove={() => { setFile(null); setSheet(null); }}
        title={t('dropTitle')}
        hint={t('dropHint')}
        chooseLabel={t('choose')}
        removeLabel={t('remove')}
        error={readError}
      />

      {sheet ? (
        <section className="space-y-4" aria-label={t('columnsTitle')}>
          <h2 className="text-body font-semibold text-foreground">{t('columnsTitle')}</h2>
          <p className="text-body-sm text-muted-foreground">{t('columnsHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <FormField key={field} htmlFor={`col-${field}`} label={t(`fields.${field}`)}>
                <Select
                  id={`col-${field}`}
                  value={columns[field] === null || columns[field] === undefined ? '' : String(columns[field])}
                  onChange={(v) => setColumns({ ...columns, [field]: v === '' ? null : Number(v) })}
                >
                  <option value="">{t('notUsed')}</option>
                  {sheet.columns.map((c, i) => (
                    <option key={`${i}-${c}`} value={String(i)}>{c || t('columnN', { n: i + 1 })}</option>
                  ))}
                </Select>
              </FormField>
            ))}
            <FormField htmlFor="date-order" label={t('dateOrder')}>
              <Select id="date-order" value={order} onChange={(v) => setOrder((v || 'DMY') as DateOrder)}>
                <option value="DMY">{t('orders.DMY')}</option>
                <option value="MDY">{t('orders.MDY')}</option>
                <option value="YMD">{t('orders.YMD')}</option>
              </Select>
            </FormField>
          </div>
          {!columnsReady(columns) ? <Notice tone="attention">{t('columnsNeeded')}</Notice> : null}
        </section>
      ) : null}

      {read ? (
        <section className="space-y-4" aria-label={t('balancesTitle')}>
          <p className="text-body-sm text-foreground">
            {t('readLines', { count: read.lines.length, net: usd(fromMinorUnits(read.netMinor, MONEY_SCALE)) })}
          </p>
          {read.problems.length > 0 ? (
            <Alert variant="error" title={t('problemsTitle', { count: read.problems.length })}>
              <ul className="list-disc ps-5">
                {read.problems.slice(0, 10).map((p) => <li key={p.line}>{t(`problems.${p.problem}`, { line: p.line })}</li>)}
              </ul>
            </Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="period-start" label={t('periodStart')} hint={read.firstDate ? t('fromFile', { date: read.firstDate }) : undefined}>
              <DatePicker id="period-start" value={periodStart || read.firstDate || ''} onChange={(v) => setPeriodStart(v ?? '')} />
            </FormField>
            <FormField htmlFor="statement-date" label={t('statementDate')} hint={read.lastDate ? t('fromFile', { date: read.lastDate }) : undefined}>
              <DatePicker id="statement-date" value={statementDate || read.lastDate || ''} onChange={(v) => setStatementDate(v ?? '')} />
            </FormField>
            <FormField htmlFor="opening" label={t('opening')} required hint={lastClosing ? t('lastClosing', { amount: usd(lastClosing) }) : undefined}>
              <Input id="opening" inputMode="decimal" value={openingText} placeholder="0.00" onChange={(e) => setOpening(e.target.value)} />
            </FormField>
            <FormField htmlFor="closing" label={t('closing')} required>
              <Input id="closing" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} />
            </FormField>
          </div>
          {computedClosing !== null && closingMinor !== null ? (
            addsUp ? (
              <Notice tone="success">{t('addsUp')}</Notice>
            ) : (
              <Notice tone="danger" title={t('doesNotAddUpTitle')}>
                {t('doesNotAddUp', { computed: usd(fromMinorUnits(computedClosing, MONEY_SCALE)), closing: usd(fromMinorUnits(closingMinor, MONEY_SCALE)) })}
              </Notice>
            )
          ) : null}
        </section>
      ) : null}

      {submit.isError ? <Alert variant="error">{submit.error instanceof ApiError ? submit.error.message : t('failed')}</Alert> : null}

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={() => submit.mutate()} disabled={!ready} loading={submit.isPending}>
          {t('submit', { count: read?.lines.length ?? 0 })}
        </Button>
      </div>
    </div>
  );
}
