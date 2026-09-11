'use client';

import type { BoqMoneyBand } from '@erp/types';
import { ArrowRight, CircleDot, Circle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn, LtrValue } from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * The compact, sticky money strip (R11 concept A) — one line, not a dashboard.
 *
 * It replaces the old status bar's four-fact block with a single Excel-frozen-header band. It
 * renders `BoqMoneyBand` verbatim: every figure is a decimal string assembled and tier-gated
 * server-side, so a figure the caller's tier does not admit arrives `null` and is OMITTED here —
 * never blurred, never shown as `0`, never a lock icon on money the user cannot have. The strip
 * never re-sums a total.
 *
 * The two life-stages read differently (Decision 3):
 *  - WORKING   → working total · % priced (unpriced flag count) · contingency (planned)
 *  - COMMITTED → Contract value HEADLINE · Δ-vs-signed · contingency remaining · revenue
 *
 * `lifeStage` is taken from the band, never re-derived.
 */
export function BoqMoneyStrip({
  band,
  currency,
  pricedPercent,
  unpricedCount,
  signedContractValue,
  pendingVariationCount,
  onReviewVariations,
  primaryAction,
  secondaryActions,
}: {
  band: BoqMoneyBand | null;
  currency: string;
  /** % of leaves priced (WORKING only). Structural fact, not a money figure — always shown. */
  pricedPercent: number;
  /** Count of flagged/unpriced items (WORKING only). */
  unpricedCount: number;
  /** The signed (base) contract value, for the "signed $X" reference in COMMITTED. */
  signedContractValue: string | null;
  /** Draft variations awaiting approval — the pending-VO affordance (H1). */
  pendingVariationCount: number;
  onReviewVariations?: () => void;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
}) {
  const t = useTranslations('platform.boq.moneyStrip');
  const locale = useLocale() as 'en' | 'ar';

  const committed = band?.lifeStage === 'COMMITTED';

  // A user with no money visibility (canViewCost false) sees no figures at all — the band's
  // cost/margin fields are all null. Show the state and the priced fact, nothing withheld
  // rendered as a placeholder.
  const money = (value: string | null): string | null => formatMoney(value, currency, locale);

  return (
    <section
      // Sticky like a frozen header. The offset clears the workspace header; the grid scrolls
      // beneath it. Logical border so the state edge sits on the leading side in RTL.
      className={cn(
        'sticky top-0 z-20 rounded-panel border border-s-2 bg-surface shadow-e1',
        committed ? 'border-s-success border-border' : 'border-s-brand-primary border-border',
      )}
      aria-label={t('lifeStage')}
    >
      <div className="flex flex-col gap-2 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* State dot — one glance gives WORKING vs COMMITTED without reading. */}
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 text-body-sm font-semibold',
              committed ? 'text-success' : 'text-brand-primary',
            )}
          >
            {committed ? (
              <CircleDot size={14} aria-hidden="true" />
            ) : (
              <Circle size={14} aria-hidden="true" />
            )}
            {committed ? t('committedLabel') : t('workingLabel')}
          </span>

          {band ? (
            committed ? (
              <CommittedFigures
                band={band}
                money={money}
                signed={signedContractValue}
                t={t}
              />
            ) : (
              <WorkingFigures
                band={band}
                money={money}
                pricedPercent={pricedPercent}
                unpricedCount={unpricedCount}
                t={t}
              />
            )
          ) : null}

          {pendingVariationCount > 0 ? (
            <button
              type="button"
              onClick={onReviewVariations}
              className="inline-flex shrink-0 items-center gap-1 rounded-control bg-brand-accent px-2 py-0.5 text-caption font-medium text-brand-primary transition-colors hover:bg-brand-accent-strong"
            >
              {t('variationsPending', { count: pendingVariationCount })}
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {(primaryAction || secondaryActions) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Headline dot separator between subordinate figures. */
function Dot() {
  return (
    <span className="text-border-strong" aria-hidden="true">
      ·
    </span>
  );
}

/**
 * COMMITTED: Contract value is the HEADLINE (M4); contingency remaining and revenue are
 * subordinate. Δ-vs-signed rides beside the contract value. Any null figure is omitted.
 */
function CommittedFigures({
  band,
  money,
  signed,
  t,
}: {
  band: BoqMoneyBand;
  money: (value: string | null) => string | null;
  signed: string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const contract = money(band.contractValue);
  const delta = deltaVsSigned(band.contractValue, band.baseContractValue ?? signed);

  // No money visibility at all — every commercial figure is null.
  if (!contract) {
    return <span className="text-body-sm text-muted-foreground">{t('restricted')}</span>;
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {/* Headline */}
      <span className="text-caption text-muted-foreground">{t('contractValue')}</span>
      <LtrValue className="text-h3 font-bold tabular-nums text-foreground">{contract}</LtrValue>

      {delta ? (
        <span
          className={cn(
            'text-caption font-medium tabular-nums',
            delta.positive ? 'text-foreground' : 'text-foreground',
          )}
        >
          {delta.positive ? '▲' : '▼'}
          {t('deltaVsSigned', { amount: money(delta.abs) ?? delta.abs })}
        </span>
      ) : null}

      {/* Subordinate figures */}
      {band.contingencyRemaining ? (
        <>
          <Dot />
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('contingencyLeft', { amount: money(band.contingencyRemaining) ?? '' })}
          </span>
        </>
      ) : null}

      {band.totalClientRevenue && band.totalClientRevenue !== band.contractValue ? (
        <>
          <Dot />
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('revenue', { amount: money(band.totalClientRevenue) ?? '' })}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * WORKING: working total (from `inContractTotal`, `canViewCost`) · % priced (always) · contingency
 * (planned, `canViewMargin`). % priced is a structural fact, shown even without money visibility.
 */
function WorkingFigures({
  band,
  money,
  pricedPercent,
  unpricedCount,
  t,
}: {
  band: BoqMoneyBand;
  money: (value: string | null) => string | null;
  pricedPercent: number;
  unpricedCount: number;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const workingTotal = money(band.inContractTotal);

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {workingTotal ? (
        <>
          <span className="text-caption text-muted-foreground">{t('plannedTotal')}</span>
          <LtrValue className="text-h3 font-bold tabular-nums text-foreground">
            {workingTotal}
          </LtrValue>
          <Dot />
        </>
      ) : null}

      {/* Priced completeness is a fact about scope, not money — always shown. */}
      <span
        className={cn(
          'text-caption tabular-nums',
          unpricedCount > 0 ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {t('priced', { percent: pricedPercent })}
        {unpricedCount > 0 ? <> ({t('unpriced', { count: unpricedCount })})</> : null}
      </span>

      {band.contingencyReserve ? (
        <>
          <Dot />
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('contingency', { amount: money(band.contingencyReserve) ?? '' })}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * live − signed, as a display-only sign + absolute string. The frontend performs no money
 * arithmetic on the value it renders — this compares two decimal strings digit-safely by
 * scaling to integer minor units only to decide the SIGN, and shows the server-consistent
 * absolute magnitude. Returns null when either side is absent or the delta is zero.
 */
function deltaVsSigned(
  live: string | null,
  signed: string | null,
): { positive: boolean; abs: string } | null {
  if (!live || !signed) return null;
  const liveMinor = toMinor(live);
  const signedMinor = toMinor(signed);
  if (liveMinor === null || signedMinor === null) return null;
  const diff = liveMinor - signedMinor;
  if (diff === 0) return null;
  const absMinor = Math.abs(diff);
  return { positive: diff > 0, abs: fromMinor(absMinor) };
}

/** Parse a 2dp decimal string into integer cents. Null on a malformed value (never 0). */
function toMinor(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function fromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}
