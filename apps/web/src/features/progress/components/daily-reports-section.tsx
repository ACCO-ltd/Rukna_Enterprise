'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  Input,
  SectionHeader,
  Dialog,
  DialogContent,
  DialogTitle,
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

/**
 * Daily progress reports: an operational index that leads with the list, not a form.
 *
 * The create form used to sit always-on above the table (audit PR2); it now lives behind the
 * one primary action (`+ New daily report`) in a `Dialog`, so the view opens on the record of
 * what has already happened. On a successful create the sheet closes and the new report's detail
 * opens — the same flow, one step less noise on arrival.
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
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('actions.newReport')}
        </Button>
      </SectionHeader>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="p-5 sm:p-6 sm:max-w-xl">
          <DialogTitle>{t('report.newTitle')}</DialogTitle>
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
                <TableRow key={dpr.id} className="relative cursor-pointer hover:bg-surface-subtle">
                  <TableCell className="whitespace-nowrap">
                    {/* Stretched-link pattern: one keyboard-focusable control (this button) with an
                        absolute overlay, so a click anywhere on the row opens the detail while the
                        row stays a plain <tr> (not a button) for a11y. */}
                    <button
                      type="button"
                      onClick={() => setSelectedDprId(dpr.id)}
                      className="-my-3 flex min-h-11 items-center font-medium text-foreground underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
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
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dpr.preparedByName ?? dpr.preparedBy}
                  </TableCell>
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
    <form onSubmit={onSubmit} aria-label={t('actions.newReport')}>
      {error ? (
        <div className="mb-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField htmlFor="dpr-date" label={t('report.fields.reportDate')}>
          <DatePicker id="dpr-date" value={reportDate} onChange={(value) => setReportDate(value)} />
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
      <div className="mt-4">
        <Button type="submit" disabled={create.isPending}>
          {t('actions.newReport')}
        </Button>
      </div>
    </form>
  );
}
