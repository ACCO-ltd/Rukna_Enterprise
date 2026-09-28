'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  CheckboxField,
  FileDrop,
  LifecycleStepper,
  Notice,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { BoqImportMode, BoqImportPreview, BoqImportRequest, BoqImportWarning } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import { downloadCsv } from '../boq-export';
import { previewToTree } from '../boq-import-preview';
import { parseSpreadsheet, type ParsedSheet } from '../boq-import-parse';
import {
  applyMapping,
  autoGuessMapping,
  importTemplateCsv,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  type ColumnMapping,
  type ImportField,
} from '../boq-import-mapping';
import { computeRollup } from '../boq-totals';
import { buildRows } from '../boq-rows';
import { useBoqImportPreview, useImportBoq } from '../hooks/use-boq';
import { BoqGrid } from './boq-grid';

type Step = 'upload' | 'map' | 'review';

export interface ImportOutcome {
  items: number;
  sections: number;
  fileName: string;
}

/**
 * Import, as a page inside the BOQ tab rather than a modal: a bill of 400 lines needs the room,
 * and the review is a document to read, not a confirmation to click through.
 *
 * Upload → Match columns → Review. The browser parses and maps (the API never sees a file); the
 * review is the server's dry-run (`…/import/preview`), so what it shows — the tree, the counts,
 * every finding — is exactly what the commit (`…/import`) will do. There is no undo on the API,
 * so the review is the last look.
 */
