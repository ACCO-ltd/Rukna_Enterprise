'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@erp/ui';

import { DailyReportsSection } from './daily-reports-section';
import { VerifiedProgressSection } from './verified-progress-section';
import { WorkPackagesSection } from './work-packages-section';
import { PerformanceSection } from './performance-section';

/**
 * Programme & Progress workspace tab (ADR-021).
 *
 * Four separated truths, one surface: the daily site record (DPRs), verified physical progress,
 * the work-package control layer, and the physical-vs-financial signal. Sub-tabs are client-side
 * — the whole tab lives under one `/progress` route.
 */
export function ProgressTab({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Tabs defaultValue="reports">
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="reports">{t('tabs.reports')}</TabsTrigger>
          <TabsTrigger value="verified">{t('tabs.verified')}</TabsTrigger>
          <TabsTrigger value="workPackages">{t('tabs.workPackages')}</TabsTrigger>
          <TabsTrigger value="performance">{t('tabs.performance')}</TabsTrigger>
        </TabsList>

        <TabsContent value="reports">
          <DailyReportsSection projectId={projectId} />
        </TabsContent>
        <TabsContent value="verified">
          <VerifiedProgressSection projectId={projectId} />
        </TabsContent>
        <TabsContent value="workPackages">
          <WorkPackagesSection projectId={projectId} />
        </TabsContent>
        <TabsContent value="performance">
          <PerformanceSection projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
