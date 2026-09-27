'use client';

/**
 * Status rendering for the procurement workspace.
 *
 * Tones come from the platform status registry (ADR-034) — this file only supplies the
 * procurement translations. A document shows one primary pill (its document status); the
 * posting and match axes render as quieter dot + text so they never compete with it.
 */

import { useTranslations } from 'next-intl';
import {
  Badge,
  type StatusTone,
  StatusPill,
  StatusText,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@erp/ui';

import { statusTone, type StatusVocabulary } from '@/lib/status-registry';

import type { BillMatchStatus, CommitmentStage } from '../types';

export function PostingStatusBadge({
  status,
  showAxis = false,
}: {
  status: string;
  /** Prefix "Posting:" — use wherever the cell or header does not already name the axis. */
  showAxis?: boolean;
}) {
  const t = useTranslations('procurement.postingStatus');
  return (
    <StatusText tone={statusTone(status, 'posting')} axis={showAxis ? t('axis') : undefined}>
      {t(status)}
    </StatusText>
  );
}

export function ProcurementStatusBadge({
  status,
  vocabulary,
}: {
  status: string;
  /** Which lifecycle `status` belongs to — the registry tones per vocabulary. */
  vocabulary: StatusVocabulary;
}) {
  const t = useTranslations('procurement.status');
  return <StatusPill tone={statusTone(status, vocabulary)}>{t(status)}</StatusPill>;
}

/**
 * The three commitment stages, each with a tooltip.
 *
 * The tooltip is not decoration. "Committed", "accrued" and "actual" are procurement
 * accounting terms, and the people reading this screen are site and commercial staff who
 * mostly are not accountants — §12.10 asks for the explanation for that reason.
 */
const STAGE_TONES: Record<CommitmentStage, StatusTone> = {
  COMMITTED: 'progress',
  ACCRUED: 'attention',
  ACTUAL: 'success',
};

export function CommitmentStageTag({ stage }: { stage: CommitmentStage }) {
  const t = useTranslations('procurement.commitments');
  const hint = {
    COMMITTED: t('committedHint'),
    ACCRUED: t('accruedHint'),
    ACTUAL: t('actualHint'),
  }[stage];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge tone={STAGE_TONES[stage] ?? 'neutral'}>
          {t(stage.toLowerCase() as 'committed' | 'accrued' | 'actual')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A bill's matching state — the third axis, shown only for PO-backed bills.
 */
export function BillMatchStatusBadge({
  status,
  showAxis = false,
}: {
  status: BillMatchStatus;
  showAxis?: boolean;
}) {
  const t = useTranslations('procurement.matchStatus');
  return (
    <StatusText tone={statusTone(status, 'billMatch')} axis={showAxis ? t('axis') : undefined}>
      {t(status)}
    </StatusText>
  );
}
