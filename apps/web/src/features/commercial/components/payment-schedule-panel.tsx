'use client';

import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
  ProgrammeMilestoneResponse,
} from '@erp/types';
import {
  Alert,
  Badge,
  Button,
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

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import {
  useGenerateInvoiceFromInstallment,
  useSetInstallmentMilestone,
} from '../hooks/use-payment-schedule';
import { isBilledInstallment, paymentInstallmentTone } from '../presentation';
import { CommercialSummaryStrip } from './commercial-summary-strip';
import { errorText } from './commercial-workspace';

type Installment = CommercialPaymentScheduleInstallment;

/** A linked programme milestone that is not yet verified blocks invoicing (CONST-COM-011). */
function isGateBlocked(inst: Installment): boolean {
  return inst.programmeMilestone !== null && inst.programmeMilestone.status !== 'VERIFIED';
}

function formatPercent(fraction: string, locale: 'en' | 'ar'): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en-US', {
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
      <div>
        <h2 className="text-h3 font-semibold text-foreground">{t('paymentSchedule.title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('paymentSchedule.subtitle')}</p>
      </div>
      <CommercialSummaryStrip summary={summary} />

      {installments.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={24} aria-hidden="true" />}
          variant="page"
          title={t('paymentSchedule.emptyTitle')}
          description={t('paymentSchedule.emptyHint')}
        />
      ) : (
        <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-body-sm font-semibold">{t('paymentSchedule.title')}</h3>
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
        <GenerateInvoiceDialog
          projectId={projectId}
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
  locale,
  money,
  canInvoice,
  canManageLink,
  onInvoice,
  onLink,
  t,
}: {
  inst: Installment;
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
        {formatPercent(inst.percentage, locale)}
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
            <Button variant="ghost" size="sm" onClick={onInvoice} disabled={blocked}>
              {t('paymentSchedule.generate')}
            </Button>
            {blocked ? (
              <span className="max-w-48 text-caption text-warning">
                {t('paymentSchedule.milestone.blockedHint')}
              </span>
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

  if (!milestone) {
    return canManageLink ? (
      <Button variant="ghost" size="sm" onClick={onLink}>
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
        <Button variant="ghost" size="sm" onClick={onLink}>
          {t('paymentSchedule.milestone.change')}
        </Button>
      ) : null}
    </div>
  );
}

function GenerateInvoiceDialog({
  projectId,
  installment,
  onDismiss,
}: {
  projectId: string;
  installment: Installment;
  onDismiss: () => void;
}) {
  const t = useTranslations('commercial');
  const generate = useGenerateInvoiceFromInstallment(projectId);

  const today = new Date().toISOString().slice(0, 10);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => {
    if (installment.dueDate) return installment.dueDate;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [paymentTerms, setPaymentTerms] = useState('');

  const dismissGuard = useDialogDismissGuard(generate.isPending, onDismiss);

  return (
    <Dialog open onOpenChange={dismissGuard.onOpenChange}>
      <DialogContent {...dismissGuard.contentProps}>
        <DialogTitle>
          {t('paymentSchedule.generateDialog.title', { name: installment.name })}
        </DialogTitle>
        <DialogDescription>{t('paymentSchedule.generateDialog.hint')}</DialogDescription>

        {generate.isError ? (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[
                generate.error instanceof ApiError
                  ? generate.error.message
                  : t('paymentSchedule.generateDialog.failed'),
              ]}
            />
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <FormField htmlFor="inst-invoice-date" label={t('paymentSchedule.generateDialog.invoiceDate')}>
            <Input
              id="inst-invoice-date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="inst-due-date" label={t('paymentSchedule.generateDialog.dueDate')}>
            <Input
              id="inst-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="inst-terms" label={t('paymentSchedule.generateDialog.paymentTerms')}>
            <Input
              id="inst-terms"
              value={paymentTerms}
              placeholder={t('paymentSchedule.generateDialog.paymentTermsPlaceholder')}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button
            onClick={() =>
              generate.mutate(
                {
                  installmentId: installment.id,
                  invoiceDate,
                  dueDate,
                  ...(paymentTerms.trim() ? { paymentTerms: paymentTerms.trim() } : {}),
                },
                { onSuccess: onDismiss },
              )
            }
            disabled={generate.isPending || !invoiceDate || !dueDate}
          >
            {t('paymentSchedule.generateDialog.submit')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={generate.isPending}>
            {t('paymentSchedule.generateDialog.cancel')}
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
                onChange={(e) => setSelected(e.target.value)}
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
