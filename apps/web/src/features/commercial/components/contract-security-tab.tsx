'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, EmptyState, Label, LtrValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, Textarea } from '@erp/ui';
import type { CommercialGuaranteeSummary, CommercialSummaryResponse } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';
import {
  useAdvanceContract,
  useContract,
  useReopenContract,
} from '@/features/contracts/hooks/use-contracts';
import { requiresConfirmation, type ContractCommand } from '@/features/contracts/contract-actions';
import { lifecycleErrorKey } from '@/features/lifecycle/lifecycle-error';
import {
  GuaranteeFormDialog,
  type EditableGuarantee,
} from '@/features/contracts/components/guarantee-form-dialog';
import type { ContractDetail } from '@/features/contracts/types';

import { commercialKeys } from '../hooks/use-commercial';
import { contractStatusTone, guaranteeAttentionTone, guaranteeStatusTone } from '../presentation';
import { formatPercent } from './current-payment-cycle';
import { FactRow, PanelLink, SectionCard } from './commercial-ui';

/**
 * The contract lifecycle rail. ACCO signs on paper, so the in-app review/signature stages are
 * gone — a physically-signed DRAFT is activated straight to ACTIVE. CANCELLED and TERMINATED are
 * exits, not stages on the rail.
 *
 * Exported: the rail itself now renders in `ContractHeader` (top of the Contract & Milestones
 * tab), not here — visible without scrolling instead of buried below the schedule editor.
 */
export const LIFECYCLE = ['DRAFT', 'ACTIVE', 'FINAL_ACCOUNT_PENDING', 'CLOSED'] as const;

/** The transition that becomes available from each state, where one exists (label keys). */
const NEXT_TRANSITION: Partial<Record<string, string>> = {
  DRAFT: 'ACTIVATE',
  FINAL_ACCOUNT_PENDING: 'CLOSE',
};

