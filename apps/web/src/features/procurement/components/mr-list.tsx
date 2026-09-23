'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, FilterBar, FilterField, Select } from '@erp/ui';

import { formatDate } from '@/lib/format';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';

import { useMaterialRequests } from '../hooks/use-procurement';
import type { MaterialRequest, MaterialRequestScope, MaterialRequestStatus } from '../types';
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
 * `PlatformDataGrid`'s own text search and sort layer on top of that server-filtered set.
 */
export function MrList() {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
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

  const description = (mr: MaterialRequest) =>
    mr.description ?? (mr.requestScope === 'PROJECT' ? t('scopeProject') : t('scopeOrganization'));

  const columns: GridColumn<MaterialRequest>[] = [
    {
      key: 'number',
      header: t('number'),
      sticky: true,
      sortable: true,
      plainValue: (mr) => mr.mrNumber,
      render: (mr) => <span className="font-mono text-caption font-semibold">{mr.mrNumber}</span>,
    },
    {
      key: 'description',
      header: tc('description'),
      sortable: true,
      plainValue: (mr) => description(mr),
      render: (mr) => (
        <span className="block max-w-[18rem] truncate">{description(mr)}</span>
      ),
    },
    {
      key: 'project',
      header: tc('project'),
      sortable: true,
      plainValue: (mr) => projectName(mr.projectId) ?? '',
      render: (mr) => projectName(mr.projectId) ?? tc('notAvailable'),
    },
    {
      key: 'requestedDate',
      header: t('requestedDate'),
      sortable: true,
      plainValue: (mr) => mr.requestedDate,
      render: (mr, ctx) => <bdi>{formatDate(mr.requestedDate, ctx.locale) ?? tc('notAvailable')}</bdi>,
    },
    {
      key: 'requiredBy',
      header: t('requiredBy'),
      sortable: true,
      plainValue: (mr) => mr.requiredByDate ?? '',
      render: (mr, ctx) => <bdi>{formatDate(mr.requiredByDate, ctx.locale) ?? tc('notAvailable')}</bdi>,
    },
    {
      key: 'lines',
      header: tc('lines'),
      numeric: true,
      sortable: true,
      plainValue: (mr) => mr.lines?.length ?? 0,
      render: (mr) => mr.lines?.length ?? 0,
    },
    {
      key: 'status',
      header: tc('status'),
      render: (mr) => <ProcurementStatusBadge status={mr.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
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

      {requests.isError ? <Alert variant="error" messages={[tc('loadFailed')]} /> : null}

      <PlatformDataGrid
        columns={columns}
        data={requests.data ?? []}
        rowKey={(mr) => mr.id}
        label={t('title')}
        isLoading={requests.isPending}
        rowHref={(mr) => `/procurement/requests/${mr.id}`}
        noMatchMessage={t('empty')}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id={ids.status} label={tc('status')}>
              <Select
                id={ids.status}
                value={status}
                onChange={(value) => setStatus(value as MaterialRequestStatus | '')}
              >
                <option value="">{tc('all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </Select>
            </FilterField>

            <FilterField id={ids.scope} label={t('scope')}>
              <Select
                id={ids.scope}
                value={scope}
                onChange={(value) => setScope(value as MaterialRequestScope | '')}
              >
                <option value="">{tc('all')}</option>
                <option value="PROJECT">{t('scopeProject')}</option>
                <option value="ORGANIZATION">{t('scopeOrganization')}</option>
              </Select>
            </FilterField>

            <FilterField id={ids.project} label={tc('project')}>
              <Select id={ids.project} value={projectId} onChange={(value) => setProjectId(value)}>
                <option value="">{tc('all')}</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => {
          setStatus('');
          setScope('');
          setProjectId('');
        }}
      />
    </div>
  );
}
