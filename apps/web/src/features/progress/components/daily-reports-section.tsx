'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  DatePicker,
  FormField,
  Input,
  Select,
  SectionHeader,
  Dialog,
  DialogContent,
  DialogTitle,
  Textarea,
} from '@erp/ui';

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
        <RefButton size="sm" onClick={() => setCreating(true)}>
          {t('actions.newReport')}
        </RefButton>
      </SectionHeader>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="rounded-xl p-5 sm:p-6 sm:max-w-xl">
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
 * Bounded site-condition options (ADR-021 redesign §5.2). Stored as their readable string so the
 * DPR detail can show them verbatim and analysis can group by a known set — never free-typed prose
 * that reads "rainy" / "Rainy" / "RAINY". A hot-climate (Banaadir) weather set; a delay taxonomy
 * that seeds later delay/EOT analysis. Defaults are the first entry, so no field is a blank guess.
 */
const WEATHER_OPTIONS = [
  'Clear',
  'Sunny / hot',
  'Partly cloudy',
  'Overcast',
  'Light rain',
  'Heavy rain',
  'Thunderstorm',
  'Windy',
  'Dust / haze',
  'Fog',
] as const;

const DELAY_OPTIONS = [
  'No delay',
  'Weather',
  'Material shortage',
  'Labour shortage',
  'Equipment breakdown',
  'Client instruction',
  'Design change / RFI',
  'Site access restriction',
  'Utilities / services',
  'Permit / authority',
  'Other',
] as const;

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
  const [weather, setWeather] = useState<string>(WEATHER_OPTIONS[0]);
  const [labourCount, setLabourCount] = useState('');
  const [equipmentNote, setEquipmentNote] = useState('');
  const [narrative, setNarrative] = useState('');
  const [delayReason, setDelayReason] = useState<string>(DELAY_OPTIONS[0]);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reportDate) return;
    create.mutate(
      {
        reportDate,
        weather: weather || undefined,
        labourCount: labourCount ? Number(labourCount) : undefined,
        equipmentNote: equipmentNote.trim() || undefined,
        narrative: narrative.trim() || undefined,
        delayReason: delayReason || undefined,
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
          {/* A report can't be filed for the future. */}
          <DatePicker id="dpr-date" value={reportDate} max={today} onChange={(value) => setReportDate(value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="dpr-weather" label={t('report.fields.weather')}>
          <Select id="dpr-weather" value={weather} onChange={(value) => setWeather(value)} className={refFieldClass}>
            {WEATHER_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="dpr-labour" label={t('report.fields.labourCount')}>
          <Input id="dpr-labour" type="number" min="0" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="dpr-equipment" label={t('report.fields.equipmentNote')}>
          <Input id="dpr-equipment" value={equipmentNote} onChange={(e) => setEquipmentNote(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="dpr-delay" label={t('report.fields.delayReason')}>
          <Select id="dpr-delay" value={delayReason} onChange={(value) => setDelayReason(value)} className={refFieldClass}>
            {DELAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField htmlFor="dpr-narrative" label={t('report.fields.narrative')}>
            <Textarea id="dpr-narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} className={refFieldClass} />
          </FormField>
        </div>
      </div>
      <div className="mt-4">
        <RefButton type="submit" disabled={create.isPending}>
          {t('actions.newReport')}
        </RefButton>
      </div>
    </form>
  );
}
