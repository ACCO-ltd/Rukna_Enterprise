'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Info, Link as LinkIcon, Lock } from 'lucide-react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Skeleton,
  cn,
} from '@erp/ui';
import type { CommercialSummaryResponse, SeparateChargeNode } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';
import { useContract, useRecordSignedDate } from '@/features/contracts/hooks/use-contracts';
import { useVerifyMilestone } from '@/features/programme/hooks/use-programme';

import {
  commercialKeys,
  useBillingPackages,
  useCommercialCurrentCycle,
  useCreateSeparateChargeInvoice,
  useProjectSeparateCharges,
} from '../hooks/use-commercial';
import { useMarkReadyToBill } from '../hooks/use-mark-ready-to-bill';
import {
  toMilestoneJourneyViewModel,
  type InvoiceJourneyPhase,
  type MilestoneItemViewModel,
} from '../milestone-journey.adapter';
import { contractStatusTone } from '../presentation';
import { CommercialActivity } from './commercial-activity';
import { MilestoneJourney } from './milestone-journey';
import { MilestoneDetailPanel } from './milestone-detail-panel';
import { ReviewForBillingDrawer } from './review-for-billing-drawer';
import { PrepareInvoiceDialog } from './prepare-invoice-dialog';
import { SendInvoiceDialog } from './send-invoice-dialog';
import { ScheduleEditor } from './payment-schedule-tab';
import { ContractSecurityBody, LIFECYCLE } from './contract-security-tab';
import { VariationsTab } from './variations-tab';

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Contract & Milestones tab — the operational home for ACCO's milestone-billing contracts.
 *
 * Replaces the table-first "Payment Schedule" tab with a journey-oriented surface:
 *   Contract header → milestone journey → schedule editor
 *
 * The journey separates physical progress (programme milestone verification) from commercial
 * readiness (Ready to bill). Slice 3B: readyToBill is persisted on the backend;
 * `useMarkReadyToBill` calls POST /projects/:id/commercial/installments/:id/mark-ready-to-bill
 * and invalidates the current-cycle query so the adapter re-derives the state from real data.
 */
