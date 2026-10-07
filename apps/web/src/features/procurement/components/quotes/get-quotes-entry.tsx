'use client';

/**
 * The MR detail's entry into quotations (wireframe A).
 *
 * "Get quotes" opens the camera in the same tap — the file input is clicked inside the user's
 * gesture, which is the only time a browser allows it — while the request is opened on the
 * server in parallel (`POST /` is idempotent). The photo goes into the upload queue for that
 * request and the buyer lands on the capture screen with the store sheet already open.
 *
 * With a request already open the entry is a link: "Quotes 2 of 3 →".
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';
import { ArrowRight, Camera } from 'lucide-react';

import { QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useResumeQuoteUploads, useUploadQueue } from '../../hooks/use-quote-uploads';
import { useOpenQuotationRequest } from '../../hooks/use-quotations';
import { preparePhoto } from '../../quotations/capture/prepare';
import type { QuotationRequestDetail } from '../../quotations/types';
import type { MaterialRequest } from '../../types';
import { usePhotoPicker } from './photo-picker';
import { useRefusalText } from './quote-shared';

export function GetQuotesEntry({ request }: { request: MaterialRequest }) {
  const t = useTranslations('procurement.quotes.entry');
  const { can } = usePermissions();
  const mayCollect = can(QUOTATION_PERMISSIONS.collect);
  const mayAward = can(QUOTATION_PERMISSIONS.award);
  const summary = request.quotation ?? null;

  if (summary) {
    if (!mayCollect && !mayAward) return null;
    const href = mayCollect ? `/procurement/quotes/${summary.id}` : `/finance/quotes/${summary.id}`;
    return (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={href}>
          {summary.status === 'AWARDED'
            ? t('chosen')
            : t('openQuotes', {
                count: summary.distinctSupplierCount ?? summary.quoteCount,
                required: summary.requiredQuoteCount,
              })}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    );
  }

  if (request.status !== 'APPROVED' || !mayCollect) return null;
  return <GetQuotesButton materialRequestId={request.id} />;
}

/** The camera-first "Get quotes" control; mounted only where it can act. */
function GetQuotesButton({ materialRequestId }: { materialRequestId: string }) {
  const t = useTranslations('procurement.quotes.entry');
  const router = useRouter();
  const queue = useUploadQueue();
  const open = useOpenQuotationRequest();
  const refusal = useRefusalText();
  const opening = useRef<Promise<QuotationRequestDetail> | null>(null);
  const [busy, setBusy] = useState(false);
  useResumeQuoteUploads();

  const startOpen = () => {
    opening.current ??= open.mutateAsync(materialRequestId);
    return opening.current;
  };

  const picker = usePhotoPicker(
    (files, via) => {
      setBusy(true);
      void (async () => {
        try {
          const detail = await startOpen();
          let clientRef: string | null = null;
          for (const file of files) {
            const photo = await preparePhoto(file, via);
            if (clientRef) await queue.addPage(clientRef, photo);
            else clientRef = await queue.capture(detail.id, photo);
          }
          router.push(`/procurement/quotes/${detail.id}${clientRef ? `?store=${clientRef}` : ''}`);
        } catch {
          opening.current = null;
          setBusy(false);
        }
      })();
    },
    {
      galleryMultiple: false,
      // Camera dismissed: the request is open anyway — go to it rather than leave them guessing.
      onCancel: () => {
        void startOpen()
          .then((detail) => router.push(`/procurement/quotes/${detail.id}`))
          .catch(() => {
            opening.current = null;
          });
      },
    },
  );

  return (
    <div className="w-full space-y-2 sm:w-auto">
      <Button
        type="button"
        size="lg"
        className="w-full sm:w-auto"
        loading={busy || open.isPending}
        loadingText={t('opening')}
        aria-describedby="get-quotes-hint"
        onClick={() => {
          // Both inside this tap: the camera (needs the gesture) and the server open.
          picker.openCamera();
          startOpen().catch(() => {
            opening.current = null;
          });
        }}
      >
        <Camera className="size-5" aria-hidden="true" />
        {t('getQuotes')}
      </Button>
      <p id="get-quotes-hint" className="text-caption text-muted-foreground">
        {t('getQuotesHint')}
      </p>
      {open.error ? <Alert variant="error" messages={[refusal(open.error) ?? t('cameraFailed')]} /> : null}
      {picker.inputs}
    </div>
  );
}
