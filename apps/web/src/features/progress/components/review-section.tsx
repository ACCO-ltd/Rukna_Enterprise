'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { DailyProgressReportResponse, ProgrammeMilestoneResponse } from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  FormField,
  Notice,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { ClipboardCheck, Flag } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { QueueList, joinQueueMeta } from '@/components/queue-list';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useSession } from '@/features/auth/session/use-session';
import { useMilestones, useVerifyMilestone } from '@/features/programme/hooks/use-programme';

import { localIsoDate } from '../domain/my-reports';
import { mapDprError } from '../domain/dpr-errors';
import {
  progressKeys,
  useApproveDpr,
  useDpr,
  useDprs,
  useProjectProgress,
  useReturnDpr,
} from '../hooks/use-progress';
import { lineLabel, useBoqLeaves } from '../hooks/use-boq-leaves';
import { useProgressAccess } from '../hooks/use-progress-access';
import { DprEvidence } from './dpr-detail';

/**
 * Review — the reviewer's view. Two parts, each shown only to who can act on it:
 *
 * - **Reports to review** (`approve:progress`): a queue of submitted reports on the left (280px),
 *   the selected report on the right; the two stack below 820px. The viewer's own submitted reports
 *   are not in the queue — a preparer cannot approve their own report — and are counted in one line
 *   instead. After approve or return the report leaves the queue and the next one is selected.
 * - **Milestones ready to verify** (`manage:project`): only milestones the server marks
 *   `readyToVerify` (every linked package verified at 100%). Verifying is still a human act.
 */
export function ReviewSection({ projectId }: { projectId: string }) {
  const access = useProgressAccess();
  return (
    <div className="space-y-10">
      {access.canApprove ? <ReportReview projectId={projectId} /> : null}
      {access.canManage ? <MilestonesReady projectId={projectId} /> : null}
    </div>
  );
}