export function ContractMilestonesTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones');
  const contract = summary.mainContract;

  // Detail panel state
  const [detailMilestone, setDetailMilestone] = useState<MilestoneItemViewModel | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Review drawer state
  const [reviewMilestone, setReviewMilestone] = useState<MilestoneItemViewModel | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Slice 3B: real mutation; invalidates current-cycle on success so the adapter
  // re-derives readyToBill from the refreshed API data.
  const markReadyMutation = useMarkReadyToBill(projectId);

  // Invoice journey state: tracks the issued/sent phase after issuePackage succeeds.
  // The adapter never produces 'invoice-issued' or 'awaiting-payment' — these are
  // component-layer states driven by real API calls (issuePackage → recordPackageDelivery).
  const [invoiceJourneyMap, setInvoiceJourneyMap] = useState<Map<string, InvoiceJourneyPhase>>(
    new Map(),
  );
  const [preparingMilestone, setPreparingMilestone] = useState<MilestoneItemViewModel | null>(null);
  const [sendingMilestone, setSendingMilestone] = useState<MilestoneItemViewModel | null>(null);
  const [verifyingMilestone, setVerifyingMilestone] = useState<MilestoneItemViewModel | null>(null);

  function handleMilestoneClick(milestone: MilestoneItemViewModel) {
    setDetailMilestone(milestone);
    setDetailOpen(true);
  }

  function handleReviewForBilling(milestone: MilestoneItemViewModel) {
    setDetailOpen(false);
    setReviewMilestone(milestone);
    setReviewOpen(true);
  }

  async function handleMarkReadyToBill(installmentId: string) {
    await markReadyMutation.mutateAsync({ installmentId });
  }

  function handlePrepareInvoice(milestone: MilestoneItemViewModel) {
    setDetailOpen(false);
    setPreparingMilestone(milestone);
  }

  function handleSendInvoice(milestone: MilestoneItemViewModel) {
    setDetailOpen(false);
    setSendingMilestone(milestone);
  }

  function handleInvoiceIssued(installmentId: string, journey: InvoiceJourneyPhase) {
    setInvoiceJourneyMap((prev) => new Map(prev).set(installmentId, journey));
    const issuedMilestone = preparingMilestone;
    setPreparingMilestone(null);
    setSendingMilestone(
      issuedMilestone
        ? { ...issuedMilestone, userState: 'invoice-issued', invoiceJourney: journey }
        : null,
    );
  }

  function handleInvoiceSent(installmentId: string, deliveryMethod: string) {
    setInvoiceJourneyMap((prev) => {
      const existing = prev.get(installmentId);
      if (!existing) return prev;
      return new Map(prev).set(installmentId, {
        ...existing,
        phase: 'sent',
        deliveryMethod: deliveryMethod as InvoiceJourneyPhase['deliveryMethod'],
      });
    });
    setSendingMilestone(null);
  }

  if (!contract) {
    return (
      <EmptyState
        variant="page"
        title={t('noContract.title')}
        description={t('noContract.hint')}
      />
    );
  }

  return (
    <>
      <div className="space-y-5">
        <ContractHeader
          projectId={projectId}
          contract={contract}
          summary={summary}
        />
        <ScheduleBody
          projectId={projectId}
          summary={summary}
          contractId={contract.id}
          invoiceJourneyMap={invoiceJourneyMap}
          onMilestoneClick={handleMilestoneClick}
          onReviewForBilling={handleReviewForBilling}
          onPrepareInvoice={handlePrepareInvoice}
          onSendInvoice={handleSendInvoice}
          onVerifyMilestone={setVerifyingMilestone}
        />
        {/* Money content first — variations and separate charges directly affect what gets
            billed, so a finance reader meets them right after the schedule. Contract-lifecycle
            admin (Edit schedule, Contract status, deliverables) and the activity log are
            occasional-use surfaces, not daily reads, and sit below. */}
        <VariationsTab projectId={projectId} summary={summary} />
        <SeparateChargesSection projectId={projectId} contractId={contract.id} />
        <ScheduleEditor
          projectId={projectId}
          contractId={contract.id}
          status={contract.status}
        />
        <ContractSecurityBody projectId={projectId} summary={summary} />
        <CommercialActivity items={summary.recentActivity} />
      </div>

      {/* Detail panel */}
      <MilestoneDetailPanel
        milestone={detailMilestone}
        currency={summary.currency ?? contract.currency}
        financialsVisible={summary.financialsVisible}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onReviewForBilling={handleReviewForBilling}
        onPrepareInvoice={handlePrepareInvoice}
      />

      {/* Review drawer */}
      <ReviewForBillingDrawer
        milestone={reviewMilestone}
        currency={summary.currency ?? contract.currency}
        financialsVisible={summary.financialsVisible}
        contractIsActive={contract.status === 'ACTIVE'}
        outstandingInvoiceCount={summary.receivables.outstandingInvoices.length}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onMarkReadyToBill={handleMarkReadyToBill}
        isPending={markReadyMutation.isPending}
        errorMessage={
          markReadyMutation.error instanceof Error ? markReadyMutation.error.message : undefined
        }
      />

      {/* Prepare invoice dialog (SLICE_4A) */}
      <PrepareInvoiceDialog
        key={preparingMilestone?.id ?? 'closed'}
        open={preparingMilestone !== null}
        milestone={preparingMilestone}
        summary={summary}
        onInvoiceIssued={handleInvoiceIssued}
        onClose={() => setPreparingMilestone(null)}
      />

      {/* Send invoice dialog */}
      <SendInvoiceDialog
        open={sendingMilestone !== null}
        milestone={sendingMilestone}
        projectId={projectId}
        currency={summary.currency ?? contract.currency}
        clientName={contract.clientName}
        onSent={handleInvoiceSent}
        onClose={() => setSendingMilestone(null)}
      />

      <VerifyCommercialMilestoneDialog
        projectId={projectId}
        milestone={verifyingMilestone}
        onClose={() => setVerifyingMilestone(null)}
      />
    </>
  );
}

// ─── Contract header ──────────────────────────────────────────────────────────

