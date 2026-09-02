'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, GitCompare, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '@erp/ui';

import type { BoqTreeNodeResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { fromMinorUnits, sumMinorUnits, MONEY_SCALE } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/empty-state';
import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { LifecycleCommandDrawer } from '@/components/lifecycle-command-drawer';
import { usePermissions } from '@/features/auth/permissions/can';

import {
  buildRows,
  collectSectionIds,
  countTree,
  flattenTree,
  isPriced,
  type PricingFilter,
} from '../boq-rows';
import { computeRollup, type BoqTotals } from '../boq-totals';
import { compareToCsv, downloadCsv, treeToCsv } from '../boq-export';
import { resolveNextStep, type BoqNextStep } from '../boq-next-step';
import {
  useBaselineVersion,
  useBoqCompare,
  useBoqTree,
  useBoqWorkspace,
  useCancelDraftVersion,
  useCreateDraftVersion,
  useDeleteNode,
  useInitializeBoq,
  useMoveNode,
  useAddNode,
  useUpdateNode,
} from '../hooks/use-boq';
import {
  useCreateLibraryItem,
  useRecordLibraryUsage,
} from '../hooks/use-boq-item-library';
import { toCreateNodePayload, toUpdateNodePayload, type NodeFormValues } from '../node-form';
import { BOQ_PERMISSIONS } from '../permissions';
import { getVersionActions } from '../version-actions';
import { BoqComparePanel } from './boq-compare-panel';
import { BoqGrid, type BoqRowCommands } from './boq-grid';
import { BoqItemDrawer, type DrawerTarget, type LibraryIntent } from './boq-item-drawer';
import { BoqReadinessBanner } from './boq-readiness-banner';
import { BoqStatusBar } from './boq-status-bar';
import { BoqStickyBar, useIsOffScreen } from './boq-sticky-bar';
import { BoqToolbar } from './boq-toolbar';
import { BoqVersionPanel } from './boq-version-panel';

type Command = 'baseline' | 'discard' | 'revise' | null;

/**
 * The BOQ workspace.
 *
 * Composition follows the Project Workspace Overview: header, facts strip, an attention
 * banner, then the working surface. Everything commercial is decided server-side — the
 * workspace query withholds rates and totals from a user without commercial visibility, and
 * returns the readiness verdict rather than the raw facts to re-derive it from.
 */
export function BoqWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.boq');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();

  const workspaceQuery = useBoqWorkspace(projectId);
  const workspace = workspaceQuery.data;

  const [chosenVersionId, setChosenVersionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pricing, setPricing] = useState<PricingFilter>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [comparing, setComparing] = useState<{ left: string; right: string } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [stickyRef, stickyOffScreen] = useIsOffScreen();

  // Derived during render rather than synchronised in an effect: a cancelled draft or a
  // version baselined in another tab disappears from the list, and an effect would render
  // one frame pointing at a version that no longer exists.
  const defaultVersionId =
    workspace?.draft?.id ?? workspace?.approved?.id ?? workspace?.versions[0]?.id ?? null;
  const selectedVersionId =
    chosenVersionId && workspace?.versions.some((v) => v.id === chosenVersionId)
      ? chosenVersionId
      : defaultVersionId;

  const treeQuery = useBoqTree(projectId, selectedVersionId);
  const compareQuery = useBoqCompare(projectId, comparing?.left ?? null, comparing?.right ?? null);

  const initialize = useInitializeBoq(projectId);
  const addNode = useAddNode(projectId, selectedVersionId ?? '');
  const updateNode = useUpdateNode(projectId, selectedVersionId ?? '');
  const deleteNode = useDeleteNode(projectId, selectedVersionId ?? '');
  const moveNode = useMoveNode(projectId, selectedVersionId ?? '');
  const baseline = useBaselineVersion(projectId);
  const discard = useCancelDraftVersion(projectId);
  const revise = useCreateDraftVersion(projectId);
  // Library side-effects of an item add (ADR-020). Both are assistance and run best-effort:
  // recording the used rate and saving a manual entry never gate or fail the node add itself.
  const recordLibraryUsage = useRecordLibraryUsage();
  const saveLibraryItem = useCreateLibraryItem();

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const counts = useMemo(() => countTree(nodes), [nodes]);
  // The headline total and every section subtotal, in one memoized pass over the tree. Keyed
  // on the tree reference so a large BOQ is walked once per load, not per render.
  const rollup = useMemo(() => computeRollup(nodes), [nodes]);
  const rows = useMemo(
    () => buildRows(nodes, { collapsed, search, pricing, pinned: highlighted }),
    [nodes, collapsed, search, pricing, highlighted],
  );

  if (workspaceQuery.isPending) return <WorkspaceSkeleton label={tCommon('loading')} />;

  if (workspaceQuery.isError) {
    return (
      <Alert
        variant="error"
        title={t('loadFailed')}
        messages={[errorText(workspaceQuery.error, t('loadFailedHint'))]}
      />
    );
  }

  if (!workspace) return null;

  // A project with no BOQ is a starting state, not a failure.
  if (!workspace.boq) {
    return (
      <EmptyState
        variant="page"
        icon={<ClipboardList size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('notInitialized')}
        description={t('notInitializedHint')}
        action={
          workspace.capabilities.canManage ? (
            <Button className="gap-2" disabled={initialize.isPending} onClick={() => initialize.mutate()}>
              <Plus size={16} aria-hidden="true" />
              {initialize.isPending ? t('initializing') : t('initialize')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const selected = workspace.versions.find((version) => version.id === selectedVersionId) ?? null;
  const isDraft = selected !== null && selected.id === workspace.draft?.id;
  const canManage = can(BOQ_PERMISSIONS.manage) && workspace.capabilities.canManage && isDraft;
  const canViewCommercials = workspace.capabilities.canViewCommercials;
  const actions = getVersionActions(workspace, selectedVersionId);

  const allSectionIds = collectSectionIds(nodes);
  const allExpanded = collapsed.size === 0;
  const isFiltered = search.trim().length > 0 || pricing !== 'all';
  const nextStep = resolveNextStep(workspace, selectedVersionId);

  /** Narrows the grid to specific rows and scrolls them into view. */
  const showNodes = (nodeIds: string[]) => {
    setHighlighted(new Set(nodeIds));
    setSearch('');
    setPricing('all');
    // Expand everything: a blocker inside a collapsed section would otherwise be filtered
    // to and then not shown, which reads as the button doing nothing.
    setCollapsed(new Set());
    document.getElementById('boq-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Runs whatever `resolveNextStep` decided. Fix steps navigate; transitions open their
   * lifecycle drawer. The button is the instruction and the navigation both.
   */
  const runNextStep = () => {
    switch (nextStep.kind) {
      case 'INITIALIZE':
        initialize.mutate();
        return;
      case 'ADD_ITEMS':
        setDrawer({ mode: 'add', kind: 'section', parent: null, node: null });
        return;
      case 'PRICE_ITEMS':
      case 'FIX_BLOCKERS':
        showNodes(nextStep.targetNodeIds ?? []);
        return;
      case 'SUBMIT_BASELINE':
        setCommand('baseline');
        return;
      case 'START_REVISION':
        setCommand('revise');
        return;
      default:
        return;
    }
  };

  // The sum of what is on screen, so a filtered footer does not show a count and a total
  // that describe different sets of rows.
  const visibleAmount = isFiltered
    ? sumVisibleItems(rows.map((row) => row.node))
    : (selected?.totalAmount ?? null);

  // The headline metric strip. The TOTAL is the server's version total (the exact figure the
  // status bar and version panel show), so the three can never disagree; the completeness
  // figures come from the tree rollup the section subtotals are also drawn from.
  const headlineMetrics: Metric[] = buildHeadlineMetrics({
    totalAmount: selected?.totalAmount ?? null,
    totals: rollup.totals,
    currency: workspace.currency,
    canViewCommercials,
    t,
  });

  const toggleCollapsed = (nodeId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const rowCommands: BoqRowCommands | null = canManage
    ? {
        onEdit: (node) =>
          setDrawer({ mode: 'edit', kind: node.isLeaf ? 'item' : 'section', parent: null, node }),
        onAddItem: (parent) => setDrawer({ mode: 'add', kind: 'item', parent, node: null }),
        onAddSection: (parent) => setDrawer({ mode: 'add', kind: 'section', parent, node: null }),
        onDelete: (node) => {
          if (!selectedVersionId) return;
          deleteNode.mutate(node.id);
        },
        onMove: (node, direction) => {
          if (!selectedVersionId) return;
          moveNode.mutate({
            nodeId: node.id,
            ...(node.parentId ? { newParentId: node.parentId } : {}),
            newSortOrder: Math.max(0, node.sortOrder + direction),
          });
        },
      }
    : null;

  const handleExportTree = () => {
    downloadCsv(
      `BOQ-v${selected?.versionNumber ?? 1}.csv`,
      treeToCsv(nodes, workspace.currency, {
        includePricing: canViewCommercials,
        headers: exportHeaders(t),
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div ref={stickyRef}>
        <BoqStatusBar
          version={selected}
          revision={isDraft ? workspace.revision : null}
          currency={workspace.currency}
          sectionCount={counts.sections}
          itemCount={counts.items}
          pricedCount={counts.priced}
          contractBaseline={workspace.contractBaseline}
          contractMatchesApproved={
            workspace.contractBaseline?.id === workspace.approved?.id
          }
          canViewCommercials={canViewCommercials}
          actions={
            <>
              {/* Exactly one primary, and it is never disabled — see boq-next-step.ts. */}
              <NextStepButton step={nextStep} onRun={runNextStep} />

              {workspace.revision ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    setComparing({
                      left: workspace.revision!.basedOnVersionId,
                      right: workspace.draft!.id,
                    })
                  }
                >
                  <GitCompare size={16} aria-hidden="true" />
                  {t('actions.reviewChanges')}
                </Button>
              ) : null}

              {/* Everything else moves behind the overflow. Four peer buttons is a toolbar,
                  not a decision. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('actions.more')}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={handleExportTree}>
                    {t('toolbar.export')}
                  </DropdownMenuItem>
                  {actions.canCreateDraft && nextStep.kind !== 'START_REVISION' ? (
                    <DropdownMenuItem onSelect={() => setCommand('revise')}>
                      {t('actions.startRevision')}
                    </DropdownMenuItem>
                  ) : null}
                  {actions.canBaseline && nextStep.kind !== 'SUBMIT_BASELINE' ? (
                    <DropdownMenuItem onSelect={() => setCommand('baseline')}>
                      {t('actions.submitForBaseline')}
                    </DropdownMenuItem>
                  ) : null}
                  {actions.canCancelDraft ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setCommand('discard')}>
                        {t('actions.discardDraft')}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      <BoqStickyBar
        visible={stickyOffScreen}
        versionNumber={selected?.versionNumber ?? null}
        status={selected?.status ?? 'DRAFT'}
        totalAmount={selected?.totalAmount ?? null}
        currency={workspace.currency}
        canViewCommercials={canViewCommercials}
        action={<NextStepButton step={nextStep} onRun={runNextStep} />}
      />

      {workspace.readiness && isDraft ? (
        <BoqReadinessBanner
          readiness={workspace.readiness}
          // Not dismissible while it is the thing standing between the user and a
          // baseline — closing it would leave a screen with nothing to act on.
          dismissible={workspace.readiness.ready}
          onShowNodes={showNodes}
        />
      ) : null}

      {/* The BOQ headline — the project budget, the first number the eye should land on.
          The total is the version total the status bar and version panel already show, so the
          three never disagree; the completeness figures come from the memoized tree rollup. */}
      <MetricStrip aria-label={t('metrics.label')} metrics={headlineMetrics} />

      <div id="boq-grid" className="space-y-3 scroll-mt-4">
        <BoqToolbar
          search={search}
          onSearchChange={setSearch}
          pricing={pricing}
          onPricingChange={(next) => {
            setPricing(next);
            if (next === 'all') setHighlighted(new Set());
          }}
          allExpanded={allExpanded}
          onToggleExpandAll={() =>
            setCollapsed(allExpanded ? new Set(allSectionIds) : new Set())
          }
          onExport={handleExportTree}
          onAddSection={() => setDrawer({ mode: 'add', kind: 'section', parent: null, node: null })}
          canManage={canManage}
          resultCount={rows.length}
          totalCount={counts.sections + counts.items}
        />

        {treeQuery.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : treeQuery.isError ? (
          <Alert variant="error" messages={[errorText(treeQuery.error, t('loadFailed'))]} />
        ) : (
          <BoqGrid
            rows={rows}
            totalRows={counts.sections + counts.items}
            currency={workspace.currency}
            totalAmount={selected?.totalAmount ?? null}
            visibleAmount={visibleAmount}
            sectionTotals={rollup.sectionTotals}
            isFiltered={isFiltered}
            canManage={canManage}
            canViewCommercials={canViewCommercials}
            highlighted={highlighted}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onSelect={(node) =>
              setDrawer({
                mode: canManage ? 'edit' : 'edit',
                kind: node.isLeaf ? 'item' : 'section',
                parent: null,
                node,
              })
            }
            commands={rowCommands}
            emptyMessage={
              search || pricing !== 'all'
                ? t('grid.noMatches')
                : isDraft
                  ? t('grid.emptyDraft')
                  : t('grid.empty')
            }
          />
        )}
      </div>

      <BoqVersionPanel
        versions={workspace.versions}
        selectedId={selectedVersionId}
        currency={workspace.currency}
        canViewCommercials={canViewCommercials}
        open={versionsOpen}
        onToggle={() => setVersionsOpen((current) => !current)}
        onSelect={setChosenVersionId}
        onCompare={(left, right) => setComparing({ left, right })}
      />

      <BoqItemDrawer
        // Remount when the drawer points somewhere else, so the form seeds from the new
        // node instead of syncing itself in an effect.
        key={
          drawer
            ? `${drawer.mode}-${drawer.kind}-${drawer.node?.id ?? drawer.parent?.id ?? 'root'}`
            : 'closed'
        }
        target={drawer}
        currency={workspace.currency}
        readOnly={!canManage}
        isPending={addNode.isPending || updateNode.isPending}
        // Library assistance rides on the same permission as managing the BOQ (both the
        // controller's create/record-usage need `manage:boq`, which `canManage` implies).
        libraryEnabled={canManage}
        canViewCommercials={canViewCommercials}
        canSaveToLibrary={canManage}
        errorMessage={
          addNode.error || updateNode.error
            ? errorText(addNode.error ?? updateNode.error, t('editor.saveFailed'))
            : undefined
        }
        onClose={() => {
          addNode.reset();
          updateNode.reset();
          setDrawer(null);
        }}
        onSubmit={(values, target, library) => handleSave(values, target, library)}
      />

      {comparing ? (
        <BoqComparePanel
          diff={compareQuery.data}
          isPending={compareQuery.isPending}
          isError={compareQuery.isError}
          canViewCommercials={canViewCommercials}
          onExport={() => {
            if (!compareQuery.data) return;
            downloadCsv(
              `BOQ-compare-v${compareQuery.data.leftVersionNumber}-v${compareQuery.data.rightVersionNumber}.csv`,
              compareToCsv(compareQuery.data, {
                includePricing: canViewCommercials,
                headers: exportHeaders(t),
                changeHeaders: {
                  kind: t('compare.change'),
                  delta: t('compare.delta'),
                  percent: t('compare.percent'),
                },
              }),
            );
          }}
          onClose={() => setComparing(null)}
        />
      ) : null}

      {command ? (
        <LifecycleCommandDrawer
          open
          onClose={() => {
            baseline.reset();
            discard.reset();
            revise.reset();
            setCommand(null);
          }}
          commandName={t(`commands.${command}.name`)}
          currentStatus={command === 'revise' ? 'BASELINED' : 'DRAFT'}
          nextStatus={
            command === 'baseline' ? 'BASELINED' : command === 'discard' ? 'CANCELLED' : 'DRAFT'
          }
          businessImpact={businessImpact(command, actions, t)}
          reason={
            command === 'revise'
              ? { required: false, label: t('commands.revise.notes'), hint: t('commands.revise.notesHint') }
              : undefined
          }
          confirmLabel={t(`commands.${command}.confirm`)}
          isDestructive={command === 'discard'}
          isPending={baseline.isPending || discard.isPending || revise.isPending}
          errorMessage={commandError(command, t)}
          onConfirm={(reason) => runCommand(command, reason)}
        />
      ) : null}
    </div>
  );

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function handleSave(values: NodeFormValues, target: DrawerTarget, library: LibraryIntent) {
    if (!selectedVersionId) return;

    if (target.mode === 'edit' && target.node) {
      updateNode.mutate(
        {
          nodeId: target.node.id,
          payload: toUpdateNodePayload(values, { kind: target.kind }),
        },
        { onSuccess: () => setDrawer(null) },
      );
      return;
    }

    const payload = toCreateNodePayload(values, {
      kind: target.kind,
      parentId: target.parent?.id,
    });

    addNode.mutate(payload, {
      onSuccess: () => {
        // Library side-effects run AFTER the node is saved and never block it — a failure
        // here must not undo or surface an error on the add the user actually asked for.
        runLibrarySideEffects(values, library, payload.unitRate ?? null);
        setDrawer(null);
      },
    });
  }

  /**
   * Records a picked item's used rate and/or saves a manual entry to the library. Fire-and-
   * forget: the library is assistance (ADR-020 CONST-BOQ-021), so neither call gates the add,
   * and a `409` on save (code already exists) is swallowed rather than shown as a failure.
   */
  function runLibrarySideEffects(
    values: NodeFormValues,
    library: LibraryIntent,
    unitRate: string | null,
  ) {
    if (library.pickedItemId && unitRate) {
      recordLibraryUsage.mutate({
        id: library.pickedItemId,
        payload: { rate: unitRate, projectId },
      });
    }

    if (library.saveToLibrary) {
      const unit = values.unit.trim();
      saveLibraryItem.mutate({
        code: values.code.trim(),
        description: values.description.trim(),
        ...(unit ? { defaultUnit: unit } : {}),
        measurementMethod: values.measurementMethod,
        pricingBasis: values.pricingBasis,
      });
    }
  }

  function runCommand(current: Exclude<Command, null>, reason: string) {
    const close = { onSuccess: () => setCommand(null) };

    if (current === 'baseline' && selectedVersionId) baseline.mutate(selectedVersionId, close);
    else if (current === 'discard' && selectedVersionId) discard.mutate(selectedVersionId, close);
    else if (current === 'revise') revise.mutate(reason, close);
  }

  function commandError(current: Exclude<Command, null>, translate: (key: string) => string) {
    const mutation = current === 'baseline' ? baseline : current === 'discard' ? discard : revise;
    if (!mutation.error) return undefined;

    // A 409 on baseline is the governance gate, not a failure — the version is now waiting
    // on an approver, and saying "failed" would be wrong (ADR-011/015).
    if (
      current === 'baseline' &&
      mutation.error instanceof ApiError &&
      mutation.error.status === 409
    ) {
      return translate('commands.baseline.awaitingApproval');
    }

    return errorText(mutation.error, translate(`commands.${current}.failed`));
  }
}

/**
 * The four headline metrics, pre-formatted for the metric strip.
 *
 * The total is the caller-supplied version total (the exact figure the status bar and version
 * panel show), not a re-derived sum — so the three never disagree. When commercial visibility
 * is withheld the total reads "Restricted", never a blank or a fake zero. The completeness
 * figures come from the tree rollup and are always visible: a count is not commercial.
 */
function buildHeadlineMetrics({
  totalAmount,
  totals,
  currency,
  canViewCommercials,
  t,
}: {
  totalAmount: string | null;
  totals: BoqTotals;
  currency: string;
  canViewCommercials: boolean;
  t: ReturnType<typeof useTranslations>;
}): Metric[] {
  const totalValue = canViewCommercials
    ? (formatMoney(totalAmount, currency, 'en') ?? t('metrics.notPriced'))
    : t('metrics.restricted');

  return [
    { label: t('metrics.totalValue'), value: totalValue },
    {
      label: t('metrics.priced'),
      value: t('metrics.pricedValue', { priced: totals.pricedCount, total: totals.itemCount }),
    },
    {
      label: t('metrics.unpriced'),
      value: t('metrics.unpricedValue', { count: totals.unpricedCount }),
    },
    {
      label: t('metrics.percentPriced'),
      value: t('metrics.percentValue', { percent: totals.pricedPercent }),
    },
  ];
}

/**
 * The single primary action. Always `brand-primary`.
 *
 * A first attempt filled this with `warning` when the step was a fix, on the theory that an
 * amber button would read as urgency. Two things were wrong with that. `--warning` is
 * `#9a5b13` — a token sized for *text* contrast on a light surface, so as a fill it renders
 * brown and looks like a disabled or broken control rather than an invitation. And it
 * contradicts the rule in `frontend-theme.md`: brand is the interactive colour and nothing
 * else, status colours sit on status.
 *
 * Urgency is already carried where it belongs — the amber banner above and the amber row
 * edges below. The button's job is to be the one obvious thing to press, and it is never
 * rendered disabled: `resolveNextStep` returns something doable, or nothing at all.
 */
function NextStepButton({ step, onRun }: { step: BoqNextStep; onRun: () => void }) {
  const t = useTranslations('platform.boq.nextStep');
  if (step.tone === 'none') return null;

  return (
    <Button size="sm" className="gap-2" onClick={onRun}>
      {t(step.kind, { count: step.count ?? 0 })}
    </Button>
  );
}

/** Sum of the visible billable rows, in minor units, so a filtered footer stays honest. */
function sumVisibleItems(nodes: BoqTreeNodeResponse[]): string | null {
  const items = flattenTree(nodes).filter((node) => node.isLeaf && isPriced(node));
  if (items.length === 0) return null;
  const minor = sumMinorUnits(
    items.map((item) => item.computedTotal),
    MONEY_SCALE,
  );
  return fromMinorUnits(minor, MONEY_SCALE);
}

function businessImpact(
  command: Exclude<Command, null>,
  actions: ReturnType<typeof getVersionActions>,
  t: (key: string) => string,
): string {
  if (command !== 'baseline') return t(`commands.${command}.impact`);

  // Baselining the first version fixes the original contract BOQ, which is immutable
  // thereafter — a materially different consequence from superseding a later revision.
  if (actions.isFirstBaseline) return t('commands.baseline.impactFirst');
  return t('commands.baseline.impactRevision');
}

function exportHeaders(t: (key: string, values?: Record<string, string>) => string) {
  return {
    code: t('grid.code'),
    description: t('grid.description'),
    type: t('grid.type'),
    unit: t('grid.unit'),
    quantity: t('grid.quantity'),
    rate: t('export.rate'),
    amount: t('export.amount'),
    source: t('grid.source'),
    section: t('grid.typeSection'),
    item: t('grid.typeItem'),
  };
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}

function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {/* Skeletons mirror the final layout — a generic grey block teaches the reader
          nothing about what is arriving. */}
      <Skeleton className="h-20 w-full" aria-hidden="true" />
      <Skeleton className="h-24 w-full" aria-hidden="true" />
      <Skeleton className="h-96 w-full" aria-hidden="true" />
    </div>
  );
}
