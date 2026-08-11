'use client';

/**
 * Material request detail and lifecycle (§12.5).
 *
 * §12.5's action table offers Close on `APPROVED` and on `PARTIALLY_ORDERED`. There is no
 * close endpoint (P4): `NEXT_STATUS` in `material-request.service.ts` permits the
 * transition and no controller route reaches it, so `CLOSED` is unreachable over HTTP.
 * The button is not rendered, and the screen says why rather than leaving a request in a
 * state with no explicable dead end — `PARTIALLY_ORDERED` has no available action at all.
 */

import { useState } from 'react';
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
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatDate, formatNumber } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';

import {
  useApproveMaterialRequest,
  useCancelMaterialRequest,
  useMaterialRequest,
  useSubmitMaterialRequest,
} from '../hooks/use-procurement';
import type { MaterialRequest } from '../types';
import { WorkflowTransactionType } from '@erp/types';
import { ApprovalPanel } from '@/features/workflows/components/approval-panel';
import { ProcurementStatusBadge } from './procurement-badges';

type PendingAction = 'submit' | 'approve' | 'cancel';

export function MrDetail({ id }: { id: string }) {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const tStatus = useTranslations('procurement.status');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const mr = useMaterialRequest(id);
  const projects = useProjects();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const submit = useSubmitMaterialRequest();
  const approve = useApproveMaterialRequest();
  const cancel = useCancelMaterialRequest();

  if (mr.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tc('loadFailed')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (mr.isError || !mr.data) {
    return <Alert variant="error" messages={[tc('loadFailed')]} />;
  }

  const request: MaterialRequest = mr.data;
  const projectName =
    projects.data?.find((p) => p.id === request.projectId)?.name ?? null;

  const isTerminal = request.status === 'CANCELLED' || request.status === 'CLOSED';
  const mutation = { submit, approve, cancel }[pending ?? 'submit'];

  const run = () => {
    const action = { submit, approve, cancel }[pending!];
    action.mutate(id, { onSuccess: () => setPending(null) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('detailTitle', { number: request.mrNumber })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ProcurementStatusBadge status={request.status} />
            <Badge tone="neutral">
              {request.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization')}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {request.status === 'DRAFT' ? (
            <Button type="button" onClick={() => setPending('submit')}>
              {t('submit')}
            </Button>
          ) : null}

          {request.status === 'SUBMITTED' && can(PROCUREMENT_PERMISSIONS.approveRequest) ? (
            <Button type="button" onClick={() => setPending('approve')}>
              {t('approve')}
            </Button>
          ) : null}

          {/* CANCELLED is reachable from DRAFT, SUBMITTED and APPROVED — but not from
              PARTIALLY_ORDERED, whose only documented exit is a close that has no
              endpoint (P4). */}
          {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(request.status) ? (
            <Button type="button" variant="destructive" onClick={() => setPending('cancel')}>
              {t('cancelRequest')}
            </Button>
          ) : null}
        </div>
      </div>

      <ApprovalPanel
        instanceId={request.approvalInstanceId}
        transactionType={WorkflowTransactionType.MATERIAL_REQUEST}
      />

      {isTerminal ? (
        <Alert
          variant="info"
          messages={[t('terminalNotice', { status: tStatus(request.status) })]}
        />
      ) : null}

      {request.status === 'PARTIALLY_ORDERED' ? (
        <Alert variant="warning" messages={[t('partiallyOrderedNotice')]} />
      ) : null}

      {request.status === 'APPROVED' ? (
        <Alert variant="info" messages={[t('noCloseAction')]} />
      ) : null}

      <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={tc('project')} value={projectName ?? tc('notAvailable')} />
        <Field
          label={t('requestedDate')}
          value={formatDate(request.requestedDate, locale) ?? tc('notAvailable')}
        />
        <Field
          label={t('requiredBy')}
          value={formatDate(request.requiredByDate, locale) ?? tc('notAvailable')}
        />
        <Field label={tc('description')} value={request.description ?? tc('notAvailable')} />
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">{t('linesTitle')}</h2>

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
