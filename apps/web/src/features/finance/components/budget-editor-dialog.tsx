'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  MoneyInput,
  Select,
  Skeleton,
} from '@erp/ui';

import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';
import { usePermissions } from '@/features/auth/permissions/can';
import {
  useBaselineProjectCostBudget,
  useCreateProjectCostBudget,
  useDiscardProjectCostBudget,
  useProjectCostBudgets,
  useUpdateProjectCostBudget,
} from '@/features/procurement/hooks/use-project-procurement';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { flattenTree } from '@/features/boq/boq-rows';
import { useSpendCategories } from '@/features/procurement/hooks/use-procurement';

const BUDGET_BASELINE = 'baseline:project-budget' as const;

/** One budget line as the editor holds it: strings, because that is what the inputs contain. */
interface LineDraft {
  key: string;
  target: 'BOQ' | 'CATEGORY';
  boqNodeId: string;
  spendCategoryId: string;
  description: string;
  amount: string;
}

function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    target: 'BOQ',
    boqNodeId: '',
    spendCategoryId: '',
    description: '',
    amount: '',
  };
}

/**
 * Author a cost budget version.
 *
 * Every line targets exactly one of a BOQ item or a project spend category — the same rule the
 * server enforces. A line with neither is an unlabelled number nobody can reconcile against
 * anything, and a line with both would roll up two ways at once.
 *
 * Baselining is a freeze, not an approval. The confirmation says what it actually does: this
 * version becomes the figure the project is measured against, and changing it later means a new
 * revision. Calling it "approve" would claim a governance step the model does not have.
 */
