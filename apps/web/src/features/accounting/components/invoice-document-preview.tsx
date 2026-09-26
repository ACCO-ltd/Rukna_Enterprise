'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  Skeleton,
} from '@erp/ui';

import { useInvoiceDocumentUrl } from '../hooks/use-invoices';

/**
 * The invoice PDF, embedded rather than a bare new-tab link — the only such viewer in `apps/web`
 * today; every other file surface (Documents, this same "View invoice document" elsewhere) opens
 * a signed URL in a new tab. An `<iframe>` on the signed URL is enough for a real, zoomable,
 * printable preview in every desktop browser's native PDF renderer, so this does not pull in a
 * PDF.js dependency. Download and "Open in new tab" stay as explicit secondary actions — never
 * the primary way to see the document.
 */
export function InvoiceDocumentPreview({ invoiceId, active }: { invoiceId: string; active: boolean }) {
  const t = useTranslations('accounting.invoices.document');
  const query = useInvoiceDocumentUrl(invoiceId, active);

  if (!active) return null;

  if (query.isPending) {
    return <Skeleton className="h-130 w-full rounded-panel" />;
  }

  if (query.isError || !query.data) {
    return (
      <Alert variant="error" messages={[t('unavailable')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const { url, originalName } = query.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={url} download={originalName}>
            {t('download')}
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t('openNewTab')}
          </a>
        </Button>
      </div>
      <iframe
        key={url}
        src={url}
        title={originalName}
        className="h-[70vh] min-h-130 w-full rounded-panel border border-border bg-surface-subtle"
      />
    </div>
  );
}

/**
 * Mobile equivalent: the preview never fits usefully in a stacked narrow column, so it opens
 * full-screen in a `Sheet` instead of always rendering a cramped iframe.
 */
export function MobileInvoicePreviewTrigger({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('accounting.invoices.document');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full sm:hidden">
          {t('previewMobile')}
        </Button>
      </SheetTrigger>
      <SheetContent side="end" size="2xl" className="sm:hidden">
        <SheetHeader>
          <SheetTitle>{t('heading')}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col">
          <InvoiceDocumentPreview invoiceId={invoiceId} active={open} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
