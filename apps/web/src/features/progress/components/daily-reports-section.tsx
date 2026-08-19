'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { useCreateDpr, useDprs } from '../hooks/use-progress';
import { DprStatusBadge } from './dpr-status-badge';
import { DprDetail } from './dpr-detail';

/** Daily progress reports: list + create, and the selected report's detail. */
export function DailyReportsSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [selectedDprId, setSelectedDprId] = useState<string | null>(null);
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
      <CreateReportForm projectId={projectId} onCreated={(id) => setSelectedDprId(id)} />

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-40 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('states.loadFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      ) : data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('report.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('report.emptyHint')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('report.listTitle')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('report.fields.reportDate')}</TableHead>
                <TableHead>{t('report.statusLabel')}</TableHead>
                <TableHead numeric>{t('report.fields.labourCount')}</TableHead>
                <TableHead>{t('report.fields.preparedBy')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((dpr) => (
                <TableRow key={dpr.id}>
                  <TableCell className="whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedDprId(dpr.id)}
                      className="-my-3 flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                    >
                      {formatDate(dpr.reportDate, locale)}
                    </button>
                  </TableCell>
                  <TableCell>
                    <DprStatusBadge status={dpr.status} />
                  </TableCell>
                  <TableCell numeric className="tabular-nums">
                    {dpr.labourCount ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dpr.preparedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </div>
  );
}

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
  const [weather, setWeather] = useState('');
  const [labourCount, setLabourCount] = useState('');
  const [narrative, setNarrative] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reportDate) return;
    create.mutate(
      {
        reportDate,
        weather: weather.trim() || undefined,
        labourCount: labourCount ? Number(labourCount) : undefined,
        narrative: narrative.trim() || undefined,
        delayReason: delayReason.trim() || undefined,
      },
      {
        onSuccess: (dpr) => onCreated(dpr.id),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-panel border border-border bg-surface p-4 sm:p-5" aria-label={t('actions.newReport')}>
      <h3 className="text-sm font-semibold text-foreground">{t('actions.newReport')}</h3>
      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormField htmlFor="dpr-date" label={t('report.fields.reportDate')}>
          <Input id="dpr-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </FormField>
        <FormField htmlFor="dpr-weather" label={t('report.fields.weather')}>
          <Input id="dpr-weather" value={weather} onChange={(e) => setWeather(e.target.value)} />
        </FormField>
        <FormField htmlFor="dpr-labour" label={t('report.fields.labourCount')}>
          <Input id="dpr-labour" type="number" min="0" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} />
        </FormField>
        <FormField htmlFor="dpr-delay" label={t('report.fields.delayReason')}>
          <Input id="dpr-delay" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField htmlFor="dpr-narrative" label={t('report.fields.narrative')}>
            <Textarea id="dpr-narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} />
          </FormField>
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={create.isPending}>
          {t('actions.newReport')}
        </Button>
      </div>
    </form>
  );
}
