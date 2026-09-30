'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { ProjectCostBudgetLineResponse } from '@erp/types';
import {
  Alert,
  Button,
  ConfirmDialog,
  Input,
  MoneyInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';
import {
  useCreateProjectCostBudget,
  useUpdateProjectCostBudget,
} from '@/features/procurement/hooks/use-project-procurement';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { flattenTree } from '@/features/boq/boq-rows';
import { useSpendCategories } from '@/features/procurement/hooks/use-procurement';
import { SectionPanel } from '@/features/procurement/components/project/section-panel';

/** One budget line as the editor holds it: strings, because that is what the inputs contain. */
export interface BudgetLineDraft {
  key: string;
  target: 'BOQ' | 'CATEGORY';
  boqNodeId: string;
  spendCategoryId: string;
  description: string;
  amount: string;
}

type LineProblem = 'target' | 'description' | 'amount';

function emptyLine(): BudgetLineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    target: 'BOQ',
    boqNodeId: '',
    spendCategoryId: '',
    description: '',
    amount: '',
  };
}

/** A saved line as the editor's starting point. */
export function draftFromLine(line: ProjectCostBudgetLineResponse): BudgetLineDraft {
  return {
    key: line.id,
    target: line.boqNodeId ? 'BOQ' : 'CATEGORY',
    boqNodeId: line.boqNodeId ?? '',
    spendCategoryId: line.spendCategoryId ?? '',
    description: line.description,
    amount: line.budgetAmount,
  };
}

/**
 * Every line targets exactly one of a BOQ item or a project spend category — the same rule the
 * server enforces. A line with neither is an unlabelled number nobody can reconcile against
 * anything, and a line with both would roll up two ways at once.
 */
export function budgetLineProblem(line: BudgetLineDraft): LineProblem | null {
  if (line.target === 'BOQ' && !line.boqNodeId) return 'target';
  if (line.target === 'CATEGORY' && !line.spendCategoryId) return 'target';
  if (!line.description.trim()) return 'description';
  const minor = parseMinorUnits(line.amount, MONEY_SCALE);
  if (minor === null || minor < 0) return 'amount';
  return null;
}

/** What a line carries, without its React key — for "has anything changed". */
const signature = (lines: BudgetLineDraft[]) =>
  JSON.stringify(
    lines.map(({ target, boqNodeId, spendCategoryId, description, amount }) => [
      target,
      boqNodeId,
      spendCategoryId,
      description,
      amount,
    ]),
  );

/**
 * The cost budget, edited in its own table (ADR-039: values that sit in a table are edited in
 * the table — no side sheet, no dialog).
 *
 * The save model is the same as the editor it replaces: the whole version is written in one call.
 * `create` starts a new Working version (`POST …/budgets` with every line); `edit` replaces the
 * Working version's lines (`PATCH …/budgets/:id` with every line). There is no per-line save — a
 * budget is only meaningful as a whole, and a half-saved one would be measured against.
 *
 * Leaving with unsaved edits asks first. Baselining and discarding are version actions and live on
 * the budget panel, outside edit mode, so neither can act on a version that differs from what the
 * user is looking at.
 */
