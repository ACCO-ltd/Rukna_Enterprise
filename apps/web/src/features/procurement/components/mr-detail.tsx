'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { formatDate, formatNumber } from '@/lib/format';
import { useProjects } from '@/features/projects/hooks/use-projects';

import { stepPosition } from '@/features/workflows/approval-actions';
import { useApprovalStep } from '@/features/workflows/hooks/use-approval';
import { useWorkflowDefinition } from '@/features/workflows/hooks/use-workflow-definition';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';

import {
  useApproveMaterialRequest,
  useCancelMaterialRequest,
  useMaterialRequest,
  useRejectMaterialRequest,
  useSubmitMaterialRequest,
} from '../hooks/use-procurement';
import type { MaterialRequest, MaterialRequestStatus } from '../types';
import { MrRejectDialog } from './mr-reject-dialog';
import { ProcurementStatusBadge } from './procurement-badges';

type PendingAction = 'submit' | 'cancel' | 'approve';

/** A 409 carrying an approvalInstanceId is the DoA gate, not a failure (ADR-015). */
function gateInstanceId(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409
    ? ((error.details?.approvalInstanceId as string | undefined) ?? null)
    : null;
}

export function MrDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const tStatus = useTranslations('procurement.status');
  const locale = useLocale() as 'en' | 'ar';

  const mr = useMaterialRequest(id);
  useModuleTrail(mr.data?.mrNumber);
  const projects = useProjects();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [rejecting, setRejecting] = useState(false);
  // Set when submit was routed for approval (409): the panel shows and "Complete submission"
  // calls submit again once approvers have acted.
  const [gatedInstanceId, setGatedInstanceId] = useState<string | null>(null);
  const { can } = usePermissions();

  const submit = useSubmitMaterialRequest();
  const cancel = useCancelMaterialRequest();
  const approve = useApproveMaterialRequest();
  const reject = useRejectMaterialRequest();

  if (mr.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tc('loadFailed')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (mr.isError || !mr.data) {
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[tc('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/procurement/requests">{t('backToList')}</Link>
        </Button>
      </div>
    );
  }

  const request: MaterialRequest = mr.data;
  const projectName = projects.data?.find((p) => p.id === request.projectId)?.name ?? null;
  const isTerminal = request.status === 'CANCELLED' || request.status === 'CLOSED';
  const mutation = pending === 'submit' ? submit : pending === 'approve' ? approve : cancel;
  const mayApprove = request.status === 'SUBMITTED' && can(PROCUREMENT_PERMISSIONS.approveRequest);

  const run = () => {
    mutation.mutate(id, {
      onSuccess: () => {
        setPending(null);
        setGatedInstanceId(null);
      },
      onError: (error) => {
        const instanceId = pending === 'submit' ? gateInstanceId(error) : null;
        if (instanceId) {
          setGatedInstanceId(instanceId);
          setPending(null);
          mutation.reset();
        }
      },
    });
  };

  /** The server's refusal in words — the own-request rule gets its own sentence. */
  const errorFor = (error: unknown): string | undefined => {
    if (!error) return undefined;
    if (error instanceof ApiError && error.details?.code === 'REQUESTER_CANNOT_APPROVE_OWN_REQUEST') {
      return t('approveOwnRequest');
    }
    return error instanceof ApiError && error.message ? error.message : tc('loadFailed');
  };

  return (
    <div className="space-y-6">
      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/procurement/requests"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <ChevronStartIcon />
          {t('backToList')}
        </Link>
      </div>

      {/* ── Header card ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent>
          {/* Top row: MR number + status + scope */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-muted-foreground">
              {request.mrNumber}
            </span>
            <ProcurementStatusBadge vocabulary="materialRequest" status={request.status} />
            <Badge tone="neutral">
              {request.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization')}
            </Badge>
          </div>

          {/* Primary heading: the request's short title — what the list shows — then the
              longer description for older requests raised before titles existed. */}
          <h2 className="mt-2 text-h1 font-bold text-foreground">
            {request.title?.trim() || request.description || t('detailTitle', { number: request.mrNumber })}
          </h2>

          {/* Subtitle: project name */}
          {projectName ? (
            <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
          ) : null}

          {/* The justification, when the heading is the title rather than the description. */}
          {request.title?.trim() && request.description ? (
            <p className="mt-2 max-w-prose text-sm text-foreground">{request.description}</p>
          ) : null}
        </CardContent>

        {/* Footer: lifecycle actions */}
        {!isTerminal ? (
          <CardFooter className="flex-row flex-wrap justify-start border-t border-border pt-4 sm:flex-row sm:justify-start">
            {request.status === 'DRAFT' ? (
              <Button type="button" size="sm" onClick={() => setPending('submit')}>
                {t('submit')}
              </Button>
            ) : null}
            {mayApprove ? (
              <>
                <Button type="button" size="sm" onClick={() => setPending('approve')}>
                  {t('approve')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(true)}>
                  {t('reject.action')}
                </Button>
              </>
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
          </CardFooter>
        ) : null}
      </Card>

      {/* ── Submit routed for approval (409 gate) ──────────────────────────── */}
      {gatedInstanceId && request.status === 'DRAFT' ? (
        <Card>
          <CardContent className="space-y-3">
            <Alert variant="info" messages={[t('submitAwaitingApproval')]} />
            <ApprovalPanel instanceId={gatedInstanceId} transactionType={WorkflowTransactionType.MATERIAL_REQUEST} />
            <div className="border-t border-border pt-3">
              <Button type="button" loading={submit.isPending} onClick={() => setPending('submit')}>
                {t('completeSubmit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
      <dl className="grid gap-px overflow-hidden rounded-panel border border-border bg-border shadow-e2 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border py-4">
            <CardTitle className="text-h3">{tc('notes')}</CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            <p className="text-sm text-foreground">{request.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Lines table ───────────────────────────────────────────────────── */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-4">
          <CardTitle className="text-h3">{t('linesTitle')}</CardTitle>
        </CardHeader>
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
      </Card>

      {/* ── Confirm dialogs ───────────────────────────────────────────────── */}
      {pending ? (
        <ConfirmActionDialog
          title={t(`${pending}Title`, { number: request.mrNumber })}
          description={t(`${pending}Body`)}
          confirmLabel={t(pending === 'cancel' ? 'cancelRequest' : pending)}
          isPending={mutation.isPending}
          errorMessage={errorFor(mutation.error)}
          onConfirm={run}
          onDismiss={() => {
            mutation.reset();
            setPending(null);
          }}
        />
      ) : null}

      {rejecting ? (
        <MrRejectDialog
          number={request.mrNumber}
          busy={reject.isPending}
          error={reject.error ? (errorFor(reject.error) ?? null) : null}
          onReject={(reason) => reject.mutate({ id, reason }, { onSuccess: () => setRejecting(false) })}
          onClose={() => {
            reject.reset();
            setRejecting(false);
          }}
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
  // A request with no approval instance went through no workflow — the governance binding
  // gates submit and records the instance. Without one there is no chain to draw, and the
  // definition read would only 404 for an organization that has none configured.
  const hasWorkflow = instanceId !== null;
  const definition = useWorkflowDefinition(WorkflowTransactionType.MATERIAL_REQUEST, {
    enabled: hasWorkflow,
  });

  if (!hasWorkflow) return null;

  const isLoading = definition.isPending || stepQuery.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-3.5 w-36 animate-pulse rounded bg-muted" aria-hidden="true" />
          <div className="mt-4 flex items-center gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Fragment key={i}>
                <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
                {i < 2 && <div className="h-0.5 flex-1 animate-pulse rounded bg-muted" />}
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('workflowTitle')}</CardTitle>
          <CardDescription>{caption}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
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
                <div className="flex shrink-0 flex-col items-center gap-1.5" role="listitem">
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
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
                  <span className="max-w-18 truncate text-center text-micro font-medium leading-tight text-muted-foreground">
                    {defStep.roleRequired}
                  </span>
                </div>

                {/* Connector line */}
                {!isLast && (
                  <div
                    className={cn(
                      'mt-3.5 h-0.5 min-w-6 flex-1 transition-colors',
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
          <p className="text-micro text-muted-foreground/60">{t('workflowProgressNote')}</p>
        ) : null}
      </CardContent>
    </Card>
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