function ContractHeader({
  projectId,
  contract,
  summary,
}: {
  projectId: string;
  contract: CommercialSummaryResponse['mainContract'] & {};
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones.header');
  const tRoot = useTranslations('commercial');
  const locale = useLocale() as 'en';
  const currency = summary.currency ?? contract.currency;
  // Only field this header needs from the contract-detail query — everything else it needs
  // (billing model, dates, BOQ version) already rides on `summary.mainContract`. Cheap: the
  // Contract & Milestones tab's own security section fetches the same id, so TanStack Query
  // serves both from one request.
  const detail = useContract(contract.id);

  const fmt = (amount: string | null) =>
    amount ? (formatMoney(amount, currency, locale) ?? amount) : '—';

  const cv = summary.contractValue;
  const stageIndex = LIFECYCLE.indexOf(contract.status as (typeof LIFECYCLE)[number]);
  const exited = stageIndex < 0;

  // Activation freezes the client's identity onto the contract; state it plainly once it has
  // happened, forewarn while it hasn't. Never both.
  const isLocked = Boolean(detail.data?.clientNameSnapshot);
  const showLockNotice = isLocked || contract.status === 'DRAFT';
  const [showSignedDateDialog, setShowSignedDateDialog] = useState(false);

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      {/* Header row: reference + lifecycle at a glance — no scrolling past the schedule editor
          and the contract-security section to learn where this contract stands. */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p className="text-caption font-medium text-muted-foreground">{t('reference')}</p>
          <p className="mt-0.5 text-h3 font-bold text-foreground">{contract.contractNumber}</p>
        </div>

        <div className="w-full sm:w-auto sm:min-w-64 sm:max-w-xs">
          <p className="text-caption font-medium text-muted-foreground">
            {tRoot('contractStatus_.title')}
          </p>
          {exited ? (
            <Badge tone={contractStatusTone(contract.status)} className="mt-1.5">
              {tRoot(`contractStatus.${contract.status}`)}
            </Badge>
          ) : (
            <ol
              className="mt-1.5 flex items-start gap-1"
              aria-label={tRoot('contractStatus_.title')}
            >
              {LIFECYCLE.map((stage, index) => {
                const active = index === stageIndex;
                return (
                  <li
                    key={stage}
                    className="flex min-w-14 flex-1 flex-col items-center gap-1 text-center"
                    aria-current={active ? 'step' : undefined}
                  >
                    <span
                      className={cn(
                        'h-1 w-full rounded-full',
                        index < stageIndex
                          ? 'bg-success'
                          : active
                            ? 'bg-brand-primary'
                            : 'bg-border-strong',
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'text-micro font-medium leading-tight',
                        active ? 'text-brand-primary' : 'text-muted-foreground',
                      )}
                    >
                      {tRoot(`contractStatus.${stage}`)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* Row 1 — what/who/how billed. Row 2 — the three dates. Split into two 3-cell grids
          (rather than one 6-cell grid) so HeaderCell's own not-last divider lands correctly
          at the end of each row instead of only at the very last cell. */}
      <dl className="grid sm:grid-cols-3">
        <HeaderCell label={t('currentValue')}>
          {summary.financialsVisible && cv ? (
            <span className="text-h3 font-bold tabular-nums text-foreground">
              {fmt(cv.governingContractValue)}
            </span>
          ) : (
            <span className="text-h3 font-bold text-muted-foreground">—</span>
          )}
        </HeaderCell>
        <HeaderCell label={t('client')}>
          <span className="text-body-sm font-semibold text-foreground">{contract.clientName}</span>
        </HeaderCell>
        <HeaderCell label={tRoot('mainContract.billingModel')}>
          <span className="text-body-sm font-semibold text-foreground">
            {tRoot(`billingModel.${contract.billingModel}`)}
          </span>
        </HeaderCell>
      </dl>
      <dl className="grid border-t border-border sm:grid-cols-3">
        <HeaderCell label={tRoot('mainContract.effectiveDate')}>
          <span className="text-body-sm font-semibold text-foreground">
            {contract.startDate
              ? (formatDate(contract.startDate, locale) ?? contract.startDate)
              : t('paymentTermsNotSet')}
          </span>
        </HeaderCell>
        <HeaderCell label={t('completionDate')}>
          <span className="text-body-sm font-semibold text-foreground">
            {contract.expectedEndDate
              ? (formatDate(contract.expectedEndDate, locale) ?? contract.expectedEndDate)
              : t('paymentTermsNotSet')}
          </span>
        </HeaderCell>
        <HeaderCell label={t('signedDate')} warning={!contract.signedDate}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-semibold">
            <span className="flex items-center gap-1.5">
              {!contract.signedDate ? (
                <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
              ) : null}
              {contract.signedDate
                ? (formatDate(contract.signedDate, locale) ?? contract.signedDate)
                : t('signedDateNotRecorded')}
            </span>
            {!contract.signedDate && summary.capabilities.canRecordSignedDate ? (
              <button
                type="button"
                onClick={() => setShowSignedDateDialog(true)}
                className="text-caption font-semibold text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
              >
                {t('completeRecord')}
              </button>
            ) : null}
          </span>
        </HeaderCell>
      </dl>

      <RecordSignedDateDialog
        open={showSignedDateDialog}
        projectId={projectId}
        contractId={contract.id}
        onClose={() => setShowSignedDateDialog(false)}
      />

      {contract.paymentTerms?.trim() ? (
        <div className="border-t border-border px-5 py-3">
          <ContractFact label={t('paymentTerms')} value={contract.paymentTerms.trim()} />
        </div>
      ) : null}

      {/* BOQ baseline this contract was signed against, plus the one edit entry point — moved
          here from the (now-removed) standalone Main Contract card, which restated four of
          these nine facts a screen's worth of scrolling below this same information. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="text-body-sm text-muted-foreground">
          {tRoot('mainContract.boqBaseline')}:{' '}
          <span className="font-medium text-foreground">
            {contract.boqVersionNumber !== null
              ? tRoot('mainContract.boqVersion', { number: contract.boqVersionNumber })
              : t('paymentTermsNotSet')}
          </span>
          {' · '}
          <Link
            href={`/projects/${projectId}/boq`}
            className="font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            {tRoot('mainContract.viewBoq')}
          </Link>
        </p>
        {summary.capabilities.canEditContract ? (
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
            <Link href={`/projects/${projectId}/commercial/contract/edit`}>
              {tRoot('actions.edit')}
            </Link>
          </Button>
        ) : null}
      </div>

      {showLockNotice ? (
        <div className="flex items-start gap-2 border-t border-border bg-muted/50 px-5 py-3">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {isLocked ? (
              <Lock size={13} aria-hidden="true" />
            ) : (
              <Info size={13} aria-hidden="true" />
            )}
          </span>
          <p className="text-caption text-muted-foreground">
            <span className="font-semibold text-foreground">
              {isLocked
                ? tRoot('mainContract.clientLockedTitle')
                : tRoot('mainContract.willLockTitle')}
            </span>
            {' — '}
            {isLocked ? tRoot('mainContract.clientLockedHint') : tRoot('mainContract.willLockHint')}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function RecordSignedDateDialog({
  open,
  projectId,
  contractId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  contractId: string;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.contractMilestones.recordSignedDate');
  const [signedDate, setSignedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const mutation = useRecordSignedDate(contractId);
  const queryClient = useQueryClient();

  async function handleSubmit() {
    if (!signedDate) return;
    await mutation.mutateAsync(signedDate);
    // useRecordSignedDate only invalidates the contract-detail query; the "Not recorded" text and
    // this dialog's own trigger read `contract.signedDate` / `capabilities.canRecordSignedDate`
    // off the commercial summary, which lives under a different query root and would otherwise
    // stay stale until an unrelated refetch.
    await queryClient.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !mutation.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        {mutation.error ? (
          <Alert variant="error" messages={[(mutation.error as Error).message]} />
        ) : null}
        <FormField htmlFor="contract-signed-date" label={t('signedDate')}>
          <DatePicker
            id="contract-signed-date"
            value={signedDate}
            onChange={setSignedDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!signedDate || mutation.isPending}>
            {mutation.isPending ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HeaderCell({
  label,
  warning,
  children,
}: {
  label: string;
  /** Draws attention to a fact that should be recorded but isn't — e.g. an unsigned contract. */
  warning?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-b border-border px-5 py-4 sm:border-b-0 sm:not-last:border-e',
        warning && 'text-warning',
      )}
    >
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1', warning && 'text-warning')}>{children}</dd>
    </div>
  );
}

function ContractFact({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  /** Draws attention to a fact that should be recorded but isn't — e.g. an unsigned contract. */
  warning?: boolean;
}) {
  return (
    <p className={cn('text-body-sm', warning ? 'text-warning' : 'text-muted-foreground')}>
      <span className={cn('font-medium', warning ? 'text-warning' : 'text-foreground')}>
        {label}:
      </span>{' '}
      {warning ? <AlertTriangle size={12} className="-mt-0.5 me-1 inline" aria-hidden="true" /> : null}
      {value}
    </p>
  );
}


function MoneyRow({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-body-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          prominent
            ? 'text-body font-semibold tabular-nums text-foreground'
            : 'text-body-sm tabular-nums text-foreground'
        }
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Schedule body (data-fetching layer) ──────────────────────────────────────

function ScheduleBody({
  projectId,
  summary,
  contractId,
  invoiceJourneyMap,
  onMilestoneClick,
  onReviewForBilling,
  onPrepareInvoice,
  onSendInvoice,
  onVerifyMilestone,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
  contractId: string;
  invoiceJourneyMap: Map<string, InvoiceJourneyPhase>;
  onMilestoneClick: (m: MilestoneItemViewModel) => void;
  onReviewForBilling: (m: MilestoneItemViewModel) => void;
  onPrepareInvoice: (m: MilestoneItemViewModel) => void;
  onSendInvoice: (m: MilestoneItemViewModel) => void;
  onVerifyMilestone: (m: MilestoneItemViewModel) => void;
}) {
  const t = useTranslations('commercial');
  const cycleQuery = useCommercialCurrentCycle(projectId);
  const packagesQuery = useBillingPackages(projectId, contractId);

  if (cycleQuery.isPending) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (cycleQuery.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[t('states.loadFailedHint')]}
      >
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => cycleQuery.refetch()}
        >
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const schedule = cycleQuery.data?.paymentSchedule ?? null;
  if (!schedule || schedule.installments.length === 0) {
    return (
      <section className="rounded-panel border border-border bg-surface px-5 py-10 text-center">
        <p className="text-body font-medium text-foreground">
          {t('contractMilestones.journey.emptyTitle')}
        </p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('contractMilestones.journey.emptyDescription')}
        </p>
      </section>
    );
  }

  const rawVm = toMilestoneJourneyViewModel(schedule, summary.financialsVisible);

  // Apply invoice-journey state overrides after real API operations (issuePackage / recordPackageDelivery).
  // The adapter derives 'ready-to-bill' from the backend; 'invoice-issued' and 'awaiting-payment'
  // live here because the installment status transitions asynchronously — the component layer
  // captures the optimistic state immediately, then the next refetch confirms it.
  const viewModel = {
    ...rawVm,
    milestones: rawVm.milestones.map((m) => {
      const billingPackage = packagesQuery.data?.packages.find(
        (candidate) => candidate.installmentId === m.id && candidate.documents.length > 0,
      );
      const persistedJourney: InvoiceJourneyPhase | null = billingPackage
        ? {
            phase: billingPackage.documents.every((document) => document.deliveries.length > 0)
              ? 'sent'
              : 'issued',
            invoiceId: billingPackage.documents[0]!.invoiceId,
            invoiceDate: '',
            dueDate: billingPackage.documents[0]!.dueDate,
            documents: billingPackage.documents,
            deliveryMethod: billingPackage.documents
              .flatMap((document) => document.deliveries)
              .at(0)?.method.toLowerCase() as InvoiceJourneyPhase['deliveryMethod'],
          }
        : null;
      const journey = invoiceJourneyMap.get(m.id) ?? persistedJourney;

      let userState = m.userState;
      // Settlement is authoritative. Delivery describes how an open invoice reached the client;
      // it must never make a partly-paid or paid stage look unpaid again.
      const isSettled = m.userState === 'partially-paid' || m.userState === 'paid';
      if (!isSettled && journey?.phase === 'issued') userState = 'invoice-issued' as const;
      if (!isSettled && journey?.phase === 'sent') userState = 'awaiting-payment' as const;

      return { ...m, userState, invoiceJourney: journey };
    }),
  };

  const allBilled =
    schedule.installments.length > 0 &&
    !schedule.installments.some((i) => i.status === 'NEXT' || i.status === 'UPCOMING');

  return (
    <>
      <CommercialDeepLinkAction
        milestones={viewModel.milestones}
        onReviewForBilling={onReviewForBilling}
        onPrepareInvoice={onPrepareInvoice}
        onSendInvoice={onSendInvoice}
      />
      <MilestoneJourney
        title={t('contractMilestones.paymentScheduleTitle')}
        viewModel={viewModel}
        onMilestoneClick={onMilestoneClick}
        onReviewForBilling={onReviewForBilling}
        onPrepareInvoice={onPrepareInvoice}
        onSendInvoice={onSendInvoice}
        onVerifyMilestone={onVerifyMilestone}
      />
      {allBilled && <AllMilestonesBilledBanner projectId={projectId} />}
    </>
  );
}

function CommercialDeepLinkAction({
  milestones,
  onReviewForBilling,
  onPrepareInvoice,
  onSendInvoice,
}: {
  milestones: MilestoneItemViewModel[];
  onReviewForBilling: (milestone: MilestoneItemViewModel) => void;
  onPrepareInvoice: (milestone: MilestoneItemViewModel) => void;
  onSendInvoice: (milestone: MilestoneItemViewModel) => void;
}) {
  const searchParams = useSearchParams();
  const consumedAction = useRef<string | null>(null);
  const requestedInstallmentId = searchParams?.get('installment') ?? null;
  const requestedAction = searchParams?.get('action') ?? null;

  useEffect(() => {
    if (!requestedInstallmentId || !requestedAction) return;
    const key = `${requestedInstallmentId}:${requestedAction}`;
    if (consumedAction.current === key) return;
    const milestone = milestones.find((item) => item.id === requestedInstallmentId);
    if (!milestone) return;
    consumedAction.current = key;
    if (requestedAction === 'prepare' && milestone.userState === 'ready-to-bill') {
      onPrepareInvoice(milestone);
    } else if (requestedAction === 'review' && milestone.userState === 'review-for-billing') {
      onReviewForBilling(milestone);
    } else if (requestedAction === 'send' && milestone.userState === 'invoice-issued') {
      // Billing & Collection's "Record delivery" row action links here — the delivery
      // dialog (SendInvoiceDialog) needs the same milestone view-model the schedule body
      // already built, which is why this is a deep link rather than a duplicated dialog.
      onSendInvoice(milestone);
    }
  }, [milestones, onPrepareInvoice, onReviewForBilling, onSendInvoice, requestedAction, requestedInstallmentId]);

  return null;
}

// ─── All Milestones Billed Banner (Slice A) ───────────────────────────────────

function AllMilestonesBilledBanner({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial.contractMilestones.allBilledBanner');
  return (
    <div className="rounded-panel border border-success/30 bg-success/5 px-5 py-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-foreground">{t('title')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('hint')}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/projects/${projectId}/commercial/billing-collection`}>
            {t('goToCollections')}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ─── Separate Charges Section (Slice D) ──────────────────────────────────────

function SeparateChargesSection({
  projectId,
  contractId,
}: {
  projectId: string;
  contractId: string;
}) {
  const t = useTranslations('commercial.contractMilestones.separateCharges');
  const locale = useLocale() as 'en' | 'ar';
  const query = useProjectSeparateCharges(projectId);
  const [creatingFor, setCreatingFor] = useState<Extract<
    SeparateChargeNode,
    { source: 'BOQ_LEAF' }
  > | null>(null);

  if (query.isPending) {
    return <Skeleton className="h-24 w-full rounded-panel" />;
  }

  if (query.isError || !query.data) return null;

  const { items } = query.data;

  return (
    <section className="rounded-panel border border-border bg-surface shadow-e1">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <LinkIcon size={14} className="text-muted-foreground" aria-hidden="true" />
          <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
          {items.length > 0 && (
            <Badge tone="neutral" className="text-caption">{items.length}</Badge>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-body-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <SeparateChargeRow
              key={item.id}
              item={item}
              locale={locale}
              t={t}
              onCreateInvoice={() => {
                if (item.source === 'BOQ_LEAF') setCreatingFor(item);
              }}
            />
          ))}
        </ul>
      )}

      {creatingFor && (
        <CreateSeparateChargeInvoiceDialog
          projectId={projectId}
          node={creatingFor}
          onClose={() => setCreatingFor(null)}
        />
      )}
    </section>
  );
}

function SeparateChargeRow({
  item,
  locale,
  onCreateInvoice,
  t,
}: {
  item: SeparateChargeNode;
  locale: string;
  onCreateInvoice: () => void;
  t: (key: string) => string;
}) {
  const fmtMoney = (v: string | null) =>
    v ? (formatMoney(v, item.currency, locale as 'en' | 'ar') ?? v) : '—';
  // A VO addition billed standalone (source: VARIATION) is created with its invoice atomically
  // (issuePackage → generateStandaloneCharge) — there is no un-invoiced state to offer "Create
  // invoice" for, unlike a BOQ_LEAF item, which can sit un-invoiced until billed on demand.
  const reference = item.source === 'BOQ_LEAF' ? item.code : item.variationReference;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground">{item.name}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          <span className="font-mono">{reference}</span>
          {item.totalAmount ? ` · ${fmtMoney(item.totalAmount)}` : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.invoice ? (
          <Badge tone="live" className="text-caption">{t('statusInvoiced')}</Badge>
        ) : (
          <>
            <Badge tone="neutral" className="text-caption">{t('statusNotBilled')}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={onCreateInvoice}>
              {t('createInvoice')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function CreateSeparateChargeInvoiceDialog({
  projectId,
  node,
  onClose,
}: {
  projectId: string;
  // Only a BOQ_LEAF item can be un-invoiced — the row only offers this action when `invoice` is
  // null, which a VARIATION item's invoice (created atomically with its allocation) never is.
  node: Extract<SeparateChargeNode, { source: 'BOQ_LEAF' }>;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.contractMilestones.separateCharges.dialog');
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const mutation = useCreateSeparateChargeInvoice(projectId);

  async function handleSubmit() {
    if (!dueDate) return;
    await mutation.mutateAsync({
      boqNodeId: node.id,
      invoiceDate,
      dueDate,
      paymentTerms: paymentTerms || undefined,
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        {mutation.error && (
          <Alert variant="error" messages={[(mutation.error as Error).message]} />
        )}
        <FormField htmlFor="sc-invoice-date" label={t('invoiceDate')}>
          <DatePicker
            id="sc-invoice-date"
            value={invoiceDate}
            onChange={setInvoiceDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <FormField htmlFor="sc-due-date" label={t('dueDate')}>
          <DatePicker
            id="sc-due-date"
            value={dueDate}
            onChange={setDueDate}
            disabled={mutation.isPending}
          />
        </FormField>
        <FormField htmlFor="sc-payment-terms" label={t('paymentTerms')}>
          <Input
            id="sc-payment-terms"
            type="text"
            placeholder={t('paymentTermsPlaceholder')}
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            disabled={mutation.isPending}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!dueDate || mutation.isPending}
          >
            {mutation.isPending ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyCommercialMilestoneDialog({
  projectId,
  milestone,
  onClose,
}: {
  projectId: string;
  milestone: MilestoneItemViewModel | null;
  onClose: () => void;
}) {
  const t = useTranslations('commercial.contractMilestones.verify');
  const [actualDate, setActualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const verify = useVerifyMilestone(projectId);
  const queryClient = useQueryClient();

  async function handleVerify() {
    if (!milestone?.programmeMilestone || !actualDate) return;
    await verify.mutateAsync({
      milestoneId: milestone.programmeMilestone.id,
      actualDate,
    });
    await queryClient.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
    onClose();
  }

  if (!milestone?.programmeMilestone) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !verify.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {t('description', { name: milestone.programmeMilestone.name, stage: milestone.name })}
        </DialogDescription>
        {verify.error ? (
          <Alert variant="error" messages={[verify.error.message]} />
        ) : null}
        <FormField htmlFor="commercial-milestone-actual-date" label={t('actualDate')}>
          <DatePicker
            id="commercial-milestone-actual-date"
            value={actualDate}
            onChange={setActualDate}
            disabled={verify.isPending}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={verify.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleVerify()} disabled={!actualDate || verify.isPending}>
            {verify.isPending ? t('verifying') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
