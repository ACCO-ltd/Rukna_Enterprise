'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  LtrValue,
  Skeleton,
  cn,
} from '@erp/ui';
import type {
  CommercialOverviewResponse,
  CommercialSummaryResponse,
  OverviewAttentionItem,
} from '@erp/types';

import { formatMoney } from '@/lib/format';

import {
  useCloseContract,
  useCommercialBilling,
  useCommercialOverview,
  useReleaseRetention,
} from '../hooks/use-commercial';

export function OverviewTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary?: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const query = useCommercialOverview(projectId);

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-panel" />
        <Skeleton className="h-36 w-full rounded-panel" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert
        variant="error"
        title={t('states.loadFailed')}
        messages={[t('states.loadFailedHint')]}
      >
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('states.retry')}
        </Button>
      </Alert>
    );
  }

  const overview = query.data;
  const contractStatus = summary?.mainContract?.status;

  return (
    <div className="space-y-4">
      <section aria-label={t('overview.financialStrip.contractValue')}>
        <FinancialStrip overview={overview} />
      </section>

      <section aria-label={t('overview.currentPosition.title')}>
        <CurrentPositionCard overview={overview} projectId={projectId} />
      </section>

      {overview.attention.length > 0 && (
        <section aria-label={t('overview.attentionSection.title')}>
          <AttentionSection items={overview.attention} projectId={projectId} currency={overview.currency} />
        </section>
      )}

      {contractStatus === 'FINAL_ACCOUNT_PENDING' && summary?.mainContract && (
        <FinalAccountCard
          projectId={projectId}
          contractId={summary.mainContract.id}
          summary={summary}
        />
      )}

      {(contractStatus === 'CLOSED' ||
        contractStatus === 'CANCELLED' ||
        contractStatus === 'TERMINATED') && (
        <TerminalStateBanner status={contractStatus} />
      )}
    </div>
  );
}

// ─── Financial Strip ──────────────────────────────────────────────────────────

function FinancialStrip({ overview }: { overview: CommercialOverviewResponse }) {
  const t = useTranslations('commercial.overview.financialStrip');
  const locale = useLocale() as 'en' | 'ar';
  const { financialPosition: fp, contract, currency } = overview;

  const money = (v: string | null) =>
    v === null ? '—' : (formatMoney(v, currency, locale) ?? v);

  const postedCreditNotes = fp.postedCreditNotes !== null && parseFloat(fp.postedCreditNotes) > 0;

  const hasOutstanding = fp.outstanding !== null && parseFloat(fp.outstanding) > 0;
  const hasOverdue = fp.overdue !== null && parseFloat(fp.overdue) > 0;

  return (
    <dl className="grid overflow-hidden rounded-panel border border-border bg-surface shadow-e1 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCell
        label={t('contractValue')}
        value={money(contract.currentContractValue)}
      />
      <MetricCell
        label={t('netBilled')}
        value={money(fp.netBilled)}
        note={
          postedCreditNotes
            ? t('creditNoteNote', { amount: money(fp.postedCreditNotes) })
            : undefined
        }
      />
      <MetricCell label={t('collected')} value={money(fp.collected)} accent="success" />
      <MetricCell
        label={t('outstanding')}
        value={money(fp.outstanding)}
        highlight={hasOutstanding}
        accent={hasOutstanding ? 'brand' : undefined}
      />
      <MetricCell
        label={t('overdue')}
        value={money(fp.overdue)}
        highlight={hasOverdue}
        highlightColor="warning"
        accent={hasOverdue ? 'warning' : undefined}
      />
    </dl>
  );
}

