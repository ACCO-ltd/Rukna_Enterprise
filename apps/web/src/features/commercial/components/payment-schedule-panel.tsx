'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Ban } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
  ProgrammeMilestoneResponse,
  VariationOrderListItem,
} from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { EmptyState } from '@/components/empty-state';
import { usePermissions } from '@/features/auth/permissions/can';
import { useMilestones } from '@/features/programme/hooks/use-programme';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { useDialogDismissGuard } from '@/lib/use-dialog-dismiss-guard';

import { useBillingPackages, useCommercialCurrentCycle, useVariations } from '../hooks/use-commercial';
import { useBillStage, useSetInstallmentMilestone } from '../hooks/use-payment-schedule';
import { isBilledInstallment, paymentInstallmentTone } from '../presentation';
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

  const [invoicing, setInvoicing] = useState<Installment | null>(null);
  const [linking, setLinking] = useState<Installment | null>(null);

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
  const canInvoice = summary.capabilities.canGenerateInvoice;

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
                {installments.map((inst) => (
                  <InstallmentRow
                    key={inst.id}
                    inst={inst}
                    projectId={projectId}
                    locale={locale}
                    money={money}
                    canInvoice={canInvoice}
                    canManageLink={canManageLink}
                    onInvoice={() => setInvoicing(inst)}
                    onLink={() => setLinking(inst)}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </div>
      )}

      {invoicing ? (
        <BillStageDialog
          projectId={projectId}
          contractId={contractId}
          summary={summary}
          installment={invoicing}
          onDismiss={() => setInvoicing(null)}
        />
      ) : null}

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
  canInvoice,
  canManageLink,
  onInvoice,
  onLink,
  t,
}: {
  inst: Installment;
  projectId: string;
  locale: 'en' | 'ar';
  money: (value: string | null) => string | null;
  canInvoice: boolean;
  canManageLink: boolean;
  onInvoice: () => void;
  onLink: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const blocked = isGateBlocked(inst);

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
        {inst.dueDate ? formatDate(inst.dueDate, locale) : '—'}
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
        {inst.status === 'NEXT' && canInvoice ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={onInvoice}
              disabled={blocked}
              // The reason is not on this button alone — it is rendered adjacent below (S-PS-1), so
              // the disabled state is self-explanatory rather than a bare, unexplained control.
              title={blocked ? t('paymentSchedule.milestone.blockedHint') : undefined}
            >
              {t('paymentSchedule.billStage')}
            </Button>
            {/* CONST-COM-025 / S-PS-1: the gate's reason and its remediation live on the row itself —
                "⛔ Verify "<milestone>" →" links straight into Programme & Progress (the same target
                the cycle ribbon uses), so a blocked control is never bare. */}
            {blocked && inst.programmeMilestone ? (
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
            ) : null}
          </div>
        ) : isBilledInstallment(inst.status) ? (
          <span className="text-caption text-muted-foreground">
            {t('paymentSchedule.status.BILLED')}
          </span>
        ) : null}
      </TableCell>
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

/**
 * "Bill this stage" (S-VB-11 / ADR-030 CD10).
 *
 * One billing path. It always bills the milestone installment; when the contract has eligible
 * client-approved variations it also offers to bill each of them in the same command — additions
 * on their own standalone invoice, an omission netted into this stage.
 *
 * **Eligible VO** = `CLIENT_APPROVED` AND not already allocated on any prior stage. The
 * already-allocated set is every VO that appears in the Billing Packages read — a VO billed on an
 * earlier stage is done and must not be offered again (the server would idempotently skip it, but
 * showing it would misrepresent it as still-billable).
 *
 * The summary is **indicative**: a running sum of the server's own decimal strings
 * (`installment.amount` + Σ included VO `netPrice`, omissions subtract via their negative net),
 * before Sales Tax. It exists to make the include/defer toggles legible, not to assert a figure —
 * the authoritative numbers live on the generated invoices, so it is labelled as indicative and
 * the frontend computes no tax.
 */
