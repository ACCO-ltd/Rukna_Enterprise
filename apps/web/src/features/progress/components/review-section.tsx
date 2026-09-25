'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Avatar, Tabs, TabsContent, TabsList, TabsTrigger } from '@erp/ui';
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
    approved: t('review.approved'),
  };

  // Switching filters keeps the current selection only when it still belongs to the new group —
  // otherwise the first result in that group takes over, or the selection clears so the queue's
  // own empty state shows instead of a stale detail pane.
  function onTabChange(next: string) {
    const nextTab = next as QueueTab;
    setTab(nextTab);
    const nextItems = groups[nextTab];
    setSelectedDprId((current) => (current && nextItems.some((d) => d.id === current) ? current : nextItems[0]?.id ?? null));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr] lg:items-start">
      <RefCard className="lg:sticky lg:top-4">
        <RefCardHeader
          icon={<ClipboardCheck size={17} strokeWidth={1.9} />}
          title={t('review.title')}
          subtitle={t('review.subtitle')}
        />
        <Tabs value={tab} onValueChange={onTabChange}>
          <div className="px-5 pt-2">
            <TabsList aria-label={t('review.tabsLabel')}>
              {(Object.keys(groups) as QueueTab[]).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {tabLabels[key]}
                  <TabCount value={groups[key].length} />
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {(Object.keys(groups) as QueueTab[]).map((key) => (
            <TabsContent key={key} value={key} className="mt-3 max-h-[32rem] overflow-y-auto px-2 pb-2">
              <QueueList items={groups[key]} tab={key} selectedDprId={selectedDprId} onSelect={setSelectedDprId} locale={locale} t={t} />
            </TabsContent>
          ))}
        </Tabs>
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

/** A tab's result count — omitted entirely (not shown as "0") when the group is empty. */
function TabCount({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ms-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-medium text-white">
      {value}
    </span>
  );
}

function QueueList({
  items,
  tab,
  selectedDprId,
  onSelect,
  locale,
  t,
}: {
  items: DailyProgressReportResponse[];
  tab: QueueTab;
  selectedDprId: string | null;
  onSelect: (id: string) => void;
  locale: 'en';
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  if (items.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-body text-muted-foreground">{t('review.empty')}</p>
        {tab === 'submitted' ? <p className="mt-1 text-caption text-disabled-foreground">{t('review.emptyHint')}</p> : null}
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {items.map((dpr) => (
        <QueueRow key={dpr.id} dpr={dpr} selected={dpr.id === selectedDprId} onSelect={() => onSelect(dpr.id)} locale={locale} />
      ))}
    </ul>
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
