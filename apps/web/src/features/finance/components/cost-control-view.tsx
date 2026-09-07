'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight, Download, History, PieChart, Plus, Search, Wallet } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Input,
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
  ProjectCostBudgetListResponse,
  ProjectCostByBoqRow,
  ProjectProcurementCostResponse,
} from '@erp/types';

import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { SectionPanel } from '@/features/procurement/components/project/section-panel';
import {
  useProjectCostBudgets,
  useProjectProcurementCost,
} from '@/features/procurement/hooks/use-project-procurement';

import {
  Headroom,
  InlineRatio,
  Metric,
  MetricBand,
  Money,
  RatioBar,
} from './finance-primitives';
import { downloadCostCsv } from '../cost-export';
import { ShareBar, toSegments } from './share-bar';
import { BudgetEditorDialog } from './budget-editor-dialog';

type Dimension = 'boq' | 'category' | 'supplier';

const BUDGET_MANAGE = 'manage:project-budget' as const;

/**
 * Cost Control — the project's cost budget, and cost measured against it.
 *
 * The budget lives here rather than in Procurement for one reason that outlasts tidiness: a
 * budget line targets a BOQ node *or a project spend category*, and spend categories will carry
 * labour, plant hire, site overhead and insurance long before procurement handles any of them. A
 * budget authored inside Procurement would be a plan for money procurement does not spend.
 *
 * It reads the same cost rollup the Procurement tab renders. One read model, two purposes — the
 * alternative is two answers to "what has this project committed".
 */
