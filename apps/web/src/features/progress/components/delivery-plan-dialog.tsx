'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton, useToast } from '@erp/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BoqTreeNodeResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';

import { suggestDeliveryPlan, type SuggestedPackage } from '../domain/suggest-delivery-plan';
import { useSaveDeliveryPlan, useWorkPackages } from '../hooks/use-progress';
import { RefButton, RefPill, RefTable, RefTableScroll, RefTbody, RefTd, RefTh, RefThead, RefTr } from './ref-ui';

const refFieldClass = 'rounded-lg border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

interface PlanRow {
  key: string;
  included: boolean;
  code: string;
  name: string;
  responsibleOwner: string;
  /** Edited as a whole-number percent string in the UI; converted to a 0..1 fraction on save. */
  weightPercent: string;
  leafIds: string[];
  totalValue: number;
  hasUnpriced: boolean;
}

function toRow(pkg: SuggestedPackage, unpricedLeafIds: ReadonlySet<string>): PlanRow {
  return {
    key: pkg.sectionNodeId,
    included: true,
    code: pkg.code,
    name: pkg.name,
    responsibleOwner: '',
    weightPercent: String(Math.round(pkg.suggestedWeight * 100)),
    leafIds: pkg.leafIds,
    totalValue: pkg.totalValue,
    hasUnpriced: pkg.leafIds.some((id) => unpricedLeafIds.has(id)),
  };
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

  // Rows are seeded from the suggestion once per dialog open, then owned locally — the PM edits
  // freely and re-running the suggestion (e.g. a background refetch) must never clobber an edit.
  const current =
    rows ?? (suggestion ? suggestion.packages.map((p) => toRow(p, new Set(suggestion.unpricedLeafIds))) : []);

  function update(key: string, patch: Partial<PlanRow>) {
    setError(null);
    setRows(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
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

  const leafDescriptions = useMemo(() => {
    const map = new Map<string, { code: string; description: string }>();
    const visit = (node: BoqTreeNodeResponse) => {
      if (node.isLeaf) map.set(node.id, { code: node.code, description: node.description });
      else node.children.forEach(visit);
    };
    (tree.data ?? []).forEach(visit);
    return map;
  }, [tree.data]);

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
      <DialogContent className="rounded-xl p-5 sm:max-w-4xl sm:p-6" aria-describedby="delivery-plan-desc">
        <DialogTitle>{t('deliveryPlan.title')}</DialogTitle>
        <DialogDescription id="delivery-plan-desc">{t('deliveryPlan.subtitle')}</DialogDescription>

        <div className="mt-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !suggestion || suggestion.packages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">{t('deliveryPlan.empty')}</p>
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
                        leafDescriptions={leafDescriptions}
                        t={t}
                      />
                    ))}
                  </RefTbody>
                </RefTable>
              </RefTableScroll>

              <p className={`mt-3 text-xs ${totalWeightPercent > 100 ? 'text-amber-600' : 'text-gray-500'}`}>
                {totalWeightPercent > 100
                  ? t('deliveryPlan.weightTotalOver', { total: totalWeightPercent })
                  : t('deliveryPlan.weightTotal', { total: totalWeightPercent })}
              </p>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
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
  leafDescriptions,
  t,
}: {
  row: PlanRow;
  currency: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<PlanRow>) => void;
  leafDescriptions: Map<string, { code: string; description: string }>;
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  return (
    <>
      <RefTr className={row.included ? '' : 'opacity-50'}>
        <RefTd>
          <input
            type="checkbox"
            checked={row.included}
            onChange={(e) => onChange({ included: e.target.checked })}
            aria-label={`${t('deliveryPlan.col.include')} — ${row.name}`}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
            className="flex items-center gap-1 text-gray-700 hover:text-gray-900"
          >
            {isExpanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <span>{t('deliveryPlan.coverageCount', { count: row.leafIds.length })}</span>
          </button>
          <div className="text-xs text-gray-500">{formatMoney(String(row.totalValue), currency, 'en')}</div>
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
            <span className="text-gray-500">%</span>
          </div>
        </RefTd>
        <RefTd>
          {!row.included ? (
            <RefPill tone="gray">{t('deliveryPlan.excluded')}</RefPill>
          ) : row.hasUnpriced ? (
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
          <RefTd colSpan={7} className="bg-gray-50">
            <p className="mb-1 text-xs font-medium text-gray-500">{t('deliveryPlan.inspect')}</p>
            <ul className="space-y-0.5">
              {row.leafIds.map((id) => {
                const leaf = leafDescriptions.get(id);
                return (
                  <li key={id} className="text-xs text-gray-700">
                    <span className="font-mono text-gray-500">{leaf?.code ?? id}</span>
                    {leaf ? ` — ${leaf.description}` : ''}
                  </li>
                );
              })}
            </ul>
          </RefTd>
        </RefTr>
      ) : null}
    </>
  );
}
