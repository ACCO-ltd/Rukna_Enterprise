'use client';

import type { BoqTimelineEntry, BoqTimelineResponse } from '@erp/types';
import { CheckCircle2, GitPullRequestArrow, PencilLine, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, LtrValue, Skeleton, cn } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

/**
 * The timeline drawer (R11 concept D, on demand) — right-docked, never permanent chrome.
 *
 * Renders `BoqTimelineResponse` newest-first: the commit, each variation-adopt snapshot, and
 * notable per-line change events. Plain language, no version numbers (Decision 9). Clicking an
 * entry scrolls the grid to the line it concerns (when it carries one).
 */
export function BoqTimelineDrawer({
  data,
  currency,
  canViewMargin,
  isPending,
  isError,
  onSelectVersion,
  onClose,
}: {
  data: BoqTimelineResponse | undefined;
  currency: string;
  /** Contract-scale amounts are `canViewMargin`; line amounts are `canViewCost`. */
  canViewMargin: boolean;
  isPending: boolean;
  isError: boolean;
  onSelectVersion?: (versionId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.timeline');

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('heading')}>
      <button
        type="button"
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
        aria-label={t('close')}
        onClick={onClose}
      />
      <aside className="absolute end-0 top-0 flex h-full w-full max-w-sm flex-col border-s border-border bg-surface shadow-e3">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-h3 font-semibold text-foreground">{t('heading')}</h2>
          <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : isError ? (
            <Alert variant="error" messages={[t('loadFailed')]} />
          ) : !data || data.entries.length === 0 ? (
            <Alert variant="info" messages={[t('empty')]} />
          ) : (
            <ol className="space-y-1">
              {data.entries.map((entry) => (
                <TimelineRow
                  key={entry.id}
                  entry={entry}
                  currency={currency}
                  canViewMargin={canViewMargin}
                  onSelect={onSelectVersion}
                />
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function TimelineRow({
  entry,
  currency,
  canViewMargin,
  onSelect,
}: {
  entry: BoqTimelineEntry;
  currency: string;
  canViewMargin: boolean;
  onSelect?: (versionId: string) => void;
}) {
  const t = useTranslations('platform.boq.timeline');
  const locale = useLocale() as 'en' | 'ar';

  const clickable = Boolean(entry.versionId && onSelect);
  const amount = canViewMargin ? formatMoney(entry.amount, currency, locale) : null;

  return (
    <li>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => entry.versionId && onSelect?.(entry.versionId)}
        className={cn(
          'flex w-full items-start gap-3 rounded-control px-2 py-2 text-start transition-colors',
          clickable ? 'hover:bg-surface-hover' : 'cursor-default',
        )}
      >
        <TimelineIcon kind={entry.kind} />
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-medium text-foreground">{entry.label}</span>
          <span className="block text-caption text-muted-foreground">
            {entry.actorName ? `${t('by', { name: entry.actorName })} · ` : ''}
            {formatDate(entry.occurredAt, locale) ?? ''}
          </span>
        </span>
        {amount ? (
          <LtrValue className="shrink-0 text-caption font-medium tabular-nums text-foreground">
            {amount}
          </LtrValue>
        ) : null}
      </button>
    </li>
  );
}

function TimelineIcon({ kind }: { kind: BoqTimelineEntry['kind'] }) {
  const className = 'mt-0.5 shrink-0';
  if (kind === 'COMMITTED') {
    return <CheckCircle2 size={16} className={cn(className, 'text-success')} aria-hidden="true" />;
  }
  if (kind === 'VARIATION_SNAPSHOT') {
    return (
      <GitPullRequestArrow size={16} className={cn(className, 'text-brand-primary')} aria-hidden="true" />
    );
  }
  return <PencilLine size={16} className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
}
