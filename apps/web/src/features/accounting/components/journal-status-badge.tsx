'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import type { JournalStatus } from '../types';

/**
 * `POSTED` is `live` — it is the only status where the entry is actually in the ledger.
 * `REJECTED` is `danger` because it needs someone to act; `REVERSED` is neutral because a
 * reversal is a normal correction, not a fault, and the reversing entry is on the record
 * beside it.
 */
const STATUS_TONES: Record<JournalStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'accent',
  POSTED: 'live',
  REJECTED: 'danger',
  REVERSED: 'neutral',
};

export function JournalStatusBadge({ status }: { status: JournalStatus }) {
  const t = useTranslations('accounting.journals.status');
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