export function BudgetLinesEditor({
  projectId,
  mode,
  budgetId,
  versionNumber,
  currency,
  initialLines,
  unreadableLineCount = 0,
  onExit,
}: {
  projectId: string;
  mode: 'create' | 'edit';
  budgetId?: string;
  /** The version being written, for the heading. */
  versionNumber: number;
  currency: string;
  /** Where the table starts. Empty means one blank line. */
  initialLines: BudgetLineDraft[];
  /**
   * Lines the Working version already has that the API does not return to this screen. Saving
   * replaces them, so the user is told how many there are rather than finding out afterwards.
   */
  unreadableLineCount?: number;
  onExit: () => void;
}) {
  const t = useTranslations('finance.budgetEditor');
  const tc = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';

  const create = useCreateProjectCostBudget(projectId);
  const update = useUpdateProjectCostBudget(projectId);

  const startingLines = React.useMemo(
    () => (initialLines.length > 0 ? initialLines : [emptyLine()]),
    [initialLines],
  );
  const [lines, setLines] = React.useState<BudgetLineDraft[]>(startingLines);
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);

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

  const dirty = signature(lines) !== signature(startingLines);
  const saving = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;
  const valid = lines.length > 0 && lines.every((l) => budgetLineProblem(l) === null);
  const totalMinor = lines.reduce(
    (sum, l) => sum + (parseMinorUnits(l.amount, MONEY_SCALE) ?? 0),
    0,
  );

  // A reload or tab close would drop the edits silently; the browser's own prompt covers it.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const patch = (key: string, next: Partial<BudgetLineDraft>) =>
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
      create.mutate({ currency, lines: payloadLines() }, { onSuccess: () => onExit() });
    } else if (budgetId) {
      update.mutate(
        { budgetId, payload: { lines: payloadLines() } },
        { onSuccess: () => onExit() },
      );
    }
  }

  function handleCancel() {
    if (saving) return;
    if (dirty) setConfirmLeave(true);
    else onExit();
  }

  const heading = mode === 'create' ? t('createTitle') : t('editTitle');

  return (
    <>
      <SectionPanel
        title={heading}
        description={t('description')}
        bodyClassName="p-0"
        action={
          <span className="text-caption text-muted-foreground">
            {t('editingVersion', { version: versionNumber })}
          </span>
        }
      >
        <div className="space-y-3 px-4 pt-3 sm:px-5">
          {unreadableLineCount > 0 ? (
            <Alert variant="warning">{t('replacesLines', { count: unreadableLineCount })}</Alert>
          ) : null}
          {mutationError ? (
            <Alert
              variant="error"
              messages={[mutationError instanceof Error ? mutationError.message : tc('loadFailed')]}
            />
          ) : null}
        </div>

        <TableScroll aria-label={heading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">{t('targetType')}</TableHead>
                <TableHead className="min-w-60">{t('targetValue')}</TableHead>
                <TableHead className="min-w-52">{t('lineDescription')}</TableHead>
                <TableHead numeric className="min-w-36">
                  {t('amount')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('removeLine')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const problem = showErrors ? budgetLineProblem(line) : null;
                const n = index + 1;
                return (
                  <TableRow key={line.key} className="[&>td]:align-top">
                    <TableCell className="min-w-40">
                      <Select
                        aria-label={t('targetTypeAria', { number: n })}
                        value={line.target}
                        disabled={saving}
                        onChange={(value) =>
                          // The two targets are alternatives: switching clears the other so a
                          // line can never carry both.
                          patch(line.key, {
                            target: value as BudgetLineDraft['target'],
                            boqNodeId: '',
                            spendCategoryId: '',
                          })
                        }
                      >
                        <option value="BOQ">{t('targetBoq')}</option>
                        <option value="CATEGORY">{t('targetCategory')}</option>
                      </Select>
                    </TableCell>
                    <TableCell className="min-w-60">
                      {line.target === 'BOQ' ? (
                        <Select
                          aria-label={t('boqItemAria', { number: n })}
                          value={line.boqNodeId}
                          disabled={saving || tree.isLoading || leafNodes.length === 0}
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
                          aria-label={t('spendCategoryAria', { number: n })}
                          value={line.spendCategoryId}
                          disabled={saving || categories.isLoading}
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
                      {problem ? (
                        <p className="mt-1 text-caption text-danger">{t(`lineError.${problem}`)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-52">
                      <Input
                        aria-label={t('descriptionAria', { number: n })}
                        value={line.description}
                        disabled={saving}
                        onChange={(e) => patch(line.key, { description: e.target.value })}
                      />
                    </TableCell>
                    <TableCell numeric className="min-w-36">
                      <MoneyInput
                        aria-label={t('amountAria', { number: n })}
                        className="text-end tabular-nums"
                        value={line.amount}
                        disabled={saving}
                        onValueChange={(value) => patch(line.key, { amount: value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('removeLineAria', { number: n })}
                        // A version needs at least one line, so the last one cannot go.
                        disabled={saving || lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40">
                <TableCell colSpan={3}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  >
                    {t('addLine')}
                  </Button>
                </TableCell>
                {/* Live, because a budget is built by watching the total move. */}
                <TableCell numeric aria-live="polite" className="font-semibold text-foreground">
                  <span className="sr-only">{t('totalLabel')} </span>
                  <bdi className="tabular-nums">
                    {formatMoney(fromMinorUnits(totalMinor, MONEY_SCALE), currency, locale)}
                  </bdi>
                </TableCell>
                <TableCell className="text-caption text-muted-foreground">
                  {t('lineCount', { count: lines.length })}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableScroll>
      </SectionPanel>

      {/* Fixed action bar — present only while editing. One primary. */}
      <div
        role="region"
        aria-label={t('actionsLabel')}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 md:start-16 lg:start-[var(--sidebar-width)]"
      >
        <div className="flex w-full flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <p className="me-auto hidden text-caption text-muted-foreground sm:block">
            {dirty ? t('unsaved') : t('noChanges')}
          </p>
          <Button type="button" variant="outline" disabled={saving} onClick={handleCancel}>
            {tc('cancel')}
          </Button>
          <Button type="button" disabled={saving} onClick={handleSave}>
            {saving ? tc('saving') : t('save')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t('discardEditsTitle')}
        description={t('discardEditsBody')}
        confirmLabel={t('discardEditsConfirm')}
        cancelLabel={t('keepEditing')}
        initialFocus="cancel"
        onConfirm={() => {
          setConfirmLeave(false);
          onExit();
        }}
      />
    </>
  );
}
