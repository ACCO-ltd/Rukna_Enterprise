'use client';

import type { BoqRevisionSummary, BoqVersionSummary } from '@erp/types';
import { ClipboardList } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, LtrValue, type BadgeTone } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'info',
  BASELINED: 'live',
  SUPERSEDED: 'historical',
  CANCELLED: 'neutral',
};

/**
 * The BOQ page header.
 *
 * Replaces a `<label> + <select>` that asked "which version?" before the screen had said
 * anything about the BOQ's contractual state. A quantity surveyor opening this needs to
 * know what they are looking at — approved or draft, what it is worth, what it derives from
 * — before choosing to look at something else. Version switching moved to the version
 * panel, where the history it needs is visible.
 *
 * Follows the shell's own header geometry: neutral bordered icon block, `text-h1` title,
 * status badge inline, meta line beneath, actions trailing.
 */
export function BoqHeader({
  version,
  revision,
  currency,
  canViewCommercials,
  actions,
}: {
  version: BoqVersionSummary | null;
  revision: BoqRevisionSummary | null;
  currency: string;
  canViewCommercials: boolean;
  actions: React.ReactNode;
}) {
  const t = useTranslations('platform.boq');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <section className="border-b border-border pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-panel border border-border bg-surface-subtle text-foreground">
            <ClipboardList size={25} strokeWidth={1.8} aria-hidden="true" />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h1 font-bold leading-tight text-foreground">{t('title')}</h1>
              {version ? (
                <Badge tone={STATUS_TONE[version.status] ?? 'neutral'}>
                  {t(`versionStatus.${version.status}`)}
                </Badge>
              ) : null}
              {version?.isContractBaseline ? (
                <Badge tone="accent">{t('contractBaselineBadge')}</Badge>
              ) : null}
            </div>

            <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>

            {version ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t('versionNumber', { number: version.versionNumber })}
                </span>

                {revision ? (
                  <span>
                    {t('basedOn', { number: revision.basedOnVersionNumber })}
                  </span>
                ) : null}

                {/* The delta is the fact a reviewer opens a revision to find. Withheld
                    entirely — not shown as zero — when the server omitted the figures. */}
                {revision && canViewCommercials && revision.netDelta ? (
                  <span
                    className={
                      revision.netDelta.startsWith('-') ? 'text-success' : 'text-warning'
                    }
                  >
                    <LtrValue>
                      {t('changeSummary', {
                        count: revision.changedItemCount,
                        amount: formatMoney(revision.netDelta, currency, locale) ?? '',
                      })}
                    </LtrValue>
                  </span>
                ) : null}

                {version.baselinedAt ? (
                  <span>
                    {t('baselinedOn', {
                      date: formatDate(version.baselinedAt, locale) ?? '—',
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
    </section>
  );
}
