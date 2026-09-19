'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
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
  FormField,
  Skeleton,
} from '@erp/ui';
import type { CommercialSummaryResponse } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';
import { useVerifyMilestone } from '@/features/programme/hooks/use-programme';

import { commercialKeys, useBillingPackages, useCommercialCurrentCycle } from '../hooks/use-commercial';
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
import { ContractSecurityBody } from './contract-security-tab';
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
        <ScheduleEditor
          projectId={projectId}
          contractId={contract.id}
          status={contract.status}
        />
        <ContractSecurityBody projectId={projectId} summary={summary} />
        <VariationsTab projectId={projectId} summary={summary} />
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
  contract,
  summary,
}: {
  contract: CommercialSummaryResponse['mainContract'] & {};
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones.header');
  const locale = useLocale() as 'en';
  const currency = summary.currency ?? contract.currency;

  const fmt = (amount: string | null) =>
    amount ? (formatMoney(amount, currency, locale) ?? amount) : '—';

  const cv = summary.contractValue;

  return (
    <section className="rounded-panel border border-border bg-white px-5 py-5">
      {/* Reference + status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
            {t('reference')}
          </p>
          <p className="mt-0.5 text-h3 font-bold text-foreground">{contract.contractNumber}</p>
        </div>
        <Badge tone={contractStatusTone(contract.status)}>{contract.status}</Badge>
      </div>

      {/* Money values */}
      {summary.financialsVisible && cv ? (
        <dl className="mt-5 space-y-2">
          <MoneyRow
            label={t('originalValue')}
            value={fmt(cv.originalContractValue)}
            prominent
          />
          {cv.approvedVariationsTotal && Number(cv.approvedVariationsTotal) !== 0 ? (
            <MoneyRow
              label={t('approvedVariations')}
              value={
                Number(cv.approvedVariationsTotal) > 0
                  ? `+${fmt(cv.approvedVariationsTotal)}`
                  : fmt(cv.approvedVariationsTotal)
              }
            />
          ) : null}
          <div className="border-t border-border pt-2">
            <MoneyRow
              label={t('currentValue')}
              value={fmt(cv.governingContractValue)}
              prominent
            />
          </div>
        </dl>
      ) : null}

      {/* Footer: payment terms */}
      <div className="mt-4 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
        <ContractFact
          label={t('signedDate')}
          value={
            contract.signedDate
              ? (formatDate(contract.signedDate, locale) ?? contract.signedDate)
              : t('paymentTermsNotSet')
          }
        />
        <ContractFact
          label={t('paymentTerms')}
          value={contract.paymentTerms?.trim() || t('paymentTermsNotSet')}
        />
      </div>
    </section>
  );
}

function ContractFact({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-body-sm text-muted-foreground">
      <span className="font-medium text-foreground">{label}:</span>{' '}
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

  return (
    <>
      <CommercialDeepLinkAction
        milestones={viewModel.milestones}
        onReviewForBilling={onReviewForBilling}
        onPrepareInvoice={onPrepareInvoice}
      />
      <MilestoneJourney
        viewModel={viewModel}
        onMilestoneClick={onMilestoneClick}
        onReviewForBilling={onReviewForBilling}
        onPrepareInvoice={onPrepareInvoice}
        onSendInvoice={onSendInvoice}
        onVerifyMilestone={onVerifyMilestone}
      />
    </>
  );
}

function CommercialDeepLinkAction({
  milestones,
  onReviewForBilling,
  onPrepareInvoice,
}: {
  milestones: MilestoneItemViewModel[];
  onReviewForBilling: (milestone: MilestoneItemViewModel) => void;
  onPrepareInvoice: (milestone: MilestoneItemViewModel) => void;
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
    }
  }, [milestones, onPrepareInvoice, onReviewForBilling, requestedAction, requestedInstallmentId]);

  return null;
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
