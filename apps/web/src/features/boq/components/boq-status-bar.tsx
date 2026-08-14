'use client';

import type { BoqRevisionSummary, BoqVersionSummary } from '@erp/types';
import { AlertTriangle, Check, ClipboardList } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, LtrValue, cn, type BadgeTone } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

/**
 * The BOQ's state, value and next action, in one band.
 *
 * Replaces a separate header block *and* a four-tile summary row. Those two stacked under
 * the project header, the lifecycle strip, the tab bar and the project's own four tiles —
 * and because the BOQ tiles were styled identically to the project tiles, the page read as
 * eight equal boxes with no way to tell context from subject. Roughly 840px of chrome stood
 * between the top of the page and the first BOQ row.
 *
 * Every fact from both blocks survives here. What changes is rank: the value dominates, the
 * state is carried by a coloured edge rather than a tile, and the supporting counts sit on
 * one line instead of four boxes.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'warning',
  BASELINED: 'live',
  SUPERSEDED: 'historical',
  CANCELLED: 'neutral',
};

/** The accent edge — one glance gives the state without reading a word. */
const STATUS_EDGE: Record<string, string> = {
  DRAFT: 'border-s-warning',
  BASELINED: 'border-s-success',
  SUPERSEDED: 'border-s-historical',
  CANCELLED: 'border-s-border-strong',
};

export function BoqStatusBar({
  version,
  revision,
  currency,
  sectionCount,
  itemCount,
  pricedCount,
  contractBaseline,
  contractMatchesApproved,
  canViewCommercials,
  actions,
}: {
  version: BoqVersionSummary | null;
  revision: BoqRevisionSummary | null;
  currency: string;
  sectionCount: number;
  itemCount: number;
  pricedCount: number;
  contractBaseline: BoqVersionSummary | null;
  contractMatchesApproved: boolean;
  canViewCommercials: boolean;
  actions: React.ReactNode;
}) {
  const t = useTranslations('platform.boq');
  const locale = useLocale() as 'en' | 'ar';

  const complete = itemCount > 0 && pricedCount === itemCount;
  const percent = itemCount === 0 ? 0 : Math.round((pricedCount / itemCount) * 100);
  const status = version?.status ?? 'DRAFT';

  return (
    <section
      // Logical border, so the accent sits on the leading edge in both directions.
      className={cn(
        'rounded-panel border border-s-2 border-border bg-surface',
        STATUS_EDGE[status] ?? 'border-s-border-strong',
      )}
    >
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          {/* Identity */}
          <div className="flex flex-wrap items-center gap-2">
            <ClipboardList
              size={17}
              strokeWidth={1.8}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            <h1 className="text-h3 font-semibold text-foreground">{t('title')}</h1>
            {version ? (
              <>
                <span className="text-body-sm font-medium text-foreground">
                  {t('versionNumber', { number: version.versionNumber })}
                </span>
                <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
                  {t(`versionStatus.${status}`)}
                </Badge>
                {version.isContractBaseline ? (
                  <Badge tone="accent">{t('contractBaselineBadge')}</Badge>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Value — the one figure that should be readable from across a desk. */}
          <div className="flex flex-wrap items-baseline gap-2">
            {canViewCommercials ? (
              <>
                <LtrValue className="text-h1 font-bold tabular-nums text-foreground">
                  {formatMoney(version?.totalAmount ?? null, currency, locale) ?? t('summary.notPriced')}
                </LtrValue>
                <span className="text-caption text-muted-foreground">{currency}</span>
              </>
            ) : (
              <span className="text-h3 font-semibold text-muted-foreground">
                {t('summary.restricted')}
              </span>
            )}
          </div>

          {/* Structure and pricing completeness, on one line rather than in two boxes. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-muted-foreground">
            <span>{t('summary.sectionsAndItems', { sections: sectionCount, items: itemCount })}</span>
            <span aria-hidden="true">·</span>
            <span className={cn(complete ? 'font-medium text-success' : 'text-muted-foreground')}>
              {t('summary.pricedOf', { priced: pricedCount, total: itemCount })}
            </span>

            {/* A progress bar is a status carrier, not an accent: amber while there is work
                left, green when there is none. It was brand blue, so a finished BOQ looked
                exactly like an unfinished one. */}
            <span
              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('summary.pricingCompleteness')}
            >
              <span
                className={cn(
                  'block h-full rounded-full transition-[width] duration-(--motion-layout)',
                  complete ? 'bg-success' : 'bg-warning',
                )}
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </span>
            <span
              className={cn('tabular-nums', complete ? 'font-medium text-success' : 'text-warning')}
            >
              {percent}%
            </span>
          </div>

          {/* Provenance: what this version derives from, and what the contract points at. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted-foreground">
            {revision ? (
              <span>{t('basedOn', { number: revision.basedOnVersionNumber })}</span>
            ) : null}

            {revision && canViewCommercials && revision.netDelta ? (
              <LtrValue
                className={revision.netDelta.startsWith('-') ? 'text-success' : 'text-warning'}
              >
                {t('changeSummary', {
                  count: revision.changedItemCount,
                  amount: formatMoney(revision.netDelta, currency, locale) ?? '',
                })}
              </LtrValue>
            ) : null}

            <ContractBaselineNote
              contractBaseline={contractBaseline}
              matchesApproved={contractMatchesApproved}
            />

            {version?.baselinedAt ? (
              <span>{t('baselinedOn', { date: formatDate(version.baselinedAt, locale) ?? '—' })}</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
      </div>
    </section>
  );
}

/**
 * Which version the contract actually references.
 *
 * Worth a state colour of its own: an approved revision that the contract has not moved to
 * means the scope on screen is not the scope the client signed, and that is the kind of
 * thing a surveyor should not have to work out by comparing two version numbers.
 */
function ContractBaselineNote({
  contractBaseline,
  matchesApproved,
}: {
  contractBaseline: BoqVersionSummary | null;
  matchesApproved: boolean;
}) {
  const t = useTranslations('platform.boq.summary');

  if (!contractBaseline) {
    return <span>{t('noContractBaselineHint')}</span>;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        matchesApproved ? 'text-success' : 'text-warning',
      )}
    >
      {matchesApproved ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <AlertTriangle size={14} aria-hidden="true" />
      )}
      {matchesApproved
        ? t('contractCurrentAt', { number: contractBaseline.versionNumber })
        : t('contractBehindAt', { number: contractBaseline.versionNumber })}
    </span>
  );
}