function BillStageDialog({
  projectId,
  contractId,
  summary,
  installment,
  onDismiss,
}: {
  projectId: string;
  contractId: string;
  summary: CommercialSummaryResponse;
  installment: Installment;
  onDismiss: () => void;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const bill = useBillStage(projectId);
  const variationsQuery = useVariations(contractId);
  const packagesQuery = useBillingPackages(projectId, contractId);

  const today = new Date().toISOString().slice(0, 10);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => {
    if (installment.dueDate) return installment.dueDate;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [paymentTerms, setPaymentTerms] = useState('');

  // The VOs that are still available to bill on this stage. A VO already present in ANY billing
  // package (with any allocation) has been realized on a prior stage and is excluded.
  const eligible = useMemo<VariationOrderListItem[]>(() => {
    const variations = variationsQuery.data?.variations ?? [];
    const allocated = new Set(
      (packagesQuery.data?.packages ?? [])
        .flatMap((p) => p.variationLines)
        .map((l) => l.variationId),
    );
    return variations.filter((vo) => vo.status === 'CLIENT_APPROVED' && !allocated.has(vo.id));
  }, [variationsQuery.data, packagesQuery.data]);

  // Include/defer per eligible VO — default INCLUDE. Keyed by id; unknown ids (none yet fetched)
  // fall back to included, so the summary is correct before the first toggle.
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const isIncluded = (id: string) => included[id] ?? true;

  // Indicative running sum of the server's decimal strings. NOT a re-derivation of a money rule —
  // just the stage amount plus each included VO's signed net, for the reader to see the direction.
  const includedVos = eligible.filter((vo) => isIncluded(vo.id));
  const deferredCount = eligible.length - includedVos.length;
  const indicativeTotal =
    Number(installment.amount ?? 0) +
    includedVos.reduce((sum, vo) => sum + Number(vo.netPrice ?? 0), 0);
  const indicativeText = summary.financialsVisible
    ? (formatMoney(String(indicativeTotal), summary.currency, locale) ?? '—')
    : t('metricState.restricted');

  const dismissGuard = useDialogDismissGuard(bill.isPending, onDismiss);

  const submit = () =>
    bill.mutate(
      {
        installmentId: installment.id,
        invoiceDate,
        dueDate,
        ...(paymentTerms.trim() ? { paymentTerms: paymentTerms.trim() } : {}),
        variations: eligible.map((vo) => ({ variationId: vo.id, include: isIncluded(vo.id) })),
      },
      { onSuccess: onDismiss },
    );

  return (
    <Dialog open onOpenChange={dismissGuard.onOpenChange}>
      <DialogContent {...dismissGuard.contentProps}>
        <DialogTitle>{t('paymentSchedule.billDialog.title', { name: installment.name })}</DialogTitle>
        <DialogDescription>{t('paymentSchedule.billDialog.hint')}</DialogDescription>

        {bill.isError ? (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[
                bill.error instanceof ApiError
                  ? bill.error.message
                  : t('paymentSchedule.billDialog.failed'),
              ]}
            />
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <FormField htmlFor="inst-invoice-date" label={t('paymentSchedule.billDialog.invoiceDate')}>
            <DatePicker
              id="inst-invoice-date"
              value={invoiceDate}
              onChange={(value) => setInvoiceDate(value)}
            />
          </FormField>
          <FormField htmlFor="inst-due-date" label={t('paymentSchedule.billDialog.dueDate')}>
            <DatePicker id="inst-due-date" value={dueDate} onChange={(value) => setDueDate(value)} />
          </FormField>
          <FormField htmlFor="inst-terms" label={t('paymentSchedule.billDialog.paymentTerms')}>
            <Input
              id="inst-terms"
              value={paymentTerms}
              placeholder={t('paymentSchedule.billDialog.paymentTermsPlaceholder')}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </FormField>
        </div>

        {/* Eligible variations. Absent this section the dialog is exactly the old single-invoice
            flow — one billing path, degrading gracefully when there is nothing extra to bill. */}
        {eligible.length > 0 ? (
          <div className="mt-4 space-y-2 rounded-panel border border-border p-3">
            <p className="text-body-sm font-semibold text-foreground">
              {t('paymentSchedule.billDialog.variationsTitle')}
            </p>
            <p className="text-caption text-muted-foreground">
              {t('paymentSchedule.billDialog.variationsHint')}
            </p>
            <ul className="divide-y divide-border/70">
              {eligible.map((vo) => {
                const isOmission = Number(vo.netPrice ?? 0) < 0;
                return (
                  <li
                    key={vo.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                  >
                    <label
                      htmlFor={`bill-vo-${vo.id}`}
                      className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2.5 sm:min-h-0"
                    >
                      <Checkbox
                        id={`bill-vo-${vo.id}`}
                        className="mt-0.5"
                        checked={isIncluded(vo.id)}
                        onChange={(e) =>
                          setIncluded((prev) => ({ ...prev, [vo.id]: e.target.checked }))
                        }
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-caption text-muted-foreground">
                            {vo.reference}
                          </span>
                          <span className="text-body-sm font-medium text-foreground">{vo.title}</span>
                        </span>
                        <span className="mt-0.5 block text-caption text-muted-foreground">
                          {isOmission
                            ? t('paymentSchedule.billDialog.omissionCaption')
                            : t('paymentSchedule.billDialog.additionCaption')}
                        </span>
                      </span>
                    </label>
                    <span className="shrink-0 tabular-nums text-body-sm text-foreground">
                      {summary.financialsVisible
                        ? (formatMoney(vo.netPrice, summary.currency, locale) ?? '—')
                        : t('metricState.restricted')}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border pt-2">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-caption text-muted-foreground">
                  {t('paymentSchedule.billDialog.indicativeLabel')}
                </span>
                <span className="tabular-nums text-body-sm font-semibold text-foreground">
                  {indicativeText}
                </span>
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {t('paymentSchedule.billDialog.indicativeNote')}
                {deferredCount > 0
                  ? ` · ${t('paymentSchedule.billDialog.deferred', { n: deferredCount })}`
                  : ''}
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={submit} disabled={bill.isPending || !invoiceDate || !dueDate}>
            {t('paymentSchedule.billDialog.submit')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={bill.isPending}>
            {t('paymentSchedule.billDialog.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [selected, setSelected] = useState<string>(installment.programmeMilestone?.id ?? '');

  const dismissGuard = useDialogDismissGuard(link.isPending, onDismiss);

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

        {milestones.length === 0 && !milestonesLoading ? (
          <div className="mt-4">
            <Alert variant="info" messages={[t('paymentSchedule.milestone.noMilestones')]} />
          </div>
        ) : (
          <div className="mt-4">
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
            disabled={link.isPending}
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