function MetricCell({
  label,
  value,
  note,
  highlight,
  highlightColor = 'default',
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
  highlightColor?: 'default' | 'warning';
  accent?: 'brand' | 'success' | 'warning';
}) {
  const accentClass = accent === 'brand'
    ? 'border-t-2 border-t-brand-primary'
    : accent === 'success'
      ? 'border-t-2 border-t-success'
      : accent === 'warning'
        ? 'border-t-2 border-t-warning'
        : '';

  return (
    <div
      className={cn(
        'border-b border-border p-4 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e',
        accentClass,
      )}
    >
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5">
        <LtrValue
          className={cn(
            'text-h2 font-semibold tabular-nums',
            highlight && highlightColor === 'warning' ? 'text-warning' : 'text-foreground',
          )}
        >
          {value}
        </LtrValue>
      </dd>
      {note ? <dd className="mt-1 text-caption text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

// ─── Current Position Card ────────────────────────────────────────────────────

function CurrentPositionCard({
  overview,
  projectId,
}: {
  overview: CommercialOverviewResponse;
  projectId: string;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const { currentCycle: cc, currency } = overview;

  const ctaHref = ((): string => {
    const base = `/projects/${projectId}/commercial/contract-milestones`;
    if (!cc.nextAction?.targetId) return base;
    const action = cc.nextAction.kind === 'PREPARE_INVOICE' ? 'prepare' : 'review';
    return `${base}?installment=${cc.nextAction.targetId}&action=${action}`;
  })();

  const isActionable = cc.stage === 'REVIEW_FOR_BILLING' || cc.stage === 'READY_TO_BILL';

  return (
    <div
      className={cn(
        'rounded-panel border bg-surface p-5 shadow-e1',
        isActionable ? 'border-amber-300/60 bg-amber-50/30' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium text-muted-foreground">
            {t('overview.currentPosition.title')}
          </p>
          <h3 className="mt-1 text-h3 font-bold text-foreground">{cc.title}</h3>
          {cc.description ? (
            <p className="mt-1 text-body-sm text-muted-foreground">{cc.description}</p>
          ) : null}
        </div>
        {cc.amount !== null ? (
          <div className="shrink-0 text-end">
            <p className="text-caption font-medium text-muted-foreground">
              {t('overview.currentPosition.amount')}
            </p>
            <p className="mt-0.5 text-h3 font-bold tabular-nums text-foreground">
              <LtrValue>{formatMoney(cc.amount, currency, locale) ?? cc.amount}</LtrValue>
            </p>
          </div>
        ) : null}
      </div>
      {cc.nextAction && cc.stage !== 'NO_CONTRACT' ? (
        <div className="mt-4">
          <Button asChild size="sm">
            <Link href={ctaHref}>{cc.nextAction.label}</Link>
          </Button>
        </div>
      ) : cc.stage === 'NO_CONTRACT' ? (
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${projectId}/commercial/contract-security`}>
              {t('overview.notActiveAction')}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Attention Section ────────────────────────────────────────────────────────

function AttentionSection({
  items,
  projectId,
  currency,
}: {
  items: OverviewAttentionItem[];
  projectId: string;
  currency: string;
}) {
  const t = useTranslations('commercial.overview.attentionSection');
  const locale = useLocale() as 'en' | 'ar';

  const money = (v: string) => formatMoney(v, currency, locale) ?? v;

  return (
    <div className="rounded-panel border border-border bg-surface shadow-e1">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <AttentionRow
            key={item.invoiceId}
            item={item}
            projectId={projectId}
            money={money}
            t={t}
          />
        ))}
      </ul>
    </div>
  );

}

function AttentionRow({
  item,
  projectId,
  money,
  t,
}: {
  item: OverviewAttentionItem;
  projectId: string;
  money: (v: string) => string;
  t: ReturnType<typeof useTranslations<'commercial.overview.attentionSection'>>;
}) {
  const href = `/projects/${projectId}/commercial/billing-collection?invoice=${item.invoiceId}`;

  const actionLabel =
    item.kind === 'ISSUED_NOT_SENT'
      ? t('sendToClient')
      : item.kind === 'OPEN_DISPUTE'
        ? t('viewDispute')
        : t('followUp');

  const headline = (() => {
    if (item.kind === 'OVERDUE_INVOICE' && item.daysOverdue !== undefined) {
      return `${item.headline} · ${money(item.amount)}`;
    }
    if (item.kind === 'OPEN_DISPUTE' && item.disputedAmount) {
      return `${item.headline} · ${money(item.disputedAmount)}`;
    }
    return `${item.headline} · ${money(item.amount)}`;
  })();

  const accentClass =
    item.kind === 'OPEN_DISPUTE'
      ? 'border-s-2 border-s-danger'
      : item.kind === 'OVERDUE_INVOICE'
        ? 'border-s-2 border-s-warning'
        : 'border-s-2 border-s-border';

  return (
    <li className={cn('flex items-center gap-3 px-4 py-3 ps-3', accentClass)}>
      <div className="min-w-0 flex-1 ps-1">
        <p className="truncate text-caption text-muted-foreground">{item.invoiceNumber}</p>
        <p className="mt-0.5 text-body-sm font-medium text-foreground">{headline}</p>
      </div>
      <Button asChild variant="ghost" size="sm" className="shrink-0">
        <Link href={href}>{actionLabel}</Link>
      </Button>
    </li>
  );
}

// ─── Final Account Card (Slice B + C) ─────────────────────────────────────────

function FinalAccountCard({
  projectId,
  contractId,
  summary,
}: {
  projectId: string;
  contractId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.overview.finalAccount');
  const [closeOpen, setCloseOpen] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);

  const billingQuery = useCommercialBilling(projectId);
  const closeContract = useCloseContract(contractId, projectId);
  const releaseRetention = useReleaseRetention(contractId, projectId);

  const outstanding = billingQuery.data?.position?.outstanding ?? null;
  const balanceClear = outstanding !== null && parseFloat(outstanding) === 0;
  const noOpenDisputes = billingQuery.data
    ? !billingQuery.data.invoices.some((inv) => !!inv.openDispute)
    : null;

  const retentionTerms = summary.retention;
  const retentionReleased = retentionTerms === null || !!retentionTerms?.retentionReleasedAt;
  const retentionPending = retentionTerms !== null && !retentionTerms?.retentionReleasedAt;

  const canClose = balanceClear && noOpenDisputes === true;

  return (
    <section className="rounded-panel border border-border bg-surface shadow-e1">
      <div className="border-b border-border px-5 py-4">
        <p className="text-caption font-medium text-muted-foreground">{t('title')}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('hint')}</p>
      </div>

      <div className="px-5 py-4">
        <p className="text-body-sm font-semibold text-foreground">{t('checklist.title')}</p>
        <ul className="mt-3 space-y-3">
          <ChecklistItem
            done={balanceClear}
            pending={!balanceClear && outstanding !== null}
            label={t('checklist.balance')}
            pendingLabel={t('checklist.balancePending')}
          />
          <ChecklistItem
            done={noOpenDisputes === true}
            pending={noOpenDisputes === false}
            label={t('checklist.disputes')}
            pendingLabel={t('checklist.disputesPending')}
          />
          {retentionTerms === null ? (
            <ChecklistItem done label={t('checklist.retentionNone')} />
          ) : (
            <li className="flex items-start gap-3">
              {retentionReleased ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className={cn('text-body-sm', retentionReleased ? 'text-foreground' : 'text-warning')}>
                  {retentionReleased ? t('checklist.retention') : t('checklist.retentionPending')}
                </span>
                {retentionPending && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRetentionOpen(true)}
                  >
                    {t('releaseRetention')}
                  </Button>
                )}
              </div>
            </li>
          )}
        </ul>
      </div>

      <div className="border-t border-border px-5 py-4">
        <Button
          type="button"
          size="sm"
          disabled={!canClose}
          onClick={() => setCloseOpen(true)}
        >
          {t('closeContract')}
        </Button>
        {!canClose && billingQuery.data && (
          <p className="mt-2 text-caption text-muted-foreground">
            {!balanceClear ? t('checklist.balancePending') : t('checklist.disputesPending')}
          </p>
        )}
      </div>

      {/* Release retention confirm dialog */}
      {retentionOpen && (
        <Dialog open onOpenChange={(open) => !open && !releaseRetention.isPending && setRetentionOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>{t('releaseRetentionConfirm.title')}</DialogTitle>
            <DialogDescription>{t('releaseRetentionConfirm.description')}</DialogDescription>
            {releaseRetention.error && (
              <Alert variant="error" messages={[(releaseRetention.error as Error).message]} />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRetentionOpen(false)}
                disabled={releaseRetention.isPending}
              >
                {t('releaseRetentionConfirm.cancel')}
              </Button>
              <Button
                onClick={() => {
                  releaseRetention.mutate(undefined, {
                    onSuccess: () => setRetentionOpen(false),
                  });
                }}
                disabled={releaseRetention.isPending}
              >
                {t('releaseRetentionConfirm.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Close contract confirm dialog */}
      {closeOpen && (
        <Dialog open onOpenChange={(open) => !open && !closeContract.isPending && setCloseOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>{t('closeConfirm.title')}</DialogTitle>
            <DialogDescription>{t('closeConfirm.description')}</DialogDescription>
            {closeContract.error && (
              <Alert variant="error" messages={[(closeContract.error as Error).message]} />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCloseOpen(false)}
                disabled={closeContract.isPending}
              >
                {t('closeConfirm.cancel')}
              </Button>
              <Button
                onClick={() => {
                  closeContract.mutate(undefined, {
                    onSuccess: () => setCloseOpen(false),
                  });
                }}
                disabled={closeContract.isPending}
              >
                {t('closeConfirm.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function ChecklistItem({
  done,
  pending,
  label,
  pendingLabel,
}: {
  done: boolean;
  pending?: boolean;
  label: string;
  pendingLabel?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      {done ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      ) : pending ? (
        <XCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <Circle size={16} className="mt-0.5 shrink-0 text-border-strong" aria-hidden="true" />
      )}
      <span className={cn('text-body-sm', done ? 'text-foreground' : pending ? 'text-warning' : 'text-muted-foreground')}>
        {done || !pending ? label : (pendingLabel ?? label)}
      </span>
    </li>
  );
}

// ─── Terminal State Banner (Slice B) ─────────────────────────────────────────

function TerminalStateBanner({ status }: { status: 'CLOSED' | 'CANCELLED' | 'TERMINATED' }) {
  const t = useTranslations('commercial.overview');
  return (
    <div className="rounded-panel border border-border bg-muted/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-body-sm font-medium text-foreground">{t(`terminal.${status}`)}</p>
          <p className="text-caption text-muted-foreground">{t('terminalHint')}</p>
        </div>
      </div>
    </div>
  );
}
