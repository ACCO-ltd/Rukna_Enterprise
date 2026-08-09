'use client';

/**
 * Status vocabulary for the procurement workspace.
 *
 * §12.10 names colours — slate, blue, green, amber, teal, red. The design system does not
 * have colours, it has tones, and mapping through them keeps procurement looking like the
 * rest of the platform instead of like a second product. The mapping below is the spec's
 * intent, not its palette:
 *
 *   slate  → neutral   a resting state, nothing to act on
 *   blue   → info      moving through a workflow
 *   green  → live      the state where the record is doing its job
 *   amber  → warning   something needs a human
 *   red    → danger    terminal and not by plan
 *
 * `PARTIALLY_ORDERED` and `FULLY_ORDERED` collapse to `info` and `accent`. The spec gives
 * them amber and teal, but amber here would read as "needs attention" when partial
 * ordering is the ordinary course of a large request.
 */

import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import type { BillMatchStatus, CommitmentStage } from '../types';

const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'live',
  ACTIVE: 'live',
  OPEN: 'live',
  PARTIALLY_ORDERED: 'info',
  FULLY_ORDERED: 'accent',
  POSTED: 'live',
  EXCEPTION_PENDING: 'warning',
  SUPERSEDED: 'neutral',
  CANCELLED: 'danger',
  CLOSED: 'neutral',
  DISCONTINUED: 'danger',
  INACTIVE: 'neutral',
};

export function ProcurementStatusBadge({ status }: { status: string }) {
  const t = useTranslations('procurement.status');
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}

/**
 * The three commitment stages, each with a tooltip.
 *
 * The tooltip is not decoration. "Committed", "accrued" and "actual" are procurement
 * accounting terms, and the people reading this screen are site and commercial staff who
 * mostly are not accountants — §12.10 asks for the explanation for that reason.
 */
const STAGE_TONES: Record<CommitmentStage, BadgeTone> = {
  COMMITTED: 'info',
  ACCRUED: 'warning',
  ACTUAL: 'live',
};

export function CommitmentStageTag({ stage }: { stage: CommitmentStage }) {
  const t = useTranslations('procurement.commitments');
  const hint = {
    COMMITTED: t('committedHint'),
    ACCRUED: t('accruedHint'),
    ACTUAL: t('actualHint'),
  }[stage];

  return (
    <Badge tone={STAGE_TONES[stage] ?? 'neutral'} title={hint}>
      {t(stage.toLowerCase() as 'committed' | 'accrued' | 'actual')}
    </Badge>
  );
}

/**
 * A bill's matching state.
 *
 * `NOT_RUN` is neutral rather than warning: not having run matching yet is the starting
 * position for every bill, not a problem. `EXCEPTION` is danger because posting is blocked
 * until someone with the permission clears it.
 */
const MATCH_TONES: Record<BillMatchStatus, BadgeTone> = {
  NOT_RUN: 'neutral',
  MATCHED: 'live',
  MATCHED_WITH_TOLERANCE: 'warning',
  EXCEPTION: 'danger',
  APPROVED_EXCEPTION: 'warning',
};

export function BillMatchStatusBadge({ status }: { status: BillMatchStatus }) {
  const t = useTranslations('procurement.matchStatus');
  return <Badge tone={MATCH_TONES[status] ?? 'neutral'}>{t(status)}</Badge>;
}
