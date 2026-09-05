'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
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
  ViewSwitcher,
  cn,
} from '@erp/ui';
import type {
  ProjectCostByBoqRow,
  ProjectProcurementCostResponse,
} from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

import { useProjectProcurementCost } from '../../hooks/use-project-procurement';
import { CostPositionBand } from './cost-position-band';
import { SectionPanel } from './section-panel';

type Dimension = 'boq' | 'supplier' | 'category';

/**
 * Cost & Commitments — the authoritative backbone of the project's procurement view.
 *
 * Table first, deliberately. A grouped bar chart of committed-vs-actual looks like analysis and
 * answers nothing a project manager can act on; the expandable cost table names the section, the
 * budget, all three stages and what is still free to spend. Everything else on this screen is
 * secondary to it, and nothing is allowed to push it below the fold.
 *
 * Every figure comes from the commitment ledger via the read model, so the numbers here are the
 * same rows the Project Financial Position reads. Nothing is summed in the browser.
 */
export function CostCommitmentsView({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.project.cost');
  const query = useProjectProcurementCost(projectId);
  const [dimension, setDimension] = React.useState<Dimension>('boq');

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
      <div>
        <h3 className="text-h3 font-semibold text-foreground">{t('title')}</h3>
        <p className="mt-1 text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <CostPositionBand
        position={data.position}
        canManageBudget={data.capabilities.canManageBudget}
      />

      <SectionPanel
        title={t('breakdown')}
        description={t('breakdownHint')}
        action={
          <ViewSwitcher
            aria-label={t('dimensionLabel')}
            value={dimension}
            onValueChange={(next) => setDimension(next as Dimension)}
            items={[
              { value: 'boq', label: t('byBoq') },
              { value: 'supplier', label: t('bySupplier') },
              { value: 'category', label: t('byCategory') },
            ]}
          />
        }
        bodyClassName="px-0 py-0"
      >
        {dimension === 'boq' ? (
          <CostByBoqTable data={data} />
        ) : dimension === 'supplier' ? (
          <CostBySupplierTable data={data} />
        ) : (
          <CostByCategoryTable data={data} />
        )}
      </SectionPanel>

      <RecentEntriesPanel data={data} />
    </div>
  );
}

// ─── By BOQ ─────────────────────────────────────────────────────────────────────

/**
 * Cost against priced scope, expandable.
 *
 * Committed, accrued and actual are **stages of one cost's recognition, not three buckets to
 * add up**. Nothing on this screen sums them, and no "total exposure" metric exists — each
 * column is the ledger's current signed balance for that stage, reversals included.
 *
 * Opens at section level: cost is coded to leaves, but a 400-row cost report is a data dump, so
 * the server rolls every node's descendants into it and this only expands where the reader asks.
 *
 * The project-level row is a peer of the sections, not a footnote. It is legitimate project cost
 * that has no BOQ line — site office, transport, insurance — and calling it "other/unallocated"
 * would imply somebody failed to code it.
 */
