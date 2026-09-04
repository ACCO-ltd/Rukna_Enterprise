'use client';

import { ChevronRight, History as HistoryIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Skeleton, cn } from '@erp/ui';
import type { BoqChangeEventResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useBoqHistory } from '../hooks/use-boq';

/** Node field name → the label used in the sentence, so the log reads in plain words. */
const FIELD_LABELS: Record<string, string> = {
  unitRate: 'rate',
  quantity: 'quantity',
  description: 'description',
  unit: 'unit',
  code: 'code',
  measurementMethod: 'measurementMethod',
  pricingBasis: 'pricingBasis',
};

/**
 * The BOQ change log — "who changed what, and what was it before" (BOQ refinement Phase 1).
 *
 * A disclosure at the foot of the workspace, mirroring the version panel: collapsed by default (so
 * it does not fetch until opened) and one interaction from the full feed. A value edit reads
 * "Ahmed changed rate of 02.01.001: 80.00 → 85.00"; structural changes and imports show the
 * server's own summary. Commercial figures are withheld from a user who cannot see them.
 */
export function BoqHistoryPanel({
  projectId,
  versionId,
  currency,
  canViewCommercials,
  open,
  onToggle,
  filterCode,
  filterNodeId,
  onClearFilter,
}: {
  projectId: string;
  versionId: string | null;
  currency: string;
  canViewCommercials: boolean;
  open: boolean;
  onToggle: () => void;
  /** When set, the feed is narrowed to one line and its code is shown. */
  filterCode?: string | null;
  filterNodeId?: string | null;
  onClearFilter?: () => void;
}) {
  const t = useTranslations('platform.boq.history');
  const locale = useLocale() as 'en' | 'ar';

  const query = useBoqHistory(projectId, versionId, { nodeId: filterNodeId ?? null, enabled: open });
  const events = query.data ?? [];

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            'flex min-h-12 w-full items-center justify-between gap-3 px-5 text-start',
            'hover:bg-surface-hover focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-primary',
            open && 'border-b border-border',
          )}
        >
          <span className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
            <ChevronRight
              size={16}
              className={cn('text-muted-foreground transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
            <HistoryIcon size={16} className="text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            {t('title')}
          </span>
          <span className="text-caption text-muted-foreground">
            {filterCode ? t('filteredHint', { code: filterCode }) : t('hint')}
          </span>
        </button>
      </h2>

      {!open ? null : (
        <div className="px-5 py-4">
          {filterCode && onClearFilter ? (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-caption text-muted-foreground">{t('filteredTo', { code: filterCode })}</span>
              <Button variant="ghost" size="sm" onClick={onClearFilter}>
                {t('clearFilter')}
              </Button>
            </div>
          ) : null}

          {query.isPending ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <Skeleton className="h-6 w-full" aria-hidden="true" />
              <Skeleton className="h-6 w-3/4" aria-hidden="true" />
            </div>
          ) : query.isError ? (
            <Alert variant="error" messages={[errorText(query.error, t('loadFailed'))]} />
          ) : events.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ol className="space-y-2.5">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-body-sm">
                  <span className="font-medium text-foreground">{event.actorName ?? t('someone')}</span>
                  <span className="min-w-0 text-muted-foreground">
                    {describe(event, t, currency, locale, canViewCommercials)}
                  </span>
                  <span className="ms-auto whitespace-nowrap text-caption text-muted-foreground">
                    {formatDate(event.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function describe(
  event: BoqChangeEventResponse,
  t: ReturnType<typeof useTranslations>,
  currency: string,
  locale: 'en' | 'ar',
  canViewCommercials: boolean,
): string {
  if (event.action === 'UPDATE' && event.field) {
    const field = t(`field.${FIELD_LABELS[event.field] ?? 'field'}`);
    const code = event.code ?? '';
    // A rate is commercial — a user who cannot see rates does not see the values here either.
    if (event.field === 'unitRate' && !canViewCommercials) {
      return t('changedRestricted', { field, code });
    }
    return t('changed', {
      field,
      code,
      from: formatValue(event.field, event.oldValue, currency, locale),
      to: formatValue(event.field, event.newValue, currency, locale),
    });
  }
  // Structural changes and imports carry the server's own summary line.
  return event.detail ?? t('genericChange');
}

function formatValue(
  field: string,
  value: string | null,
  currency: string,
  locale: 'en' | 'ar',
): string {
  if (value === null || value === '') return '—';
  if (field === 'unitRate') return formatMoney(value, currency, locale) ?? value;
  return value;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
