'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Link as LinkIcon } from 'lucide-react';
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
import { useVerifyMilestone } from '@/features/programme/hooks/use-programme';

import {
  commercialKeys,
  useBillingPackages,
  useCommercialCurrentCycle,
  useCreateSeparateChargeInvoice,
  useExtensionsOfTime,
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
        <ContractChangesSummary contractId={contract.id} summary={summary} />
        <div id="contract-changes-detail">
          <VariationsTab projectId={projectId} summary={summary} />
        </div>
        <SeparateChargesSection projectId={projectId} contractId={contract.id} />
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
  contract,
  summary,
}: {
  contract: CommercialSummaryResponse['mainContract'] & {};
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones.header');
  const tStatus = useTranslations('commercial.contractStatus');
  const locale = useLocale() as 'en';
  const currency = summary.currency ?? contract.currency;

  const fmt = (amount: string | null) =>
    amount ? (formatMoney(amount, currency, locale) ?? amount) : '—';

  const cv = summary.contractValue;

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      {/* Header row: reference + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-caption font-medium text-muted-foreground">{t('reference')}</p>
          <p className="mt-0.5 text-h3 font-bold text-foreground">{contract.contractNumber}</p>
        </div>
        <Badge tone={contractStatusTone(contract.status)}>{tStatus(contract.status)}</Badge>
      </div>

      {/* Money values — prominent two-column layout on wider screens */}
      {summary.financialsVisible && cv ? (
        <dl className="grid gap-0 sm:grid-cols-3">
          <div className="border-b border-border px-5 py-4 sm:border-b-0 sm:border-e">
            <dt className="text-caption font-medium text-muted-foreground">{t('originalValue')}</dt>
            <dd className="mt-1 text-h3 font-bold tabular-nums text-foreground">
              {fmt(cv.originalContractValue)}
            </dd>
          </div>
          {cv.approvedVariationsTotal && Number(cv.approvedVariationsTotal) !== 0 ? (
            <div className="border-b border-border px-5 py-4 sm:border-b-0 sm:border-e">
              <dt className="text-caption font-medium text-muted-foreground">
                {t('approvedVariations')}
              </dt>
              <dd
                className={cn(
                  'mt-1 text-h3 font-bold tabular-nums',
                  Number(cv.approvedVariationsTotal) < 0 ? 'text-danger' : 'text-success',
                )}
              >
                {Number(cv.approvedVariationsTotal) > 0
                  ? `+${fmt(cv.approvedVariationsTotal)}`
                  : fmt(cv.approvedVariationsTotal)}
              </dd>
            </div>
          ) : (
            <div className="hidden sm:block sm:border-e border-border" />
          )}
          <div className="bg-surface/50 px-5 py-4">
            <dt className="text-caption font-medium text-muted-foreground">{t('currentValue')}</dt>
            <dd className="mt-1 text-h2 font-bold tabular-nums text-foreground">
              {fmt(cv.governingContractValue)}
            </dd>
          </div>
        </dl>
      ) : null}

      {/* Footer: payment terms */}
      <div className="grid gap-2 border-t border-border px-5 py-3 sm:grid-cols-2">
        <ContractFact
          label={t('signedDate')}
          value={
            contract.signedDate
              ? (formatDate(contract.signedDate, locale) ?? contract.signedDate)
              : t('signedDateNotRecorded')
          }
          warning={!contract.signedDate}
        />
        <ContractFact
          label={t('paymentTerms')}
          value={contract.paymentTerms?.trim() || t('paymentTermsNotSet')}
        />
      </div>
    </section>
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

// ─── Contract changes summary ───────────────────────────────────────────────

/**
 * A glanceable summary above the full Variations/EoT sections below — approved and pending
 * variation totals come straight off `summary.contractValue` (the same authoritative figures
 * `ContractHeader` reads its "Approved variations" cell from), so this never recomputes a
 * total the server already derived. `useExtensionsOfTime` is the one extra read — the same
 * hook `ExtensionOfTimeSection` calls for the same `contractId`, which TanStack Query dedupes,
 * so this costs no extra round trip.
 */
function ContractChangesSummary({
  contractId,
  summary,
}: {
  contractId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.contractMilestones.changesSummary');
  const locale = useLocale() as 'en';
  const currency = summary.currency ?? summary.mainContract?.currency ?? null;

  const eotQuery = useExtensionsOfTime(contractId);

  const money = (value: string | null) =>
    value !== null && currency ? (formatMoney(value, currency, locale) ?? value) : '—';

  const extensionDays =
    eotQuery.data?.extensions.reduce((sum, ext) => sum + (ext.grantedDays ?? 0), 0) ?? null;
  const hasExtensions = (eotQuery.data?.extensions.length ?? 0) > 0;

  return (
    <div className="grid overflow-hidden rounded-panel border border-border bg-surface shadow-e1 sm:grid-cols-3">
      <PositionCell label={t('approvedVariations')}>
        <span className="text-h3 font-bold tabular-nums text-foreground">
          {money(summary.contractValue?.approvedVariationsTotal ?? null)}
        </span>
      </PositionCell>
      <PositionCell label={t('pendingVariations')}>
        <span className="text-h3 font-bold tabular-nums text-foreground">
          {money(summary.contractValue?.pendingVariations ?? null)}
        </span>
      </PositionCell>
      <PositionCell label={t('extensionOfTime')}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-h3 font-bold tabular-nums text-foreground">
            {hasExtensions ? t('extensionDays', { days: extensionDays ?? 0 }) : t('none')}
          </span>
          <a
            href="#contract-changes-detail"
            className="shrink-0 text-caption font-medium text-brand-primary hover:underline"
          >
            {t('viewDetails')}
          </a>
        </div>
      </PositionCell>
    </div>
  );
}

function PositionCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:not-last:border-e">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
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
  const [creatingFor, setCreatingFor] = useState<SeparateChargeNode | null>(null);

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
              onCreateInvoice={() => setCreatingFor(item)}
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

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-foreground">{item.name}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          <span className="font-mono">{item.code}</span>
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
  node: SeparateChargeNode;
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
