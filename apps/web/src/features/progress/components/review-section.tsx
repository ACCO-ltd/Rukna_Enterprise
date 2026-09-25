'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Avatar } from '@erp/ui';
import { ClipboardCheck } from 'lucide-react';
import type { DailyProgressReportResponse } from '@erp/types';

import { formatDate } from '@/lib/format';

import { useDprs } from '../hooks/use-progress';
import { DprStatusBadge } from './dpr-status-badge';
import { DprDetail } from './dpr-detail';
import { RefCard, RefCardHeader } from './ref-ui';

type QueueTab = 'submitted' | 'returned' | 'approved';

/**
 * Review view — the PM's primary entry point.
 *
 * Two-pane layout: a persistent queue on the left (grouped SUBMITTED / RETURNED / recently
 * APPROVED), the selected report's full detail on the right — so switching reports doesn't
 * mean leaving and re-entering the queue. Below `lg` the queue and detail stack instead
 * (a 375px viewport has no room for two panes side by side).
 */
export function ReviewSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const dprs = useDprs(projectId);
  const [selectedDprId, setSelectedDprId] = useState<string | null>(null);
  const [tab, setTab] = useState<QueueTab>('submitted');

  if (dprs.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-12 w-full animate-pulse rounded-panel bg-muted" aria-hidden="true" />
        <div className="h-12 w-full animate-pulse rounded-panel bg-muted" aria-hidden="true" />
        <div className="h-12 w-full animate-pulse rounded-panel bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (dprs.isError) {
    return <Alert variant="error" messages={[t('states.loadFailed')]} />;
  }

  const all = dprs.data ?? [];
  const submitted = [...all.filter((d) => d.status === 'SUBMITTED')].sort((a, b) =>
    a.reportDate.localeCompare(b.reportDate),
  );
  const returned = all.filter((d) => d.status === 'RETURNED');
  const approved = [...all.filter((d) => d.status === 'APPROVED')]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, 10);

  const groups: Record<QueueTab, DailyProgressReportResponse[]> = { submitted, returned, approved };
  const tabLabels: Record<QueueTab, string> = {
    submitted: t('review.awaiting'),
    returned: t('review.returned'),
    approved: t('review.recentlyApproved'),
  };
  const items = groups[tab];

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr] lg:items-start">
      <RefCard className="lg:sticky lg:top-4">
        <RefCardHeader
          icon={<ClipboardCheck size={17} strokeWidth={1.9} />}
          title={t('review.queueCount', { count: all.length })}
          subtitle={t('review.subtitle')}
        />
        <div className="border-t border-border px-5 pt-3">
          <div className="flex gap-1 rounded-panel bg-muted p-1">
            {(Object.keys(groups) as QueueTab[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-caption font-medium transition-colors ${
                  tab === key ? 'bg-surface text-foreground shadow-e1' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tabLabels[key]}
                {key === 'submitted' && submitted.length > 0 ? (
                  <span className="ms-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-medium text-white">
                    {submitted.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 max-h-[32rem] overflow-y-auto px-2 pb-2">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-body text-muted-foreground">{t('review.empty')}</p>
              {tab === 'submitted' ? <p className="mt-1 text-caption text-disabled-foreground">{t('review.emptyHint')}</p> : null}
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((dpr) => (
                <QueueRow
                  key={dpr.id}
                  dpr={dpr}
                  selected={dpr.id === selectedDprId}
                  onSelect={() => setSelectedDprId(dpr.id)}
                  locale={locale}
                />
              ))}
            </ul>
          )}
        </div>
      </RefCard>

      {selectedDprId ? (
        <DprDetail projectId={projectId} dprId={selectedDprId} onBack={() => setSelectedDprId(null)} />
      ) : (
        <RefCard>
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <ClipboardCheck size={28} strokeWidth={1.6} className="text-disabled-foreground" aria-hidden="true" />
            <p className="text-body font-medium text-foreground">{t('review.selectPrompt')}</p>
            <p className="text-body text-muted-foreground">{t('review.selectPromptHint')}</p>
          </div>
        </RefCard>
      )}
    </div>
  );
}

function QueueRow({
  dpr,
  selected,
  onSelect,
  locale,
}: {
  dpr: DailyProgressReportResponse;
  selected: boolean;
  onSelect: () => void;
  locale: 'en';
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full items-start gap-2.5 rounded-panel border px-3 py-2.5 text-start transition-colors ${
          selected ? 'border-brand-accent-strong bg-brand-accent' : 'border-transparent hover:bg-surface-subtle'
        }`}
      >
        <Avatar name={dpr.preparedByName ?? dpr.preparedBy} size="sm" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-body font-medium text-foreground">{dpr.preparedByName ?? dpr.preparedBy}</p>
            <span className="shrink-0 text-caption text-disabled-foreground">{formatDate(dpr.reportDate, locale)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <DprStatusBadge status={dpr.status} />
          </div>
        </div>
      </button>
    </li>
  );
}
