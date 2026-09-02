'use client';

import type { BoqVersionSummary } from '@erp/types';
import { GitCompare, History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, cn, LtrValue, type BadgeTone } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

/** Must match the status bar's map — the same badge in two colours is worse than no colour. */
const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'warning',
  BASELINED: 'live',
  SUPERSEDED: 'historical',
  CANCELLED: 'neutral',
};

/**
 * Version history, and the way to switch between versions.
 *
 * The old screen offered a `<Select>` of "Version 3 — BASELINED" strings, which could tell
 * you a version existed but not what it was worth, what it derived from, or which one the
 * contract actually references. Those three facts are why someone opens version history.
 *
 * SUPERSEDED and CANCELLED are shown. The previous status strip collapsed both into
 * BASELINED, so a cancelled draft and an approved baseline rendered identically.
 */
export function BoqVersionPanel({
  versions,
  selectedId,
  currency,
  canViewCommercials,
  onSelect,
  onCompare,
}: {
  versions: BoqVersionSummary[];
  selectedId: string | null;
  currency: string;
  canViewCommercials: boolean;
  onSelect: (versionId: string) => void;
  onCompare: (leftId: string, rightId: string) => void;
}) {
  const t = useTranslations('platform.boq.versions');
  const locale = useLocale() as 'en' | 'ar';

  const ordered = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
          <History size={16} className="text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          {t('heading')}
        </div>
        <span className="text-caption text-muted-foreground">
          {t('count', { count: versions.length })}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {ordered.map((version) => {
          const selected = version.id === selectedId;
          const basedOn = version.derivedFromVersionId
            ? ordered.find((other) => other.id === version.derivedFromVersionId)
            : undefined;

          return (
            <li key={version.id}>
              <div
                className={cn(
                  'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5',
                  selected && 'bg-surface-selected',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(version.id)}
                  aria-current={selected ? 'true' : undefined}
                  className="min-w-0 flex-1 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-semibold text-foreground">
                      {t('version', { number: version.versionNumber })}
                    </span>
                    <Badge tone={STATUS_TONE[version.status] ?? 'neutral'}>
                      {t(`status.${version.status}`)}
                    </Badge>
                    {/* `info`, not `accent` — accent is the historical purple, which is what
                        SUPERSEDED already wears in this very list. */}
                    {version.isContractBaseline ? (
                      <Badge tone="info">{t('contractBaseline')}</Badge>
                    ) : null}
                    {/* A tick beside a "Draft" badge reads as approved. The row is already
                        tinted and carries aria-current; say plainly what it means instead. */}
                    {selected ? (
                      <span className="text-micro font-semibold uppercase text-brand-primary">
                        {t('viewing')}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-caption text-muted-foreground">
                    {basedOn ? t('basedOn', { number: basedOn.versionNumber }) : t('original')}
                    {' · '}
                    {t('items', { count: version.itemCount })}
                    {version.baselinedAt
                      ? ` · ${t('baselined', { date: formatDate(version.baselinedAt, locale) ?? '' })}`
                      : ` · ${t('created', { date: formatDate(version.createdAt, locale) ?? '' })}`}
                  </p>

                  {version.notes ? (
                    <p className="mt-1 line-clamp-1 text-caption italic text-muted-foreground">
                      {version.notes}
                    </p>
                  ) : null}
                </button>

                <div className="flex shrink-0 items-center gap-3">
                  {canViewCommercials ? (
                    <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
                      {formatMoney(version.totalAmount, currency, locale) ?? '—'}
                    </LtrValue>
                  ) : null}

                  {basedOn ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => onCompare(basedOn.id, version.id)}
                    >
                      <GitCompare size={14} aria-hidden="true" />
                      {t('compare')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
