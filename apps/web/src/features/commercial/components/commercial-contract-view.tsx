'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ellipsis, Paperclip } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  StageBillingEligibility,
  CommercialPaymentScheduleInstallment,
  CommercialWorkspaceResponse,
} from '@erp/types';
import {
  Alert,
  Button,
  DefinitionGrid,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoneyDisplay,
  Skeleton,
  StatusPill,
  type DefinitionFact,
} from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { statusTone } from '@/lib/status-registry';
import { getFileDownloadUrl } from '@/features/files/api/files-api';

import { useCommercialCurrentCycle, useCommercialSummary } from '../hooks/use-commercial';
import { projectInvoiceHref, type InvoiceHrefBuilder } from './commercial-billing-view';
import { ContractChangesPanel } from './contract-changes-panel';
import { ScheduleForm, splitScheduleForEditing } from './payment-schedule-tab';
import { RecordSignedDateDialog } from './record-signed-date-dialog';
import { StageEligibilityNote } from './stage-eligibility-note';

/**
 * Contract: what was signed (facts), how it bills (the payment schedule, with each stage's state
 * and the one reason it is waiting), and what has changed since (variations, separate charges,
 * time). Read-only apart from the few commands the server allows; the schedule's reasons come from
 * `installmentBillingBlocker` via the read model, never from rules re-derived here.
 */
export function CommercialContractView({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: CommercialWorkspaceResponse;
}) {
  const contract = workspace.contract!;
  const summary = useCommercialSummary(projectId);

  return (
    <div className="space-y-4">
      <ContractFacts projectId={projectId} workspace={workspace} />
      <PaymentSchedulePanel projectId={projectId} workspace={workspace} />
      {summary.data ? (
        <ContractChangesPanel projectId={projectId} contractId={contract.id} summary={summary.data} />
      ) : summary.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : null}
    </div>
  );
}

// ─── Facts ───────────────────────────────────────────────────────────────────

