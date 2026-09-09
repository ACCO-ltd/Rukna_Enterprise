'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Lock, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  LtrValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import type { CommercialGuaranteeSummary, CommercialSummaryResponse } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';
import { useContract } from '@/features/contracts/hooks/use-contracts';
import {
  GuaranteeFormDialog,
  type EditableGuarantee,
} from '@/features/contracts/components/guarantee-form-dialog';
import type { ContractDetail } from '@/features/contracts/types';
import type { ContractPaymentInstallmentResponse } from '@erp/types';

import { commercialKeys } from '../hooks/use-commercial';
import { contractStatusTone, guaranteeAttentionTone, guaranteeStatusTone } from '../presentation';
import { formatPercent } from './current-payment-cycle';
import { FactRow, SectionCard } from './commercial-ui';

/** ADR-017 contract lifecycle. CANCELLED and TERMINATED are exits, not stages on the rail. */
const LIFECYCLE = [
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_SIGNATURE',
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
  'CLOSED',
] as const;

/** The transition that becomes available from each state, where one exists. */
const NEXT_TRANSITION: Partial<Record<string, string>> = {
  DRAFT: 'SUBMIT_FOR_REVIEW',
  UNDER_REVIEW: 'APPROVE_REVIEW',
  PENDING_SIGNATURE: 'EXECUTE',
  FINAL_ACCOUNT_PENDING: 'CLOSE',
};

/**
 * Contract & Security — the agreement and the instruments that secure it.
 *
 * This is the "what we signed" view, and it is deliberately different from Overview's live
 * cycle: the payment plan reads here as **terms** (name, share, value, trigger, and whether they
 * reconcile to 100%) with no status and no billing action, because changing them is a contract
 * amendment rather than an operational step.
 *
 * Sections, not one giant form. Retention, advance, guarantees and milestones are separate
 * commercial facts with separate owners and separate lifecycles; collapsing them into a single
 * "Contract details" panel is what made the old screen unreadable.
 */
