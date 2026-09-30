'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  MoneyDisplay,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useToast,
} from '@erp/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apportionUnits, type BoqTreeNodeResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';

import { suggestDeliveryPlan } from '../domain/suggest-delivery-plan';
import { useProposedPackageWeights, useSaveDeliveryPlan, useWorkPackages } from '../hooks/use-progress';

/** Weights are edited as whole percents: two decimal places of the stored 0..1 fraction. */
const WHOLE_PERCENT_DECIMALS = 2;

const refFieldClass = 'rounded-control border-border px-2 py-1 text-body focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary';

interface LeafInfo {
  code: string;
  description: string;
  value: number;
}

interface PlanRow {
  key: string;
  included: boolean;
  code: string;
  name: string;
  responsibleOwner: string;
  /** Edited as a whole-number percent string in the UI; converted to a 0..1 fraction on save. */
  weightPercent: string;
  /**
   * True once the PM typed a weight. Until then the row follows the server's value weighting for
   * the current grouping, which is recomputed whenever leaves move between rows.
   */
  weightEdited: boolean;
  leafIds: string[];
}

export function DeliveryPlanDialog({
  projectId,
  currency,
  moneyHidden = false,
  open,
  onOpenChange,
}: {
  projectId: string;
  currency: string | null;
  /**
   * The viewer may not see BOQ money (ADR-029 money-blind roles): the server omits amounts, so a
   * section value would read as a false "$0.00". Render the hidden state instead.
   */
  moneyHidden?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const tDiscard = useTranslations('common.discardChanges');
  const { toast } = useToast();

  const workspace = useBoqWorkspace(projectId);
  const versionId = workspace.data?.approved?.id ?? workspace.data?.contractBaseline?.id ?? null;
  const tree = useBoqTree(projectId, versionId);
  const workPackages = useWorkPackages(projectId);
  const save = useSaveDeliveryPlan(projectId);

  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const suggestion = useMemo(() => {
    if (!tree.data || !workPackages.data) return null;
    const existingCodes = new Set(workPackages.data.map((wp) => wp.code));
    const alreadyAllocated = new Set(workPackages.data.flatMap((wp) => wp.boqNodeIds ?? []));
    return suggestDeliveryPlan(tree.data, existingCodes, alreadyAllocated);
  }, [tree.data, workPackages.data]);

  const unpricedLeafIds = useMemo(
    () => new Set(suggestion?.unpricedLeafIds ?? []),
    [suggestion],
  );

  // Every leaf's code/description/value, whether or not it ended up in a suggestion — a moved leaf
  // still needs to be looked up. Computed once from the tree, not from the suggestion's own subset.
  const leafInfo = useMemo(() => {
    const map = new Map<string, LeafInfo>();
    const visit = (node: BoqTreeNodeResponse) => {
      if (node.isLeaf) {
        map.set(node.id, {
          code: node.code,
          description: node.description,
          value: node.totalAmount ? Number(node.totalAmount) : 0,
        });
      } else {
        node.children.forEach(visit);
      }
    };
    (tree.data ?? []).forEach(visit);
    return map;
  }, [tree.data]);

  // Rows are seeded from the suggestion once per dialog open, then owned locally — the PM edits
  // freely (including moving a leaf between rows) and a background refetch of the suggestion must
  // never clobber that.
  const current =
    rows ??
    (suggestion
      ? suggestion.packages.map((p) => ({
          key: p.sectionNodeId,
          included: true,
          code: p.code,
          name: p.name,
          responsibleOwner: '',
          weightPercent: '',
          weightEdited: false,
          leafIds: p.leafIds,
        }))
      : []);

  function update(key: string, patch: Partial<PlanRow>) {
    setError(null);
    setRows(current.map((r) => (r.key === key ? { ...r, ...patch, ...('weightPercent' in patch ? { weightEdited: true } : {}) } : r)));
  }

  /** Moves one leaf from wherever it currently sits (if anywhere in this plan) onto `toKey`. */
  function moveLeaf(leafId: string, toKey: string) {
    setError(null);
    setRows(
      current.map((r) => {
        if (r.key === toKey) {
          return r.leafIds.includes(leafId) ? r : { ...r, leafIds: [...r.leafIds, leafId] };
        }
        return r.leafIds.includes(leafId) ? { ...r, leafIds: r.leafIds.filter((id) => id !== leafId) } : r;
      }),
    );
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Value weights come from the server for the grouping as it stands (debounced, so dragging several
  // leaves is one request). Package ratios only — no per-leaf share reaches the browser.
  // Serialised so the debounce compares content: a fresh array each render is not a new grouping.
  const groupingKey = JSON.stringify(
    current.filter((r) => r.included).map((r) => ({ key: r.key, boqNodeIds: r.leafIds })),
  );
  const settledKey = useDebounced(groupingKey, 400);
  const grouping = useMemo(
    () => JSON.parse(settledKey) as { key: string; boqNodeIds: string[] }[],
    [settledKey],
  );
  const weights = useProposedPackageWeights(projectId, grouping, open);
  // Whole percents by largest remainder (shared with the API), so the untouched rows add up to
  // exactly 100 rather than 99 or 101 from rounding each one on its own.
  const serverWeights = weights.data?.weights ?? [];
  const serverUnits = apportionUnits(
    serverWeights.map((w) => w.weight),
    WHOLE_PERCENT_DECIMALS,
  );
  const serverPercent = new Map(serverWeights.map((w, i) => [w.key, String(serverUnits[i])] as const));
  const withWeights = current.map((r) =>
    r.weightEdited ? r : { ...r, weightPercent: serverPercent.get(r.key) ?? r.weightPercent },
  );

  const included = withWeights.filter((r) => r.included);
  const totalWeightPercent = included.reduce((sum, r) => sum + (Number(r.weightPercent) || 0), 0);

  function onSave() {
    setError(null);
    if (included.length === 0) {
      setError(t('deliveryPlan.noneIncluded'));
      return;
    }
    save.mutate(
      {
        packages: included.map((r) => ({
          code: r.code.trim(),
          name: r.name.trim(),
          responsibleOwner: r.responsibleOwner.trim() || undefined,
          // A whole percent is exactly two places of the stored fraction; toFixed drops float noise.
          progressWeight: Number((Number(r.weightPercent) / 100).toFixed(WHOLE_PERCENT_DECIMALS)),
          boqNodeIds: r.leafIds,
        })),
      },
      {
        onSuccess: (res) => {
          toast({ tone: 'success', title: t('deliveryPlan.saved', { count: res.packages.length }) });
          setRows(null);
          onOpenChange(false);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('deliveryPlan.saveFailed')),
      },
    );
  }

  const loading = workspace.isPending || (versionId !== null && tree.isPending) || workPackages.isPending;

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setRows(null);
        onOpenChange(o);
      }}
      title={t('deliveryPlan.title')}
      subtitle={t('deliveryPlan.subtitle')}
      size="xl"
      // Rows are seeded lazily from the suggestion, so non-null means the PM has changed the plan.
      dirty={rows !== null}
      busy={save.isPending}
      closeLabel={tCommon('close')}
      discardLabels={{
        title: tDiscard('title'),
        description: tDiscard('description'),
        confirm: tDiscard('confirm'),
        cancel: tDiscard('cancel'),
      }}
    >
      <FormDialogBody className="space-y-3">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : !suggestion || suggestion.packages.length === 0 ? (
          <p className="py-8 text-center text-body text-muted-foreground">{t('deliveryPlan.empty')}</p>
        ) : (
          <>
            {suggestion.orphanLeafIds.length > 0 ? (
              <Alert
                variant="warning"
                messages={[t('deliveryPlan.orphanWarning', { count: suggestion.orphanLeafIds.length })]}
              />
            ) : null}

            {error ? <Alert variant="error" messages={[error]} /> : null}

            <TableScroll aria-label={t('deliveryPlan.title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('deliveryPlan.col.include')}</TableHead>
                    <TableHead>{t('deliveryPlan.col.code')}</TableHead>
                    <TableHead>{t('deliveryPlan.col.name')}</TableHead>
                    <TableHead>{t('deliveryPlan.col.coverage')}</TableHead>
                    <TableHead>{t('deliveryPlan.col.owner')}</TableHead>
                    <TableHead numeric>{t('deliveryPlan.col.weight')}</TableHead>
                    <TableHead>{t('deliveryPlan.col.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withWeights.map((row) => (
                    <RowGroup
                      key={row.key}
                      row={row}
                      currency={currency}
                      moneyHidden={moneyHidden}
                      isExpanded={expanded.has(row.key)}
                      onToggleExpand={() => toggleExpanded(row.key)}
                      onChange={(patch) => update(row.key, patch)}
                      onMoveLeaf={moveLeaf}
                      leafInfo={leafInfo}
                      unpricedLeafIds={unpricedLeafIds}
                      otherIncludedRows={current.filter((r) => r.key !== row.key && r.included)}
                      t={t}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>

            {/* Without the cost tier the server splits evenly rather than by value (owner decision
                2026-09-29). One quiet line; weights the PM typed are kept either way. */}
            {weights.data && !weights.data.valueWeighted ? (
              <p className="text-caption text-muted-foreground">{t('deliveryPlan.evenWeightsNote')}</p>
            ) : null}

            <p className={`text-caption ${totalWeightPercent !== 100 ? 'text-warning' : 'text-muted-foreground'}`}>
              {totalWeightPercent > 100
                ? t('deliveryPlan.weightTotalOver', { total: totalWeightPercent })
                : totalWeightPercent < 100
                  ? t('deliveryPlan.weightTotalUnder', { total: totalWeightPercent })
                  : t('deliveryPlan.weightTotal', { total: totalWeightPercent })}
            </p>
          </>
        )}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={save.isPending}>
            {t('deliveryPlan.cancel')}
          </Button>
        </FormDialogClose>
        {suggestion && suggestion.packages.length > 0 ? (
          <Button onClick={onSave} disabled={save.isPending || (weights.isPending && grouping.length > 0)}>
            {save.isPending ? t('deliveryPlan.saving') : t('deliveryPlan.saveDraft')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}

function RowGroup({
  row,
  currency,
  moneyHidden,
  isExpanded,
  onToggleExpand,
  onChange,
  onMoveLeaf,
  leafInfo,
  unpricedLeafIds,
  otherIncludedRows,
  t,
}: {
  row: PlanRow;
  currency: string | null;
  moneyHidden: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<PlanRow>) => void;
  onMoveLeaf: (leafId: string, toKey: string) => void;
  leafInfo: Map<string, LeafInfo>;
  unpricedLeafIds: ReadonlySet<string>;
  otherIncludedRows: Array<{ key: string; code: string; name: string }>;
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  const totalValue = row.leafIds.reduce((sum, id) => sum + (leafInfo.get(id)?.value ?? 0), 0);
  const hasUnpriced = row.leafIds.some((id) => unpricedLeafIds.has(id));

  return (
    <>
      <TableRow className={row.included ? '' : 'opacity-50'}>
        <TableCell>
          <input
            type="checkbox"
            checked={row.included}
            onChange={(e) => onChange({ included: e.target.checked })}
            aria-label={`${t('deliveryPlan.col.include')} — ${row.name}`}
            className="h-4 w-4 rounded border-border text-brand-primary focus:ring-brand-primary"
          />
        </TableCell>
        <TableCell>
          <input
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            disabled={!row.included}
            className={`${refFieldClass} w-24`}
          />
        </TableCell>
        <TableCell>
          <input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={!row.included}
            className={`${refFieldClass} w-full min-w-40`}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1 text-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <span>{t('deliveryPlan.coverageCount', { count: row.leafIds.length })}</span>
          </button>
          <div className="text-caption text-muted-foreground">
            {moneyHidden ? <MoneyDisplay value={null} hidden /> : formatMoney(String(totalValue), currency, 'en')}
          </div>
        </TableCell>
        <TableCell>
          <input
            value={row.responsibleOwner}
            onChange={(e) => onChange({ responsibleOwner: e.target.value })}
            disabled={!row.included}
            placeholder={t('deliveryPlan.ownerPlaceholder')}
            className={`${refFieldClass} w-28`}
          />
        </TableCell>
        <TableCell numeric>
          <div className="flex items-center justify-end gap-1">
            <input
              type="number"
              min="0"
              max="100"
              value={row.weightPercent}
              onChange={(e) => onChange({ weightPercent: e.target.value })}
              disabled={!row.included}
              className={`${refFieldClass} w-16 text-end`}
            />
            <span className="text-muted-foreground">%</span>
          </div>
        </TableCell>
        <TableCell>
          {!row.included ? (
            <StatusPill tone="historical">{t('deliveryPlan.excluded')}</StatusPill>
          ) : row.leafIds.length === 0 ? (
            <StatusPill tone="historical">{t('deliveryPlan.noItems')}</StatusPill>
          ) : hasUnpriced ? (
            <StatusPill tone="attention" title={t('deliveryPlan.unpricedHint')}>
              {t('deliveryPlan.unpriced')}
            </StatusPill>
          ) : (
            <StatusPill tone="success">{t('deliveryPlan.ready')}</StatusPill>
          )}
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-surface-subtle">
            <p className="mb-1 text-caption font-medium text-muted-foreground">{t('deliveryPlan.inspect')}</p>
            {row.leafIds.length === 0 ? (
              <p className="text-caption text-disabled-foreground">{t('deliveryPlan.noItemsHint')}</p>
            ) : (
              <ul className="space-y-1">
                {row.leafIds.map((id) => {
                  const leaf = leafInfo.get(id);
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-caption text-foreground">
                      <span>
                        <span className="font-mono text-muted-foreground">{leaf?.code ?? id}</span>
                        {leaf ? ` — ${leaf.description}` : ''}
                      </span>
                      {otherIncludedRows.length > 0 ? (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onMoveLeaf(id, e.target.value);
                          }}
                          aria-label={t('deliveryPlan.moveTo', { item: leaf?.code ?? id })}
                          className="rounded-control border-border text-caption focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                        >
                          <option value="">{t('deliveryPlan.moveToPlaceholder')}</option>
                          {otherIncludedRows.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.code} — {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** `value`, once it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return settled;
}
