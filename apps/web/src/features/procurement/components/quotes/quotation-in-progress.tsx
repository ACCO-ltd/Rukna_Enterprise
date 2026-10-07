'use client';

/**
 * A manual purchase order (create or revise) for a material request that has a live quotation
 * round is refused with 409 `QUOTATION_IN_PROGRESS` (ADR-044: the award is that request's route to
 * an order). Says so in plain words and links to the quotation.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Notice } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

export interface QuotationInProgress {
  /** IN_PROGRESS: a live round exists; ROUND_REQUIRED: remaining quantity needs a new round. */
  kind: 'IN_PROGRESS' | 'ROUND_REQUIRED';
  quotationRequestId: string;
  quotationNumber: string;
  materialRequestId: string | null;
}

const CODES: Record<string, QuotationInProgress['kind']> = {
  QUOTATION_IN_PROGRESS: 'IN_PROGRESS',
  QUOTATION_ROUND_REQUIRED: 'ROUND_REQUIRED',
};

/** The refusal's details when it is QUOTATION_IN_PROGRESS or QUOTATION_ROUND_REQUIRED, else null. */
export function quotationInProgress(error: unknown): QuotationInProgress | null {
  if (!(error instanceof ApiError)) return null;
  const kind = CODES[String(error.details?.code)];
  if (!kind || !error.details) return null;
  const id = error.details.quotationRequestId;
  if (typeof id !== 'string' && kind === 'IN_PROGRESS') return null;
  const number = error.details.quotationNumber;
  const mr = error.details.materialRequestId;
  return {
    kind,
    quotationRequestId: typeof id === 'string' ? id : '',
    quotationNumber: typeof number === 'string' ? number : '',
    materialRequestId: typeof mr === 'string' ? mr : null,
  };
}

export function QuotationInProgressNotice({ error }: { error: unknown }) {
  const t = useTranslations('procurement.quotes.inProgress');
  const tRound = useTranslations('procurement.quotes.roundRequired');
  const info = quotationInProgress(error);
  if (!info) return null;
  if (info.kind === 'ROUND_REQUIRED') {
    return (
      <Notice tone="attention">
        <p>{tRound('body')}</p>
        {info.materialRequestId ? (
          <Link
            href={`/procurement/requests/${info.materialRequestId}`}
            className="mt-1 inline-flex min-h-11 items-center font-medium text-brand-primary underline underline-offset-4"
          >
            {tRound('link')}
          </Link>
        ) : null}
      </Notice>
    );
  }
  return (
    <Notice tone="attention">
      <p>{t('body', { quotationNumber: info.quotationNumber })}</p>
      <Link
        href={`/procurement/quotes/${info.quotationRequestId}`}
        className="mt-1 inline-flex min-h-11 items-center font-medium text-brand-primary underline underline-offset-4"
      >
        {t('link', { quotationNumber: info.quotationNumber })}
      </Link>
    </Notice>
  );
}
