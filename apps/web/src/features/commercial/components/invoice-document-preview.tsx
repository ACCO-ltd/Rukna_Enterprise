'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Skeleton, cn } from '@erp/ui';
import { Download, FileWarning, RefreshCw } from 'lucide-react';
import type { CommercialBillingPackageDocument } from '@erp/types';

import { getIssuedInvoiceDocument } from '../api/commercial-api';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InvoiceDocumentPreviewProps {
  documents: CommercialBillingPackageDocument[];
  /** False while any document in the package is still missing its posted invoice number. */
  allNumbered: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * The real, posted PDF for an issued invoice — embedded rather than re-described, so what the
 * client is about to receive is exactly what the reviewer sees. Fetched lazily (Slice 4B) and
 * rendered through the browser's own PDF viewer via `<iframe>`, which is what gives it working
 * zoom, page navigation and print controls for free.
 *
 * Renders nothing useful until every document in the package carries a posted invoice number —
 * the branded PDF is generated from the posted record, so a DRAFT document has none to show.
 */
export function InvoiceDocumentPreview({ documents, allNumbered, className }: InvoiceDocumentPreviewProps) {
  const t = useTranslations('commercial.contractMilestones.sendInvoice');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = documents.find((d) => d.invoiceId === selectedId) ?? documents[0] ?? null;

  const query = useQuery({
    queryKey: ['invoice-document', selected?.invoiceId],
    queryFn: () => getIssuedInvoiceDocument(selected!.invoiceId),
    enabled: allNumbered && Boolean(selected),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className={cn('flex h-full min-h-120 flex-col rounded-panel border border-border bg-surface', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-foreground">{t('previewTitle')}</p>
          <p className="truncate text-caption text-muted-foreground">{t('previewHint')}</p>
        </div>
        {query.data?.url ? (
          <a
            href={query.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2.5 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            <Download size={14} aria-hidden="true" />
            {t('downloadPdf')}
          </a>
        ) : null}
      </div>

      {documents.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
          {documents.map((doc) => (
            <button
              key={doc.invoiceId}
              type="button"
              onClick={() => setSelectedId(doc.invoiceId)}
              aria-pressed={doc.invoiceId === selected?.invoiceId}
              className={cn(
                'rounded-full border px-2.5 py-1 text-caption font-medium transition-colors',
                doc.invoiceId === selected?.invoiceId
                  ? 'border-brand-primary bg-brand-accent text-brand-primary'
                  : 'border-border-strong bg-surface text-muted-foreground hover:text-foreground',
              )}
            >
              {doc.sourceReference}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative flex-1 overflow-hidden bg-muted">
        {!allNumbered ? (
          <PreviewPlaceholder icon={<FileWarning size={22} aria-hidden="true" />} message={t('previewUnavailable')} />
        ) : query.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-64 w-full" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Alert variant="error" messages={[t('previewLoadFailed')]} />
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="inline-flex items-center gap-1.5 text-caption font-medium text-brand-primary hover:underline"
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t('retry')}
            </button>
          </div>
        ) : (
          <iframe
            key={query.data.url}
            src={query.data.url}
            title={t('previewTitle')}
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}

function PreviewPlaceholder({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="max-w-xs text-body-sm text-muted-foreground">{message}</p>
    </div>
  );
}