/** The submitted reports this reader can review, oldest first (the longest-waiting on top). */
export function reviewQueue(
  reports: DailyProgressReportResponse[],
  userId: string | null,
): DailyProgressReportResponse[] {
  return reports
    .filter((r) => r.status === 'SUBMITTED' && r.preparedBy !== userId)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function ReportReview({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const userId = useSession().user?.id ?? null;
  const dprs = useDprs(projectId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const queue = useMemo(() => reviewQueue(dprs.data ?? [], userId), [dprs.data, userId]);
  const ownWaiting = (dprs.data ?? []).filter((r) => r.status === 'SUBMITTED' && r.preparedBy === userId).length;
  const selected = queue.find((r) => r.id === selectedId) ?? queue[0] ?? null;

  if (dprs.isPending) {
    return <Skeleton className="h-64 w-full rounded-panel" aria-hidden="true" />;
  }
  if (dprs.isError) {
    return <Alert variant="error" messages={[t('states.loadFailed')]} />;
  }

  function onDone(kind: 'approved' | 'returned', report: DailyProgressReportResponse) {
    // Select the next report now, from the queue as it stood: the one after, else the one before.
    const index = queue.findIndex((r) => r.id === report.id);
    const next = queue[index + 1] ?? queue[index - 1] ?? null;
    setSelectedId(next?.id ?? null);
    const date = formatDate(report.reportDate, locale) ?? report.reportDate;
    setSuccess(
      kind === 'approved'
        ? t('review.approvedNotice', { date })
        : report.preparedByName
          ? t('review.returnedNotice', { date, name: report.preparedByName })
          : t('review.returnedNoticeNoName', { date }),
    );
  }

  return (
    <section aria-labelledby="review-reports-title" className="space-y-4">
      <h3 id="review-reports-title" className="text-body font-semibold text-foreground">
        {t('review.reportsTitle')}
      </h3>

      {success ? <Notice tone="success">{success}</Notice> : null}

      {queue.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={20} aria-hidden="true" />}
          title={t('review.emptyTitle')}
          description={
            ownWaiting > 0 ? t('review.ownWaiting', { count: ownWaiting }) : t('review.emptyHint')
          }
        />
      ) : (
        <>
          {ownWaiting > 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('review.ownWaiting', { count: ownWaiting })}</p>
          ) : null}
          <div className="grid gap-4 min-[820px]:grid-cols-[280px_minmax(0,1fr)] min-[820px]:items-start">
            <QueueList
              label={t('review.queueLabel')}
              selectedId={selected?.id ?? null}
              onSelect={(id) => {
                setSelectedId(id);
                setSuccess(null);
              }}
              items={queue.map((r) => ({
                id: r.id,
                title: formatDate(r.reportDate, locale) ?? r.reportDate,
                meta: joinQueueMeta([r.preparedByName, r.workPackages.map((wp) => wp.code).join(', ')]),
              }))}
            />
            {selected ? (
              <ReportPanel
                key={selected.id}
                projectId={projectId}
                report={selected}
                isOwn={selected.preparedBy === userId}
                onDone={(kind) => onDone(kind, selected)}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ReportPanel({
  projectId,
  report,
  isOwn,
  onDone,
}: {
  projectId: string;
  report: DailyProgressReportResponse;
  isOwn: boolean;
  onDone: (kind: 'approved' | 'returned') => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const queryClient = useQueryClient();
  const detail = useDpr(report.id);
  const progress = useProjectProgress(projectId);
  const { leaves } = useBoqLeaves(projectId);
  const approve = useApproveDpr(projectId, report.id);
  const returnDpr = useReturnDpr(projectId, report.id);

  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leafById = useMemo(() => new Map(leaves.map((l) => [l.id, l])), [leaves]);
  const leafLabel = useMemo(() => new Map(leaves.map((l) => [l.id, lineLabel(l)])), [leaves]);
  const lineById = useMemo(
    () => new Map((progress.data ?? []).map((line) => [line.boqNodeId, line])),
    [progress.data],
  );

  /** 409 = the report changed while it was open: say so plainly and reload what is on screen. */
  function onActionError(err: unknown) {
    setError(mapDprError(err, t('review.actionFailed')).formError);
    if (err instanceof ApiError && err.status === 409) {
      void queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) });
      void queryClient.invalidateQueries({ queryKey: progressKeys.report(report.id) });
    }
  }

  const date = formatDate(report.reportDate, locale) ?? report.reportDate;
  const d = detail.data;

  // Today's quantity per item (a report may measure one item more than once).
  const rows = useMemo(() => {
    const today = new Map<string, number>();
    for (const m of d?.measurements ?? []) today.set(m.boqNodeId, (today.get(m.boqNodeId) ?? 0) + Number(m.quantity));
    return [...today.entries()].map(([boqNodeId, qty]) => {
      const line = lineById.get(boqNodeId);
      const leaf = leafById.get(boqNodeId);
      // Verified-to-date excludes this report (it is not approved yet), so "to date" adds it.
      const toDate = Number(line?.verifiedToDate ?? 0) + qty;
      const boqStr = line?.measurableQuantity ?? leaf?.quantity ?? null;
      const boq = boqStr != null && boqStr !== '' ? Number(boqStr) : null;
      return {
        boqNodeId,
        label: leafLabel.get(boqNodeId) ?? boqNodeId,
        unit: leaf?.unit ?? '',
        today: qty,
        toDate,
        boq,
        done: boq && boq > 0 ? Math.round((toDate / boq) * 100) : null,
      };
    });
  }, [d?.measurements, lineById, leafById, leafLabel]);

  const qty = (n: number, unit: string) => `${formatNumber(n, locale, 3) ?? n}${unit ? ` ${unit}` : ''}`;

  return (
    <article
      aria-labelledby="review-report-title"
      className="min-w-0 rounded-panel border border-border bg-surface"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h4 id="review-report-title" className="text-body font-semibold text-foreground">
          {t('review.reportTitle', { date })}
        </h4>
        {report.preparedByName ? (
          <p className="text-body-sm text-muted-foreground">{t('review.preparedBy', { name: report.preparedByName })}</p>
        ) : null}
      </header>

      <div className="space-y-6 px-4 py-4 sm:px-5">
        {detail.isPending ? (
          <Skeleton className="h-40 w-full rounded-panel" aria-hidden="true" />
        ) : detail.isError || !d ? (
          <Alert variant="error" messages={[t('states.loadFailed')]} />
        ) : (
          <>
            <section aria-label={t('review.quantities')} className="space-y-2">
              <h5 className="text-body-sm font-semibold text-foreground">{t('review.quantities')}</h5>
              {rows.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">{t('review.noQuantities')}</p>
              ) : (
                <TableScroll aria-label={t('review.quantities')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('review.col.item')}</TableHead>
                        <TableHead numeric>{t('review.col.today')}</TableHead>
                        <TableHead numeric>{t('review.col.toDate')}</TableHead>
                        <TableHead numeric>{t('review.col.boq')}</TableHead>
                        <TableHead numeric>{t('review.col.done')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.boqNodeId}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell numeric className="whitespace-nowrap">{qty(row.today, row.unit)}</TableCell>
                          <TableCell numeric className="whitespace-nowrap">{qty(row.toDate, row.unit)}</TableCell>
                          <TableCell numeric className="whitespace-nowrap">
                            {row.boq === null ? '—' : qty(row.boq, row.unit)}
                          </TableCell>
                          <TableCell
                            numeric
                            className={row.done !== null && row.done > 100 ? 'font-medium text-warning' : undefined}
                          >
                            {row.done === null ? '—' : `${row.done}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScroll>
              )}
            </section>

            <section className="space-y-2">
              <h5 className="text-body-sm font-semibold text-foreground">{t('review.labour')}</h5>
              {(d.labourRows ?? []).length === 0 ? (
                <p className="text-body-sm text-muted-foreground">{t('review.noLabour')}</p>
              ) : (
                <ul className="space-y-1 text-body-sm text-foreground">
                  {(d.labourRows ?? []).map((row) => (
                    <li key={row.id}>
                      {t('review.labourRow', { trade: row.trade, headcount: row.headcount })}
                      {row.hours ? ` · ${t('review.labourHours', { hours: row.hours })}` : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h5 className="text-body-sm font-semibold text-foreground">{t('review.evidence')}</h5>
              <DprEvidence
                dprId={d.id}
                canUpload={false}
                attachments={d.attachments}
                measurements={d.measurements}
                leafLabel={leafLabel}
                bare
              />
            </section>

            <section className="space-y-2">
              <h5 className="text-body-sm font-semibold text-foreground">{t('review.notes')}</h5>
              <p className="whitespace-pre-wrap text-body-sm text-foreground">
                {d.narrative ? d.narrative : <span className="text-muted-foreground">{t('review.noNotes')}</span>}
              </p>
            </section>
          </>
        )}

        {error ? <Alert variant="error" messages={[error]} /> : null}
      </div>

      <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:px-5 md:flex-row md:items-center md:justify-between">
        {isOwn ? (
          <p className="text-body-sm text-muted-foreground">{t('review.ownReport')}</p>
        ) : (
          <>
            <p className="text-body-sm text-muted-foreground">{t('review.approveNote')}</p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setReturning(true)} disabled={approve.isPending}>
                {t('review.return')}
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  approve.mutate(undefined, { onSuccess: () => onDone('approved'), onError: onActionError });
                }}
                disabled={approve.isPending || detail.isPending}
              >
                {t('review.approve')}
              </Button>
            </div>
          </>
        )}
      </footer>

      {returning ? (
        <ConfirmActionDialog
          title={t('review.returnTitle')}
          description={t('review.returnBody')}
          confirmLabel={t('review.returnConfirm')}
          reason={{ required: true, label: t('review.returnReason'), hint: t('review.returnReasonHint'), maxLength: 255 }}
          isPending={returnDpr.isPending}
          errorMessage={returnDpr.isError ? mapDprError(returnDpr.error, t('review.actionFailed')).formError : undefined}
          onConfirm={(reason) =>
            returnDpr.mutate(reason, {
              onSuccess: () => {
                setReturning(false);
                onDone('returned');
              },
              onError: (err) => {
                if (err instanceof ApiError && err.status === 409) {
                  setReturning(false);
                  onActionError(err);
                }
              },
            })
          }
          onDismiss={() => {
            if (!returnDpr.isPending) setReturning(false);
          }}
        />
      ) : null}
    </article>
  );
}

// ─── Milestones ready to verify ────────────────────────────────────────────────────────────

/** The installment names a milestone releases, with the amount only when the server gave one. */
export function releaseNames(milestone: ProgrammeMilestoneResponse, locale: 'en'): string {
  return milestone.releases
    .map((r) => (r.amount === null ? r.name : `${r.name} (${formatMoney(r.amount, r.currency, locale) ?? r.amount})`))
    .join(', ');
}

function MilestonesReady({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const milestones = useMilestones(projectId);
  const [verifying, setVerifying] = useState<ProgrammeMilestoneResponse | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const ready = (milestones.data ?? []).filter((m) => m.readyToVerify);

  return (
    <section aria-labelledby="review-milestones-title" className="space-y-3">
      <div>
        <h3 id="review-milestones-title" className="text-body font-semibold text-foreground">
          {t('review.milestones.title')}
        </h3>
        <p className="text-body-sm text-muted-foreground">{t('review.milestones.description')}</p>
      </div>

      {success ? <Notice tone="success">{success}</Notice> : null}

      {milestones.isPending ? (
        <Skeleton className="h-20 w-full rounded-panel" aria-hidden="true" />
      ) : milestones.isError ? (
        <Alert variant="error" messages={[t('states.loadFailed')]} />
      ) : ready.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t('review.milestones.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
          {ready.map((m) => {
            const names = releaseNames(m, locale);
            return (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <Flag size={16} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-foreground">
                    <span className="me-2 font-mono text-caption text-muted-foreground">{m.code}</span>
                    {m.name}
                  </p>
                  <p className="text-body-sm text-muted-foreground">
                    {t('review.milestones.packagesDone', { list: m.workPackages.map((wp) => wp.code).join(', ') })}{' '}
                    {names ? t('review.milestones.releases', { names }) : t('review.milestones.noRelease')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSuccess(null);
                    setVerifying(m);
                  }}
                  aria-label={t('review.milestones.verifyLabel', { name: m.name })}
                >
                  {t('review.milestones.verify')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {verifying ? (
        <VerifyMilestoneDialog
          projectId={projectId}
          milestone={verifying}
          onDismiss={() => setVerifying(null)}
          onVerified={() => {
            setSuccess(t('review.milestones.verified', { name: verifying.name }));
            setVerifying(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function VerifyMilestoneDialog({
  projectId,
  milestone,
  onDismiss,
  onVerified,
}: {
  projectId: string;
  milestone: ProgrammeMilestoneResponse;
  onDismiss: () => void;
  onVerified: () => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const verify = useVerifyMilestone(projectId);
  const [actualDate, setActualDate] = useState(localIsoDate());

  const names = releaseNames(milestone, locale);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !verify.isPending) onDismiss();
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>{t('review.milestones.dialogTitle', { name: milestone.name })}</DialogTitle>
        <DialogDescription>
          {names ? t('review.milestones.dialogBillable', { names }) : t('review.milestones.dialogNoRelease')}
        </DialogDescription>

        {verify.isError ? (
          <div className="mt-4">
            <Alert variant="error" messages={[mapDprError(verify.error, t('review.actionFailed')).formError]} />
          </div>
        ) : null}

        <div className="mt-4">
          <FormField htmlFor="verify-actual-date" label={t('review.milestones.actualDate')}>
            <DatePicker id="verify-actual-date" value={actualDate} max={localIsoDate()} onChange={setActualDate} />
          </FormField>
        </div>

        <DialogFooter>
          <Button
            onClick={() => verify.mutate({ milestoneId: milestone.id, actualDate }, { onSuccess: onVerified })}
            disabled={verify.isPending || !actualDate}
          >
            {t('review.milestones.confirm')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={verify.isPending}>
            {t('review.milestones.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
