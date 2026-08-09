'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';

import { useMaterialRequests } from '../hooks/use-procurement';
import type { MaterialRequestScope, MaterialRequestStatus } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';

const STATUSES: MaterialRequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_ORDERED',
  'FULLY_ORDERED',
  'CANCELLED',
  'CLOSED',
];

/**
 * Material request list (§12.5).
 *
 * All three filters are server-side — `status`, `projectId` and `scope` are exactly what
 * `material-request.controller.ts` reads, so nothing is filtered in the browser here.
 */
export function MrList() {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const [status, setStatus] = useState<MaterialRequestStatus | ''>('');
  const [scope, setScope] = useState<MaterialRequestScope | ''>('');
  const [projectId, setProjectId] = useState('');

  const ids = { status: useId(), scope: useId(), project: useId() };

  const requests = useMaterialRequests({
    ...(status ? { status } : {}),
    ...(scope ? { scope } : {}),
    ...(projectId ? { projectId } : {}),
  });
  const projects = useProjects();

  const projectName = (id: string | null) =>
    projects.data?.find((p) => p.id === id)?.name ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {can(PROCUREMENT_PERMISSIONS.createRequest) ? (
          <Button asChild>
            <Link href="/procurement/requests/new">{t('new')}</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-44 flex-1">
          <label htmlFor={ids.status} className="mb-1 block text-xs font-medium text-muted-foreground">
            {tc('status')}
          </label>
          <select
            id={ids.status}
            value={status}
            onChange={(e) => setStatus(e.target.value as MaterialRequestStatus | '')}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{tc('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-44 flex-1">
          <label htmlFor={ids.scope} className="mb-1 block text-xs font-medium text-muted-foreground">
            {t('scope')}
          </label>
          <select
            id={ids.scope}
            value={scope}
            onChange={(e) => setScope(e.target.value as MaterialRequestScope | '')}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{tc('all')}</option>
            <option value="PROJECT">{t('scopeProject')}</option>
            <option value="ORGANIZATION">{t('scopeOrganization')}</option>
          </select>
        </div>

        <div className="min-w-44 flex-1">
          <label htmlFor={ids.project} className="mb-1 block text-xs font-medium text-muted-foreground">
            {tc('project')}
          </label>
          <select
            id={ids.project}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="">{tc('all')}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {requests.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <TableScroll aria-label={t('title')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('number')}</TableHead>
              <TableHead>{t('scope')}</TableHead>
              <TableHead>{tc('project')}</TableHead>
              <TableHead>{t('requestedDate')}</TableHead>
              <TableHead>{t('requiredBy')}</TableHead>
              <TableHead className="text-end">{tc('lines')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(requests.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>{t('empty')}</TableEmpty>
            ) : (
              (requests.data ?? []).map((mr) => (
                <TableRow key={mr.id}>
                  <TableCell>
                    <Link
                      href={`/procurement/requests/${mr.id}`}
                      className="font-mono text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
                    >
                      {mr.mrNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {mr.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {projectName(mr.projectId) ?? tc('notAvailable')}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(mr.requestedDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <bdi>{formatDate(mr.requiredByDate, locale) ?? tc('notAvailable')}</bdi>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums text-muted-foreground">
                    {mr.lines?.length ?? 0}
                  </TableCell>
                  <TableCell>
                    <ProcurementStatusBadge status={mr.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}
