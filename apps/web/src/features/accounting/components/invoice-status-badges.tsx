'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import type { InvoiceDocStatus, PostingStatus } from '../types';

/**
 * ─── Two badges, because there are two questions ────────────────────────────────
 *
 * `documentStatus` answers "has this been approved?" and `postingStatus` answers "is it in the
 * ledger?". They advance independently, and an invoice spends real time APPROVED · NOT_POSTED —
 * a state a single badge has no way to name.
 *
 * Collapsing them into one label was tried on supplier bills and produced `status: string`
 * carrying whichever axis the writer had in mind. Two badges is the honest shape.
 */

const DOC_TONES: Record<InvoiceDocStatus, BadgeTone> = {
  DRAFT: 'neutral',
  APPROVED: 'accent',
  // Terminal and deliberate rather than a fault — the same reasoning as REVERSED below.
  CANCELLED: 'neutral',
};

/**
 * `POSTED` is `live`: it is the only status where the invoice is actually in the ledger.
 *
 * `FAILED` is `danger` because someone has to retry it. `REVERSED` is neutral — a reversal is
 * a normal correction and the reversing journal sits on the record beside it. `OPENING_BALANCE`
 * is neutral too: a migrated row is settled history, not an unfinished one, and colouring it as
 * a warning would have every organisation start go-live with a screen full of alarm.
 */
const POSTING_TONES: Record<PostingStatus, BadgeTone> = {
  NOT_POSTED: 'neutral',
  PENDING: 'info',
  POSTED: 'live',
  FAILED: 'danger',
  REVERSED: 'neutral',
  OPENING_BALANCE: 'neutral',
};

export function InvoiceDocStatusBadge({ status }: { status: InvoiceDocStatus }) {
  const t = useTranslations('accounting.invoices.docStatus');
  return <Badge tone={DOC_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}

export function InvoicePostingStatusBadge({ status }: { status: PostingStatus }) {
  const t = useTranslations('accounting.invoices.postingStatus');
  return <Badge tone={POSTING_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}

/**
 * Both axes together.
 *
 * `flex-wrap` matters at 375px: two badges plus an Arabic label overflow a phone-width table
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
    <div className="flex flex-wrap items-center gap-1.5">
      <InvoiceDocStatusBadge status={documentStatus} />
      <InvoicePostingStatusBadge status={postingStatus} />
    </div>
  );
}
