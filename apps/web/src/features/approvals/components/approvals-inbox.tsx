'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { cn, EmptyState, SavedViews } from '@erp/ui';
import type { ApprovalItem, ApprovalItemKind } from '@erp/types';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { approvalHref, daysWaiting } from '../approval-href';
import { useApprovalsInbox } from '../hooks';

type Area = 'all' | 'finance' | 'procurement' | 'site';
const AREA_OF: Record<ApprovalItemKind, Exclude<Area, 'all'>> = {
  INVOICE: 'finance',
  JOURNAL: 'finance',
  BILL: 'finance',
  PAYMENT: 'finance',
  WRITE_OFF: 'finance',
  REFUND: 'finance',
  TRANSFER: 'finance',
  QUOTATION: 'finance',
  MATERIAL_REQUEST: 'procurement',
  WORKFLOW: 'procurement',
  PROGRESS_REPORT: 'site',
};
/** Waiting longer than this reads as late. */
const LATE_AFTER_DAYS = 3;

/**
 * Step 3 (ADR-049, ADR-047 §4 "one Approvals tab with a count") — every decision waiting on the
 * reader, across finance, procurement and site, oldest first. Each row opens the document's own
 * page, where the decision is made with its full context; the inbox never approves blind.
 */
export function ApprovalsInbox() {
  const t = useTranslations('platform.approvals');
  const inbox = useApprovalsInbox();
  const [area, setArea] = useState<Area>('all');

  const all = useMemo(() => inbox.data?.items ?? [], [inbox.data]);
  const visible = area === 'all' ? all : all.filter((item) => AREA_OF[item.kind] === area);
  const countIn = (a: Area) => (a === 'all' ? all.length : all.filter((item) => AREA_OF[item.kind] === a).length);
  const late = all.filter((item) => daysWaiting(item.waitingSince) > LATE_AFTER_DAYS).length;

  const kindLabel = (item: ApprovalItem) => t(`kind.${item.kind}`);

  const columns: GridColumn<ApprovalItem>[] = [
    {
      key: 'item',
      header: t('colItem'),
      sticky: true,
      card: 'title',
      plainValue: (item) => `${kindLabel(item)} ${item.title} ${item.detail ?? ''}`,
      render: (item) => (
        <span className="block min-w-0">
          <span className="block text-micro font-semibold uppercase tracking-wider text-muted-foreground">
            {kindLabel(item)}
          </span>
          <span className="block font-medium text-foreground">{item.title}</span>
          {item.detail ? <span className="block truncate text-caption text-muted-foreground">{item.detail}</span> : null}
        </span>
      ),
    },
    {
      key: 'project',
      header: t('colProject'),
      card: 'subtitle',
      plainValue: (item) => item.projectName ?? '',
      render: (item) => item.projectName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'requestedBy',
      header: t('colRequestedBy'),
      card: 'meta',
      plainValue: (item) => item.requestedByName ?? '',
      render: (item) => item.requestedByName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'waiting',
      header: t('colWaiting'),
      sortable: true,
      plainValue: (item) => -daysWaiting(item.waitingSince),
      render: (item) => {
        const days = daysWaiting(item.waitingSince);
        return (
          <span className={cn('tabular-nums', days > LATE_AFTER_DAYS ? 'font-semibold text-warning' : 'text-muted-foreground')}>
            {days === 0 ? t('today') : t('days', { count: days })}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      card: 'amount',
      plainValue: (item) => (item.amount === null ? null : Number(item.amount)),
      render: (item) =>
        item.amount === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatMoney(item.amount, item.currencyCode) ?? item.amount}</span>
        ),
    },
  ];

  const areas: Area[] = ['all', 'finance', 'procurement', 'site'];

  return (
    <div className="space-y-6">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={
          inbox.data
            ? all.length === 0
              ? t('summaryNone')
              : late > 0
                ? t('summaryLate', { count: all.length, late })
                : t('summary', { count: all.length })
            : undefined
        }
      />
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(item) => `${item.kind}:${item.id}`}
        label={t('title')}
        isLoading={inbox.isPending}
        isError={inbox.isError}
        errorMessage={t('loadFailed')}
        onRetry={() => void inbox.refetch()}
        rowHref={(item) => approvalHref(item) ?? undefined}
        savedViews={
          <SavedViews
            label={t('areasLabel')}
            activeId={area}
            onSelect={setArea}
            views={areas.map((a) => ({ id: a, label: t(`area.${a}`), count: countIn(a) }))}
          />
        }
        emptyState={
          all.length === 0 ? (
            <EmptyState
              icon={<Inbox size={20} aria-hidden="true" />}
              title={t('emptyTitle')}
              description={t('emptyHint')}
            />
          ) : undefined
        }
        noMatchMessage={t('noneInArea')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
      />
    </div>
  );
}