function ContractFacts({ projectId, workspace }: { projectId: string; workspace: CommercialWorkspaceResponse }) {
  const t = useTranslations('commercial.contractView');
  const tModel = useTranslations('commercial.billingModel');
  const locale = useLocale() as 'en' | 'ar';
  const contract = workspace.contract!;
  const { financialsVisible, capabilities } = workspace;
  const [signedDateOpen, setSignedDateOpen] = useState(false);
  const [openingAgreement, setOpeningAgreement] = useState(false);

  const date = (value: string | null) => formatDate(value, locale);
  const money = (value: string | null) => (
    <MoneyDisplay value={value} hidden={!financialsVisible} hiddenLabel={t('hidden')} />
  );

  const openAgreement = async () => {
    if (!contract.signedAgreement) return;
    setOpeningAgreement(true);
    try {
      const { url } = await getFileDownloadUrl(contract.signedAgreement.fileId);
      window.open(url, '_blank', 'noopener');
    } finally {
      setOpeningAgreement(false);
    }
  };

  const facts: DefinitionFact[] = [
    {
      label: t('client'),
      value: contract.clientId ? (
        <Link href={`/clients/${contract.clientId}`} className="text-brand-primary hover:underline">
          {contract.clientName}
        </Link>
      ) : (
        (contract.clientName ?? '—')
      ),
    },
    {
      label: t('signed'),
      value: contract.signedDate ? (
        date(contract.signedDate)
      ) : (
        // Possible for contracts activated before activation required a signed date.
        <span className="inline-flex items-center gap-2">
          <span className="italic text-muted-foreground">{t('notRecorded')}</span>
          {capabilities.canRecordSignedDate ? (
            <button type="button" className="text-brand-primary hover:underline" onClick={() => setSignedDateOpen(true)}>
              {t('add')}
            </button>
          ) : null}
        </span>
      ),
    },
    {
      label: t('period'),
      value:
        contract.startDate || contract.expectedEndDate
          ? `${date(contract.startDate) ?? '—'} → ${date(contract.expectedEndDate) ?? '—'}`
          : '—',
    },
    {
      label: t('billing'),
      value: [
        tModel.has(contract.billingModel) ? tModel(contract.billingModel) : contract.billingModel,
        contract.paymentTermsDays !== null ? t('net', { days: contract.paymentTermsDays }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    { label: t('signedValue'), value: money(contract.signedValue) },
    {
      label: t('approvedVariations'),
      value:
        contract.approvedVariationCount === 0 ? (
          t('none')
        ) : (
          <span>
            {money(contract.approvedVariationsValue)}
            <span className="text-muted-foreground"> · {t('variationCount', { count: contract.approvedVariationCount })}</span>
          </span>
        ),
    },
    {
      label: t('signedScope'),
      value: contract.signedBoq ? (
        <Link href={`/projects/${projectId}/boq`} className="text-brand-primary hover:underline">
          {t('boqVersion', { version: contract.signedBoq.versionNumber })}
        </Link>
      ) : (
        '—'
      ),
    },
    {
      label: t('signedAgreement'),
      value: contract.signedAgreement ? (
        <button
          type="button"
          disabled={openingAgreement}
          onClick={() => void openAgreement()}
          className="inline-flex max-w-full items-center gap-1.5 text-brand-primary hover:underline"
        >
          <Paperclip size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{contract.signedAgreement.fileName}</span>
        </button>
      ) : (
        t('noAgreement')
      ),
    },
  ];

  return (
    <section aria-labelledby="contract-facts-title" className="rounded-panel border border-border bg-surface p-4 shadow-e1">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="contract-facts-title" className="text-h3 font-semibold text-foreground">
          {t('title')}
        </h2>
        {contract.status === 'DRAFT' ? (
          <Link href={`/projects/${projectId}/commercial/contract/edit`} className="inline-flex min-h-11 items-center text-body-sm font-medium text-brand-primary hover:underline">
            {t('editDetails')}
          </Link>
        ) : null}
      </div>
      <DefinitionGrid facts={facts} />
      {signedDateOpen ? (
        <RecordSignedDateDialog open projectId={projectId} contractId={contract.id} onClose={() => setSignedDateOpen(false)} />
      ) : null}
    </section>
  );
}

// ─── Payment schedule ───────────────────────────────────────────────────────

/** The word the schedule shows, from the read model's own fields (see the registry note). */
/**
 * `today` is the server's day (`workspace.asOf`, `yyyy-MM-dd`). A Date stage has no raise blocker,
 * but it bills on its date — until then it is Upcoming with its date as the reason.
 */
export function installmentDisplayState(inst: CommercialPaymentScheduleInstallment, today: string): string {
  if (inst.status === 'PAID' || inst.status === 'PARTIALLY_PAID') return inst.status;
  if (inst.invoiceState === 'DRAFT') return 'DRAFT';
  if (inst.status === 'BILLED' || inst.invoiceState === 'ISSUED') return 'BILLED';
  if (inst.billingBlocker !== null) return 'UPCOMING';
  const notYetDue = inst.triggerType === 'TIME_BASED' && inst.expectedDate !== null && inst.expectedDate.slice(0, 10) > today;
  return notYetDue ? 'UPCOMING' : 'READY';
}

/**
 * The payment schedule: each stage, its state and the one reason it is waiting. Exported so the
 * Finance workspace (ADR-043) renders the same panel; `invoiceHref` says where a billed stage's
 * invoice opens (the project invoice page by default).
 */
export function PaymentSchedulePanel({
  projectId,
  workspace,
  invoiceHref = projectInvoiceHref(projectId),
}: {
  projectId: string;
  workspace: CommercialWorkspaceResponse;
  invoiceHref?: InvoiceHrefBuilder;
}) {
  const t = useTranslations('commercial.contractView');
  const tState = useTranslations('commercial.contractView.stageStatus');
  const locale = useLocale() as 'en' | 'ar';
  const cycle = useCommercialCurrentCycle(projectId);
  const canVerify = usePermissions().can('manage:project');
  const [reprofiling, setReprofiling] = useState(false);
  const { financialsVisible, capabilities } = workspace;
  const contract = workspace.contract!;
  const today = workspace.asOf.slice(0, 10);

  if (cycle.isPending) return <Skeleton className="h-48 w-full" />;
  if (cycle.isError || !cycle.data?.paymentSchedule) {
    return <Alert variant="error" messages={[t('scheduleFailed')]} />;
  }

  const schedule = cycle.data.paymentSchedule;
  const installments = [...schedule.installments].sort((a, b) => a.sortOrder - b.sortOrder);
  const date = (value: string | null) => formatDate(value, locale) ?? '';
  const progressHref = `/projects/${projectId}/progress`;

  const billedOn = (inst: CommercialPaymentScheduleInstallment): string => {
    const released = inst.releasedBy;
    if (released.kind === 'ADVANCE') return t('billedOnAdvance');
    if (released.kind === 'DATE') return t('billedOnDate', { date: date(released.date) });
    return released.milestoneCode
      ? t('billedOnMilestone', { milestone: [released.milestoneCode, released.milestoneName].filter(Boolean).join(' ') })
      : t('billedOnMilestoneUnlinked');
  };

  const reason = (inst: CommercialPaymentScheduleInstallment): React.ReactNode => {
    const state = installmentDisplayState(inst, today);
    if (state === 'READY') {
      const released = inst.releasedBy;
      if (released.kind === 'MILESTONE') return t('reasonVerified', { code: released.milestoneCode ?? '', date: date(released.verifiedAt) });
      if (released.kind === 'ADVANCE') return t('reasonAdvance');
      return t('reasonDate', { date: date(released.date) });
    }
    if (state === 'UPCOMING') {
      if (inst.billingBlocker === 'MILESTONE_NOT_VERIFIED' && inst.releasedBy.kind === 'MILESTONE') {
        // Verifying is manage:project, done in Progress → Review; others read the wait as text.
        if (!canVerify) return t('reasonWaitsFor', { code: inst.releasedBy.milestoneCode ?? '' });
        return (
          <Link href={`${progressHref}/review`} className="text-brand-primary hover:underline">
            {t('reasonWaitsFor', { code: inst.releasedBy.milestoneCode ?? '' })}
          </Link>
        );
      }
      if (inst.billingBlocker === 'MILESTONE_NOT_LINKED') {
        return (
          <Link href={progressHref} className="text-brand-primary hover:underline">
            {t('reasonNotLinked')}
          </Link>
        );
      }
      if (inst.billingBlocker === 'CONTRACT_NOT_ACTIVE') return t('reasonContractNotActive');
      return inst.expectedDate ? t('reasonExpected', { date: date(inst.expectedDate) }) : null;
    }
    return inst.invoiceId ? (
      <Link href={invoiceHref(inst.invoiceId)} className="text-brand-primary hover:underline">
        {t('viewInvoice')}
      </Link>
    ) : null;
  };

  const columns: GridColumn<CommercialPaymentScheduleInstallment>[] = [
    {
      key: 'stage',
      header: t('stage'),
      card: 'title',
      render: (inst) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {installments.indexOf(inst) + 1}. {inst.name}
          </p>
          <p className="text-caption text-muted-foreground">{billedOn(inst)}</p>
        </div>
      ),
    },
    {
      key: 'share',
      header: t('share'),
      numeric: true,
      card: 'meta',
      render: (inst) => `${Number((Number(inst.percentage) * 100).toFixed(2))}%`,
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      redacted: !financialsVisible,
      card: 'amount',
      render: (inst) => <MoneyDisplay value={inst.amount} hidden={!financialsVisible} hiddenLabel={t('hidden')} />,
    },
    {
      key: 'status',
      header: t('status'),
      card: 'status',
      render: (inst) => {
        const state = installmentDisplayState(inst, today);
        const why = reason(inst);
        return (
          <div className="min-w-0 space-y-0.5">
            <StatusPill tone={statusTone(state, 'paymentInstallment')}>{tState(state)}</StatusPill>
            {why ? <p className="text-caption text-muted-foreground">{why}</p> : null}
            {/* ADR-043 Phase 2: the server's blocking reason + owner, and the billing steps. */}
            <StageEligibilityNote eligibility={inst.billingEligibility as StageBillingEligibility | undefined} />
          </div>
        );
      },
    },
  ];

  const allocated = Math.round(installments.reduce((sum, inst) => sum + Number(inst.percentage), 0) * 100);
  const canReprofile = capabilities.canReprofileSchedule && (contract.status === 'ACTIVE' || contract.status === 'DRAFT');
  const { frozen, editable } = splitScheduleForEditing(schedule.installments);

  return (
    <section aria-labelledby="schedule-title" className="space-y-3 rounded-panel border border-border bg-surface p-4 shadow-e1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="schedule-title" className="text-h3 font-semibold text-foreground">
            {t('scheduleTitle')}
          </h2>
          <p className="text-caption text-muted-foreground">
            {t('scheduleSummary', { count: installments.length, percent: allocated })}{' '}
            {financialsVisible && schedule.contractValue ? (
              <MoneyDisplay value={schedule.contractValue} />
            ) : null}
          </p>
        </div>
        {canReprofile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('scheduleMenu')} title={t('scheduleMenu')}>
                <Ellipsis size={18} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setReprofiling(true)}>{t('reprofile')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <PlatformDataGrid
        label={t('scheduleTitle')}
        columns={columns}
        data={installments}
        rowKey={(inst) => inst.id}
        toolbar={false}
        sortControl={false}
        emptyState={<p className="p-4 text-body-sm text-muted-foreground">{t('scheduleEmpty')}</p>}
      />

      {reprofiling ? (
        <ScheduleForm
          projectId={projectId}
          contractId={contract.id}
          isReprofile={contract.status === 'ACTIVE'}
          frozen={frozen}
          editable={editable}
          contractValue={schedule.contractValue}
          currency={schedule.currency}
          onDone={() => setReprofiling(false)}
          dialog={{ title: t('reprofileTitle'), subtitle: t('reprofileBody') }}
        />
      ) : null}
    </section>
  );
}
