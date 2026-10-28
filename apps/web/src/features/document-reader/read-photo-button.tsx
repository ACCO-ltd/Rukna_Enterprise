'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ScanText } from 'lucide-react';
import { Alert, Button, Notice } from '@erp/ui';
import type { DocumentReadResult, DocumentReadingKind } from '@erp/types';

import { ApiError } from '@/lib/api-client';

import { documentReaderApi, useDocumentReader } from './api';

/**
 * Step 7 — "Read the photo": sends one already-uploaded photo to the reader and hands what it found
 * to the form, which fills its fields. Nothing is saved here; the person checks every field and
 * saves the form as usual. Renders nothing while the company has the reader off.
 */
export function ReadPhotoButton({
  fileId,
  kind,
  onRead,
  label,
}: {
  /** The photo to read; the button is disabled until there is one. */
  fileId: string | null;
  kind: DocumentReadingKind;
  onRead: (result: DocumentReadResult) => void;
  label?: string;
}) {
  const t = useTranslations('common.photoReader');
  const { ready } = useDocumentReader();
  const [last, setLast] = useState<DocumentReadResult | null>(null);
  const read = useMutation({
    mutationFn: () => documentReaderApi.read(fileId!, kind),
    onSuccess: (result) => {
      setLast(result);
      onRead(result);
    },
  });

  if (!ready) return null;
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={() => read.mutate()} disabled={!fileId} loading={read.isPending}>
        <ScanText size={16} aria-hidden="true" /> {label ?? t('read')}
      </Button>
      {read.isError ? <Alert variant="error">{read.error instanceof ApiError ? read.error.message : t('failed')}</Alert> : null}
      {last && !read.isPending ? (
        <Notice tone="attention" title={t('checkTitle')}>
          <p>{t('checkBody')}</p>
          {last.warnings.length > 0 ? (
            <ul className="mt-1 list-disc ps-5">
              {last.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}
