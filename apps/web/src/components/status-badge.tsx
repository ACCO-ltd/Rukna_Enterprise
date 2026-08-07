import { type BadgeTone, Badge, cn } from '@erp/ui';

import { formatStatus, type StatusToken } from '@/lib/format';

/**
 * Maps the six semantic platform status tokens onto the `BadgeTone` vocabulary
 * that `Badge` already understands.
 *
 * `HISTORICAL` has no dedicated tone yet — `neutral` is the closest visual fit,
 * and the `muted` class adds the opacity that distinguishes it from DRAFT.
 * If a `historical` tone is added to `Badge` later this becomes a one-line change.
 *
 * `SUCCESS` maps to `live` because "in force right now" is what most SUCCESS
 * states mean in this domain (ACTIVE contract, CERTIFIED certificate, PAID receipt).
 */
const TOKEN_TO_TONE: Record<StatusToken, BadgeTone> = {
  NEUTRAL:     'neutral',
  IN_PROGRESS: 'info',
  WARNING:     'warning',
  SUCCESS:     'live',
  DANGER:      'danger',
  HISTORICAL:  'neutral',
};

interface StatusBadgeProps {
  /** The raw status key from the API, e.g. "PENDING_INTERNAL_APPROVAL". */
  status: string;
  /**
   * Translated label. When omitted the status key is humanised
   * (underscores replaced with spaces, title-cased). Pass a translated
   * label when the screen already uses `useTranslations`.
   */
  label?: string;
}

/**
 * Platform-wide status badge. Every module that shows a lifecycle status
 * should use this component rather than mapping status strings to colours
 * independently — the six semantic tokens in `formatStatus` are the single
 * source of truth for what colour a status gets.
 *
 * @example
 * <StatusBadge status={contract.status} label={t(`status.${contract.status}`)} />
 */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { token, muted } = formatStatus(status);
  const tone = TOKEN_TO_TONE[token];

  // Humanise the key when no translation is provided. This ensures the badge is
  // always readable even before i18n keys are wired up for a new module.
  const displayLabel =
    label ??
    status
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <Badge tone={tone} className={cn(muted && 'opacity-60')}>
      {displayLabel}
    </Badge>
  );
}
