'use client';

/**
 * ─── Bill evidence (ADR-045) ──────────────────────────────────────────────────────────────
 *
 * A bill recorded from a store receipt / invoice carries that document as its evidence: the
 * buyer's photos, frozen once recorded. They show prices, so they follow the quote-photo rule —
 * readable with view:procurement and view:commitment-ledger (the server's
 * STORE_DOCUMENT_PHOTO check); anyone else sees how many pages there are, never a broken image.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import type { SupplierBillEvidence } from '../types';
import { PhotoViewer } from './quotes/photo-viewer';
import { PhotosHidden, QuotePhotoImage } from './quotes/quote-shared';

export function BillEvidence({ evidence }: { evidence: SupplierBillEvidence }) {
  const t = useTranslations('procurement.bills.evidence');
  const tKind = useTranslations('procurement.quotes.payment.documents.kind');
  const { can } = usePermissions();
  const [open, setOpen] = useState<number | null>(null);
  const kind = tKind(evidence.kind);
  const mayView = can('view:procurement') && can(PROCUREMENT_PERMISSIONS.viewCommitments);
  const photos = evidence.photos ?? [];

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-muted-foreground">
        {t('intro', { kind: kind.toLowerCase(), number: evidence.number })}
      </p>
      {!mayView || photos.length === 0 ? (
        <PhotosHidden count={photos.length} className="aspect-[3/4] w-full max-w-xs" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label={t('photosLabel', { number: evidence.number })}>
          {photos.map((photo, index) => (
            <li key={photo.fileId}>
              <button
                type="button"
                onClick={() => setOpen(index)}
                className="block w-full overflow-hidden rounded-panel border border-border bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                aria-label={t('zoom', { kind, page: photo.pageNumber ?? index + 1 })}
              >
                <QuotePhotoImage
                  fileId={photo.fileId}
                  alt={t('photoAlt', { kind, page: photo.pageNumber ?? index + 1 })}
                  className="aspect-[3/4] w-full"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null ? (
        <PhotoViewer
          store={evidence.number}
          photos={photos.map((p, i) => ({
            fileId: p.fileId,
            pageNumber: p.pageNumber ?? i + 1,
            capturedAt: null,
            source: 'UNKNOWN',
            sha256: '',
            reusedOn: [],
          }))}
          initialPage={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
