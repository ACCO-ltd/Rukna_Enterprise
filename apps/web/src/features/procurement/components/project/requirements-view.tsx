'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, ExternalLink } from 'lucide-react';
import {
  Alert,
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
  type BadgeTone,
} from '@erp/ui';
import type { ProjectRequirementRow, ProjectRequirementsResponse } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';

import { useProjectRequirements } from '../../hooks/use-project-procurement';
import { RaiseRequirementButton } from './procurement-overview-view';
import { SectionPanel } from './section-panel';

/**
 * Project requirements — what the site needs.
 *
 * This is the one part of procurement the project genuinely owns, so it is the one place with a
 * primary action. Ordering is the buyer's job and happens in their workspace; a request that has
 * reached a purchase order links out rather than pretending to operate it.
 */
export function RequirementsView({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.project.requirements');
  const query = useProjectRequirements(projectId);

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[t('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }

  const data = query.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-h3 font-semibold text-foreground">{t('title')}</h3>
          <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <RaiseRequirementButton canRaise={data.capabilities.canRaiseRequirement} />
      </div>

      <SummaryBand data={data} />

      {data.requirements.length === 0 ? (
        <EmptyState
          variant="page"
          icon={<ClipboardList size={24} aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
        />
      ) : (
        <SectionPanel title={t('listTitle')} bodyClassName="px-0 py-0">
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.mr')}</TableHead>
                  <TableHead>{t('col.requirement')}</TableHead>
                  <TableHead>{t('col.category')}</TableHead>
                  <TableHead>{t('col.requested')}</TableHead>
                  <TableHead>{t('col.priority')}</TableHead>
                  {/* Two columns, not one. Approval and fulfilment are different questions, and a
                      single "Status" answers neither cleanly — the same discipline as PO header
                      state versus revision lifecycle. */}
                  <TableHead>{t('col.approval')}</TableHead>
                  <TableHead>{t('col.fulfilment')}</TableHead>
                  <TableHead className="text-end">{t('col.estimated')}</TableHead>
                  <TableHead className="text-end">{t('col.ordered')}</TableHead>
                  <TableHead className="text-end">{t('col.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.requirements.map((row) => (
                  <RequirementRow key={row.id} row={row} canOpen={data.capabilities.canRaiseRequirement} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
            {t('valueBasisNote')}
          </p>
        </SectionPanel>
      )}
    </div>
  );
}

function SummaryBand({ data }: { data: ProjectRequirementsResponse }) {
  const t = useTranslations('procurement.project.requirements');
  const { summary } = data;
  const cells = [
    { key: 'total', value: summary.total },
    { key: 'approved', value: summary.approved },
    { key: 'partiallyOrdered', value: summary.partiallyOrdered },
    { key: 'ordered', value: summary.ordered },
    { key: 'draftOrOther', value: summary.draftOrOther },
  ];

  return (
    <dl className="grid grid-cols-1 overflow-hidden rounded-panel border border-border bg-surface sm:grid-cols-3 xl:grid-cols-5">
      {cells.map((cell) => (
        <div
          key={cell.key}
          className="border-b border-border px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:not-last:border-e"
        >
          <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t(`summary.${cell.key}`)}
          </dt>
          <dd className="mt-1.5 text-h2 font-bold tabular-nums text-foreground">{cell.value}</dd>
          <dd className="mt-1 text-caption text-muted-foreground">{t(`summaryHint.${cell.key}`)}</dd>
        </div>
      ))}
    </dl>
  );
}

const APPROVAL_TONE: Record<ProjectRequirementRow['approvalStatus'], BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'live',
  CANCELLED: 'historical',
  CLOSED: 'historical',
};

const FULFILMENT_TONE: Record<ProjectRequirementRow['fulfillmentStatus'], BadgeTone> = {
  NOT_ORDERED: 'neutral',
  PARTIALLY_ORDERED: 'warning',
  FULLY_ORDERED: 'live',
};

const PRIORITY_TONE: Record<ProjectRequirementRow['priority'], BadgeTone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
};

function RequirementRow({ row, canOpen }: { row: ProjectRequirementRow; canOpen: boolean }) {
  const t = useTranslations('procurement.project.requirements');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-mono text-caption text-muted-foreground">
        {row.mrNumber}
      </TableCell>
      <TableCell className="max-w-72">
        <span className="block truncate font-medium text-foreground">
          {row.title ?? row.description ?? t('untitled')}
        </span>
        {row.title && row.description ? (
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            {row.description}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-caption text-muted-foreground">{row.category ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(row.requestedDate, locale) ?? '—'}
        {row.requiredByDate ? (
          <span className="block text-micro text-muted-foreground">
            {t('requiredBy', { date: formatDate(row.requiredByDate, locale) ?? '' })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        {/* NORMAL is the default and says nothing; a badge on every row would be noise. */}
        {row.priority === 'NORMAL' || row.priority === 'LOW' ? (
          <span className="text-caption text-muted-foreground">{t(`priority.${row.priority}`)}</span>
        ) : (
          <Badge tone={PRIORITY_TONE[row.priority]}>{t(`priority.${row.priority}`)}</Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge tone={APPROVAL_TONE[row.approvalStatus]}>
          {t(`approval.${row.approvalStatus}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge tone={FULFILMENT_TONE[row.fulfillmentStatus]}>
          {t(`fulfilment.${row.fulfillmentStatus}`)}
        </Badge>
      </TableCell>
      {/* The requester's estimate — what ADR-022 routes approval on. Not a commitment. */}
      <TableCell className="text-end tabular-nums text-muted-foreground">
        {row.estimatedValue === null ? (
          <span title={t('noEstimateHint')}>—</span>
        ) : (
          <LtrValue>{formatMoney(row.estimatedValue, row.currencyCode, locale) ?? '—'}</LtrValue>
        )}
      </TableCell>
      {/* Real money: allocated quantity at the price a buyer agreed. A different basis, so the
          two are never subtracted into a "saving". */}
      <TableCell className="text-end tabular-nums">
        <LtrValue>{formatMoney(row.orderedValue, row.currencyCode, locale) ?? '—'}</LtrValue>
        {row.purchaseOrderCount > 0 ? (
          <span className="block text-micro text-muted-foreground">
            {t('acrossOrders', { n: row.purchaseOrderCount })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-end">
        {canOpen ? (
          <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-0">
            <Link href={`/procurement/requests/${row.id}`}>
              {t('open')}
              <ExternalLink size={13} aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
