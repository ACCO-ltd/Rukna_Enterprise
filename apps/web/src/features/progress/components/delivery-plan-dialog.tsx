'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton, useToast } from '@erp/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BoqTreeNodeResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';

import { suggestDeliveryPlan } from '../domain/suggest-delivery-plan';
import { useSaveDeliveryPlan, useWorkPackages } from '../hooks/use-progress';
import { RefButton, RefPill, RefTable, RefTableScroll, RefTbody, RefTd, RefTh, RefThead, RefTr } from './ref-ui';

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
  leafIds: string[];
}

export function DeliveryPlanDialog({
  projectId,
  currency,
  open,
  onOpenChange,
}: {
  projectId: string;
  currency: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('progress');
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
          weightPercent: String(Math.round(p.suggestedWeight * 100)),
          leafIds: p.leafIds,
        }))
      : []);

  function update(key: string, patch: Partial<PlanRow>) {
    setError(null);
    setRows(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
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

  const included = current.filter((r) => r.included);
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
          progressWeight: Number(r.weightPercent) / 100,
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setRows(null);
        onOpenChange(o);
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('deliveryPlan.title')}</DialogTitle>
          <DialogDescription>{t('deliveryPlan.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="mt-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !suggestion || suggestion.packages.length === 0 ? (
            <p className="py-8 text-center text-body text-muted-foreground">{t('deliveryPlan.empty')}</p>
          ) : (
            <>
              {suggestion.orphanLeafIds.length > 0 ? (
                <div className="mb-3">
                  <Alert
                    variant="warning"
                    messages={[t('deliveryPlan.orphanWarning', { count: suggestion.orphanLeafIds.length })]}
                  />
                </div>
              ) : null}

              {error ? (
                <div className="mb-3">
                  <Alert variant="error" messages={[error]} />
                </div>
              ) : null}

              <RefTableScroll aria-label={t('deliveryPlan.title')}>
                <RefTable>
                  <RefThead>
                    <RefTr>
                      <RefTh>{t('deliveryPlan.col.include')}</RefTh>
                      <RefTh>{t('deliveryPlan.col.code')}</RefTh>
                      <RefTh>{t('deliveryPlan.col.name')}</RefTh>
                      <RefTh>{t('deliveryPlan.col.coverage')}</RefTh>
                      <RefTh>{t('deliveryPlan.col.owner')}</RefTh>
                      <RefTh numeric>{t('deliveryPlan.col.weight')}</RefTh>
                      <RefTh>{t('deliveryPlan.col.status')}</RefTh>
                    </RefTr>
                  </RefThead>
                  <RefTbody>
                    {current.map((row) => (
                      <RowGroup
                        key={row.key}
                        row={row}
                        currency={currency}
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
                  </RefTbody>
                </RefTable>
              </RefTableScroll>

              <p className={`mt-3 text-caption ${totalWeightPercent > 100 ? 'text-warning' : 'text-muted-foreground'}`}>
                {totalWeightPercent > 100
                  ? t('deliveryPlan.weightTotalOver', { total: totalWeightPercent })
                  : t('deliveryPlan.weightTotal', { total: totalWeightPercent })}
              </p>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
          <RefButton variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('deliveryPlan.cancel')}
          </RefButton>
          {suggestion && suggestion.packages.length > 0 ? (
            <RefButton onClick={onSave} disabled={save.isPending}>
              {save.isPending ? t('deliveryPlan.saving') : t('deliveryPlan.saveDraft')}
            </RefButton>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowGroup({
  row,
  currency,
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
      <RefTr className={row.included ? '' : 'opacity-50'}>
        <RefTd>
          <input
            type="checkbox"
            checked={row.included}
            onChange={(e) => onChange({ included: e.target.checked })}
            aria-label={`${t('deliveryPlan.col.include')} — ${row.name}`}
            className="h-4 w-4 rounded border-border text-brand-primary focus:ring-brand-primary"
          />
        </RefTd>
        <RefTd>
          <input
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            disabled={!row.included}
            className={`${refFieldClass} w-24`}
          />
        </RefTd>
        <RefTd>
          <input
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={!row.included}
            className={`${refFieldClass} w-full min-w-40`}
          />
        </RefTd>
        <RefTd className="whitespace-nowrap">
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
          <div className="text-caption text-muted-foreground">{formatMoney(String(totalValue), currency, 'en')}</div>
        </RefTd>
        <RefTd>
          <input
            value={row.responsibleOwner}
            onChange={(e) => onChange({ responsibleOwner: e.target.value })}
            disabled={!row.included}
            placeholder={t('deliveryPlan.ownerPlaceholder')}
            className={`${refFieldClass} w-28`}
          />
        </RefTd>
        <RefTd numeric>
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
        </RefTd>
        <RefTd>
          {!row.included ? (
            <RefPill tone="gray">{t('deliveryPlan.excluded')}</RefPill>
          ) : row.leafIds.length === 0 ? (
            <RefPill tone="gray">{t('deliveryPlan.noItems')}</RefPill>
          ) : hasUnpriced ? (
            <RefPill tone="amber" title={t('deliveryPlan.unpricedHint')}>
              {t('deliveryPlan.unpriced')}
            </RefPill>
          ) : (
            <RefPill tone="green">{t('deliveryPlan.ready')}</RefPill>
          )}
        </RefTd>
      </RefTr>
      {isExpanded ? (
        <RefTr>
          <RefTd colSpan={7} className="bg-surface-subtle">
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
          </RefTd>
        </RefTr>
      ) : null}
    </>
  );
}