export function BudgetEditorDialog({
  projectId,
  mode,
  budgetId,
  currency,
  onClose,
}: {
  projectId: string;
  mode: 'create' | 'edit';
  budgetId?: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations('finance.budgetEditor');
  const tc = useTranslations('finance.common');
  const { can } = usePermissions();

  const budgets = useProjectCostBudgets(projectId);
  const create = useCreateProjectCostBudget(projectId);
  const update = useUpdateProjectCostBudget(projectId);
  const baseline = useBaselineProjectCostBudget(projectId);
  const discard = useDiscardProjectCostBudget(projectId);

  const existing = React.useMemo(() => {
    if (mode !== 'edit' || !budgetId) return null;
    const list = budgets.data;
    if (!list) return null;
    if (list.baselined?.id === budgetId) return list.baselined;
    return null;
  }, [mode, budgetId, budgets.data]);

  // Only the user's edits are held in state; everything else is derived from the server's copy.
  // Hydrating via an effect would set state during render and leave a frame in which the editor
  // shows an empty line over a budget that already has twelve.
  const [edited, setEdited] = React.useState<LineDraft[] | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirmBaseline, setConfirmBaseline] = React.useState(false);

  const serverLines = React.useMemo<LineDraft[]>(() => {
    if (mode !== 'edit' || !existing) return [emptyLine()];
    if (existing.lines.length === 0) return [emptyLine()];
    return existing.lines.map((line) => ({
      key: line.id,
      target: line.boqNodeId ? ('BOQ' as const) : ('CATEGORY' as const),
      boqNodeId: line.boqNodeId ?? '',
      spendCategoryId: line.spendCategoryId ?? '',
      description: line.description,
      amount: line.budgetAmount,
    }));
  }, [mode, existing]);

  const lines = edited ?? serverLines;
  const setLines = (next: LineDraft[] | ((prev: LineDraft[]) => LineDraft[])) =>
    setEdited(typeof next === 'function' ? next(lines) : next);

  const workspace = useBoqWorkspace(projectId);
  const baselineVersionId =
    workspace.data?.contractBaseline?.id ?? workspace.data?.approved?.id ?? null;
  const tree = useBoqTree(projectId, baselineVersionId);
  const categories = useSpendCategories();

  const leafNodes = React.useMemo(
    () => (tree.data ? flattenTree(tree.data).filter((n) => n.isLeaf && n.isActive) : []),
    [tree.data],
  );
  const activeCategories = (categories.data ?? []).filter((c) => c.status === 'ACTIVE');

  const lineError = (line: LineDraft): 'target' | 'description' | 'amount' | null => {
    if (line.target === 'BOQ' && !line.boqNodeId) return 'target';
    if (line.target === 'CATEGORY' && !line.spendCategoryId) return 'target';
    if (!line.description.trim()) return 'description';
    const minor = parseMinorUnits(line.amount, MONEY_SCALE);
    if (minor === null || minor < 0) return 'amount';
    return null;
  };

  const valid = lines.length > 0 && lines.every((l) => lineError(l) === null);
  const totalMinor = lines.reduce(
    (sum, l) => sum + (parseMinorUnits(l.amount, MONEY_SCALE) ?? 0),
    0,
  );

  const patch = (key: string, next: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const payloadLines = () =>
    lines.map((line) => ({
      ...(line.target === 'BOQ'
        ? { boqNodeId: line.boqNodeId }
        : { spendCategoryId: line.spendCategoryId }),
      description: line.description.trim(),
      budgetAmount: (parseMinorUnits(line.amount, MONEY_SCALE) ?? 0) / 10 ** MONEY_SCALE,
    }));

  function handleSave() {
    setShowErrors(true);
    if (!valid) return;
    if (mode === 'create') {
      create.mutate(
        { currency, lines: payloadLines() },
        { onSuccess: () => onClose() },
      );
    } else if (budgetId) {
      update.mutate(
        { budgetId, payload: { lines: payloadLines() } },
        { onSuccess: () => onClose() },
      );
    }
  }

  const saving = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error ?? baseline.error ?? discard.error;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle>{mode === 'create' ? t('createTitle') : t('editTitle')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>

        {budgets.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4">
            {mutationError ? (
              <Alert
                variant="error"
                messages={[
                  mutationError instanceof Error ? mutationError.message : tc('loadFailed'),
                ]}
              />
            ) : null}

            <div className="space-y-3">
              {lines.map((line) => {
                const error = showErrors ? lineError(line) : null;
                return (
                  <div
                    key={line.key}
                    className="rounded-panel border border-border p-3.5"
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <FormField
                        htmlFor={`target-${line.key}`}
                        label={t('targetType')}
                        className="min-w-44 flex-1"
                      >
                        <Select
                          id={`target-${line.key}`}
                          value={line.target}
                          onChange={(value) =>
                            // The two targets are alternatives: switching clears the other so a
                            // line can never carry both.
                            patch(line.key, {
                              target: value as LineDraft['target'],
                              boqNodeId: '',
                              spendCategoryId: '',
                            })
                          }
                        >
                          <option value="BOQ">{t('targetBoq')}</option>
                          <option value="CATEGORY">{t('targetCategory')}</option>
                        </Select>
                      </FormField>

                      <FormField
                        htmlFor={`value-${line.key}`}
                        label={line.target === 'BOQ' ? t('boqItem') : t('spendCategory')}
                        className="min-w-56 flex-[2]"
                      >
                        {line.target === 'BOQ' ? (
                          <Select
                            id={`value-${line.key}`}
                            value={line.boqNodeId}
                            disabled={tree.isLoading || leafNodes.length === 0}
                            onChange={(value) => patch(line.key, { boqNodeId: value })}
                          >
                            <option value="">
                              {leafNodes.length === 0 ? t('noBoqItems') : t('selectBoqItem')}
                            </option>
                            {leafNodes.map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.code} · {node.description}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Select
                            id={`value-${line.key}`}
                            value={line.spendCategoryId}
                            disabled={categories.isLoading}
                            onChange={(value) => patch(line.key, { spendCategoryId: value })}
                          >
                            <option value="">{t('selectCategory')}</option>
                            {activeCategories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.code} · {category.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </FormField>

                      <FormField
                        htmlFor={`desc-${line.key}`}
                        label={t('lineDescription')}
                        className="min-w-48 flex-[2]"
                      >
                        <Input
                          id={`desc-${line.key}`}
                          value={line.description}
                          onChange={(e) => patch(line.key, { description: e.target.value })}
                        />
                      </FormField>

                      <FormField
                        htmlFor={`amount-${line.key}`}
                        label={t('amount')}
                        className="min-w-36 flex-1"
                      >
                        <MoneyInput
                          id={`amount-${line.key}`}
                          value={line.amount}
                          onValueChange={(value) => patch(line.key, { amount: value })}
                        />
                      </FormField>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('removeLine')}
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines((prev) => prev.filter((l) => l.key !== line.key))
                        }
                        className="min-h-11"
                      >
                        <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                      </Button>
                    </div>
                    {error ? (
                      <p className="mt-2 text-caption text-danger" role="alert">
                        {t(`lineError.${error}`)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                {t('addLine')}
              </Button>
              <p className="text-body-sm text-muted-foreground">
                {t('total', {
                  count: lines.length,
                  amount: (totalMinor / 10 ** MONEY_SCALE).toFixed(2),
                })}
              </p>
            </div>

            {/* Baselining is a freeze the project is then measured against, so it is confirmed
                explicitly and described for what it does — never as an approval. */}
            {confirmBaseline && budgetId ? (
              <Alert variant="warning" title={t('baselineConfirmTitle')}>
                <p className="text-caption">{t('baselineConfirmBody')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={baseline.isPending}
                    onClick={() =>
                      baseline.mutate(budgetId, { onSuccess: () => onClose() })
                    }
                  >
                    {t('baselineConfirmAction')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmBaseline(false)}>
                    {tc('cancel')}
                  </Button>
                </div>
              </Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          {mode === 'edit' && budgetId ? (
            <Button
              variant="outline"
              disabled={discard.isPending}
              onClick={() => discard.mutate(budgetId, { onSuccess: () => onClose() })}
            >
              {t('discardDraft')}
            </Button>
          ) : null}
          {mode === 'edit' && budgetId && can(BUDGET_BASELINE) ? (
            <Button
              variant="outline"
              disabled={!valid || confirmBaseline}
              onClick={() => setConfirmBaseline(true)}
            >
              {t('baseline')}
            </Button>
          ) : null}
          <Button disabled={saving} onClick={handleSave}>
            {saving ? tc('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
