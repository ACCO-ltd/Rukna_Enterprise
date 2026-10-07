'use client';

/**
 * On a purchase order raised from a quotation award (ADR-044 §7–8): says the award is its
 * approval — "Approved by quotation award QR-…" — and shows the winning quote's photos as
 * evidence, with open and download links. Raise-order writes `quotationRef = QR-…` and attaches
 * the photos with purpose QUOTATION; a PO without that reference renders nothing.
 */

import { useTranslations } from 'next-intl';
import { Button, Notice } from '@erp/ui';
import { Download, ExternalLink } from 'lucide-react';

import { getFileDownloadUrl } from '@/features/files/api/files-api';

import { usePoRevisionAttachments } from '../../hooks/use-procurement';
import type { PurchaseOrder, PurchaseOrderRevision } from '../../types';
import { QuotePhotoImage } from './quote-shared';

/** A quotation-request number as raise-order writes it. */
export function isAwardReference(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && /^QR-/i.test(ref.trim());
}

export function AwardEvidence({
  order,
  revision,
}: {
  order: PurchaseOrder;
  revision: PurchaseOrderRevision | null;
}) {
  const t = useTranslations('procurement.quotes.order.evidence');
  const fromAward = isAwardReference(revision?.quotationRef);
  const attachments = usePoRevisionAttachments(fromAward ? order.id : '');
  if (!fromAward || !revision) return null;
  const photos = (attachments.data ?? []).filter(
    (a) => a.purpose === 'QUOTATION' && a.purchaseOrderRevisionId === revision.id,
  );

  const open = async (fileId: string, download: boolean) => {
    const { url } = await getFileDownloadUrl(fileId);
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.download = '';
      link.rel = 'noopener';
      link.click();
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <Notice tone="success" title={t('title', { ref: revision.quotationRef!.trim() })}>
      <p className="mt-1">{t('body')}</p>
      {photos.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption font-semibold text-muted-foreground">{t('photos')}</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {photos.map((photo) => (
              <li key={photo.id} className="w-28 space-y-1">
                <div className="overflow-hidden rounded-control border border-border bg-surface">
                  <QuotePhotoImage
                    fileId={photo.platformFileId}
                    alt={photo.file?.originalName ?? t('photos')}
                    className="aspect-[3/4] w-full"
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`${t('open')}: ${photo.file?.originalName ?? ''}`.trim()}
                    onClick={() => void open(photo.platformFileId, false)}
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`${t('download')}: ${photo.file?.originalName ?? ''}`.trim()}
                    onClick={() => void open(photo.platformFileId, true)}
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Notice>
  );
}
