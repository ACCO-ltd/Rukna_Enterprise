'use client';

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
import { useProjectWorkspaceSummary } from '@/features/projects/hooks/use-project';

import { useMaterialRequests } from '../hooks/use-procurement';
import { ProjectCommitmentsCard } from './commitments';
import { ProcurementStatusBadge } from './procurement-badges';

/**
 * Project Procurement tab (procurement-tab spec §1).
 *
 * A project-scoped read over the org-level procurement services: it leads with this project's
 * cost commitments (COMMITTED → ACCRUED → ACTUAL, ADR-013/020) and lists its Material Requests
 * (`projectId`-filtered). Purchase orders and goods receipts stay in the org buyer workspace —
 * they have no project filter server-side and are the cross-project queue by design — so the tab
 * links out for them. The consumption→cost step (issue material to site) arrives with Inventory.
 */
export function ProjectProcurementTab({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.projectTab');
  const tMr = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const summary = useProjectWorkspaceSummary(projectId);
  const currency = summary.data?.mainContract?.currency ?? null;
  const requests = useMaterialRequests({ projectId });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h2 font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ProjectCommitmentsCard projectId={projectId} currencyCode={currency} />

      {/* Material Requests — this project only */}
      <section className="overflow-hidden rounded-panel border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h3 className="text-body-sm font-semibold text-foreground">{tMr('title')}</h3>
          {can(PROCUREMENT_PERMISSIONS.createRequest) ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/procurement/requests/new">{tMr('new')}</Link>
            </Button>
          ) : null}
        </div>

        {requests.isPending ? (
          <div role="status" aria-live="polite" className="p-5">
            <span className="sr-only">{tCommon('loading')}</span>
            <div className="h-24 animate-pulse rounded-control bg-muted" aria-hidden="true" />
          </div>
        ) : requests.isError ? (
          <div className="p-5">
            <Alert variant="error" messages={[tc('loadFailed')]} />
          </div>
        ) : (
          <TableScroll aria-label={tMr('title')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tMr('number')}</TableHead>
                  <TableHead>{tc('description')}</TableHead>
                  <TableHead>{tMr('requestedDate')}</TableHead>
                  <TableHead numeric>{tc('lines')}</TableHead>
                  <TableHead>{tc('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={5}>{t('mrEmpty')}</TableEmpty>
                ) : (
                  (requests.data ?? []).map((mr) => (
                    <TableRow key={mr.id}>
                      <TableCell>
                        <Link
                          href={`/procurement/requests/${mr.id}`}
                          className="font-mono text-xs font-semibold text-brand-primary underline-offset-2 hover:underline"
                        >
                          {mr.mrNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[18rem]">
                        {mr.description ? (
                          <span className="block truncate text-sm text-foreground">
                            {mr.description}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {mr.requestScope === 'PROJECT'
                              ? tMr('scopeProject')
                              : tMr('scopeOrganization')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <bdi>{formatDate(mr.requestedDate, locale) ?? tc('notAvailable')}</bdi>
                      </TableCell>
                      <TableCell numeric className="text-sm tabular-nums text-muted-foreground">
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
        )}
      </section>

      {/* Where the rest of procurement lives + the honest open loop */}
      <div className="rounded-panel border border-dashed border-border bg-surface px-5 py-4">
        <p className="text-body-sm font-medium text-foreground">{t('elsewhereTitle')}</p>
        <p className="mt-1 text-caption text-muted-foreground">{t('elsewhereHint')}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link
            href="/procurement/orders"
            className="text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('ordersLink')} →
          </Link>
          <Link
            href="/procurement/grn"
            className="text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('grnLink')} →
          </Link>
        </div>
        <p className="mt-3 text-caption text-muted-foreground">{t('inventoryNote')}</p>
      </div>
    </div>
  );
}
