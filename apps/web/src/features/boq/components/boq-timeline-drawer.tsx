'use client';

import type { BoqTimelineEntry, BoqTimelineResponse } from '@erp/types';
import { CheckCircle2, GitPullRequestArrow, PencilLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  LtrValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  cn,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

/**
 * The timeline drawer (R11 concept D, on demand) — right-docked, never permanent chrome.
 *
 * Renders `BoqTimelineResponse` newest-first: the commit, each variation-adopt snapshot, and
 * notable per-line change events. Plain language, no version numbers (Decision 9). Clicking an
 * entry scrolls the grid to the line it concerns (when it carries one).
 *
 * Built on `Sheet` rather than the hand-rolled overlay this used to be — the old version had no
 * focus trap, no Escape handling and no scroll lock. The caller still mount-gates this exactly
 * as before (`{timelineOpen ? <BoqTimelineDrawer .../> : null}`); `open` stays `true` for the
 * component's whole lifetime and `onOpenChange(false)` — Escape, outside click, the close
 * button — calls `onClose`, which is what actually unmounts it. Same pattern
 * `LifecycleCommandDrawer` already uses for its own always-mounted `Dialog`.
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
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent className="max-w-sm" closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle>{t('heading')}</SheetTitle>
        </SheetHeader>

        <SheetBody>
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
        </SheetBody>
      </SheetContent>
    </Sheet>
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