export function BoqImportView({
  projectId,
  currency,
  existing,
  canViewCost,
  onCancel,
  onImported,
}: {
  projectId: string;
  currency: string;
  /** What the draft already holds. Zero lines → no Add/Replace question. */
  existing: { sections: number; items: number };
  canViewCost: boolean;
  onCancel: () => void;
  onImported: (outcome: ImportOutcome) => void;
}) {
  const t = useTranslations('platform.boq.import');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mode, setMode] = useState<BoqImportMode>('APPEND');
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mapAttempted, setMapAttempted] = useState(false);
  // The last dry-run, kept while a re-run (Add ↔ Replace) is in flight so the review never blanks.
  const [reviewData, setReviewData] = useState<BoqImportPreview | null>(null);

  const preview = useBoqImportPreview(projectId);
  const commit = useImportBoq(projectId);
  const hasExisting = existing.items + existing.sections > 0;

  const rows = useMemo(() => (sheet && mapping ? applyMapping(sheet.rows, mapping) : []), [sheet, mapping]);
  const skipped = sheet ? sheet.rows.length - rows.length : 0;

  const request = (nextMode: BoqImportMode = mode): BoqImportRequest => ({
    mode: hasExisting ? nextMode : 'APPEND',
    addToLibrary,
    rows,
  });

  const chooseFile = async (chosen: File) => {
    setUploadError(null);
    preview.reset();
    try {
      const parsed = await parseSpreadsheet(chosen);
      if (parsed.columns.length === 0 || parsed.rows.length === 0) {
        setUploadError(t('upload.parseFailed'));
        return;
      }
      setFile({ name: chosen.name, size: chosen.size });
      setSheet(parsed);
      setMapping(autoGuessMapping(parsed.columns));
    } catch {
      setUploadError(t('upload.parseFailed'));
    }
  };

  const missingRequired = (field: ImportField) =>
    REQUIRED_FIELDS.includes(field) && mapping !== null && mapping[field] === null;

  const next = () => {
    if (step === 'upload') {
      if (!sheet) {
        setUploadError(t('upload.required'));
        return;
      }
      setStep('map');
      return;
    }
    if (step === 'map') {
      setMapAttempted(true);
      if (!mapping || REQUIRED_FIELDS.some((field) => mapping[field] === null) || rows.length === 0) return;
      preview.mutate(request(), {
        onSuccess: (result) => {
          setReviewData(result);
          setStep('review');
        },
      });
      return;
    }
    commit.mutate(request(), {
      onSuccess: (result) =>
        onImported({
          items: result.createdItemCount,
          sections: result.createdSectionCount,
          fileName: file?.name ?? '',
        }),
    });
  };

  const back = () => {
    if (step === 'review') setStep('map');
    else if (step === 'map') setStep('upload');
    else onCancel();
  };

  const data = step === 'review' ? (reviewData ?? undefined) : undefined;
  const tree = useMemo(() => (data ? previewToTree(data.nodes, currency) : []), [data, currency]);
  const rollup = useMemo(() => computeRollup(tree), [tree]);
  const previewRows = useMemo(
    () => buildRows(tree, { collapsed: new Set(), search: '', pricing: 'all' }),
    [tree],
  );

  const pending = preview.isPending || commit.isPending;
  const canImport = Boolean(data?.ok) && (data?.itemCount ?? 0) + (data?.sectionCount ?? 0) > 0;
  const primaryLabel =
    step === 'review'
      ? commit.isPending
        ? t('review.importing')
        : t('review.confirm', { items: data?.itemCount ?? 0 })
      : preview.isPending
        ? tCommon('loading')
        : t('continue');

  return (
    <div className="flex min-h-[60vh] flex-col rounded-panel border border-border bg-surface shadow-e1">
      <div className="space-y-4 border-b border-border px-4 py-4 sm:px-6">
        <Button variant="link" size="sm" className="h-auto gap-1.5 p-0" onClick={onCancel} disabled={commit.isPending}>
          <ArrowLeft size={14} aria-hidden="true" className="rtl:rotate-180" />
          {t('backToBoq')}
        </Button>
        <div>
          <h2 className="text-h2 font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('description')}</p>
        </div>
        <LifecycleStepper
          current={step}
          steps={[
            { key: 'upload', label: t('steps.upload') },
            { key: 'map', label: t('steps.map') },
            { key: 'review', label: t('steps.review') },
          ]}
          stepOfLabel={(n, total) => t('stepOf', { n, total })}
        />
      </div>

      <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
        {step === 'upload' ? (
          <FileDrop
            accept=".xlsx,.xls,.csv"
            file={file}
            onFile={(chosen) => void chooseFile(chosen)}
            onRemove={() => {
              setFile(null);
              setSheet(null);
              setMapping(null);
              preview.reset();
            }}
            title={t('upload.prompt')}
            hint={t('upload.hint')}
            chooseLabel={t('upload.choose')}
            removeLabel={t('upload.remove')}
            error={uploadError}
          >
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto gap-1.5 p-0"
              onClick={() => downloadCsv('BOQ-import-template.csv', importTemplateCsv())}
            >
              <Download size={14} aria-hidden="true" />
              {t('upload.template')}
            </Button>
          </FileDrop>
        ) : null}

        {step === 'map' && sheet && mapping ? (
          <div className="space-y-3">
            <p className="text-body-sm text-muted-foreground">{t('map.intro')}</p>
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('map.fieldColumn')}</TableHead>
                    <TableHead>{t('map.sheetColumn')}</TableHead>
                    <TableHead>{t('map.firstRow')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_FIELDS.map((field) => {
                    const column = mapping[field];
                    const sample = column === null ? null : (sheet.rows[0]?.[column] ?? '') || null;
                    const error = mapAttempted && missingRequired(field);
                    return (
                      <TableRow key={field} className="hover:bg-transparent">
                        <TableCell className="align-top">
                          <label htmlFor={`map-${field}`} className="text-body-sm font-medium text-foreground">
                            {t(`map.fields.${field}`)}
                            {REQUIRED_FIELDS.includes(field) ? (
                              <span className="ms-0.5 text-danger" aria-hidden="true">
                                *
                              </span>
                            ) : null}
                          </label>
                          {t.has(`map.fieldHints.${field}`) ? (
                            <p className="text-caption text-muted-foreground">{t(`map.fieldHints.${field}`)}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-56 align-top">
                          <Select
                            id={`map-${field}`}
                            value={column === null ? '' : String(column)}
                            aria-invalid={error || undefined}
                            aria-describedby={error ? `map-${field}-error` : undefined}
                            onChange={(value) =>
                              setMapping((current) => ({ ...current!, [field]: value === '' ? null : Number(value) }))
                            }
                          >
                            <option value="">{t('map.notMapped')}</option>
                            {sheet.columns.map((name, index) => (
                              <option key={index} value={index}>
                                {name || `#${index + 1}`}
                              </option>
                            ))}
                          </Select>
                          {error ? (
                            <p id={`map-${field}-error`} className="mt-1 text-caption text-danger">
                              {t('map.requiredError', { field: t(`map.fields.${field}`) })}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top text-body-sm text-muted-foreground">{sample ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableScroll>
            <p className="text-caption text-muted-foreground">{t('map.rowsFound', { count: rows.length })}</p>
            {mapAttempted && rows.length === 0 ? (
              <p className="text-caption text-danger">{t('map.noRows')}</p>
            ) : null}
            {preview.isError ? <Notice tone="danger">{errorText(preview.error, t('failed'))}</Notice> : null}
          </div>
        ) : null}

        {step === 'review' && data ? (
          <div className="space-y-5">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('review.sections')}</dt>
                <dd className="font-semibold tabular-nums">{data.sectionCount}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('review.items')}</dt>
                <dd className="font-semibold tabular-nums">{data.itemCount}</dd>
              </div>
              {canViewCost ? (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">{t('review.total')}</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(rollup.totals.totalAmount, currency, locale) ?? '—'}
                  </dd>
                </div>
              ) : null}
            </dl>

            {data.violations.length > 0 ? (
              <Notice tone="danger" title={t('review.errorsTitle')}>
                <ul className="mt-1 list-disc space-y-0.5 ps-5">
                  {data.violations.map((finding, index) => (
                    <li key={index}>{findingLine(finding.rowNumber, finding.message, t)}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}

            <ReviewAttention warnings={data.warnings} skipped={skipped} t={t} />

            {hasExisting ? (
              <RadioGroup<BoqImportMode>
                name="boq-import-mode"
                label={t('review.modeLabel')}
                variant="card"
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  preview.mutate(request(value), { onSuccess: setReviewData });
                }}
                options={[
                  {
                    value: 'APPEND',
                    label: t('review.modeAppend'),
                    description: t('review.modeAppendHint', { items: existing.items }),
                  },
                  {
                    value: 'REPLACE',
                    label: t('review.modeReplace'),
                    description: t('review.modeReplaceHint', { items: existing.items, sections: existing.sections }),
                  },
                ]}
              />
            ) : null}

            <CheckboxField
              id="boq-import-library"
              label={t('map.addToLibrary')}
              description={t('map.addToLibraryHint')}
              checked={addToLibrary}
              onChange={(event) => setAddToLibrary(event.target.checked)}
            />

            {previewRows.length > 0 ? (
              <BoqGrid
                rows={previewRows}
                currency={currency}
                totalAmount={rollup.totals.totalAmount}
                sectionTotals={rollup.sectionTotals}
                isFiltered={false}
                canViewCommercials={canViewCost}
                showSource={false}
                collapsed={new Set()}
                onToggle={() => {}}
                onSelect={() => {}}
                commands={null}
                emptyMessage={t('review.empty')}
              />
            ) : (
              <Notice tone="info">{t('review.empty')}</Notice>
            )}

            {!data.ok ? <p className="text-body-sm text-danger">{t('review.blocked')}</p> : null}
            {commit.isError ? <Notice tone="danger">{errorText(commit.error, t('failed'))}</Notice> : null}
          </div>
        ) : null}
      </div>

      {/* The one primary — Continue, then Import — is hidden, not disabled, when the review
          found errors: the line above says why and Back is the way forward. */}
      <div className="sticky bottom-0 z-20 flex flex-col-reverse gap-2.5 border-t border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <Button type="button" variant="outline" onClick={back} disabled={pending}>
          {step === 'upload' ? tCommon('cancel') : t('review.back')}
        </Button>
        {step !== 'review' || canImport ? (
          <Button type="button" onClick={next} disabled={pending}>
            {primaryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One attention notice for everything that imports but deserves a look: unpriced rows, amounts
 * that disagree with quantity × rate, rows skipped as blank — plus anything else the planner
 * warned about. Grouped, with row numbers, so the reader can find them in the sheet.
 */
function ReviewAttention({
  warnings,
  skipped,
  t,
}: {
  warnings: BoqImportWarning[];
  skipped: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const unpriced = warnings.filter((warning) => warning.code === 'UNPRICED_ITEM');
  const mismatched = warnings.filter((warning) => warning.code === 'AMOUNT_MISMATCH');
  const other = warnings.filter(
    (warning) => warning.code !== 'UNPRICED_ITEM' && warning.code !== 'AMOUNT_MISMATCH' && warning.code !== 'AUTO_CREATED_SECTION',
  );
  if (unpriced.length + mismatched.length + other.length + skipped === 0) return null;

  const rowsOf = (list: BoqImportWarning[]) =>
    list
      .map((warning) => warning.rowNumber)
      .filter((row): row is number => row !== null)
      .slice(0, 12)
      .join(', ');

  return (
    <Notice tone="attention" title={t('review.attentionTitle')}>
      <ul className="mt-1 list-disc space-y-0.5 ps-5">
        {unpriced.length > 0 ? (
          <li>{t('review.unpricedRows', { count: unpriced.length, rows: rowsOf(unpriced) })}</li>
        ) : null}
        {mismatched.length > 0 ? (
          <li>{t('review.mismatchRows', { count: mismatched.length, rows: rowsOf(mismatched) })}</li>
        ) : null}
        {skipped > 0 ? <li>{t('review.skippedRows', { count: skipped })}</li> : null}
        {other.slice(0, 8).map((warning, index) => (
          <li key={index}>{findingLine(warning.rowNumber, warning.message, t)}</li>
        ))}
      </ul>
    </Notice>
  );
}

function findingLine(row: number | null, message: string, t: ReturnType<typeof useTranslations>): string {
  return row !== null ? `${t('review.rowLabel', { row })}: ${message}` : message;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
