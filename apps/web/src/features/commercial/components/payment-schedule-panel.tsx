'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Ban, CornerDownRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CommercialPaymentScheduleInstallment,
  CommercialPaymentScheduleVariationLine,
  CommercialSummaryResponse,
  ProgrammeMilestoneResponse,
} from '@erp/types';
import { Alert, Badge, Button, DatePicker, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, EmptyState, FormField, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { useCreateMilestone, useMilestones } from '@/features/programme/hooks/use-programme';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { useDialogDismissGuard } from '@/lib/use-dialog-dismiss-guard';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { useSetInstallmentMilestone } from '../hooks/use-payment-schedule';
import { dueStatus, isBilledInstallment, paymentInstallmentTone } from '../presentation';
import { errorText } from './commercial-workspace';

type Installment = CommercialPaymentScheduleInstallment;

/** A linked programme milestone that is not yet verified blocks invoicing (CONST-COM-011). */
function isGateBlocked(inst: Installment): boolean {
  return inst.programmeMilestone !== null && inst.programmeMilestone.status !== 'VERIFIED';
}

function formatPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * ADR-023 payment-schedule view for a MILESTONE billing contract.
 *
 * The commercial workspace's IPA/certified chain does not apply here — a milestone contract is
 * billed from a fixed payment plan. Each installment is billed from its own invoice, and where an
 * installment is linked to a programme milestone (CONST-COM-011) invoicing is gated on that
 * milestone being verified.
 */
export function PaymentSchedulePanel({
  projectId,
  contractId,
  summary,
}: {
  projectId: string;
  contractId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const cycle = useCommercialCurrentCycle(projectId);
  const milestones = useMilestones(projectId);

  const [linking, setLinking] = useState<Installment | null>(null);

  // Adopted variations nest under the stage they were billed on (R7). Group them by stage; an
  // approved-but-unbilled VO has no stage yet and collects in the trailing "Unassigned" group — it
  // attaches to a stage the moment that stage is billed.
  const variationLines = useMemo<CommercialPaymentScheduleVariationLine[]>(
    () => cycle.data?.paymentSchedule?.variationLines ?? [],
    [cycle.data],
  );
  const variationsByStage = useMemo(() => {
    const map = new Map<string, CommercialPaymentScheduleVariationLine[]>();
    for (const line of variationLines) {
      if (!line.stageInstallmentId) continue;
      const list = map.get(line.stageInstallmentId) ?? [];
      list.push(line);
      map.set(line.stageInstallmentId, list);
    }
    return map;
  }, [variationLines]);
  const unassignedVariations = useMemo(
    () => variationLines.filter((line) => !line.stageInstallmentId),
    [variationLines],
  );

  if (cycle.isPending) return <Skeleton className="h-80 w-full" />;
  if (cycle.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[errorText(cycle.error, t('states.loadFailedHint'))]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => cycle.refetch()}>
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const schedule = cycle.data.paymentSchedule ?? null;
  const installments = schedule?.installments ?? [];
  const canManageLink = can('manage:contract');

  const money = (value: string | null) =>
    value === null
      ? summary.financialsVisible
        ? t('states.notSet')
        : t('metricState.restricted')
      : formatMoney(value, summary.currency, locale);

  return (
    <div className="space-y-4">
      {installments.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={24} aria-hidden="true" />}
          variant="page"
          title={t('paymentSchedule.emptyTitle')}
          description={t('paymentSchedule.emptyHint')}
        />
      ) : (
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          {/* The panel names itself: it sits inside Billing & Collection among the invoice and
              receipt panels, and an unlabelled table of percentages would be a guessing game. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
            <h3 className="text-body-sm font-semibold text-foreground">
              {t('paymentSchedule.title')}
            </h3>
            {schedule?.totalCollected !== null && schedule?.contractValue !== null ? (
              <p className="text-body-sm text-muted-foreground">
                {t('paymentSchedule.collected')}:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {formatMoney(schedule!.totalCollected!, summary.currency, locale)}
                </span>{' '}
                {t('paymentSchedule.of', {
                  total: formatMoney(schedule!.contractValue!, summary.currency, locale) ?? '',
                })}
              </p>
            ) : null}
          </div>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('paymentSchedule.col.installment')}</TableHead>
                  <TableHead className="text-end">{t('paymentSchedule.col.percentage')}</TableHead>
                  <TableHead className="text-end">{t('paymentSchedule.col.amount')}</TableHead>
                  <TableHead className="text-end">{t('paymentSchedule.col.paid')}</TableHead>
                  <TableHead>{t('paymentSchedule.col.due')}</TableHead>
                  <TableHead>{t('paymentSchedule.col.status')}</TableHead>
                  <TableHead>{t('paymentSchedule.col.milestone')}</TableHead>
                  <TableHead className="text-end">{t('paymentSchedule.col.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {installments.map((inst) => {
                  const kids = variationsByStage.get(inst.id) ?? [];
                  return (
                    <Fragment key={inst.id}>
                      <InstallmentRow
                        inst={inst}
                        projectId={projectId}
                        locale={locale}
                        money={money}
                        canManageLink={canManageLink}
                        onLink={() => setLinking(inst)}
                        t={t}
                      />
                      {kids.map((line) => (
                        <VariationChildRow key={line.variationId} line={line} money={money} t={t} />
                      ))}
                      {/* "Stage now 152k" — the frozen milestone plus its nested variations, so the
                          reader sees what the stage bills once the extras ride along (visual only:
                          the milestone % itself is untouched). Hidden when money is restricted. */}
                      {kids.length > 0 && inst.amount !== null ? (
                        <StageSubtotalRow amount={stageSubtotal(inst.amount, kids)} money={money} t={t} />
                      ) : null}
                    </Fragment>
                  );
                })}
                {unassignedVariations.length > 0 ? (
                  <>
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30">
                        <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('paymentSchedule.unassignedTitle')}
                        </span>
                        <span className="ms-2 text-caption text-muted-foreground">
                          {t('paymentSchedule.unassignedHint')}
                        </span>
                      </TableCell>
                    </TableRow>
                    {unassignedVariations.map((line) => (
                      <VariationChildRow key={line.variationId} line={line} money={money} t={t} />
                    ))}
                  </>
                ) : null}
              </TableBody>
            </Table>
          </TableScroll>
        </div>
      )}

      {linking ? (
        <LinkMilestoneDialog
          projectId={projectId}
          contractId={contractId}
          installment={linking}
          milestones={milestones.data ?? []}
          milestonesLoading={milestones.isPending}
          onDismiss={() => setLinking(null)}
        />
      ) : null}
    </div>
  );
}

