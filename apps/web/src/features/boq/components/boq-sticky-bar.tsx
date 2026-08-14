'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, LtrValue, type BadgeTone } from '@erp/ui';

import { formatMoney } from '@/lib/format';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'warning',
  BASELINED: 'live',
  SUPERSEDED: 'historical',
  CANCELLED: 'neutral',
};

/**
 * Tracks whether an element is still on screen.
 *
 * An IntersectionObserver rather than a scroll listener: this fires twice per page — once
 * when the tracked element leaves, once when it returns — instead of on every frame of a
 * 400-row scroll.
 *
 * Returns a **callback ref**, not a `RefObject`. The first attempt took a ref object and
 * observed `ref.current` in an effect keyed on the ref's identity. The workspace renders a
 * skeleton while the query is pending, so on the first commit `current` was null, the
 * effect bailed out — and because a ref's identity never changes, it never ran again once
 * the real element mounted. The sticky bar silently never appeared, and a screenshot could
 * not show it, because a screenshot is taken at scroll zero.
 */
export function useIsOffScreen(): [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [offScreen, setOffScreen] = useState(false);

  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setOffScreen(!(entry?.isIntersecting ?? true)),
      // A little slack at the top so the sticky bar appears as the real one tucks away,
      // rather than after a gap where neither is visible.
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  // Stable identity so attaching it does not detach and re-observe on every render.
  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);
  return [ref, offScreen];
}

/**
 * The version, the total and the one next action, kept in reach on a long BOQ.
 *
 * A 400-item BOQ is several screens tall. Without this, everything that tells you what you
 * are looking at and what to do about it scrolls away, and the answer to "which version is
 * this?" becomes a scroll to the top.
 *
 * Desktop only. At 375px this would take a third of the viewport, and the sticky table
 * header already carries the columns, which is what actually gets lost there.
 */
export function BoqStickyBar({
  visible,
  versionNumber,
  status,
  totalAmount,
  currency,
  canViewCommercials,
  action,
}: {
  visible: boolean;
  versionNumber: number | null;
  status: string;
  totalAmount: string | null;
  currency: string;
  canViewCommercials: boolean;
  action: React.ReactNode;
}) {
  const t = useTranslations('platform.boq');
  const locale = useLocale() as 'en' | 'ar';

  if (!visible) return null;

  return (
    <div
      // aria-hidden because every value here is a duplicate of the status bar above; a
      // screen reader should not meet the same version and total twice.
      aria-hidden="true"
      className="sticky top-0 z-30 -mx-1 hidden items-center justify-between gap-4 rounded-panel border border-border bg-surface px-4 py-2.5 shadow-e2 sm:flex"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-body-sm font-semibold text-foreground">{t('title')}</span>
        {versionNumber !== null ? (
          <span className="text-caption text-muted-foreground">
            {t('versionShort', { number: versionNumber })}
          </span>
        ) : null}
        <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{t(`versionStatus.${status}`)}</Badge>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {canViewCommercials ? (
          <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
            {formatMoney(totalAmount, currency, locale) ?? '—'}
          </LtrValue>
        ) : null}
        {action}
      </div>
    </div>
  );
}
