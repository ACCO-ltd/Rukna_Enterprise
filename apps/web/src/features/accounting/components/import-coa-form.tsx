'use client';

/**
 * Bulk-import the chart of accounts (tenant bootstrap).
 *
 * A fresh organisation needs a whole chart, and adding it one account at a time through the
 * create form is not viable. This pastes or uploads rows — `code, name, class, subtype,
 * normalBalance, parentCode` — and calls `POST /accounts/import`, which upserts by code.
 *
 * Two things are deliberate:
 *  1. **Parsing errors are shown by line before the request is sent**, so a malformed paste is
 *     fixed here rather than discovered as a row the server silently collected into `errors[]`.
 *  2. **The result is shown, not assumed.** The endpoint reports created / updated / skipped and
 *     a per-row error list; a partly-successful import (some rows created, one bad) is a real
 *     outcome, so the summary states all three counts and lists any row the server rejected.
 */

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Textarea } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { parseChartImport, type ImportChartResult } from '../coa-setup';
import { useImportChartOfAccounts } from '../hooks/use-accounting';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ImportCoaForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('accounting.chartOfAccounts.import');
  const tCommon = useTranslations('common');

  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportChartResult | null>(null);
  const importMutation = useImportChartOfAccounts();
  const pasteId = useId();

  const parsed = useMemo(() => parseChartImport(text, today()), [text]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setResult(null);
  }

  function handleImport() {
    if (parsed.rows.length === 0) return;
    importMutation.mutate(parsed.rows, {
      onSuccess: (data) => setResult(data),
    });
  }

  // The result view: shown after a successful call, whatever the per-row outcome.
  if (result) {
    return (
      <div className="space-y-4">
        <Alert
          variant={result.errors.length > 0 ? 'warning' : 'success'}
          title={t('resultTitle')}
          messages={[
            t('resultSummary', {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
            }),
          ]}
        />

        {result.errors.length > 0 ? (
          <div className="rounded-panel border border-border bg-surface p-4">
            <p className="text-sm font-medium text-foreground">
              {t('resultErrors', { count: result.errors.length })}
            </p>
            <ul className="mt-2 space-y-1">
              {result.errors.map((error) => (
                <li key={error.code} className="text-caption text-muted-foreground">
                  {t('resultErrorRow', { code: error.code, message: error.message })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="button" onClick={onDone}>
            {t('done')}
          </Button>
        </div>
      </div>
    );
  }

  const requestFailed = importMutation.isError
    ? importMutation.error instanceof ApiError
      ? importMutation.error.message
      : t('failed')
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

      <FormField htmlFor={pasteId} label={t('pasteLabel')} hint={t('pasteHint')}>
        <Textarea
          id={pasteId}
          rows={8}
          value={text}
          placeholder={t('placeholder')}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
          className="font-mono text-caption"
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-primary underline-offset-2 hover:underline">
          {t('uploadLabel')}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        {text.trim() ? (
          <span className="text-caption text-muted-foreground">
            {t('rowsParsed', { count: parsed.rows.length })}
          </span>
        ) : null}
      </div>

      {parsed.errors.length > 0 ? (
        <Alert
          variant="error"
          messages={parsed.errors.map((error) =>
            t('parseError', {
              line: error.line,
              message: t(`parseProblem.${error.problem}`),
            }),
          )}
        />
      ) : null}

      {requestFailed ? <Alert variant="error" messages={[requestFailed]} /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={importMutation.isPending}>
          {tCommon('cancel')}
        </Button>
        <Button
          type="button"
          onClick={handleImport}
          disabled={
            importMutation.isPending || parsed.rows.length === 0 || parsed.errors.length > 0
          }
          title={parsed.rows.length === 0 ? t('nothingToImport') : undefined}
        >
          {importMutation.isPending ? t('importing') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
