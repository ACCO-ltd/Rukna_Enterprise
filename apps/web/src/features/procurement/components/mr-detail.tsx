'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';
import { WorkflowTransactionType } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate, formatNumber } from '@/lib/format';
import { useProjects } from '@/features/projects/hooks/use-projects';

import { stepPosition } from '@/features/workflows/approval-actions';
import { useApprovalStep } from '@/features/workflows/hooks/use-approval';
import { useWorkflowDefinition } from '@/features/workflows/hooks/use-workflow-definition';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';

import {
  useCancelMaterialRequest,
  useMaterialRequest,
  useSubmitMaterialRequest,
} from '../hooks/use-procurement';
import type { MaterialRequest, MaterialRequestStatus } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';

type PendingAction = 'submit' | 'cancel';

export function MrDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const tStatus = useTranslations('procurement.status');
  const locale = useLocale() as 'en' | 'ar';

  const mr = useMaterialRequest(id);
  const projects = useProjects();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const submit = useSubmitMaterialRequest();
  const cancel = useCancelMaterialRequest();

  if (mr.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tc('loadFailed')}</span>
        <div className="h-64 animate-pulse rounded-xl border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (mr.isError || !mr.data) {
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[tc('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/procurement/material-requests">{t('backToList')}</Link>
        </Button>
      </div>
    );
  }

  const request: MaterialRequest = mr.data;
  const projectName = projects.data?.find((p) => p.id === request.projectId)?.name ?? null;
  const isTerminal = request.status === 'CANCELLED' || request.status === 'CLOSED';
  const mutation = pending === 'submit' ? submit : cancel;

  const run = () => {
    mutation.mutate(id, { onSuccess: () => setPending(null) });
  };

  return (
    <div className="space-y-6">
      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/procurement/material-requests"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <ChevronStartIcon />
          {t('backToList')}
        </Link>
      </div>

      {/* ── Header card ───────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          {/* Top row: MR number + status + scope */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              {request.mrNumber}
            </span>
            <ProcurementStatusBadge status={request.status} />
            <Badge tone="neutral">
              {request.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization')}
            </Badge>
          </div>

          {/* Primary heading */}
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[28px]">
            {request.description ?? t('detailTitle', { number: request.mrNumber })}
          </h1>

          {/* Subtitle: project name */}
          {projectName ? (
            <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
          ) : null}
        </div>

        {/* Footer: lifecycle actions */}
        {!isTerminal ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border px-5 py-3 sm:px-6">
            {request.status === 'DRAFT' ? (
              <Button type="button" size="sm" onClick={() => setPending('submit')}>
                {t('submit')}
              </Button>
            ) : null}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(request.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPending('cancel')}
              >
                {t('cancelRequest')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Approval workflow chain ────────────────────────────────────────── */}
      <WorkflowChain instanceId={request.approvalInstanceId} status={request.status} />

      {/* ── Approval actions (approve / reject on the pending step) ───────── */}
      <ApprovalPanel
        instanceId={request.approvalInstanceId}
        transactionType={WorkflowTransactionType.MATERIAL_REQUEST}
      />

      {/* ── Status notices ────────────────────────────────────────────────── */}
      {request.status === 'PARTIALLY_ORDERED' ? (
        <Alert variant="info" messages={[t('partiallyOrderedNotice')]} />
      ) : null}

      {isTerminal ? (
        <Alert
          variant="info"
          messages={[t('terminalNotice', { status: tStatus(request.status) })]}
        />
      ) : null}

      {/* ── Context tile grid ─────────────────────────────────────────────── */}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-[var(--shadow-panel)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{tc('project')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {projectName ?? tc('notAvailable')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('scope')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {request.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('requestedDate')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {formatDate(request.requestedDate, locale) ?? tc('notAvailable')}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{t('requiredBy')}</dt>
          <dd className="mt-1.5 text-sm font-semibold text-foreground">
            {formatDate(request.requiredByDate, locale) ?? tc('notAvailable')}
          </dd>
        </div>
      </dl>

      {/* ── Notes ─────────────────────────────────────────────────────────── */}
      {request.notes ? (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
          <div className="border-b border-border px-5 py-3 sm:px-6">
            <h2 className="text-[13px] font-semibold text-foreground">{tc('notes')}</h2>
          </div>
          <p className="px-5 py-4 text-sm text-foreground sm:px-6">{request.notes}</p>
        </section>
      ) : null}

      {/* ── Lines table ───────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="border-b border-border px-5 py-3 sm:px-6">
          <h2 className="text-[13px] font-semibold text-foreground">{t('linesTitle')}</h2>
        </div>
        <TableScroll aria-label={t('linesTitle')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-end">{tc('lineNumber')}</TableHead>
                <TableHead>{tc('type')}</TableHead>
                <TableHead>{tc('material')}</TableHead>
                <TableHead>{tc('description')}</TableHead>
                <TableHead>{tc('uom')}</TableHead>
                <TableHead className="text-end">{t('requestedQuantity')}</TableHead>
                <TableHead className="text-end">{t('approvedQuantity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-end tabular-nums">{line.lineNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tType(line.lineType)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {line.material?.code ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm">{line.description}</TableCell>
                  <TableCell>
                    <bdi className="text-sm">{line.uom?.symbol ?? line.uom?.code ?? '—'}</bdi>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.requestedQuantity, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {formatNumber(line.approvedQuantity, locale) ?? tc('notAvailable')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </section>

      {/* ── Confirm dialogs ───────────────────────────────────────────────── */}
      {pending ? (
        <ConfirmActionDialog
          title={t(`${pending}Title`, { number: request.mrNumber })}
          description={t(`${pending}Body`)}
          confirmLabel={t(pending === 'cancel' ? 'cancelRequest' : pending)}
          isPending={mutation.isPending}
          errorMessage={mutation.isError ? tc('loadFailed') : undefined}
          onConfirm={run}
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Workflow Chain ────────────────────────────────────────────────────────────

type NodeState = 'complete' | 'active' | 'inactive';

function WorkflowChain({
  instanceId,
  status,
}: {
  instanceId: string | null;
  status: MaterialRequestStatus;
}) {
  const t = useTranslations('procurement.mr');
  const tCommon = useTranslations('common');

  const stepQuery = useApprovalStep(instanceId);
  const definition = useWorkflowDefinition(WorkflowTransactionType.MATERIAL_REQUEST);

  const isLoading = definition.isPending || (instanceId !== null && stepQuery.isPending);

  if (isLoading) {
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-3.5 w-36 animate-pulse rounded bg-muted" aria-hidden="true" />
          <div className="mt-4 flex items-center gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Fragment key={i}>
                <div className="h-7 w-7 flex-shrink-0 animate-pulse rounded-full bg-muted" />
                {i < 2 && <div className="h-0.5 flex-1 animate-pulse rounded bg-muted" />}
              </Fragment>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const sortedSteps = [...(definition.data?.steps ?? [])].sort(
    (a, b) => a.stepOrder - b.stepOrder,
  );

  if (sortedSteps.length === 0) return null;

  const current = stepQuery.data ?? null;
  const isTerminalPositive = (
    ['APPROVED', 'PARTIALLY_ORDERED', 'FULLY_ORDERED', 'CLOSED'] as MaterialRequestStatus[]
  ).includes(status);
  const isCancelled = status === 'CANCELLED';
  const isDraft = status === 'DRAFT';

  const getNodeState = (idx: number): NodeState => {
    if (isTerminalPositive) return 'complete';
    if (isCancelled || isDraft) return 'inactive';
    // SUBMITTED: position relative to current pending step
    if (!current) return 'complete'; // submitted but no pending step — chain resolved
    const currentIdx = sortedSteps.findIndex((s) => s.id === current.id);
    if (currentIdx === -1) return idx === 0 ? 'active' : 'inactive';
    if (idx < currentIdx) return 'complete';
    if (idx === currentIdx) return 'active';
    return 'inactive';
  };

  let caption: string;
  if (isDraft) {
    caption = t('workflowNotStarted');
  } else if (isTerminalPositive) {
    caption = t('workflowCompleted', { total: sortedSteps.length });
  } else if (isCancelled) {
    caption = t('workflowCancelled');
  } else if (current) {
    const pos = stepPosition(current, sortedSteps);
    caption = pos
      ? t('workflowPendingWithPosition', {
          position: pos.position,
          total: pos.total,
          role: current.roleRequired,
        })
      : t('workflowPending', { role: current.roleRequired });
  } else {
    caption = t('workflowCompleted', { total: sortedSteps.length });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
      <div className="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground">{t('workflowTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
        </div>

        <div
          className="flex items-start overflow-x-auto pb-1"
          role="list"
          aria-label={t('workflowTitle')}
        >
          {sortedSteps.map((defStep, idx) => {
            const nodeState = getNodeState(idx);
            const isLast = idx === sortedSteps.length - 1;

            return (
              <Fragment key={defStep.id}>
                {/* Node + role label */}
                <div className="flex flex-shrink-0 flex-col items-center gap-1.5" role="listitem">
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                      nodeState === 'complete' && 'bg-success text-white',
                      nodeState === 'active' &&
                        'bg-brand-primary text-white ring-4 ring-brand-primary/15',
                      nodeState === 'inactive' && 'border-2 border-border bg-surface',
                    )}
                  >
                    {nodeState === 'complete' && <CheckIcon />}
                    {nodeState === 'active' && (
                      <span className="h-2 w-2 rounded-full bg-white" aria-hidden="true" />
                    )}
                  </span>
                  <span className="max-w-[72px] truncate text-center text-[11px] font-medium leading-tight text-muted-foreground">
                    {defStep.roleRequired}
                  </span>
                </div>

                {/* Connector line */}
                {!isLast && (
                  <div
                    className={cn(
                      'mt-3.5 h-0.5 min-w-[1.5rem] flex-1 transition-colors',
                      nodeState === 'complete' ? 'bg-success/40' : 'bg-border',
                    )}
                    aria-hidden="true"
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        {!isDraft && !isCancelled ? (
          <p className="text-[11px] text-muted-foreground/60">{t('workflowProgressNote')}</p>
        ) : null}
      </div>
    </section>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
