'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
} from '@erp/ui';
import type {
  BoqImportMode,
  BoqImportPreviewNode,
  BoqImportRequest,
  BoqImportViolation,
  BoqImportWarning,
} from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import { downloadCsv } from '../boq-export';
import { parseSpreadsheet, type ParsedSheet } from '../boq-import-parse';
import {
  applyMapping,
  autoGuessMapping,
  importTemplateCsv,
  isMappingComplete,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  type ColumnMapping,
} from '../boq-import-mapping';
import { useBoqImportPreview, useImportBoq } from '../hooks/use-boq';

type Step = 'upload' | 'map' | 'review';

/**
 * Upload → Map → Review → Commit.
 *
 * The browser parses the sheet and applies the mapping; the Review step is a server dry-run
 * (`preview`) so what it shows — the tree it will build, the auto-added sections, every error and
 * warning — is exactly what the commit will do. There is no client-side re-implementation of the
 * rules to drift from the server.
 */
export function BoqImportDialog({
  projectId,
  currency,
  open,
  onClose,
  onImported,
}: {
  projectId: string;
  currency: string;
  open: boolean;
  onClose: () => void;
  onImported: (summary: string) => void;
}) {
  const t = useTranslations('platform.boq.import');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<Step>('upload');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mode, setMode] = useState<BoqImportMode>('REPLACE');
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useBoqImportPreview(projectId);
  const commit = useImportBoq(projectId);

  const rows = useMemo(
    () => (sheet && mapping ? applyMapping(sheet.rows, mapping) : []),
    [sheet, mapping],
  );

  const close = () => {
    setStep('upload');
    setSheet(null);
    setMapping(null);
    setMode('REPLACE');
    setAddToLibrary(false);
    setParseError(null);
    preview.reset();
    commit.reset();
    onClose();
  };

  const request = (): BoqImportRequest => ({ mode, addToLibrary, rows });

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setParseError(null);
    preview.reset();
    try {
      const parsed = await parseSpreadsheet(file);
      if (parsed.columns.length === 0 || parsed.rows.length === 0) {
        setParseError(t('upload.parseFailed'));
        return;
      }
      setSheet(parsed);
      setMapping(autoGuessMapping(parsed.columns));
      setStep('map');
    } catch {
      setParseError(t('upload.parseFailed'));
    }
  };

  const runPreview = () => {
    if (!mapping || !isMappingComplete(mapping)) return;
    preview.mutate(request(), { onSuccess: () => setStep('review') });
  };

  const runCommit = () => {
    commit.mutate(request(), {
      onSuccess: (result) => {
        onImported(t('success', { items: result.createdItemCount }));
        close();
      },
    });
  };

  const data = preview.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !commit.isPending && !preview.isPending) close();
      }}
    >
      <DialogContent closeLabel={tCommon('close')} className="sm:max-w-2xl">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>

        <ol className="mt-4 flex items-center gap-2 text-caption text-muted-foreground">
          {(['upload', 'map', 'review'] as Step[]).map((name, index) => (
            <li key={name} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">›</span> : null}
              <span className={name === step ? 'font-semibold text-foreground' : undefined}>
                {t(`steps.${name}`)}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-5 space-y-4">
          {step === 'upload' ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-panel border border-dashed border-border px-4 py-10 text-center transition-colors hover:border-brand-primary hover:bg-muted/40"
              >
                <FileSpreadsheet size={28} strokeWidth={1.6} aria-hidden="true" className="text-muted-foreground" />
                <span className="text-body-sm font-medium text-foreground">{t('upload.prompt')}</span>
                <span className="text-caption text-muted-foreground">{t('upload.hint')}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  void onFileChosen(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {parseError ? <Alert variant="error" messages={[parseError]} /> : null}
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => downloadCsv('BOQ-import-template.csv', importTemplateCsv())}
                >
                  <Download size={15} aria-hidden="true" />
                  {t('upload.template')}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'map' && sheet && mapping ? (
            <div className="space-y-4">
              <p className="text-body-sm text-muted-foreground">{t('map.intro')}</p>

              <div className="space-y-3">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="grid grid-cols-[9rem,1fr] items-center gap-3">
                    <label htmlFor={`map-${field}`} className="text-body-sm font-medium text-foreground">
                      {t(`map.fields.${field}`)}
                      {REQUIRED_FIELDS.includes(field) ? (
                        <span className="ms-1 text-danger" aria-label={t('map.required')}>
                          *
                        </span>
                      ) : null}
                    </label>
                    <Select
                      id={`map-${field}`}
                      value={mapping[field] === null ? '' : String(mapping[field])}
                      onChange={(value) =>
                        setMapping((current) => ({
                          ...current!,
                          [field]: value === '' ? null : Number(value),
                        }))
                      }
                    >
                      <option value="">{t('map.notMapped')}</option>
                      {sheet.columns.map((column, index) => (
                        <option key={index} value={index}>
                          {column || `#${index + 1}`}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-[9rem,1fr] items-center gap-3">
                <label htmlFor="map-mode" className="text-body-sm font-medium text-foreground">
                  {t('map.modeLabel')}
                </label>
                <Select
                  id="map-mode"
                  value={mode}
                  onChange={(value) => setMode(value as BoqImportMode)}
                >
                  <option value="REPLACE">{t('map.modeReplace')}</option>
                  <option value="APPEND">{t('map.modeAppend')}</option>
                </Select>
              </div>

              <CheckboxField
                id="map-add-to-library"
                label={t('map.addToLibrary')}
                description={t('map.addToLibraryHint')}
                checked={addToLibrary}
                onChange={(event) => setAddToLibrary(event.target.checked)}
              />

              <p className="text-caption text-muted-foreground">{t('map.rowsFound', { count: rows.length })}</p>

              {preview.isError ? (
                <Alert variant="error" messages={[errorText(preview.error, t('failed'))]} />
              ) : null}
            </div>
          ) : null}

          {step === 'review' && data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-body-sm font-semibold text-foreground">
                  {t('review.summary', { sections: data.sectionCount, items: data.itemCount })}
                </span>
                {data.autoCreatedSectionCount > 0 ? (
                  <span className="text-caption text-muted-foreground">
                    {t('review.autoCreated', { count: data.autoCreatedSectionCount })}
                  </span>
                ) : null}
              </div>

              {data.violations.length > 0 ? (
                <Alert
                  variant="error"
                  title={t('review.errorsTitle')}
                  messages={data.violations.map((violation) => findingLine(violation, t))}
                />
              ) : null}

              {data.warnings.length > 0 ? (
                <Alert
                  variant="warning"
                  title={t('review.warningsTitle')}
                  messages={data.warnings.slice(0, 20).map((warning) => findingLine(warning, t))}
                />
              ) : null}

              {data.nodes.length > 0 ? (
                <div className="max-h-72 overflow-auto rounded-panel border border-border">
                  <ul className="divide-y divide-border">
                    {data.nodes.map((node) => (
                      <PreviewRow key={node.code} node={node} currency={currency} t={t} />
                    ))}
                  </ul>
                </div>
              ) : (
                <Alert variant="info" messages={[t('review.empty')]} />
              )}

              {!data.ok ? <p className="text-caption text-danger">{t('review.blocked')}</p> : null}

              {commit.isError ? (
                <Alert variant="error" messages={[errorText(commit.error, t('failed'))]} />
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {step === 'upload' ? (
            <Button type="button" variant="outline" onClick={close}>
              {tCommon('cancel')}
            </Button>
          ) : null}

          {step === 'map' ? (
            <>
              <Button
                type="button"
                onClick={runPreview}
                disabled={!isMappingComplete(mapping ?? emptyMapping) || rows.length === 0 || preview.isPending}
                className="gap-2"
              >
                <Upload size={15} aria-hidden="true" />
                {preview.isPending ? tCommon('loading') : t('map.preview')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep('upload')} disabled={preview.isPending}>
                {t('review.back')}
              </Button>
            </>
          ) : null}

          {step === 'review' && data ? (
            <>
              <Button
                type="button"
                onClick={runCommit}
                disabled={!data.ok || data.itemCount + data.sectionCount === 0 || commit.isPending}
              >
                {commit.isPending ? t('review.importing') : t('review.confirm', { items: data.itemCount })}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep('map')} disabled={commit.isPending}>
                {t('review.back')}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const emptyMapping: ColumnMapping = {
  code: null,
  description: null,
  unit: null,
  quantity: null,
  unitRate: null,
  sheetAmount: null,
};

function PreviewRow({
  node,
  currency,
  t,
}: {
  node: BoqImportPreviewNode;
  currency: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <li
      className="flex items-baseline gap-2 px-3 py-1.5 text-body-sm"
      style={{ paddingInlineStart: `${node.depth * 16 + 12}px` }}
    >
      <span className="font-mono text-caption text-muted-foreground">{node.code}</span>
      <span className={node.isLeaf ? 'text-foreground' : 'font-medium text-foreground'}>
        {node.description}
      </span>
      {node.autoCreated ? <Badge tone="neutral">{t('review.auto')}</Badge> : null}
      {node.isLeaf ? (
        <span className="ms-auto whitespace-nowrap text-caption text-muted-foreground">
          {node.quantity ? `${node.quantity}${node.unit ? ` ${node.unit}` : ''}` : ''}
          {node.totalAmount
            ? ` · ${formatMoney(node.totalAmount, currency, 'en')}`
            : node.isLeaf && !node.unitRate
              ? ` · ${t('review.unpriced')}`
              : ''}
        </span>
      ) : null}
    </li>
  );
}

function findingLine(
  finding: BoqImportViolation | BoqImportWarning,
  t: ReturnType<typeof useTranslations>,
): string {
  const where = finding.rowNumber !== null ? `${t('review.rowLabel', { row: finding.rowNumber })}: ` : '';
  return `${where}${finding.message}`;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
