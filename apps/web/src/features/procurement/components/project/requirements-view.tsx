'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, Search } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Input,
  LtrValue,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import type { ProjectRequirementRow, ProjectRequirementsResponse } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';

import {
  EMPTY_REQUIREMENT_FILTERS,
  filterRequirements,
  hasActiveFilters,
  requirementCategoryOptions,
  type RequirementFilters,
} from '../../filter-requirements';
import { useProjectRequirements } from '../../hooks/use-project-procurement';
import { RaiseRequirementButton } from './procurement-overview-view';
import { RequirementDetailDialog } from './requirement-detail-dialog';
import { APPROVAL_TONE, FULFILMENT_TONE, PRIORITY_TONE } from './requirement-tones';
import { SectionPanel } from './section-panel';

const APPROVAL_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED', 'CLOSED'] as const;
const FULFILMENT_STATUSES = ['NOT_ORDERED', 'PARTIALLY_ORDERED', 'FULLY_ORDERED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

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
  const [filters, setFilters] = React.useState<RequirementFilters>(EMPTY_REQUIREMENT_FILTERS);
  const [openId, setOpenId] = React.useState<string | null>(null);

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
  const filtered = filterRequirements(data.requirements, filters);

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
        <SectionPanel
          title={t('listTitle')}
          description={
            filtered.length === data.requirements.length
              ? undefined
              : t('showingFiltered', { shown: filtered.length, total: data.requirements.length })
          }
          action={
            hasActiveFilters(filters) ? (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={() => setFilters(EMPTY_REQUIREMENT_FILTERS)}
              >
                {t('clearFilters')}
              </Button>
            ) : null
          }
          bodyClassName="px-0 py-0"
        >
          <FilterBar
            filters={filters}
            onChange={setFilters}
            categories={requirementCategoryOptions(data.requirements)}
          />
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-body-sm text-muted-foreground sm:px-5">
              {t('noMatches')}
            </p>
          ) : (
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
                {filtered.map((row) => (
                  <RequirementRow key={row.id} row={row} onOpen={() => setOpenId(row.id)} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          )}
          <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
            {t('valueBasisNote')}
          </p>
        </SectionPanel>
      )}

      {openId ? (
        <RequirementDetailDialog
          projectId={projectId}
          requirementId={openId}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Five filters, and approval and fulfilment stay apart.
 *
 * Merging them would make "approved, and nobody has ordered it" — the most operationally urgent
 * set on this screen — impossible to select.
 */
function FilterBar({
  filters,
  onChange,
  categories,
}: {
  filters: RequirementFilters;
  onChange: (next: RequirementFilters) => void;
  categories: string[];
}) {
  const t = useTranslations('procurement.project.requirements');
  const searchId = React.useId();
  const set = (patch: Partial<RequirementFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
      <div className="relative w-full sm:w-auto sm:min-w-56 sm:flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <label className="sr-only" htmlFor={searchId}>
          {t('searchLabel')}
        </label>
        <Input
          id={searchId}
          value={filters.search}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => set({ search: e.target.value })}
          className="ps-9"
        />
      </div>

      <Select
        aria-label={t('col.approval')}
        value={filters.approvalStatus}
        onChange={(value) => set({ approvalStatus: value })}
        className="w-full sm:w-44"
      >
        <option value="">{t('allApproval')}</option>
        {APPROVAL_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`approval.${value}`)}
          </option>
        ))}
      </Select>

      <Select
        aria-label={t('col.fulfilment')}
        value={filters.fulfillmentStatus}
        onChange={(value) => set({ fulfillmentStatus: value })}
        className="w-full sm:w-48"
      >
        <option value="">{t('allFulfilment')}</option>
        {FULFILMENT_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`fulfilment.${value}`)}
          </option>
        ))}
      </Select>

      {/* Only the categories present in the data — a filter offering values that match nothing
          is a dead end. */}
      {categories.length > 0 ? (
        <Select
          aria-label={t('col.category')}
          value={filters.category}
          onChange={(value) => set({ category: value })}
          className="w-full sm:w-40"
        >
          <option value="">{t('allCategories')}</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        aria-label={t('col.priority')}
        value={filters.priority}
        onChange={(value) => set({ priority: value })}
        className="w-full sm:w-36"
      >
        <option value="">{t('allPriorities')}</option>
        {PRIORITIES.map((value) => (
          <option key={value} value={value}>
            {t(`priority.${value}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function SummaryBand({ data }: { data: ProjectRequirementsResponse }) {
  const t = useTranslations('procurement.project.requirements');
  const { summary } = data;
  // One total, then the fulfilment ladder. "Draft or closed" is gone: a draft and a closed
  // request share nothing operationally, and one bucket for both was a count nobody could act on.
  const cells = [
    { key: 'total', value: summary.total },
    { key: 'approved', value: summary.approved },
    { key: 'notOrdered', value: summary.notOrdered },
    { key: 'partiallyOrdered', value: summary.partiallyOrdered },
    { key: 'ordered', value: summary.ordered },
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

function RequirementRow({
  row,
  onOpen,
}: {
  row: ProjectRequirementRow;
  onOpen: () => void;
}) {
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
          <span className="block text-caption text-muted-foreground">
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
          <span className="block text-caption text-muted-foreground">
            {t('acrossOrders', { n: row.purchaseOrderCount })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-end">
        {/* Opens the detail panel rather than leaving the workspace. The link out to the buyer's
            application lives inside it, where the purchase orders are. */}
        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onOpen}>
          {t('open')}
        </Button>
      </TableCell>
    </TableRow>
  );
}
