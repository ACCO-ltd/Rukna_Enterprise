'use client';

/**
 * Accounting → Invoice settings: the live preview beside the form.
 *
 * It shows the REAL invoice PDF — rendered by the API from the settings as they are typed, saved or
 * not, on a sample client, project and stage — so what you see is exactly what the next invoice
 * prints. The request is debounced, the last PDF stays on screen while the next one renders, and a
 * settings value that is not valid yet is left out of the preview rather than blocking it.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button } from '@erp/ui';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';

import { ApiError } from '@/lib/api-client';

import { useInvoiceSettingsPreview } from '../hooks/use-accounting';
import type { UpdateInvoiceDocumentSettingsBody } from '../types';

export const PREVIEW_DEBOUNCE_MS = 600;

/** `value`, once it has stopped changing for `delayMs` (compared by content, not identity). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const key = JSON.stringify(value);
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
    // Re-arm only when the content changes; `value` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  return settled;
}

/**
 * A blob: URL for the LAST rendered PDF. A failed render (no blob) keeps the previous URL alive, so
 * the frame and "Open full size" keep showing the last good preview; a URL is revoked only when a
 * newer PDF replaces it. (The last one is left to the page's lifetime: revoking it on unmount would
 * also fire on React StrictMode's simulated unmount and break the live preview.)
 */
function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    // Syncing with an external resource: the URL is created for the blob and replaces the last.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl((previous) => {
      if (previous && previous !== next) URL.revokeObjectURL(previous);
      return next;
    });
  }, [blob]);
  return url;
}

export interface InvoiceSettingsPreviewProps {
  /** The settings to print, already stripped of values that would be refused. */
  body: UpdateInvoiceDocumentSettingsBody;
  /** The form differs from what is saved. */
  unsaved: boolean;
  /** Some typed values are left out because they are not valid yet. */
  partial: boolean;
}

export function InvoiceSettingsPreview({ body, unsaved, partial }: InvoiceSettingsPreviewProps) {
  const t = useTranslations('accounting.invoiceSettings');
  const settled = useDebouncedValue(body, PREVIEW_DEBOUNCE_MS);
  const preview = useInvoiceSettingsPreview(settled);
  const url = useObjectUrl(preview.data);
  const waiting = JSON.stringify(settled) !== JSON.stringify(body);
  const updating = waiting || preview.isFetching;
  const error = preview.isError
    ? preview.error instanceof ApiError
      ? preview.error.message
      : t('previewFailed')
    : null;

  return (
    <section
      aria-labelledby="invoice-preview-title"
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="invoice-preview-title" className="text-sm font-semibold text-foreground">
            {t('previewTitle')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* One persistent live region; only its text changes. */}
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground empty:hidden"
            role="status"
            aria-live="polite"
          >
            {updating || !url ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                {url ? t('previewUpdating') : t('previewLoading')}
              </>
            ) : null}
          </span>
          {!updating && url && unsaved ? (
            <Badge tone="attention">{t('previewUnsaved')}</Badge>
          ) : null}
          {url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                {t('previewOpen')}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {partial ? <p className="text-xs text-warning">{t('previewPartial')}</p> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {/* Phones render PDFs in frames poorly (or not at all): there, "Open full size" is the preview. */}
      <div className="relative hidden aspect-[210/297] w-full overflow-hidden rounded-control border border-border bg-surface-subtle sm:block">
        {url ? (
          <iframe
            src={`${url}#toolbar=0&navpanes=0&view=FitH`}
            title={t('previewFrame')}
            className={
              updating ? 'size-full opacity-70 transition-opacity' : 'size-full transition-opacity'
            }
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            {error ? (
              <FileText className="size-6" aria-hidden="true" />
            ) : (
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            )}
            {error ? t('previewFailed') : t('previewLoading')}
          </div>
        )}
      </div>
    </section>
  );
}
