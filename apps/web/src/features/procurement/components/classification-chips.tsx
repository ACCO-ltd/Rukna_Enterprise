'use client';

/**
 * Read-only cost-classification chips (Round 2, D7 consistency).
 *
 * Slices ① and ② each grew their own inline "material / cost target" chip markup — the PO
 * detail line and the goods-receipt line. They drifted immediately (one showed a spend
 * category, the other did not), which is exactly the inconsistency D7 names. This is the one
 * component both, and now the supplier-bill detail and the commitment ledger, render, so
 * "material / cost target" reads identically on every surface that shows a classified line.
 *
 * ── What a chip is, and is not ──────────────────────────────────────────────────────────
 *
 * These are display-only. Nothing here writes, and no payload or contract changes. The chips
 * report what the read model already carries; they never derive or fabricate a value.
 *
 * The cost target is the honest edge (A3, Slice ①). A PO line has no `boqNodeId` — the
 * PO/PO-line contract does not carry one — so there is no cost target to show, and the slot
 * is **omitted, not faked**. A bill line and a commitment entry *do* carry `boqNodeId`, but
 * only the id (no embedded BOQ path), so where one is present the chip states that a target
 * is set without inventing a label the API did not send. When neither a spend category nor a
 * cost target is present, no cost-target chip renders at all — an empty chip is noise.
 */

import { useTranslations } from 'next-intl';
import { Badge } from '@erp/ui';

import type { ProcurementLineType } from '../types';

export interface ClassificationChipsProps {
  /** The line type — MATERIAL / SERVICE / OTHER. Omitted for surfaces that carry no type. */
  lineType?: ProcurementLineType | null;
  /** Spend category name, when the read model embeds one (PO lines do; bills/commitments do not). */
  spendCategoryName?: string | null;
  /**
   * True when a cost target (BOQ node) is recorded on the line. Bill lines and commitment
   * entries carry a `boqNodeId`; PO/GR lines never do. Only the presence is known — the API
   * does not send a BOQ path — so the chip states a target is set without naming it.
   */
  hasCostTarget?: boolean;
  className?: string;
}

/**
 * Renders up to three neutral chips: the line type, the spend category, and the cost target.
 * Every chip is optional and self-suppressing, so the same component serves a PO line (type +
 * spend category, no target), a GR line (type only), a bill line (target when set), and a
 * commitment row (spend category / target when set) without any surface passing a faked value.
 */
export function ClassificationChips({
  lineType,
  spendCategoryName,
  hasCostTarget,
  className,
}: ClassificationChipsProps) {
  const t = useTranslations('procurement.classification');
  const tType = useTranslations('procurement.lineType');

  const showSpend = Boolean(spendCategoryName);
  const showTarget = Boolean(hasCostTarget);

  // Nothing to classify — render nothing rather than an empty chip row.
  if (!lineType && !showSpend && !showTarget) return null;

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-1.5'}>
      {lineType ? <Badge tone="neutral">{tType(lineType)}</Badge> : null}

      {showSpend ? (
        <Badge tone="neutral">
          {t('spendCategory')}: {spendCategoryName}
        </Badge>
      ) : null}

      {/* Cost target: only when the line actually carries a BOQ node. The label is
          intentionally unnamed — the read model sends an id, not a path (A3). */}
      {showTarget ? (
        <Badge tone="neutral">
          {t('costTarget')}: {t('costTargetSet')}
        </Badge>
      ) : null}
    </div>
  );
}
