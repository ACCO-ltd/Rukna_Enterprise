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
 * The cost target has two honesty levels (A3/D7, no. 148/no. 150):
 *
 *  - A **PO line** now carries a real cost-target and its read model embeds the labels —
 *    project `code` and BOQ node `code`/`description`. Pass `costTargetLabel` and the chip
 *    names it: "Cost target: WBR-26-0065 · 03.10 Concrete".
 *  - A **bill line** and a **commitment entry** carry a bare `boqNodeId` (no embedded path),
 *    so pass `hasCostTarget` and the chip states a target is set without inventing a label.
 *
 * Where a line has NO cost target (an org/overhead line, or a surface that never carries one
 * such as a goods-receipt line), pass neither and no cost-target chip renders — an empty or
 * faked chip is noise. `costTargetLabel` wins over `hasCostTarget` when both are given.
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
   * True when a cost target (BOQ node) is recorded on the line but no label is available.
   * Bill lines and commitment entries carry a bare `boqNodeId` — only the presence is known,
   * so the chip states a target is set without naming it. Ignored when `costTargetLabel` is set.
   */
  hasCostTarget?: boolean;
  /**
   * A labelled cost target — used where the read model embeds the project and BOQ node
   * (a PO detail line, no. 148). Takes precedence over `hasCostTarget`.
   */
  costTargetLabel?: string | null;
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
  costTargetLabel,
  className,
}: ClassificationChipsProps) {
  const t = useTranslations('procurement.classification');
  const tType = useTranslations('procurement.lineType');

  const showSpend = Boolean(spendCategoryName);
  const labelled = Boolean(costTargetLabel);
  const showTarget = labelled || Boolean(hasCostTarget);

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

      {/* Cost target: only when the line carries a BOQ node. Named where the read model
          embeds the project/node (PO line, no. 148); otherwise "Set" — a bare id, not a path. */}
      {showTarget ? (
        <Badge tone="neutral">
          {t('costTarget')}: {labelled ? costTargetLabel : t('costTargetSet')}
        </Badge>
      ) : null}
    </div>
  );
}