function CostByBoqTable({ data }: { data: ProjectProcurementCostResponse }) {
  const t = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, data.position.currency, locale) ?? '—');
  const hasBudget = data.position.budgetTotal !== null;

  // A row shows when every ancestor above it is expanded. Depth alone is not enough — a collapsed
  // section must hide its grandchildren too.
  const visible: ProjectCostByBoqRow[] = [];
  const openDepth: boolean[] = [];
  for (const row of data.byBoq) {
    if (row.kind === 'PROJECT_LEVEL' || row.depth === 0) {
      visible.push(row);
      openDepth[row.depth] = row.boqNodeId !== null && expanded.has(row.boqNodeId);
      continue;
    }
    if (openDepth.slice(0, row.depth).every(Boolean)) {
      visible.push(row);
      openDepth[row.depth] = row.boqNodeId !== null && expanded.has(row.boqNodeId);
    } else {
      openDepth[row.depth] = false;
    }
  }

  if (data.byBoq.length === 0) {
    return <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('noCost')}</p>;
  }

  return (
    <>
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.scope')}</TableHead>
              {hasBudget ? <TableHead className="text-end">{t('col.budget')}</TableHead> : null}
              <TableHead className="text-end">{t('col.committed')}</TableHead>
              <TableHead className="text-end">{t('col.accrued')}</TableHead>
              <TableHead className="text-end">{t('col.actual')}</TableHead>
              {hasBudget ? (
                <>
                  <TableHead className="text-end">{t('col.uncommitted')}</TableHead>
                  {/* Named for its numerator. "% used" with three stages on the row is a guess. */}
                  <TableHead className="text-end">{t('col.committedOfBudget')}</TableHead>
                  <TableHead className="text-end">{t('col.actualOfBudget')}</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const key = row.boqNodeId ?? 'project-level';
              const isOpen = row.boqNodeId !== null && expanded.has(row.boqNodeId);
              return (
                <TableRow key={key} className={cn(row.kind === 'PROJECT_LEVEL' && 'bg-muted/40')}>
                  <TableCell>
                    <span
                      className="flex items-center gap-1.5"
                      style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}
                    >
                      {row.hasChildren && row.boqNodeId ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? t('collapse') : t('expand')}
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.boqNodeId!)) next.delete(row.boqNodeId!);
                              else next.add(row.boqNodeId!);
                              return next;
                            })
                          }
                          // 44px on touch, 20px from sm up. A disclosure triangle is still a
                          // target a thumb has to hit; the glyph inside stays the same size.
                          className="-m-3 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:m-0 sm:size-5"
                        >
                          <ChevronRight
                            size={14}
                            className={cn('transition-transform', isOpen && 'rotate-90')}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        <span className="size-5 shrink-0" aria-hidden="true" />
                      )}
                      {row.code ? (
                        <LtrValue className="font-mono text-caption text-muted-foreground">
                          {row.code}
                        </LtrValue>
                      ) : null}
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          row.depth === 0 ? 'font-medium text-foreground' : 'text-foreground',
                        )}
                      >
                        {row.kind === 'PROJECT_LEVEL' ? t('projectLevel') : row.description}
                      </span>
                    </span>
                  </TableCell>
                  {hasBudget ? (
                    <TableCell className="text-end tabular-nums">{money(row.budget)}</TableCell>
                  ) : null}
                  <TableCell className="text-end tabular-nums">{money(row.committed)}</TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {money(row.accrued)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{money(row.actual)}</TableCell>
                  {hasBudget ? (
                    <>
                      <TableCell className="text-end tabular-nums">
                        {money(row.uncommittedBudget)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {row.committedOfBudgetPercent === null
                          ? '—'
                          : `${row.committedOfBudgetPercent}%`}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {row.actualOfBudgetPercent === null ? '—' : `${row.actualOfBudgetPercent}%`}
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>

      <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
        {hasBudget ? t('budgetBasisNote') : t('noBudgetNote')}
      </p>
    </>
  );
}

// ─── By supplier / category ─────────────────────────────────────────────────────

/**
 * Ranked, not a donut.
 *
 * The question is "which supplier owns this exposure", and a ranked table answers it to the
 * cent. A share ring answers "what shape is the distribution", which nobody has ever needed to
 * act on. The share bar rides alongside the figure rather than replacing it.
 */
function CostBySupplierTable({ data }: { data: ProjectProcurementCostResponse }) {
  const t = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';
  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, data.position.currency, locale) ?? '—');

  if (data.bySupplier.length === 0) {
    return <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('noCost')}</p>;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.supplier')}</TableHead>
            <TableHead className="text-end">{t('col.committed')}</TableHead>
            <TableHead className="text-end">{t('col.accrued')}</TableHead>
            <TableHead className="text-end">{t('col.actual')}</TableHead>
            <TableHead>{t('col.shareOfCommitted')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.bySupplier.map((row) => (
            <TableRow key={row.supplierId ?? 'unattributed'}>
              <TableCell className="font-medium text-foreground">{row.supplierName}</TableCell>
              <TableCell className="text-end tabular-nums">{money(row.committed)}</TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground">
                {money(row.accrued)}
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(row.actual)}</TableCell>
              <TableCell>
                <ShareBar percent={row.percentOfCommitted} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

/**
 * Cost by spend category — **and deliberately no budget column.**
 *
 * A budget line codes to a BOQ node *or* a spend category, never both: the schema supports one
 * total per BOQ node, not a materials/labour/equipment split inside each BOQ item. So only the
 * project-level budget lines are category-coded. A budget column here would be populated for
 * those rows and blank for every BOQ-coded one, which reads as missing data rather than as the
 * model boundary it actually is. Budget belongs on the BOQ view, where it is complete.
 */
function CostByCategoryTable({ data }: { data: ProjectProcurementCostResponse }) {
  const t = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';
  const money = (value: string | null) =>
    value === null ? '—' : (formatMoney(value, data.position.currency, locale) ?? '—');

  if (data.byCategory.length === 0) {
    return <p className="px-4 py-4 text-body-sm text-muted-foreground sm:px-5">{t('noCost')}</p>;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.category')}</TableHead>
            <TableHead className="text-end">{t('col.committed')}</TableHead>
            <TableHead className="text-end">{t('col.accrued')}</TableHead>
            <TableHead className="text-end">{t('col.actual')}</TableHead>
            <TableHead>{t('col.shareOfActual')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.byCategory.map((row) => (
            <TableRow key={row.spendCategoryId ?? 'uncategorised'}>
              <TableCell className="font-medium text-foreground">{row.categoryName}</TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground">
                {money(row.committed)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground">
                {money(row.accrued)}
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(row.actual)}</TableCell>
              <TableCell>
                <ShareBar percent={row.percentOfActual} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

/** The figure first, the bar as support — a share nobody can read to the cent is decoration. */
function ShareBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-caption text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="w-24 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-1.5 rounded-full bg-brand-primary"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </span>
      <span className="text-caption tabular-nums text-muted-foreground">{percent}%</span>
    </span>
  );
}

// ─── Ledger activity ────────────────────────────────────────────────────────────

function RecentEntriesPanel({ data }: { data: ProjectProcurementCostResponse }) {
  const t = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';

  if (data.recentEntries.length === 0) return null;

  return (
    <SectionPanel title={t('recentEntries')} bodyClassName="px-0 py-0">
      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.date')}</TableHead>
              <TableHead>{t('col.document')}</TableHead>
              <TableHead>{t('col.reference')}</TableHead>
              <TableHead>{t('col.stage')}</TableHead>
              <TableHead className="text-end">{t('col.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.recentEntries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(entry.occurredAt, locale) ?? '—'}
                </TableCell>
                <TableCell className="text-caption text-muted-foreground">
                  {t(`documentType.${entry.documentType}`)}
                </TableCell>
                <TableCell className="font-mono text-caption text-foreground">
                  {entry.reference ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge tone={entry.stage === 'ACTUAL' ? 'live' : 'info'}>
                    {t(`stage.${entry.stage}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {entry.amount === null
                    ? '—'
                    : (formatMoney(entry.amount, entry.currency, locale) ?? '—')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </SectionPanel>
  );
}