export function ContractSecurityTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');

  if (!summary.mainContract) {
    const createUrl = summary.attention.find((i) => i.kind === 'NO_MAIN_CONTRACT')?.actionUrl;
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
        action={
          createUrl ? (
            <Button asChild>
              <Link href={createUrl}>{t('attention.NO_MAIN_CONTRACT.action')}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <ContractSecurityBody projectId={projectId} summary={summary} />;
}

/**
 * Split from the tab so the contract-detail query is only ever mounted with a real id. Hooks run
 * before an early return, so keeping it in the parent meant a project with no contract still
 * fired a request for `/contracts/` — a fetch for nothing, on the one screen that has nothing.
 */
function ContractSecurityBody({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const detail = useContract(summary.mainContract!.id);

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <MainContractPanel projectId={projectId} summary={summary} detail={detail.data ?? null} />
          <PaymentTermsPanel summary={summary} detail={detail.data ?? null} loading={detail.isPending} />
          <RetentionPanel summary={summary} />
        </div>
        <div className="min-w-0 space-y-4">
          <ContractStatusPanel summary={summary} />
          <AdvancePanel summary={summary} />
          <GuaranteesPanel projectId={projectId} summary={summary} />
        </div>
      </div>

      <ContractDeliverablesPanel detail={detail.data ?? null} loading={detail.isPending} />
    </div>
  );
}

// ─── Main contract ──────────────────────────────────────────────────────────────

function MainContractPanel({
  projectId,
  summary,
  detail,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
  detail: ContractDetail | null;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const contract = summary.mainContract!;
  const value = summary.metrics.contractValue;

  return (
    <SectionCard
      title={t('mainContract.title')}
      action={
        summary.capabilities.canEditContract ? (
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-0">
            <Link href={`/projects/${projectId}/commercial/contract/edit`}>{t('actions.edit')}</Link>
          </Button>
        ) : null
      }
    >
      <dl>
        <FactRow label={t('mainContract.number')}>
          <LtrValue>{contract.contractNumber}</LtrValue>
        </FactRow>
        <FactRow label={t('mainContract.client')}>{contract.clientName}</FactRow>
        <FactRow label={t('mainContract.value')}>
          {value.state === 'RESTRICTED' ? (
            <RestrictedValue />
          ) : (
            <LtrValue>{formatMoney(value.amount, contract.currency, locale) ?? '—'}</LtrValue>
          )}
        </FactRow>
        <FactRow label={t('mainContract.currency')}>
          <LtrValue>{contract.currency}</LtrValue>
        </FactRow>
        <FactRow label={t('mainContract.billingModel')}>
          {t(`billingModel.${contract.billingModel}`)}
        </FactRow>
        <FactRow label={t('mainContract.effectiveDate')}>
          {formatDate(contract.startDate, locale) ?? t('states.notSet')}
        </FactRow>
        {/* The contractual completion date. It moves only through an audited Extension of Time
            (ADR-026 CONST-VAR-009) — never because a variation proposed extra days. */}
        <FactRow label={t('mainContract.completionDate')}>
          {formatDate(contract.expectedEndDate, locale) ?? t('states.notSet')}
        </FactRow>
        <FactRow label={t('mainContract.boqBaseline')}>
          {contract.boqVersionNumber !== null
            ? t('mainContract.boqVersion', { number: contract.boqVersionNumber })
            : t('states.notSet')}
        </FactRow>
      </dl>

      {/* Execution froze the client's identity onto this contract. Once it has happened, say so
          plainly — a reader who later edits the client record needs to know it will not follow. */}
      {detail?.clientNameSnapshot ? (
        <Notice
          icon={<Lock size={14} aria-hidden="true" />}
          title={t('mainContract.clientLockedTitle')}
          body={t('mainContract.clientLockedHint')}
        />
      ) : contract.status === 'PENDING_SIGNATURE' ? (
        <Notice
          icon={<Info size={14} aria-hidden="true" />}
          title={t('mainContract.willLockTitle')}
          body={t('mainContract.willLockHint')}
        />
      ) : null}

      {/* 44px tall on touch, quiet on desktop — a bare inline anchor inherits its line height
          and lands at 15px, which is not a target a thumb can hit. */}
      <div className="mt-2">
        <Link
          href={`/projects/${projectId}/boq`}
          className="inline-flex min-h-11 items-center text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
        >
          {t('mainContract.viewBoq')}
        </Link>
      </div>
    </SectionCard>
  );
}

/**
 * Where the contract is in its lifecycle, and what comes next.
 *
 * A compact rail plus a stated next transition, not a permanent full-width stepper: the current
 * state is the fact a reader needs, and the six-stage journey is context for it. The next step
 * is only named when the backend has one — inventing a transition the state machine does not
 * offer would be a promise the Execute button cannot keep.
 */
function ContractStatusPanel({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial');
  const contract = summary.mainContract!;
  const stageIndex = LIFECYCLE.indexOf(contract.status as (typeof LIFECYCLE)[number]);
  const next = NEXT_TRANSITION[contract.status] ?? null;
  const exited = stageIndex < 0;

  return (
    <SectionCard title={t('contractStatus_.title')}>
      {exited ? (
        <p className="pb-3 text-body-sm text-muted-foreground">
          {t('contractStatus_.exited', { status: t(`contractStatus.${contract.status}`) })}
        </p>
      ) : (
        <ol className="flex items-start gap-1 overflow-x-auto pb-1" aria-label={t('contractStatus_.title')}>
          {LIFECYCLE.map((stage, index) => {
            const active = index === stageIndex;
            return (
              <li
                key={stage}
                className="flex min-w-16 flex-1 flex-col items-center gap-1.5 text-center"
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
                    'text-micro font-medium',
                    active ? 'text-brand-primary' : 'text-muted-foreground',
                  )}
                >
                  {t(`contractStatus.${stage}`)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <dl className="mt-3 border-t border-border pt-3">
        <FactRow label={t('contractStatus_.current')}>
          <Badge tone={contractStatusTone(contract.status)}>
            {t(`contractStatus.${contract.status}`)}
          </Badge>
        </FactRow>
        {/* The lifecycle transition is stated, not linked: the standalone contract detail page that
            used to host the advance action is retired (P3 Slice C), and the in-workspace transition
            affordance is not part of this fold. Showing the pending transition as a label keeps the
            reader oriented without dangling a link into a route that only redirects back here. */}
        <FactRow label={t('contractStatus_.next')}>
          {next ? (
            <span className="font-normal text-muted-foreground">
              {t(`contractStatus_.transition.${next}`)}
            </span>
          ) : (
            <span className="font-normal text-muted-foreground">
              {t('contractStatus_.noneRequired')}
            </span>
          )}
        </FactRow>
      </dl>
    </SectionCard>
  );
}

// ─── Payment terms ──────────────────────────────────────────────────────────────

/**
 * The negotiated schedule as an agreement: what each installment is worth and what triggers it.
 *
 * No status column and no Generate-invoice button — those belong to the live plan on Overview
 * and to Billing & Collection. What matters here is that the shares reconcile: the server rejects
 * a plan that does not total 100%, so the footer states the total rather than leaving a reader to
 * add six percentages in their head.
 */
function PaymentTermsPanel({
  summary,
  detail,
  loading,
}: {
  summary: CommercialSummaryResponse;
  detail: ContractDetail | null;
  loading: boolean;
}) {
  const t = useTranslations('commercial.paymentTerms');
  const tRoot = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const contract = summary.mainContract!;

  // A measured contract has no negotiated installments — it bills what is certified. Naming the
  // mechanism is more useful than an empty table pretending a plan is missing.
  if (contract.billingModel !== 'MILESTONE') {
    return (
      <SectionCard title={t('title')}>
        <dl>
          <FactRow label={t('model')}>{tRoot(`billingModel.${contract.billingModel}`)}</FactRow>
        </dl>
        <p className="mt-2 text-caption text-muted-foreground">{t('measuredHint')}</p>
      </SectionCard>
    );
  }

  if (loading) return <Skeleton className="h-56 w-full" />;

  const installments = [...(detail?.paymentInstallments ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  if (installments.length === 0) {
    return (
      <SectionCard title={t('title')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('empty')}</p>
      </SectionCard>
    );
  }

  const contractValue = Number(detail?.contractValue ?? contract.contractValue ?? 0);
  const totalFraction = installments.reduce((sum, i) => sum + Number(i.percentage), 0);
  const reconciled = Math.abs(totalFraction - 1) < 0.00005;

  const amountOf = (percentage: string): string =>
    summary.financialsVisible && Number.isFinite(contractValue) && contractValue > 0
      ? (formatMoney((Number(percentage) * contractValue).toFixed(2), contract.currency, locale) ??
        '—')
      : '—';

  return (
    <SectionCard title={t('title')} bodyClassName="px-0 py-0">
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.installment')}</TableHead>
              <TableHead className="text-end">{t('col.percent')}</TableHead>
              <TableHead className="text-end">{t('col.value')}</TableHead>
              <TableHead>{t('col.trigger')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installments.map((installment) => (
              <TableRow key={installment.id}>
                <TableCell className="font-medium text-foreground">{installment.name}</TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">
                  {formatPercent(installment.percentage)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {amountOf(installment.percentage)}
                </TableCell>
                <TableCell className="text-caption text-muted-foreground">
                  {installmentTrigger(installment, locale, t)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5">
        <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('total')}
        </span>
        <span
          className={cn(
            'text-body-sm font-semibold tabular-nums',
            reconciled ? 'text-foreground' : 'text-warning',
          )}
        >
          {formatPercent(String(totalFraction))}
          {reconciled ? ` · ${t('reconciled')}` : ` · ${t('notReconciled')}`}
        </span>
      </div>
      <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
        {t('amendmentHint')}
      </p>
    </SectionCard>
  );
}

// ─── Retention & advance ────────────────────────────────────────────────────────

function RetentionPanel({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial.retention');
  const locale = useLocale() as 'en' | 'ar';
  const { retention, securityPosition, currency } = summary;

  // ADR-023 CONST-COM-013: a payment-schedule contract deducts no retention at all. Saying that
  // is a different — and true — statement, where "0.00 held" would imply a term that is working.
  if (!securityPosition.applicable && !retention) {
    return (
      <SectionCard title={t('title')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('notApplicable')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('title')}>
      <dl>
        {retention ? (
          <>
            <FactRow label={t('rate')}>{percentOfFraction(retention.retentionRate)}</FactRow>
            <FactRow label={t('cap')}>
              {t('capOfValue', { percent: percentOfFraction(retention.retentionCap) })}
            </FactRow>
            <FactRow label={t('releaseAtPc')}>
              {percentOfFraction(retention.retentionSplitOnPC)}
            </FactRow>
            <FactRow label={t('releaseAtFinal')}>
              {percentOfFraction(String(1 - Number(retention.retentionSplitOnPC)))}
            </FactRow>
          </>
        ) : (
          <FactRow label={t('rate')}>{t('none')}</FactRow>
        )}
        <FactRow label={t('held')}>
          {securityPosition.retentionHeld !== null ? (
            <LtrValue>
              {formatMoney(securityPosition.retentionHeld, currency, locale) ?? '—'}
            </LtrValue>
          ) : summary.financialsVisible ? (
            <span className="font-normal text-muted-foreground">
              {securityPosition.applicable ? t('heldUnknown') : t('heldNotApplicable')}
            </span>
          ) : (
            <RestrictedValue />
          )}
        </FactRow>
      </dl>
      {/* Configured terms the billing model never exercises. Saying so once is kinder than
          leaving a reader to reconcile a 5% rate against a "not applicable" balance. */}
      {retention && !securityPosition.applicable ? (
        <p className="mt-2 text-caption text-muted-foreground">{t('notApplicable')}</p>
      ) : null}
    </SectionCard>
  );
}

function AdvancePanel({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial.advances');
  const locale = useLocale() as 'en' | 'ar';
  const { advances, securityPosition, currency } = summary;

  if (advances.length === 0) {
    return (
      <SectionCard title={t('title')}>
        <p className="py-2 text-body-sm text-muted-foreground">{t('none')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('title')}>
      <dl>
        {advances.map((advance) => (
          <FactRow key={advance.id} label={t(`type.${advance.advanceType}`)}>
            <span className="font-normal">
              {advance.amount
                ? (formatMoney(advance.amount, currency, locale) ?? '—')
                : advance.percentage
                  ? t('percentageOfValue', { percent: percentOfFraction(advance.percentage) })
                  : '—'}
              {' · '}
              {t('recoveryAt', { rate: percentOfFraction(advance.recoveryRate) })}
            </span>
          </FactRow>
        ))}
        <FactRow label={t('recovered')}>
          {securityPosition.advanceRecovered !== null ? (
            <LtrValue>
              {formatMoney(securityPosition.advanceRecovered, currency, locale) ?? '—'}
            </LtrValue>
          ) : (
            <span className="font-normal text-muted-foreground">
              {securityPosition.applicable ? t('recoveredUnknown') : t('recoveredNotApplicable')}
            </span>
          )}
        </FactRow>
        {/* Only when there is a principal to count down from. A percentage-only term has none
            until somebody derives it, and the server returns null rather than inventing one. */}
        {securityPosition.advanceOutstanding !== null ? (
          <FactRow label={t('outstanding')}>
            <LtrValue>
              {formatMoney(securityPosition.advanceOutstanding, currency, locale) ?? '—'}
            </LtrValue>
          </FactRow>
        ) : null}
      </dl>
    </SectionCard>
  );
}

// ─── Guarantees & milestones ────────────────────────────────────────────────────

/**
 * The instruments that secure the contract, plus the authoring that keeps them current.
 *
 * Add and edit happen in a dialog mounted here (`GuaranteeFormDialog`), against the existing
 * `POST/PATCH /contracts/:id/guarantees` endpoints — the P3 fold-in removed the old contract page
 * that used to host the form, so authoring lives inside the workspace now. Both actions are gated
 * on `canManageGuarantee`; the backend commands still enforce.
 */
function GuaranteesPanel({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.guarantees');
  const tRoot = useTranslations('commercial');
  const tActions = useTranslations('commercial.actions');
  const locale = useLocale() as 'en' | 'ar';
  const qc = useQueryClient();
  const contract = summary.mainContract!;
  const contractId = contract.id;
  const canManage = summary.capabilities.canManageGuarantee;

  // `null` = closed, `'add'` = add dialog, an object = edit that guarantee.
  const [dialog, setDialog] = useState<'add' | CommercialGuaranteeSummary | null>(null);

  // The mutations already refresh the contract-detail query; the workspace reads the guarantee
  // table off the commercial summary, so it must be invalidated too or the table would go stale.
  const refreshSummary = () => qc.invalidateQueries({ queryKey: commercialKeys.summary(projectId) });

  return (
    <SectionCard
      title={t('title')}
      action={
        canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => {
              setDialog('add');
            }}
          >
            {t('add')}
          </Button>
        ) : null
      }
      bodyClassName={summary.guarantees.length > 0 ? 'px-0 py-0' : undefined}
    >
      {summary.guarantees.length === 0 ? (
        <div className="flex items-start gap-2.5 py-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-body-sm text-muted-foreground">{t('none')}</p>
        </div>
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.type')}</TableHead>
                <TableHead>{t('col.reference')}</TableHead>
                <TableHead className="text-end">{t('col.value')}</TableHead>
                <TableHead>{t('col.expiry')}</TableHead>
                <TableHead>{t('col.status')}</TableHead>
                {canManage ? (
                  <TableHead className="text-end">
                    <span className="sr-only">{tActions('edit')}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.guarantees.map((guarantee) => (
                <TableRow key={guarantee.id}>
                  <TableCell className="font-medium text-foreground">
                    {humanize(guarantee.guaranteeType)}
                  </TableCell>
                  <TableCell className="font-mono text-caption text-muted-foreground">
                    {guarantee.reference ?? '—'}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(guarantee.amount, guarantee.currency, locale) ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(guarantee.expiryDate, locale) ?? '—'}
                  </TableCell>
                  {/* Lifecycle and attention are different facts and must not merge: a guarantee
                      nearing expiry is still legally ACTIVE, and "expiring soon" is a prompt from
                      the server's own policy, not a status. */}
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={guaranteeStatusTone(guarantee.status)}>
                        {tRoot(`guaranteeStatus.${guarantee.status}`)}
                      </Badge>
                      {guarantee.attention !== 'NONE' ? (
                        <Badge tone={guaranteeAttentionTone(guarantee.attention)}>
                          {tRoot(`guaranteeAttention.${guarantee.attention}`)}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-0"
                        onClick={() => {
                          setDialog(guarantee);
                        }}
                      >
                        {tActions('edit')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {canManage && dialog !== null ? (
        <GuaranteeFormDialog
          contractId={contractId}
          guarantee={dialog === 'add' ? undefined : toEditableGuarantee(dialog)}
          onClose={() => {
            setDialog(null);
          }}
          onSuccess={refreshSummary}
        />
      ) : null}
    </SectionCard>
  );
}

/**
 * The commercial summary row carries every commercial fact the edit dialog shows, but not the
 * guarantee's notes — only the contract-detail shape does. Leaving `notes` `undefined` tells the
 * dialog to start blank and to omit `notes` from the PATCH unless the user types, so an existing
 * note the workspace never loaded is not silently cleared.
 */
function toEditableGuarantee(guarantee: CommercialGuaranteeSummary): EditableGuarantee {
  return {
    id: guarantee.id,
    guaranteeType: guarantee.guaranteeType,
    amount: guarantee.amount,
    currency: guarantee.currency,
    issuer: guarantee.issuer,
    beneficiary: guarantee.beneficiary,
    issueDate: guarantee.issueDate,
    expiryDate: guarantee.expiryDate,
    status: guarantee.status,
  };
}

function ContractDeliverablesPanel({
  detail,
  loading,
}: {
  detail: ContractDetail | null;
  loading: boolean;
}) {
  const t = useTranslations('commercial.contractDeliverables');
  const locale = useLocale() as 'en' | 'ar';

  if (loading) return <Skeleton className="h-40 w-full" />;

  const deliverables = [...(detail?.deliverables ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (deliverables.length === 0) return null;

  return (
    <SectionCard title={t('title')} bodyClassName="px-0 py-0">
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-end">#</TableHead>
              <TableHead>{t('col.deliverable')}</TableHead>
              <TableHead>{t('col.description')}</TableHead>
              <TableHead>{t('col.target')}</TableHead>
              <TableHead>{t('col.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliverables.map((deliverable, index) => (
              <TableRow key={deliverable.id}>
                <TableCell className="text-end tabular-nums text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell className="font-medium text-foreground">{deliverable.name}</TableCell>
                <TableCell className="text-caption text-muted-foreground">
                  {deliverable.description ?? '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(deliverable.dueDate, locale) ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge tone={deliverable.completedAt ? 'live' : 'neutral'}>
                    {deliverable.completedAt ? t('completed') : t('open')}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </SectionCard>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────────

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-muted/50 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-caption font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function RestrictedValue() {
  const t = useTranslations('commercial.metricState');
  return (
    <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
      <Lock size={13} aria-hidden="true" />
      {t('RESTRICTED')}
    </span>
  );
}

/**
 * What has to happen before an installment can be billed, in the contract's own words.
 *
 * Order matters: the negotiated label wins, then an explicit date, then a day offset, and only
 * then the trigger's generic name. `dueOffsetDays` arrives as `null` rather than `undefined`, so
 * an `undefined` check let an ADVANCE installment render " days after commencement" with the
 * number missing — a sentence with a hole in it.
 */
function installmentTrigger(
  installment: ContractPaymentInstallmentResponse,
  locale: 'en' | 'ar',
  t: ReturnType<typeof useTranslations>,
): string {
  if (installment.milestoneLabel) return installment.milestoneLabel;
  if (installment.dueDate) return formatDate(installment.dueDate, locale) ?? '—';
  if (installment.dueOffsetDays != null)
    return t('afterCommencement', { days: installment.dueOffsetDays });
  return t(`trigger.${installment.triggerType}`);
}

/** Rates arrive as fractions — `0.05` is 5%. */
function percentOfFraction(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value)) return rate;
  const scaled = value * 100;
  return `${Number.isInteger(scaled) ? scaled : Number(scaled.toFixed(2))}%`;
}

/** Free-form guarantee type (`"PERFORMANCE_BOND"`) → "Performance Bond". Data, not a key. */
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
