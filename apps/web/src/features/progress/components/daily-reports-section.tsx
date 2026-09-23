'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, DatePicker, FormField, SectionHeader, Dialog, DialogContent, DialogDescription, DialogTitle } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useCreateDpr, useDprs } from '../hooks/use-progress';
import { DprStatusBadge } from './dpr-status-badge';
import { DprDetail } from './dpr-detail';
import { RefButton, RefCard, RefEmpty, RefTable, RefTableScroll, RefTbody, RefTd, RefTh, RefThead, RefTr } from './ref-ui';

const refFieldClass = 'rounded-lg border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

/**
 * Daily progress reports: an operational index that leads with the list, not a form.
 *
 * Starting a report only asks for the date it's for — everything else (weather, work completed,
 * labour, equipment, issues, photos) is filled in on the full report screen that opens right
 * after, which is where a site engineer actually spends their time. On a successful create the
 * dialog closes and the new report's detail opens immediately.
 */
export function DailyReportsSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [selectedDprId, setSelectedDprId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, isPending, isError, refetch, isFetching } = useDprs(projectId);

  if (selectedDprId) {
    return (
      <DprDetail
        projectId={projectId}
        dprId={selectedDprId}
        onBack={() => setSelectedDprId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title={t('report.listTitle')}>
        <RefButton size="sm" onClick={() => setCreating(true)}>
          {t('actions.newReport')}
        </RefButton>
      </SectionHeader>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="rounded-xl p-5 sm:p-6 sm:max-w-sm" aria-describedby="new-report-desc">
          <DialogTitle>{t('report.newTitle')}</DialogTitle>
          <DialogDescription id="new-report-desc">{t('report.newHint')}</DialogDescription>
          <div className="mt-5">
            <CreateReportForm
              projectId={projectId}
              onCreated={(id) => {
                setCreating(false);
                setSelectedDprId(id);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <RefCard>
        {isPending ? (
          <div role="status" aria-live="polite" className="p-5">
            <span className="sr-only">{tCommon('loading')}</span>
            <div className="h-40 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
          </div>
        ) : isError ? (
          <div className="p-5">
            <Alert variant="error" messages={[t('states.loadFailed')]}>
              <div className="mt-3">
                <RefButton variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                  {t('actions.retry')}
                </RefButton>
              </div>
            </Alert>
          </div>
        ) : data.length === 0 ? (
          <div className="p-5">
            <RefEmpty title={t('report.emptyTitle')} hint={t('report.emptyHint')} />
          </div>
        ) : (
          <RefTableScroll aria-label={t('report.listTitle')}>
            <RefTable>
              <RefThead>
                <RefTr>
                  <RefTh>{t('report.fields.reportDate')}</RefTh>
                  <RefTh>{t('report.statusLabel')}</RefTh>
                  <RefTh numeric>{t('report.fields.labourCount')}</RefTh>
                  <RefTh>{t('report.fields.preparedBy')}</RefTh>
                </RefTr>
              </RefThead>
              <RefTbody>
                {data.map((dpr) => (
                  <RefTr key={dpr.id} className="relative">
                    <RefTd className="whitespace-nowrap">
                      {/* Stretched-link pattern: one keyboard-focusable control (this button) with an
                          absolute overlay, so a click anywhere on the row opens the detail while the
                          row stays a plain <tr> (not a button) for a11y. */}
                      <button
                        type="button"
                        onClick={() => setSelectedDprId(dpr.id)}
                        className="-my-3 flex min-h-11 items-center font-medium text-gray-900 underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                      >
                        {formatDate(dpr.reportDate, locale)}
                      </button>
                    </RefTd>
                    <RefTd>
                      <DprStatusBadge status={dpr.status} />
                    </RefTd>
                    <RefTd numeric className="tabular-nums">
                      {dpr.labourCount ?? <span className="text-gray-400">—</span>}
                    </RefTd>
                    <RefTd className="whitespace-nowrap text-gray-500">
                      {dpr.preparedByName ?? dpr.preparedBy}
                    </RefTd>
                  </RefTr>
                ))}
              </RefTbody>
            </RefTable>
          </RefTableScroll>
        )}
      </RefCard>
    </div>
  );
}

/**
 * Starting a report only fixes the date it's for (a report can't be filed for the future, and
 * backfilling a missed day needs a date in the past). Weather, work completed, labour, equipment,
 * issues and photos are all filled in on the report screen that opens immediately after — see
 * `ReportDetailsCard` in `dpr-detail.tsx`.
 */
function CreateReportForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (dprId: string) => void;
}) {
  const t = useTranslations('progress');
  const create = useCreateDpr(projectId);

  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reportDate) return;
    create.mutate(
      { reportDate },
      {
        onSuccess: (dpr) => onCreated(dpr.id),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} aria-label={t('actions.newReport')}>
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <FormField htmlFor="dpr-date" label={t('report.fields.reportDate')}>
        <DatePicker id="dpr-date" value={reportDate} max={today} onChange={(value) => setReportDate(value)} className={refFieldClass} />
      </FormField>
      <div className="mt-4">
        <RefButton type="submit" disabled={create.isPending || !reportDate} className="w-full">
          {t('actions.newReport')}
        </RefButton>
      </div>
    </form>
  );
}
