'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, CircleCheck, ImageIcon } from 'lucide-react';
import { Alert, Button } from '@erp/ui';
import type { DocumentReadResult, DocumentReadingKind } from '@erp/types';

import { ReadPhotoButton } from '@/features/document-reader/read-photo-button';
import { uploadFile } from '@/features/files/api/files-api';

import { downscaleImage } from '../quotations/capture/downscale';
import { usePhotoPicker } from './quotes/photo-picker';

/**
 * Step 7 — a photo taken (or picked) on a form, uploaded, and optionally read to fill the form:
 * the delivery note on a goods receipt (attached to it when saved), a handwritten list on a
 * material request. `messages` names the strings: take, retake, choose, attached, hint, failed, read.
 */
export function ReadablePhoto({
  kind,
  messages,
  fileId,
  onUploaded,
  onRead,
  onLocalPhoto,
}: {
  kind: DocumentReadingKind;
  messages: 'procurement.grn.receive.photo' | 'procurement.mr.photo';
  fileId: string | null;
  onUploaded: (fileId: string | null) => void;
  onRead: (result: DocumentReadResult) => void;
  /** Step 7 — the downscaled photo itself, so a form sent later (no signal) can carry it. */
  onLocalPhoto?: (file: File) => void;
}) {
  const t = useTranslations(messages);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [kept, setKept] = useState(false);

  const picker = usePhotoPicker(
    (files) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      setError(false);
      void (async () => {
        try {
          const small = await downscaleImage(file);
          const local = new File([small], small.name || 'photo.jpg', { type: small.type || 'image/jpeg' });
          onLocalPhoto?.(local);
          setName(file.name);
          setKept(false);
          if (typeof navigator !== 'undefined' && navigator.onLine === false && onLocalPhoto) {
            // No signal: the form keeps the photo and sends it later.
            setKept(true);
            onUploaded(null);
            return;
          }
          onUploaded(await uploadFile(local));
        } catch {
          // A failed upload with no signal is kept with the form when the form can carry it.
          if (onLocalPhoto && typeof navigator !== 'undefined' && navigator.onLine === false) setKept(true);
          else setError(true);
          onUploaded(null);
        } finally {
          setBusy(false);
        }
      })();
    },
    { galleryMultiple: false },
  );

  return (
    <div className="space-y-3 rounded-panel border border-border bg-surface-subtle px-4 py-3">
      {picker.inputs}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={picker.openCamera} loading={busy}>
          <Camera size={16} aria-hidden="true" /> {fileId ? t('retake') : t('take')}
        </Button>
        <Button type="button" variant="ghost" onClick={picker.openGallery} disabled={busy}>
          <ImageIcon size={16} aria-hidden="true" /> {t('choose')}
        </Button>
        {fileId ? (
          <span className="inline-flex items-center gap-1 text-body-sm text-foreground">
            <CircleCheck size={16} className="text-success" aria-hidden="true" /> {name ?? t('attached')}
          </span>
        ) : (
          <span className="text-caption text-muted-foreground">{t('hint')}</span>
        )}
      </div>
      {error ? <Alert variant="error">{t('failed')}</Alert> : null}
      {kept && messages === 'procurement.grn.receive.photo' ? <p className="text-caption text-muted-foreground">{t('keptOnPhone')}</p> : null}
      {fileId ? <ReadPhotoButton fileId={fileId} kind={kind} onRead={onRead} label={t('read')} /> : null}
    </div>
  );
}