function InstallmentRow({
  inst,
  projectId,
  locale,
  money,
  canManageLink,
  onLink,
  t,
}: {
  inst: Installment;
  projectId: string;
  locale: 'en' | 'ar';
  money: (value: string | null) => string | null;
  canManageLink: boolean;
  onLink: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const blocked = isGateBlocked(inst);
  // Due-date urgency is only a cue for an un-billed stage — an "overdue" chip on a paid stage is
  // noise. `upcoming` (more than a week out) shows no chip; the date column already states it.
  const due = isBilledInstallment(inst.status) ? null : dueStatus(inst.dueDate);
  const showDueChip = due !== null && due.key !== 'upcoming';

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{inst.name}</TableCell>
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {formatPercent(inst.percentage)}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(inst.amount)}</TableCell>
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {money(inst.amountPaid)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <div className="flex flex-col items-start gap-1">
          <span>{inst.dueDate ? formatDate(inst.dueDate, locale) : '—'}</span>
          {showDueChip && due ? (
            <Badge tone={due.tone}>
              {t(`paymentSchedule.due.${due.key}`, { days: Math.abs(due.days) })}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge tone={paymentInstallmentTone(inst.status)}>
          {t(`paymentSchedule.status.${inst.status}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <MilestoneCell inst={inst} canManageLink={canManageLink} onLink={onLink} t={t} />
      </TableCell>
      <TableCell className="text-end">
        {/* CONST-COM-025 / S-PS-1: the gate's reason and its remediation live on the row itself —
            "⛔ Verify "<milestone>" →" links straight into Programme & Progress (the same target
            the cycle ribbon uses). Billing itself now happens exclusively through the milestone-
            journey "Issue" flow (Contract & Milestones tab) — this panel only surfaces the gate. */}
        {inst.status === 'NEXT' && blocked && inst.programmeMilestone ? (
          <Link
            href={`/projects/${projectId}/progress`}
            className="inline-flex max-w-56 items-center justify-end gap-1 text-caption font-medium text-warning underline underline-offset-2 hover:text-warning/80"
          >
            <Ban size={13} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {t('paymentSchedule.milestone.blockedRow', {
                name: inst.programmeMilestone.name,
              })}
            </span>
            <ArrowRight size={12} className="shrink-0" aria-hidden="true" />
          </Link>
        ) : isBilledInstallment(inst.status) ? (
          <span className="text-caption text-muted-foreground">
            {t('paymentSchedule.status.BILLED')}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/** "Stage now" = the frozen milestone amount plus its nested variations (additions add, omissions
 *  subtract via their negative net). Indicative display only, from the server's decimal strings. */
function stageSubtotal(
  installmentAmount: string,
  kids: CommercialPaymentScheduleVariationLine[],
): string {
  const base = Number(installmentAmount);
  const delta = kids.reduce((sum, k) => sum + Number(k.amount ?? 0), 0);
  return (base + delta).toFixed(2);
}

/** A variation nested under its billed stage (or in the Unassigned group): reference, title, signed
 *  amount, and an addition/omission tag. Indented so it reads as a child of the row above it. */
function VariationChildRow({
  line,
  money,
  t,
}: {
  line: CommercialPaymentScheduleVariationLine;
  money: (value: string | null) => string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const isOmission = line.amount !== null && Number(line.amount) < 0;
  return (
    <TableRow className="bg-muted/20">
      <TableCell className="ps-8">
        <div className="flex min-w-0 items-center gap-2">
          <CornerDownRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-caption text-muted-foreground">{line.reference}</span>
          <span className="min-w-0 truncate text-body-sm text-foreground">{line.title}</span>
        </div>
      </TableCell>
      <TableCell />
      <TableCell className="text-end tabular-nums text-foreground">{money(line.amount)}</TableCell>
      <TableCell />
      <TableCell />
      <TableCell>
        {line.amount !== null ? (
          <Badge tone={isOmission ? 'warning' : 'live'}>
            {isOmission
              ? t('paymentSchedule.variation.omission')
              : t('paymentSchedule.variation.addition')}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell />
      <TableCell />
    </TableRow>
  );
}

/** The "stage now X" subtotal row printed under a stage that has nested variations. */
function StageSubtotalRow({
  amount,
  money,
  t,
}: {
  amount: string;
  money: (value: string | null) => string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <TableRow className="bg-muted/40">
      <TableCell className="ps-8 text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {t('paymentSchedule.stageSubtotal')}
      </TableCell>
      <TableCell />
      <TableCell className="text-end tabular-nums font-semibold text-foreground">
        {money(amount)}
      </TableCell>
      <TableCell colSpan={5} />
    </TableRow>
  );
}

function MilestoneCell({
  inst,
  canManageLink,
  onLink,
  t,
}: {
  inst: Installment;
  canManageLink: boolean;
  onLink: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const milestone = inst.programmeMilestone;

  // An ADVANCE installment (the mobilization payment) is paid early and is not milestone-gated by
  // design. Showing "Not linked / Link milestone" here would read as a forgotten link; instead say
  // plainly that no milestone is required. MILESTONE/TIME_BASED rows keep the link affordance below.
  if (inst.triggerType === 'ADVANCE') {
    return (
      <Badge tone="neutral">{t('paymentSchedule.milestone.ungatedAdvance')}</Badge>
    );
  }

  if (!milestone) {
    return canManageLink ? (
      <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onLink}>
        {t('paymentSchedule.milestone.link')}
      </Button>
    ) : (
      <span className="text-caption text-muted-foreground">{t('paymentSchedule.milestone.none')}</span>
    );
  }

  const verified = milestone.status === 'VERIFIED';
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-foreground">{milestone.code}</span>
      <Badge tone={verified ? 'live' : 'warning'}>
        {verified
          ? t('paymentSchedule.milestone.verified')
          : t('paymentSchedule.milestone.planned')}
      </Badge>
      {canManageLink ? (
        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onLink}>
          {t('paymentSchedule.milestone.change')}
        </Button>
      ) : null}
    </div>
  );
}

function LinkMilestoneDialog({
  projectId,
  contractId,
  installment,
  milestones,
  milestonesLoading,
  onDismiss,
}: {
  projectId: string;
  contractId: string;
  installment: Installment;
  milestones: ProgrammeMilestoneResponse[];
  milestonesLoading: boolean;
  onDismiss: () => void;
}) {
  const t = useTranslations('commercial');
  const link = useSetInstallmentMilestone(projectId, contractId);
  const create = useCreateMilestone(projectId);
  const [selected, setSelected] = useState<string>(installment.programmeMilestone?.id ?? '');

  // Select-and-link is the default path (pick an existing milestone this installment names as its
  // delivery evidence). Creating one is the exception — offered inline so a PM who hasn't set the
  // milestone up yet doesn't have to leave Commercial, go create it in Progress, then come back to
  // find this dialog again. This still creates the ONE shared ProgrammeMilestone Progress already
  // owns (via the same `useCreateMilestone` hook Progress's own form uses) — never a second entity.
  const [creatingNew, setCreatingNew] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState(installment.name);
  const [newDate, setNewDate] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const dismissGuard = useDialogDismissGuard(link.isPending || create.isPending, onDismiss);

  function onCreateAndSelect(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    if (!newCode.trim() || !newName.trim() || !newDate) return;
    create.mutate(
      { code: newCode.trim(), name: newName.trim(), baselineDate: newDate },
      {
        onSuccess: (milestone) => {
          setSelected(milestone.id);
          setCreatingNew(false);
        },
        onError: (e) =>
          setCreateError(e instanceof ApiError ? e.message : t('paymentSchedule.milestone.createFailed')),
      },
    );
  }

  return (
    <Dialog open onOpenChange={dismissGuard.onOpenChange}>
      <DialogContent {...dismissGuard.contentProps}>
        <DialogTitle>{t('paymentSchedule.milestone.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('paymentSchedule.milestone.dialogHint')}</DialogDescription>

        {link.isError ? (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[
                link.error instanceof ApiError
                  ? link.error.message
                  : t('paymentSchedule.milestone.failed'),
              ]}
            />
          </div>
        ) : null}

        {creatingNew ? (
          <form onSubmit={onCreateAndSelect} className="mt-4 space-y-3 rounded-panel border border-border p-3">
            {createError ? <Alert variant="error" messages={[createError]} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField htmlFor="new-ms-code" label={t('paymentSchedule.milestone.newCode')}>
                <Input id="new-ms-code" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
              </FormField>
              <FormField htmlFor="new-ms-date" label={t('paymentSchedule.milestone.newDate')}>
                <DatePicker id="new-ms-date" value={newDate} onChange={setNewDate} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField htmlFor="new-ms-name" label={t('paymentSchedule.milestone.newName')}>
                  <Input id="new-ms-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </FormField>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={create.isPending || !newCode.trim() || !newName.trim() || !newDate}
              >
                {create.isPending ? t('paymentSchedule.milestone.creating') : t('paymentSchedule.milestone.createAndSelect')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingNew(false)} disabled={create.isPending}>
                {t('paymentSchedule.milestone.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-2">
            {milestones.length === 0 && !milestonesLoading ? (
              <Alert variant="info" messages={[t('paymentSchedule.milestone.noMilestones')]} />
            ) : (
              <FormField htmlFor="inst-milestone" label={t('paymentSchedule.milestone.picker')}>
                <Select
                  id="inst-milestone"
                  value={selected}
                  onChange={(value) => setSelected(value)}
                  disabled={milestonesLoading}
                >
                  <option value="">{t('paymentSchedule.milestone.pickerNone')}</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingNew(true)}>
              {t('paymentSchedule.milestone.createNew')}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() =>
              link.mutate(
                { installmentId: installment.id, programmeMilestoneId: selected || null },
                { onSuccess: onDismiss },
              )
            }
            disabled={link.isPending || creatingNew}
          >
            {t('paymentSchedule.milestone.save')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={link.isPending}>
            {t('paymentSchedule.milestone.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
