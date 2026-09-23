'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, SectionHeader, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent } from '@erp/ui';
import type { DailyProgressReportResponse } from '@erp/types';

import { formatDate } from '@/lib/format';

import { useDprs } from '../hooks/use-progress';
import { DprStatusBadge } from './dpr-status-badge';
import { DprDetail } from './dpr-detail';

/**
 * Review view — the PM's primary entry point.
 *
 * Shows DPRs grouped by status: SUBMITTED (oldest first, the actionable queue),
 * RETURNED (reports sent back, may need a follow-up), and recently APPROVED.
 * Clicking a row opens the full DPR detail where the PM can approve or return.
 *
 * Phase 4 will add a rich review detail with side-by-side measurement comparison.
 */
export function ReviewSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const dprs = useDprs(projectId);
  const [selectedDprId, setSelectedDprId] = useState<string | null>(null);

  if (selectedDprId) {
    return (
      <DprDetail
        projectId={projectId}
        dprId={selectedDprId}
        onBack={() => setSelectedDprId(null)}
      />
    );
  }

  if (dprs.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" aria-hidden="true" />
        <Skeleton className="h-12 w-full" aria-hidden="true" />
        <Skeleton className="h-12 w-full" aria-hidden="true" />
      </div>
    );
  }

  if (dprs.isError) {
    return <Alert variant="error" messages={[t('states.loadFailed')]} />;
  }

  const all = dprs.data ?? [];
  const submitted = [...all.filter((d) => d.status === 'SUBMITTED')].sort(
    (a, b) => a.reportDate.localeCompare(b.reportDate),
  );
  const returned = all.filter((d) => d.status === 'RETURNED');
  const approved = [...all.filter((d) => d.status === 'APPROVED')].sort(
    (a, b) => b.reportDate.localeCompare(a.reportDate),
  ).slice(0, 10);

  return (
    <div className="space-y-4">
      <SectionHeader title={t('review.title')}>
        <p className="text-body-sm text-muted-foreground">{t('review.subtitle')}</p>
      </SectionHeader>

      <Tabs defaultValue="submitted">
        <TabsList>
          <TabsTrigger value="submitted">
            {t('review.awaiting')}
            {submitted.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {submitted.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="returned">{t('review.returned')}</TabsTrigger>
          <TabsTrigger value="approved">{t('review.recentlyApproved')}</TabsTrigger>
        </TabsList>

        <TabsContent value="submitted" className="mt-4">
          <DprQueue
            items={submitted}
            empty={t('review.empty')}
            emptyHint={t('review.emptyHint')}
            onOpen={(id) => setSelectedDprId(id)}
            locale={locale}
            t={t}
          />
        </TabsContent>

        <TabsContent value="returned" className="mt-4">
          <DprQueue
            items={returned}
            empty={t('review.empty')}
            onOpen={(id) => setSelectedDprId(id)}
            locale={locale}
            t={t}
          />
        </TabsContent>

        <TabsContent value="approved" className="mt-4">
          <DprQueue
            items={approved}
            empty={t('review.empty')}
            onOpen={(id) => setSelectedDprId(id)}
            locale={locale}
            t={t}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DprQueue({
  items,
  empty,
  emptyHint,
  onOpen,
  locale,
  t,
}: {
  items: DailyProgressReportResponse[];
  empty: string;
  emptyHint?: string;
  onOpen: (id: string) => void;
  locale: string;
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center">
        <p className="text-body-sm text-muted-foreground">{empty}</p>
        {emptyHint && <p className="mt-1 text-body-xs text-muted-foreground">{emptyHint}</p>}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((dpr) => (
        <DprQueueRow key={dpr.id} dpr={dpr} onOpen={onOpen} locale={locale} t={t} />
      ))}
    </div>
  );
}

function DprQueueRow({
  dpr,
  onOpen,
  locale,
  t,
}: {
  dpr: DailyProgressReportResponse;
  onOpen: (id: string) => void;
  locale: string;
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <DprStatusBadge status={dpr.status as any} />
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-foreground truncate">
            {formatDate(dpr.reportDate, locale as 'en')}
          </p>
          {dpr.preparedByName && (
            <p className="text-body-xs text-muted-foreground truncate">{dpr.preparedByName}</p>
          )}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(dpr.id)}>
        {t('review.openReport')}
      </Button>
    </div>
  );
}