/** The lifecycle command each state advances with. Mirrors `contract-actions.ts` NEXT_COMMAND. */
const ADVANCE_COMMAND: Partial<Record<string, ContractCommand>> = {
  DRAFT: 'activate',
  FINAL_ACCOUNT_PENDING: 'close',
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
export function ContractSecurityBody({
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
          <PaymentTermsPanel
            projectId={projectId}
            summary={summary}
            detail={detail.data ?? null}
            loading={detail.isPending}
          />
          <RetentionPanel summary={summary} />
        </div>
        <div className="min-w-0 space-y-4">
          <ContractStatusPanel projectId={projectId} summary={summary} />
          <AdvancePanel summary={summary} />
          <GuaranteesPanel projectId={projectId} summary={summary} />
        </div>
      </div>

      <ContractDeliverablesPanel detail={detail.data ?? null} loading={detail.isPending} />
    </div>
  );
}

/**
 * Where the contract is in its lifecycle, and the buttons that move it.
 *
 * A compact rail (current state in context of the four-stage journey) plus the ONE next-step
 * button that fires the actual transition — Activate → Close — mirroring the BOQ workspace's
 * next-step grammar. ACCO signs on paper, so a physically-signed DRAFT is activated straight to
 * ACTIVE; that single step freezes the client's identity onto the contract forever, so it confirms
 * first (as does the final Close). The command, its permission and its confirmation are the
 * server's rules (`capabilities.canAdvanceContract`); the button only ever offers a step the state
 * machine will accept.
 *
 * ACTIVE also carries a REVERSE affordance — "Reopen to draft" — for correcting a contract whose
 * paperwork is still changing. It is gated on `capabilities.canReopenContract`, takes a mandatory
 * reason and confirms with a strong warning: reopening a contract that has already been invoiced
 * or collected against will leave those figures contradicting the draft.
 *
 * When the user cannot run the forward step, its name is shown as a plain label (oriented, not a
 * dead button). ACTIVE has no forward command — it advances when the project records practical
 * completion — so that is stated rather than left blank.
 */
function ContractStatusPanel({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const tCommon = useTranslations('common');
  const tLifecycle = useTranslations('platform.lifecycle');
  const qc = useQueryClient();
  const contract = summary.mainContract!;
  const nextKey = NEXT_TRANSITION[contract.status] ?? null;
  const command = ADVANCE_COMMAND[contract.status] ?? null;
  const canAdvance = summary.capabilities.canAdvanceContract;
  const canReopen = summary.capabilities.canReopenContract;

  const advance = useAdvanceContract(contract.id);
  const reopen = useReopenContract(contract.id);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const invalidateCommercial = () => {
    // useAdvanceContract/useReopenContract refresh contracts + projects; the commercial summary
    // and cycle (status, capabilities, ribbon) live under their own keys, so refresh them too.
    void qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
  };

  const run = () => {
    if (!command) return;
    advance.mutate(command, {
      onSuccess: () => {
        setConfirming(false);
        invalidateCommercial();
      },
    });
  };

  const onAdvance = () => {
    if (!command) return;
    if (requiresConfirmation(command)) setConfirming(true);
    else run();
  };

  const runReopen = () => {
    if (!reopenReason.trim()) return;
    reopen.mutate(reopenReason.trim(), {
      onSuccess: () => {
        setReopening(false);
        setReopenReason('');
        invalidateCommercial();
      },
    });
  };

  const failureMessage = advance.failure
    ? advance.failure.serverMessage || tLifecycle(lifecycleErrorKey(advance.failure.kind))
    : null;
  const reopenFailureMessage = reopen.failure
    ? reopen.failure.serverMessage || tLifecycle(lifecycleErrorKey(reopen.failure.kind))
    : null;

  return (
    <SectionCard title={t('contractStatus_.title')}>
      {/* The lifecycle rail itself now lives in ContractHeader at the top of the tab — this card
          is just the actions (current status + the one next-step button + Reopen). Current status
          + the one next action live on a single row — this used to be two stacked FactRows plus a
          separately-bordered Reopen block, which gave the card three sections of padding for two
          facts and a button. Reopen is a quiet secondary affordance that never competes with the
          forward step; its strong warning lives in its own confirm dialog. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{t('contractStatus_.current')}</span>
          <Badge tone={contractStatusTone(contract.status)}>
            {t(`contractStatus.${contract.status}`)}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {command && canAdvance ? (
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={onAdvance}
              disabled={advance.isPending}
            >
              {advance.isPending && !confirming
                ? tCommon('loading')
                : t(`contractStatus_.transition.${nextKey}`)}
            </Button>
          ) : command ? (
            <span className="text-caption font-normal text-muted-foreground">
              {t(`contractStatus_.transition.${nextKey}`)}
            </span>
          ) : contract.status === 'ACTIVE' ? (
            <span className="text-caption font-normal text-muted-foreground">
              {t('contractStatus_.awaitingPc')}
            </span>
          ) : (
            <span className="text-caption font-normal text-muted-foreground">
              {t('contractStatus_.noneRequired')}
            </span>
          )}

          {canReopen ? (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-0"
              onClick={() => setReopening(true)}
              disabled={reopen.isPending}
            >
              {t('contractStatus_.reopen.action')}
            </Button>
          ) : null}
        </div>
      </div>

      {failureMessage && !confirming ? (
        <div className="mt-3">
          <Alert variant="error" messages={[failureMessage]} />
        </div>
      ) : null}

      {reopenFailureMessage && !reopening ? (
        <div className="mt-3">
          <Alert variant="error" messages={[reopenFailureMessage]} />
        </div>
      ) : null}

      {/* Irreversible steps confirm first (S: execute freezes the client identity permanently). */}
      {confirming && command ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !advance.isPending) setConfirming(false);
          }}
        >
          <DialogContent>
            <DialogTitle>{t(`contractStatus_.confirm.${command}.title`)}</DialogTitle>
            <DialogDescription>{t(`contractStatus_.confirm.${command}.body`)}</DialogDescription>
            {failureMessage ? (
              <div className="mt-3">
                <Alert variant="error" messages={[failureMessage]} />
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={run} disabled={advance.isPending}>
                {advance.isPending
                  ? tCommon('loading')
                  : t(`contractStatus_.confirm.${command}.confirm`)}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={advance.isPending}>
                {tCommon('cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Reopen confirms with a mandatory reason and a strong warning — it reverses a live
          contract, and if it has been billed the draft will contradict issued invoices. */}
      {reopening ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !reopen.isPending) {
              setReopening(false);
              setReopenReason('');
            }
          }}
        >
          <DialogContent>
            <DialogTitle>{t('contractStatus_.reopen.title')}</DialogTitle>
            <DialogDescription>{t('contractStatus_.reopen.body')}</DialogDescription>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="reopen-reason">{t('contractStatus_.reopen.reasonLabel')}</Label>
              <Textarea
                id="reopen-reason"
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                maxLength={500}
                placeholder={t('contractStatus_.reopen.reasonPlaceholder')}
                disabled={reopen.isPending}
              />
            </div>
            {reopenFailureMessage ? (
              <div className="mt-3">
                <Alert variant="error" messages={[reopenFailureMessage]} />
              </div>
            ) : null}
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={runReopen}
                disabled={reopen.isPending || !reopenReason.trim()}
              >
                {reopen.isPending ? tCommon('loading') : t('contractStatus_.reopen.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setReopening(false);
                  setReopenReason('');
                }}
                disabled={reopen.isPending}
              >
                {tCommon('cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </SectionCard>
  );
}

// ─── Payment terms ──────────────────────────────────────────────────────────────

/**
 * The negotiated schedule as an agreement — but only a summary. The live, actionable plan (each
 * installment's status, amount paid/due, and its billing action) lives on the Payment Schedule
 * tab; rendering the same installment rows again here, from a second query, is how the two tabs
 * drifted into showing the same four rows twice. This panel states only whether the terms
 * reconcile to 100% and links across to the tab that owns the detail.
 */
function PaymentTermsPanel({
  projectId,
  summary,
  detail,
  loading,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
  detail: ContractDetail | null;
  loading: boolean;
}) {
  const t = useTranslations('commercial.paymentTerms');
  const tRoot = useTranslations('commercial');
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

  if (loading) return <Skeleton className="h-16 w-full" />;

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

  const totalFraction = installments.reduce((sum, i) => sum + Number(i.percentage), 0);
  const reconciled = Math.abs(totalFraction - 1) < 0.00005;

  return (
    <SectionCard title={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body-sm text-foreground">
            {t('summary', { count: installments.length, percent: formatPercent(String(totalFraction)) })}
          </p>
          {!reconciled ? (
            <p className="mt-0.5 text-caption text-warning">{t('notReconciled')}</p>
          ) : null}
        </div>
        <PanelLink href={`/projects/${projectId}/commercial/payment-schedule`}>
          {t('viewSchedule')}
        </PanelLink>
      </div>
    </SectionCard>
  );
}

// ─── Retention & advance ────────────────────────────────────────────────────────

function RetentionPanel({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial.retention');
  const locale = useLocale() as 'en' | 'ar';
  const { retention, securityPosition, currency } = summary;

  // S-SH-4: the retention panel appears only when the contract actually carries retention terms.
  // ACCO's MILESTONE contracts hold no retention (ADR-023 CONST-COM-013), so on those there is
  // nothing to show — an empty "not applicable" card was noise on the section, not information.
  if (!retention) return null;

  return (
    <SectionCard title={t('title')}>
      <dl>
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
      {!securityPosition.applicable ? (
        <p className="mt-2 text-caption text-muted-foreground">{t('notApplicable')}</p>
      ) : null}
    </SectionCard>
  );
}

function AdvancePanel({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial.advances');
  const locale = useLocale() as 'en' | 'ar';
  const { advances, securityPosition, currency } = summary;

  // S-SH-4: the advance panel appears only when the contract carries advance terms. A MILESTONE
  // contract folds its advance into the first installment (no standalone advance recovery), so
  // there is nothing to show and an empty "none" card was just noise.
  if (advances.length === 0) return null;

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

  const hasGuarantees = summary.guarantees.length > 0;

  const dialogEl =
    canManage && dialog !== null ? (
      <GuaranteeFormDialog
        contractId={contractId}
        guarantee={dialog === 'add' ? undefined : toEditableGuarantee(dialog)}
        onClose={() => {
          setDialog(null);
        }}
        onSuccess={refreshSummary}
      />
    ) : null;

  // S-SH-4: like Retention and Advance, an empty Guarantees panel is noise on an ACCO milestone
  // contract that carries none (ADR-023). With nothing recorded there is no card — just a quiet
  // "add" affordance for someone who can manage guarantees, and nothing at all for someone who
  // cannot. Guarantees stay one click away without occupying the tab by default.
  if (!hasGuarantees) {
    if (!canManage) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setDialog('add')}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-panel border border-dashed border-border px-3 text-body-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <ShieldCheck size={15} aria-hidden="true" />
          {t('add')}
        </button>
        {dialogEl}
      </>
    );
  }

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
      bodyClassName="px-0 py-0"
    >
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

      {dialogEl}
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

function RestrictedValue() {
  const t = useTranslations('commercial.metricState');
  return (
    <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
      <Lock size={13} aria-hidden="true" />
      {t('RESTRICTED')}
    </span>
  );
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
