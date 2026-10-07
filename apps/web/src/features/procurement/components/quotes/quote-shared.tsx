'use client';

/**
 * Small pieces every quotation screen shares: the server-refusal sentence, the status pill, the
 * waiting time with its SLA tone, and a quote photo loaded from a short-lived signed URL.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton, StatusPill, StatusText, cn } from '@erp/ui';
import { EyeOff, ImageOff } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { statusTone } from '@/lib/status-registry';

import { useQuotePhotoUrl } from '../../hooks/use-quotations';
import { durationParts } from '../../quotations/quote-rules';
import type { QuotationRequestStatus, SlaTone } from '../../quotations/types';

/** The machine code on a refusal: `details.code` (domain rule) before the HTTP-level `code`. */
export function refusalCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const detailCode = error.details?.code;
  return typeof detailCode === 'string' ? detailCode : (error.code ?? null);
}

/**
 * A server refusal in plain words. Known codes (SoD rules, frozen, duplicate photo, …) get their
 * own sentence; otherwise the server's message, then a generic line. The frontend never decides
 * segregation of duties — it only says what the server decided.
 */
export function useRefusalText(): (error: unknown) => string | undefined {
  const t = useTranslations('procurement.quotes.refusal');
  return (error) => {
    if (!error) return undefined;
    if (error instanceof TypeError) return t('offline');
    const code = refusalCode(error);
    if (code && t.has(code)) return t(code);
    if (error instanceof ApiError) {
      if (error.status === 403) return error.message && error.message !== 'Request failed' ? error.message : t('forbidden');
      if (error.message && error.message !== 'Request failed') return error.message;
      if (error.status === 409) return t('conflict');
    }
    return t('generic');
  };
}

export function QuotationStatusPill({ status }: { status: QuotationRequestStatus }) {
  const t = useTranslations('procurement.quotes.status');
  return <StatusPill tone={statusTone(status, 'quotationRequest')}>{t(status)}</StatusPill>;
}

/** "4 h 10 m" — working time as the server measured it. */
export function useDurationText(): (minutes: number | null | undefined) => string {
  const t = useTranslations('procurement.quotes.waiting');
  return (minutes) => t('duration', durationParts(minutes));
}

/**
 * Waiting time with its SLA tone (amber ≥ 2 h, red ≥ 4 h, decided by the server). Colour is never
 * the only signal: the over-2h / over-4h label is always written out.
 */
export function WaitingTime({
  minutes,
  tone,
  className,
}: {
  minutes: number | null | undefined;
  tone: SlaTone;
  className?: string;
}) {
  const t = useTranslations('procurement.quotes.waiting');
  const duration = useDurationText();
  if (minutes === null || minutes === undefined) {
    return <span className={cn('text-muted-foreground', className)}>{t('notSent')}</span>;
  }
  const badgeTone = tone === 'red' ? 'danger' : tone === 'amber' ? 'attention' : 'neutral';
  return (
    <StatusText tone={badgeTone} className={cn('text-sm', className)} data-sla={tone}>
      <span className="tabular-nums">{duration(minutes)}</span>
      {tone !== 'none' ? (
        <span className={cn('ms-1.5 font-semibold', tone === 'red' ? 'text-danger' : 'text-warning')}>
          {t(`tone.${tone}`)}
        </span>
      ) : null}
    </StatusText>
  );
}

/**
 * A quote photo. The signed URL is short-lived, so an image that fails to load asks for a fresh
 * URL once before giving up (the usual cause is a URL that expired while the page sat open).
 */
export function QuotePhotoImage({
  fileId,
  alt,
  className,
  fit = 'cover',
}: {
  fileId: string;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
}) {
  const t = useTranslations('procurement.quotes.decision');
  const url = useQuotePhotoUrl(fileId);
  const [failedOnce, setFailedOnce] = useState(false);
  const [failed, setFailed] = useState(false);

  if (url.isPending) {
    return (
      <div role="status" className={cn('relative overflow-hidden', className)}>
        <span className="sr-only">{t('photoLoading')}</span>
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
    );
  }
  if (url.isError || failed || !url.data?.url) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-1 bg-muted p-2 text-center text-caption text-muted-foreground',
          className,
        )}
      >
        <ImageOff className="size-5" aria-hidden="true" />
        {t('photoFailed')}
      </div>
    );
  }
  return (
    // A signed object-storage URL: next/image cannot optimise it and must not proxy it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url.data.url}
      alt={alt}
      className={cn(fit === 'cover' ? 'object-cover' : 'object-contain', className)}
      onError={() => {
        if (!failedOnce) {
          setFailedOnce(true);
          void url.refetch();
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

/**
 * In place of a quote photo when the server withholds photos for this role (`photosVisible: false`):
 * says so, with how many pages there are — never an empty or broken image box.
 */
export function PhotosHidden({
  count,
  className,
  compact = false,
}: {
  count: number;
  className?: string;
  /** Thumbnail size: the icon and count only; the sentence stays for screen readers. */
  compact?: boolean;
}) {
  const t = useTranslations('procurement.quotes.photosHidden');
  return (
    <div
      role="note"
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border-strong bg-surface-subtle p-2 text-center text-caption text-muted-foreground',
        className,
      )}
    >
      <EyeOff className="size-5" aria-hidden="true" />
      <span className={compact ? 'sr-only' : 'font-medium text-foreground'}>{t('title')}</span>
      <span>{t('count', { count })}</span>
    </div>
  );
}

/** A blob photo still on the phone (not yet uploaded). */
export function LocalPhoto({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  if (!url) return <div className={cn('bg-muted', className)} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={cn('object-cover', className)} />;
}

/** Filled dots for stores collected out of the target — a glanceable counter. */
export function StoreDots({ count, target }: { count: number; target: number }) {
  const done = count >= target;
  const dots = Math.max(target, count);
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: dots }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full border',
            i < count
              ? done
                ? 'border-success bg-success'
                : 'border-brand-primary bg-brand-primary'
              : 'border-border-strong bg-surface',
          )}
        />
      ))}
    </span>
  );
}
