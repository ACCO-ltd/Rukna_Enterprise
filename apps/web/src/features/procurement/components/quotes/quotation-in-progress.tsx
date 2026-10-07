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
  quotationRequestId: string;
  quotationNumber: string;
  materialRequestId: string | null;
}

/** The refusal's details when it is QUOTATION_IN_PROGRESS, else null. */
export function quotationInProgress(error: unknown): QuotationInProgress | null {
  if (!(error instanceof ApiError) || error.details?.code !== 'QUOTATION_IN_PROGRESS') return null;
  const id = error.details.quotationRequestId;
  if (typeof id !== 'string') return null;
  const number = error.details.quotationNumber;
  const mr = error.details.materialRequestId;
  return {
    quotationRequestId: id,
    quotationNumber: typeof number === 'string' ? number : '',
    materialRequestId: typeof mr === 'string' ? mr : null,
  };
}

export function QuotationInProgressNotice({ error }: { error: unknown }) {
  const t = useTranslations('procurement.quotes.inProgress');
  const info = quotationInProgress(error);
  if (!info) return null;
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