export function CostControlView({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.costControl');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();

  const cost = useProjectProcurementCost(projectId);
  const budgets = useProjectCostBudgets(projectId);
  const [dimension, setDimension] = React.useState<Dimension>('boq');
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<{ mode: 'create' | 'edit'; budgetId?: string } | null>(
    null,
  );

  if (cost.isPending || budgets.isPending) return <Skeleton className="h-[32rem] w-full" />;
  if (cost.isError) {
    return (
      <Alert variant="error" title={tc('loadFailed')} messages={[tc('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => cost.refetch()}>
          {tc('retry')}
        </Button>
      </Alert>
    );
  }

  const data = cost.data;
  const position = data.position;
  const budgetList = budgets.data;
  const baselined = budgetList?.baselined ?? null;
  const mayManage = can(BUDGET_MANAGE);

  return (
    <div className="space-y-6">
      <MetricBand
        title={t('position.title')}
        description={t('position.description')}
        icon={<Wallet size={16} strokeWidth={1.9} />}
        columns={5}
        footer={
          <div className="grid gap-3 sm:grid-cols-3">
            <RatioBar label={t('ratio.committed')} percent={position.committedOfBudgetPercent} />
            <RatioBar label={t('ratio.accrued')} percent={position.accruedOfBudgetPercent} />
            <RatioBar label={t('ratio.actual')} percent={position.actualOfBudgetPercent} />
          </div>
        }
      >
        <Metric
          label={t('position.budget')}
          amount={position.budgetTotal}
          currency={position.currency}
          basis={
            baselined
              ? t('position.budgetBasis', { version: baselined.versionNumber })
              : t('position.notBaselined')
          }
          unavailableLabel={
            data.financialsVisible ? t('position.notBaselined') : tc('restricted')
          }
        />
        <Metric
          label={t('position.openCommitment')}
          amount={position.committed}
          currency={position.currency}
          basis={t('position.openCommitmentBasis')}
          unavailableLabel={tc('restricted')}
        />
        <Metric
          label={t('position.accrued')}
          amount={position.accrued}
          currency={position.currency}
          basis={t('position.accruedBasis')}
          unavailableLabel={tc('restricted')}
        />
        <Metric
          label={t('position.actual')}
          amount={position.actual}
          currency={position.currency}
          basis={t('position.actualBasis')}
          emphasis
          unavailableLabel={tc('restricted')}
        />
        <Metric
          label={t('position.uncommittedBudget')}
          amount={position.uncommittedBudget}
          currency={position.currency}
          basis={t('position.uncommittedBudgetBasis')}
          overrunLabel={tc('overrun')}
          unavailableLabel={
            data.financialsVisible ? t('position.notBaselined') : tc('restricted')
          }
        />
      </MetricBand>

      {/* Two remainders that must never read as one. Stated as a footnote rather than a sixth
          metric, because the distinction matters more than either number does. */}
      {position.budgetTotal !== null ? (
        <p className="text-caption text-muted-foreground">
          {t('position.remainderNote', {
            uncommitted: position.uncommittedBudget ?? '—',
            lessActual: position.budgetLessActual ?? '—',
          })}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionPanel
          title={t('breakdown.title')}
          description={t('breakdown.description')}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ViewSwitcher
                aria-label={t('breakdown.dimensionLabel')}
                value={dimension}
                onValueChange={(next) => setDimension(next as Dimension)}
                items={[
                  { value: 'boq', label: t('breakdown.byBoq') },
                  { value: 'category', label: t('breakdown.byCategory') },
                  { value: 'supplier', label: t('breakdown.bySupplier') },
                ]}
              />
              <label className="relative">
                <span className="sr-only">{t('breakdown.search')}</span>
                <Search
                  size={15}
                  strokeWidth={1.9}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-muted-foreground"
                />
                <Input
                  value={search}
                  placeholder={t('breakdown.search')}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-44 ps-8"
                />
              </label>
              {/* Real file, real data — the same rows the table shows, in the current view. */}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() =>
                  downloadCostCsv(data, dimension, {
                    costArea: t('table.costArea'),
                    category: t('table.category'),
                    supplier: t('table.supplier'),
                    budget: t('table.budget'),
                    openCommitment: t('table.openCommitment'),
                    accrued: t('table.accrued'),
                    actual: t('table.actual'),
                    uncommitted: t('table.uncommitted'),
                  })
                }
              >
                <Download size={15} strokeWidth={1.9} aria-hidden="true" />
                {tc('export')}
              </Button>
            </div>
          }
          bodyClassName="px-0 py-0"
        >
          {dimension === 'boq' ? (
            <CostByBoqTable data={data} search={search} />
          ) : dimension === 'category' ? (
            <CostByCategoryTable data={data} search={search} />
          ) : (
            <CostBySupplierTable data={data} search={search} />
          )}
        </SectionPanel>

        <div className="min-w-0 space-y-6">
          <BudgetPanel
            list={budgetList}
            mayManage={mayManage}
            onCreate={() => setEditing({ mode: 'create' })}
            onEdit={(budgetId) => setEditing({ mode: 'edit', budgetId })}
            locale={locale}
          />

          {/* What proportion of the budget each area holds — the one thing the table beside
              it cannot be read for quickly. Drawn only when there is a budget to divide. */}
          {position.budgetTotal !== null ? (
            <SectionPanel
              title={t('composition.title')}
              description={t('composition.description')}
              icon={<PieChart size={16} strokeWidth={1.9} />}
              bodyClassName="p-0"
            >
              <ShareBar
                title={t('composition.title')}
                totalLabel={t('composition.totalLabel')}
                total={position.budgetTotal}
                currency={position.currency}
                segments={toSegments(
                  data.byBoq
                    .filter((row) => row.depth === 0 && row.budget !== null)
                    .map((row) => ({
                      key: row.boqNodeId ?? row.description,
                      label: row.code ? row.code + ' \u00b7 ' + row.description : row.description,
                      amount: row.budget!,
                    })),
                  tc('other'),
                )}
              />
            </SectionPanel>
          ) : null}
        </div>
      </div>

      {editing ? (
        <BudgetEditorDialog
          projectId={projectId}
          mode={editing.mode}
          budgetId={editing.budgetId}
          currency={position.currency ?? 'USD'}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );

  function BudgetPanel({
    list,
    mayManage,
    onCreate,
    onEdit,
    locale,
  }: {
    list: ProjectCostBudgetListResponse | undefined;
    mayManage: boolean;
    onCreate: () => void;
    onEdit: (budgetId: string) => void;
    locale: 'en' | 'ar';
  }) {
    const versions = list?.budgets ?? [];
    const baselinedVersion = list?.baselined ?? null;
    const workingVersion = versions.find((v) => v.status === 'DRAFT') ?? null;

    return (
      <SectionPanel
        title={t('budget.title')}
        description={t('budget.description')}
        bodyClassName="p-0"
      >
        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* Working, Baselined, Superseded — never "Approved". The model has no approval step,
              and naming one re-creates exactly the fake control this programme removed. */}
          {workingVersion ? (
            <div className="rounded-panel border border-border bg-muted/40 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body-sm font-semibold text-foreground">
                  {t('budget.version', { version: workingVersion.versionNumber })}
                </span>
                <Badge tone="warning">{t('budget.status.WORKING')}</Badge>
              </div>
              <p className="mt-1 text-caption text-muted-foreground">
                {t('budget.workingHint')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {mayManage ? (
                  <Button size="sm" variant="outline" onClick={() => onEdit(workingVersion.id)}>
                    {t('budget.editDraft')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {baselinedVersion ? (
            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-caption text-muted-foreground">{t('budget.current')}</dt>
                <dd className="flex items-center gap-2">
                  <span className="text-body-sm font-semibold text-foreground">
                    {t('budget.version', { version: baselinedVersion.versionNumber })}
                  </span>
                  <Badge tone="live">{t('budget.status.BASELINED')}</Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-caption text-muted-foreground">{t('budget.total')}</dt>
                <dd>
                  <Money
                    amount={baselinedVersion.total}
                    currency={baselinedVersion.currency}
                    className="text-body-sm font-medium text-foreground"
                  />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-caption text-muted-foreground">{t('budget.lines')}</dt>
                <dd className="text-body-sm text-foreground">
                  {baselinedVersion.lines.length}
                </dd>
              </div>
              {/* Actor and date only when the audit trail actually has them. */}
              {baselinedVersion.baselinedAt ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption text-muted-foreground">{t('budget.baselinedOn')}</dt>
                  <dd className="text-body-sm text-foreground">
                    {formatDate(baselinedVersion.baselinedAt, locale) ??
                      baselinedVersion.baselinedAt}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : !workingVersion ? (
            <p className="text-body-sm text-muted-foreground">{t('budget.none')}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {/* Create revision only from a baselined state, and never while a draft is open —
                two drafts mean two answers to "what are we about to baseline". */}
            {mayManage && !workingVersion ? (
              <Button size="sm" onClick={onCreate}>
                <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
                {baselinedVersion ? t('budget.createRevision') : t('budget.createBudget')}
              </Button>
            ) : null}
          </div>

          {versions.length > 1 ? (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-caption font-medium text-brand-primary">
                <History size={14} strokeWidth={1.9} aria-hidden="true" />
                {t('budget.history', { count: versions.length })}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <span className="text-caption text-muted-foreground">
                      {t('budget.version', { version: v.versionNumber })}
                    </span>
                    <Badge
                      tone={
                        v.status === 'BASELINED'
                          ? 'live'
                          : v.status === 'DRAFT'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(
                        `budget.status.${v.status === 'DRAFT' ? 'WORKING' : v.status}`,
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </SectionPanel>
    );
  }
}

// ─── Cost tables ────────────────────────────────────────────────────────────────

/**
 * Cost against priced scope, expandable.
 *
 * Committed, accrued and actual are **stages of one cost's recognition, not three buckets to add
 * up**. Nothing here sums them into a "total exposure"; each column is the ledger's current
 * signed balance for that stage, reversals included.
 *
 * `Uncommitted budget` is budget less everything ordered, received or billed. It is not
 * `budget − committed`: COMMITTED falls when goods arrive, so that formula handed a project back
 * headroom it had already spent.
 */
function CostByBoqTable({
  data,
  search,
}: {
  data: ProjectProcurementCostResponse;
  search: string;
}) {
  const t = useTranslations('finance.costControl');
  const tc = useTranslations('finance.common');

  const rowKey = (row: ProjectCostByBoqRow, index: number) =>
    row.boqNodeId ?? `${row.kind}-${row.spendCategoryId ?? index}`;

  // Expanded by default. Cost Control exists to be read, and a reader who has to open four
  // sections before seeing where the money went will not do it — the collapsed default was right
  // on the Procurement tab, where the tree is context, and wrong here, where it is the subject.
  // `collapsed` holds the exceptions rather than `expanded` holding the norm.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();
  const matches = (row: ProjectCostByBoqRow) =>
    !term || `${row.code ?? ''} ${row.description}`.toLowerCase().includes(term);

  // A row shows when every ancestor above it is open. Depth alone is not enough — a collapsed
  // section must hide its grandchildren too. A search flattens the tree instead: every hit shows
  // regardless of its ancestors, because hiding a match inside a closed section makes the search
  // look broken.
  const visible: Array<{ row: ProjectCostByBoqRow; key: string }> = [];
  const closedDepth: number[] = [];
  data.byBoq.forEach((row, index) => {
    const key = rowKey(row, index);
    if (term) {
      if (matches(row)) visible.push({ row, key });
      return;
    }
    while (closedDepth.length > 0 && closedDepth[closedDepth.length - 1]! >= row.depth) {
      closedDepth.pop();
    }
    if (closedDepth.length === 0) {
      visible.push({ row, key });
      if (row.hasChildren && collapsed.has(key)) closedDepth.push(row.depth);
    }
  });

  const isOpen = (key: string) => !collapsed.has(key);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.costArea')}</TableHead>
            <TableHead className="text-end">{t('table.budget')}</TableHead>
            <TableHead className="text-end">{t('table.openCommitment')}</TableHead>
            <TableHead className="text-end">{t('table.accrued')}</TableHead>
            <TableHead className="text-end">{t('table.actual')}</TableHead>
            <TableHead className="text-end">{t('table.uncommitted')}</TableHead>
            <TableHead className="text-end">{t('ratio.actual')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(({ row, key }) => (
            <TableRow key={key}>
              <TableCell
                className="font-medium text-foreground"
                style={{ paddingInlineStart: `${0.75 + row.depth * 1.25}rem` }}
              >
                <span className="flex items-center gap-1.5">
                  {row.hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen(key)}
                      aria-label={row.description}
                      className="inline-flex size-11 shrink-0 items-center justify-center -my-2 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight
                        size={15}
                        strokeWidth={2}
                        className={cn('transition-transform', isOpen(key) && 'rotate-90')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <span className="inline-block w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0">
                    {row.code ? `${row.code} · ` : ''}
                    {row.description}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.budget} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.committed} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.accrued} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.actual} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Headroom
                  amount={row.uncommittedBudget}
                  currency={data.position.currency}
                  overrunLabel={tc('overrun')}
                />
              </TableCell>
              <TableCell className="text-end">
                <InlineRatio
                  percent={row.actualOfBudgetPercent}
                  label={t('ratio.actual') + ' ' + row.description}
                />
              </TableCell>
            </TableRow>
          ))}
          {/* Ties back to the position band above; without it a reader adds the rows by hand. */}
          <TableRow className="bg-muted/40">
            <TableCell className="font-semibold text-foreground">{tc('total')}</TableCell>
            <TableCell className="text-end font-semibold">
              <Money amount={data.position.budgetTotal} currency={data.position.currency} />
            </TableCell>
            <TableCell className="text-end font-semibold">
              <Money amount={data.position.committed} currency={data.position.currency} />
            </TableCell>
            <TableCell className="text-end font-semibold">
              <Money amount={data.position.accrued} currency={data.position.currency} />
            </TableCell>
            <TableCell className="text-end font-semibold">
              <Money amount={data.position.actual} currency={data.position.currency} />
            </TableCell>
            <TableCell className="text-end font-semibold">
              <Headroom
                amount={data.position.uncommittedBudget}
                currency={data.position.currency}
                overrunLabel={tc('overrun')}
              />
            </TableCell>
            <TableCell className="text-end">
              <InlineRatio
                percent={data.position.actualOfBudgetPercent}
                label={t('ratio.actual') + ' ' + tc('total')}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableScroll>
  );
}

function CostByCategoryTable({
  data,
  search,
}: {
  data: ProjectProcurementCostResponse;
  search: string;
}) {
  const t = useTranslations('finance.costControl');
  const term = search.trim().toLowerCase();
  const rows = data.byCategory.filter(
    (r) => !term || r.categoryName.toLowerCase().includes(term),
  );
  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.category')}</TableHead>
            <TableHead className="text-end">{t('table.openCommitment')}</TableHead>
            <TableHead className="text-end">{t('table.accrued')}</TableHead>
            <TableHead className="text-end">{t('table.actual')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.spendCategoryId ?? row.categoryName}>
              <TableCell className="font-medium text-foreground">{row.categoryName}</TableCell>
              <TableCell className="text-end">
                <Money amount={row.committed} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.accrued} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.actual} currency={data.position.currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

function CostBySupplierTable({
  data,
  search,
}: {
  data: ProjectProcurementCostResponse;
  search: string;
}) {
  const t = useTranslations('finance.costControl');
  const term = search.trim().toLowerCase();
  const rows = data.bySupplier.filter(
    (r) => !term || r.supplierName.toLowerCase().includes(term),
  );
  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.supplier')}</TableHead>
            <TableHead className="text-end">{t('table.openCommitment')}</TableHead>
            <TableHead className="text-end">{t('table.accrued')}</TableHead>
            <TableHead className="text-end">{t('table.actual')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.supplierId ?? row.supplierName}>
              <TableCell className="font-medium text-foreground">{row.supplierName}</TableCell>
              <TableCell className="text-end">
                <Money amount={row.committed} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.accrued} currency={data.position.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money amount={row.actual} currency={data.position.currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}
