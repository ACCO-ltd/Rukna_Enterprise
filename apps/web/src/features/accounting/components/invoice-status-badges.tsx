'use client';

import { useTranslations } from 'next-intl';
import { StatusPill, StatusText } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

import type { InvoiceDocStatus, PostingStatus } from '../types';

/**
 * ─── Two statuses, because there are two questions ──────────────────────────────
 *
 * `documentStatus` answers "has this been approved?" and `postingStatus` answers "is it in the
 * ledger?". They advance independently, and an invoice spends real time APPROVED · NOT_POSTED —
 * a state a single badge has no way to name.
 *
 * Collapsing them into one label was tried on supplier bills and produced `status: string`
 * carrying whichever axis the writer had in mind. The document status is the primary pill; the
 * posting status is the quieter second axis (dot + text). Tones come from the status registry
 * (ADR-034). The posting labels ("Not posted", "Posting failed") already name their axis.
 */

export function InvoiceDocStatusBadge({ status }: { status: InvoiceDocStatus }) {
  const t = useTranslations('accounting.invoices.docStatus');
  return <StatusPill tone={statusTone(status, 'clientInvoice')}>{t(status)}</StatusPill>;
}

export function InvoicePostingStatusBadge({ status }: { status: PostingStatus }) {
  const t = useTranslations('accounting.invoices.postingStatus');
  return <StatusText tone={statusTone(status, 'posting')}>{t(status)}</StatusText>;
}

/**
 * Both axes together.
 *
 * `flex-wrap` matters at 375px: two statuses plus a long label overflow a phone-width table
 * cell, and a badge clipped in half reads as a rendering fault rather than a narrow screen.
 */
export function InvoiceStatusBadges({
  documentStatus,
  postingStatus,
}: {
  documentStatus: InvoiceDocStatus;
  postingStatus: PostingStatus;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <InvoiceDocStatusBadge status={documentStatus} />
      <InvoicePostingStatusBadge status={postingStatus} />
    </div>
  );
}
