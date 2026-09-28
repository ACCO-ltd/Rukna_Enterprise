'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DailyProgressReportResponse } from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  Notice,
  Skeleton,
} from '@erp/ui';
import { ClipboardList, Ellipsis } from 'lucide-react';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate } from '@/lib/format';
import { useSession } from '@/features/auth/session/use-session';

import { isEditableDpr, localIsoDate, myReports, sortMyReports } from '../domain/my-reports';
import { mapDprError } from '../domain/dpr-errors';
import { useCreateDpr, useDprs } from '../hooks/use-progress';
import { DprEntrySheet } from './dpr-entry-sheet';
import { DprStatusBadge } from './dpr-status-badge';

/**
 * Today — the site engineer's view.
 *
 * A context bar for the day (today's report status, what is waiting for review, the last approved
 * report) carrying the view's one primary: start, continue or open today's report. Below it, one
 * attention notice per report of MINE that a reviewer returned, then "My reports" with anything
 * waiting on me first. Reports open in a side sheet.
 *
 * "My reports" and the counts are derived client-side from the project's report list
 * (owner-approved) — there is no per-user endpoint.
 */
export function TodaySection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const session = useSession();
  const dprs = useDprs(projectId);
  const create = useCreateDpr(projectId);

  const [openDprId, setOpenDprId] = useState<string | null>(null);
  const [otherDayOpen, setOtherDayOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const today = localIsoDate();
  const userId = session.user?.id ?? null;
  const all = useMemo(() => dprs.data ?? [], [dprs.data]);
  const mine = useMemo(() => sortMyReports(myReports(all, userId)), [all, userId]);

  if (dprs.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-panel" aria-hidden="true" />
        <Skeleton className="h-48 w-full rounded-panel" aria-hidden="true" />
      </div>
    );
  }

  if (dprs.isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void dprs.refetch()}>
            {t('actions.retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  const todays = mine.find((d) => d.reportDate.slice(0, 10) === today) ?? null;
  const waiting = all.filter((d) => d.status === 'SUBMITTED').length;
  const lastApproved = [...all]
    .filter((d) => d.status === 'APPROVED')
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  const returned = mine.filter((d) => d.status === 'RETURNED');

  function startReport(reportDate: string, onDone?: () => void) {
    // One report per day: an existing report for that day (mine) opens instead of a duplicate.
    const existing = mine.find((d) => d.reportDate.slice(0, 10) === reportDate);
    if (existing) {
      onDone?.();
      setOpenDprId(existing.id);
      return;
    }
    setCreateError(null);
    create.mutate(
      { reportDate },
      {
        onSuccess: (dpr) => {
          onDone?.();
          setOpenDprId(dpr.id);
        },
        onError: (error) => setCreateError(mapDprError(error, t('today.createFailed')).formError),
      },
    );
  }

  const primaryLabel = !todays
    ? t('today.startReport')
    : isEditableDpr(todays.status)
      ? t('today.continueReport')
      : t('today.open');

  return (
    <div className="space-y-6">
      {/* Context bar */}
      <section
        aria-labelledby="today-context-title"
        className="flex flex-col gap-4 rounded-panel border border-border bg-surface px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between"
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="today-context-title" className="text-body font-semibold text-foreground">
              {t('today.contextTitle', { date: formatDate(today, locale) ?? today })}
            </h3>
            {todays ? (
              <DprStatusBadge status={todays.status} />
            ) : (
              <span className="text-body-sm text-muted-foreground">{t('today.notStarted')}</span>
            )}
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t('today.waitingForReview')}</dt>
              <dd className="font-medium text-foreground">{t('today.waitingForReviewValue', { count: waiting })}</dd>
            </div>
            {lastApproved ? (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('today.lastApproved')}</dt>
                <dd className="font-medium text-foreground">{formatDate(lastApproved.reportDate, locale)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => (todays ? setOpenDprId(todays.id) : startReport(today))}
            disabled={create.isPending}
          >
            {primaryLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('today.more')} title={t('today.more')}>
                <Ellipsis size={18} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setOtherDayOpen(true)}>{t('today.otherDay')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {createError && !otherDayOpen ? <Alert variant="error" messages={[createError]} /> : null}

      {/* One notice per report of mine that a reviewer sent back. */}
      {returned.map((dpr) => (
        <Notice
          key={dpr.id}
          tone="attention"
          title={t('today.returnedTitle', { date: formatDate(dpr.reportDate, locale) ?? dpr.reportDate })}
          action={
            <Button variant="outline" size="sm" onClick={() => setOpenDprId(dpr.id)}>
              {t('today.fixAndResubmit')}
            </Button>
          }
        >
          {dpr.returnReason
            ? dpr.returnedByName
              ? t('today.returnedBody', { name: dpr.returnedByName, reason: dpr.returnReason })
              : dpr.returnReason
            : t('today.returnedNoReason')}
        </Notice>
      ))}

      <MyReports reports={mine} onOpen={setOpenDprId} />

      <OtherDayDialog
        open={otherDayOpen}
        onOpenChange={(open) => {
          setOtherDayOpen(open);
          if (!open) setCreateError(null);
        }}
        max={today}
        pending={create.isPending}
        error={createError}
        onStart={(date) => startReport(date, () => setOtherDayOpen(false))}
      />

      <DprEntrySheet projectId={projectId} dprId={openDprId} onClose={() => setOpenDprId(null)} />
    </div>
  );
}

function MyReports({
  reports,
  onOpen,
}: {
  reports: DailyProgressReportResponse[];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';

  const columns: GridColumn<DailyProgressReportResponse>[] = [
    {
      key: 'date',
      header: t('today.col.date'),
      sticky: true,
      card: 'title',
      plainValue: (r) => r.reportDate,
      render: (r) => (
        <button
          type="button"
          onClick={() => onOpen(r.id)}
          className="min-h-11 text-start font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring sm:min-h-0"
        >
          {formatDate(r.reportDate, locale)}
        </button>
      ),
    },
    {
      key: 'workPackages',
      header: t('today.col.workPackages'),
      card: 'subtitle',
      plainValue: (r) => r.workPackages.map((wp) => wp.code).join(', '),
      render: (r) => (
        <span className="text-muted-foreground">
          {r.workPackages.length > 0 ? r.workPackages.map((wp) => `${wp.code} ${wp.name}`).join(', ') : '—'}
        </span>
      ),
    },
    {
      key: 'reviewedBy',
      header: t('today.col.reviewedBy'),
      card: 'meta',
      plainValue: (r) => r.reviewedByName,
      render: (r) => <span className="text-muted-foreground">{r.reviewedByName ?? '—'}</span>,
    },
    {
      key: 'status',
      header: t('today.col.status'),
      card: 'status',
      plainValue: (r) => r.status,
      render: (r) => <DprStatusBadge status={r.status} />,
    },
  ];

  return (
    <section aria-labelledby="my-reports-title" className="space-y-3">
      <h3 id="my-reports-title" className="text-body font-semibold text-foreground">
        {t('today.myReports')}
      </h3>
      <PlatformDataGrid
        label={t('today.myReports')}
        columns={columns}
        data={reports}
        rowKey={(r) => r.id}
        sortControl={false}
        emptyState={
          <EmptyState
            variant="row"
            icon={<ClipboardList size={20} aria-hidden="true" />}
            title={t('today.myReportsEmpty')}
            description={t('today.myReportsEmptyHint')}
          />
        }
      />
    </section>
  );
}

function OtherDayDialog({
  open,
  onOpenChange,
  max,
  pending,
  error,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  max: string;
  pending: boolean;
  error: string | null;
  onStart: (date: string) => void;
}) {
  const t = useTranslations('progress');
  const [date, setDate] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('today.otherDayTitle')}</DialogTitle>
          <DialogDescription>{t('today.otherDayHint')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (date) onStart(date);
          }}
          className="mt-4 space-y-4"
        >
          {error ? <Alert variant="error" messages={[error]} /> : null}
          <FormField htmlFor="dpr-other-day" label={t('report.fields.reportDate')}>
            <DatePicker id="dpr-other-day" value={date} max={max} onChange={setDate} />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending || !date}>
            {t('today.otherDaySubmit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
