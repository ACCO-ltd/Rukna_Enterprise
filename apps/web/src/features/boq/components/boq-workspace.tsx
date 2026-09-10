'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClipboardList, FileSpreadsheet, GitCompare, History, Plus } from 'lucide-react';
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
  useToast,
} from '@erp/ui';

import type { BoqTreeNodeResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { fromMinorUnits, sumMinorUnits, MONEY_SCALE } from '@/lib/money';
import { EmptyState } from '@/components/empty-state';
import { LifecycleCommandDrawer } from '@/components/lifecycle-command-drawer';
import { useProjectGuidance } from '@/features/projects/hooks/use-project';
import { usePermissions } from '@/features/auth/permissions/can';

import {
  buildRows,
  collectSectionIds,
  countTree,
  flattenTree,
  isPriced,
  type PricingFilter,
} from '../boq-rows';
import { computeRollup } from '../boq-totals';
import { treeToCsv, downloadCsv } from '../boq-export';
import { resolveNextStep, type BoqNextStep } from '../boq-next-step';
import {
  useBoqCompareToSigned,
  useBoqTimeline,
  useBoqTree,
  useBoqWorkspace,
  useCancelDraftVersion,
  useCommitVersion,
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
import {
  toCreateNodePayload,
  toNodeFormValues,
  toUpdateNodePayload,
  type NodeFormValues,
} from '../node-form';
import { BOQ_PERMISSIONS } from '../permissions';
import { getVersionActions } from '../version-actions';
import { BoqClassifierDrawer, type ClassifierResult } from './boq-classifier-drawer';
import { BoqCompareSignedPanel } from './boq-compare-signed-panel';
import { BoqGrid, type BoqRowCommands } from './boq-grid';
import { BoqImportDialog } from './boq-import-dialog';
import { BoqItemDrawer, type DrawerTarget, type LibraryIntent } from './boq-item-drawer';
import { BoqMoneyStrip } from './boq-money-strip';
import { BoqReadinessBanner } from './boq-readiness-banner';
import { BoqTimelineDrawer } from './boq-timeline-drawer';
import { BoqToolbar } from './boq-toolbar';

type Command = 'commit' | 'discard' | 'revise' | null;

/**
 * The BOQ workspace (R11 redesign).
 *
 * Composition follows the "Excel-level speed, ERP-level control" principle: a compact sticky
 * money strip on top, then the grid as the dominant surface, with the compare-to-signed lens and
 * the timeline summoned on demand. The two life-stages — WORKING and COMMITTED — are genuinely
 * different modes, driven off `moneyBand.lifeStage` (never re-derived). Everything commercial is
 * decided server-side: the workspace query withholds figures a tier cannot see, and this screen
 * renders what is present rather than re-summing anything.
 */
export function BoqWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.boq');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const { toast } = useToast();
  const router = useRouter();

  const guidance = useProjectGuidance(projectId);
  const workspaceQuery = useBoqWorkspace(projectId);
  const workspace = workspaceQuery.data;

  const [search, setSearch] = useState('');
  const [pricing, setPricing] = useState<PricingFilter>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [classifierOpen, setClassifierOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Draft variations raised in this session but not yet adopted — the H1 pending affordance.
  const [pendingVariations, setPendingVariations] = useState(0);

  // The one operational version the redesign works on: prefer the working draft, else the
  // approved/committed one. No user-facing version switching (Decision 9).
  const operationalVersionId =
    workspace?.draft?.id ?? workspace?.approved?.id ?? workspace?.versions[0]?.id ?? null;

  const treeQuery = useBoqTree(projectId, operationalVersionId);
  const compareQuery = useBoqCompareToSigned(projectId, compareOpen);
  const timelineQuery = useBoqTimeline(projectId, timelineOpen);

  const initialize = useInitializeBoq(projectId);
  const addNode = useAddNode(projectId, operationalVersionId ?? '');
  const updateNode = useUpdateNode(projectId, operationalVersionId ?? '');
  const deleteNode = useDeleteNode(projectId, operationalVersionId ?? '');
  const moveNode = useMoveNode(projectId, operationalVersionId ?? '');
  const commit = useCommitVersion(projectId);
  const discard = useCancelDraftVersion(projectId);
  const revise = useCreateDraftVersion(projectId);
  const recordLibraryUsage = useRecordLibraryUsage();
  const saveLibraryItem = useCreateLibraryItem();

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const counts = useMemo(() => countTree(nodes), [nodes]);
  const hasVariations = useMemo(
    () => flattenTree(nodes).some((node) => node.sourceType === 'VARIATION'),
    [nodes],
  );
  const siblingCodesUnder = useCallback(
    (parentId: string | null) =>
      nodes.filter((node) => node.parentId === parentId).map((node) => node.code),
    [nodes],
  );
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

  const capabilities = workspace.capabilities;
  const canEdit = capabilities.canEdit;
  const canViewCost = capabilities.canViewCost;
  const canViewMargin = capabilities.canViewMargin;

  // Empty BOQ (H2): two doors, only when the user can edit. Import creates the BOQ; Start blank
  // does too. A read-only user with no BOQ sees a plain "nothing here yet".
  if (!workspace.boq) {
    return (
      <>
        <EmptyState
          variant="page"
          icon={<ClipboardList size={25} strokeWidth={1.8} aria-hidden="true" />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            canEdit ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button className="gap-2" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet size={16} aria-hidden="true" />
                  {t('empty.import')}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={initialize.isPending}
                  onClick={() => initialize.mutate()}
                >
                  <Plus size={16} aria-hidden="true" />
                  {initialize.isPending ? t('initializing') : t('empty.startBlank')}
                </Button>
              </div>
            ) : undefined
          }
        />
        {importOpen ? (
          <BoqImportDialog
            projectId={projectId}
            currency={workspace.currency}
            open
            onClose={() => setImportOpen(false)}
            onImported={(summary) => toast({ title: summary })}
          />
        ) : null}
      </>
    );
  }

  const band = workspace.moneyBand;
  const committed = band?.lifeStage === 'COMMITTED';
  // The working draft is what free-editing acts on; a committed version pins value cells.
  const onDraft = operationalVersionId === workspace.draft?.id;
  // Edit affordances need edit permission AND an editable draft (the server refuses otherwise).
  const canManage = can(BOQ_PERMISSIONS.manage) && canEdit && onDraft;
  const canImport = canManage;
  const actions = getVersionActions(workspace, operationalVersionId);

  const allSectionIds = collectSectionIds(nodes);
  const allExpanded = collapsed.size === 0;
  const isFiltered = search.trim().length > 0 || pricing !== 'all';
  const nextStep = resolveNextStep(workspace, operationalVersionId);

  const pricedPercent = counts.items === 0 ? 0 : Math.round((counts.priced / counts.items) * 100);
  const unpricedCount = Math.max(0, counts.items - counts.priced);

  const showNodes = (nodeIds: string[]) => {
    setHighlighted(new Set(nodeIds));
    setSearch('');
    setPricing('all');
    setCollapsed(new Set());
    document.getElementById('boq-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const runNextStep = () => {
    switch (nextStep.kind) {
      case 'INITIALIZE':
        initialize.mutate();
        return;
      case 'ADD_ITEMS':
        setDrawer({ mode: 'add', kind: 'section', parent: null, node: null, siblingCodes: siblingCodesUnder(null) });
        return;
      case 'PRICE_ITEMS':
      case 'FIX_BLOCKERS':
        showNodes(nextStep.targetNodeIds ?? []);
        return;
      case 'SUBMIT_BASELINE':
        // WORKING → the forward move is commit-to-contract.
        setCommand('commit');
        return;
      case 'START_REVISION':
        setCommand('revise');
        return;
      default:
        return;
    }
  };

  const visibleAmount = isFiltered
    ? sumVisibleItems(rows.map((row) => row.node))
    : (workspace.draft?.totalAmount ?? workspace.approved?.totalAmount ?? null);

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
        onAddItem: (parent) =>
          setDrawer({ mode: 'add', kind: 'item', parent, node: null, siblingCodes: siblingCodesUnder(parent.id) }),
        onAddSection: (parent) =>
          setDrawer({ mode: 'add', kind: 'section', parent, node: null, siblingCodes: siblingCodesUnder(parent.id) }),
        onDelete: (node) => {
          if (!operationalVersionId) return;
          deleteNode.mutate(node.id);
        },
        onMove: (node, direction) => {
          if (!operationalVersionId) return;
          moveNode.mutate({
            nodeId: node.id,
            ...(node.parentId ? { newParentId: node.parentId } : {}),
            newSortOrder: Math.max(0, node.sortOrder + direction),
          });
        },
        onEditField: async (node, field, value) => {
          if (!operationalVersionId) return;
          const values = { ...toNodeFormValues(node), [field]: value };
          const payload = toUpdateNodePayload(values, { kind: node.isLeaf ? 'item' : 'section' });
          await updateNode.mutateAsync({ nodeId: node.id, payload });
        },
      }
    : null;

  // The primary action is life-stage-aware and never a disabled dead button (next-step doctrine).
  const contractAction =
    !workspace.draft && !committed
      ? guidance.data?.find((item) => item.kind === 'MAIN_CONTRACT_REQUIRED' && item.actionUrl)
      : undefined;

  const primaryAction = committed ? (
    canEdit ? (
      <Button size="sm" className="gap-2" onClick={() => setClassifierOpen(true)}>
        <Plus size={16} aria-hidden="true" />
        {t('mode.addExtraWork')}
      </Button>
    ) : null
  ) : contractAction?.actionUrl ? (
    <Button asChild size="sm">
      <Link href={contractAction.actionUrl}>{t('actions.createContract')}</Link>
    </Button>
  ) : (
    <NextStepButton step={nextStep} onRun={runNextStep} />
  );

  const compareAffordance = workspace.compareToSignedAvailable ? (
    <Button variant="outline" size="sm" className="gap-2" onClick={() => setCompareOpen(true)}>
      <GitCompare size={16} aria-hidden="true" />
      {t('compareToSigned.action')}
    </Button>
  ) : null;

  const timelineAffordance = (
    <Button variant="outline" size="sm" className="gap-2" onClick={() => setTimelineOpen(true)}>
      <History size={16} aria-hidden="true" />
      {t('timeline.action')}
    </Button>
  );

  const handleExportTree = () => {
    downloadCsv(
      `BOQ.csv`,
      treeToCsv(nodes, workspace.currency, {
        includePricing: canViewCost,
        headers: exportHeaders(t),
      }),
    );
  };

  return (
    <div className="space-y-3">
      <BoqMoneyStrip
        band={band}
        currency={workspace.currency}
        pricedPercent={pricedPercent}
        unpricedCount={unpricedCount}
        signedContractValue={band?.baseContractValue ?? null}
        pendingVariationCount={pendingVariations}
        onReviewVariations={() => router.push(`/projects/${projectId}/commercial/variations`)}
        primaryAction={primaryAction}
        secondaryActions={
          <>
            {compareAffordance}
            {timelineAffordance}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {t('actions.more')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleExportTree}>{t('toolbar.export')}</DropdownMenuItem>
                {actions.canCreateDraft && nextStep.kind !== 'START_REVISION' ? (
                  <DropdownMenuItem onSelect={() => setCommand('revise')}>
                    {t('actions.startRevision')}
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

      {workspace.readiness && onDraft && !committed ? (
        <BoqReadinessBanner
          readiness={workspace.readiness}
          dismissible={workspace.readiness.ready}
          onShowNodes={showNodes}
        />
      ) : null}

      {/* COMMITTED teaches the pin at the cell (grid), but a one-line note names the rule once. */}
      {committed && canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface-subtle px-4 py-2.5">
          <span className="text-body-sm text-muted-foreground">{t('mode.committedHint')}</span>
          <Link
            href={`/projects/${projectId}/commercial/variations`}
            className="inline-flex items-center gap-1 text-body-sm font-medium text-brand-primary hover:underline"
          >
            {t('contractLocked.action')}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : null}

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
          onToggleExpandAll={() => setCollapsed(allExpanded ? new Set(allSectionIds) : new Set())}
          onAddSection={() =>
            setDrawer({ mode: 'add', kind: 'section', parent: null, node: null, siblingCodes: siblingCodesUnder(null) })
          }
          onImport={() => setImportOpen(true)}
          canManage={canManage}
          canImport={canImport}
          hasVariations={hasVariations}
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
            totalAmount={workspace.draft?.totalAmount ?? workspace.approved?.totalAmount ?? null}
            visibleAmount={visibleAmount}
            sectionTotals={rollup.sectionTotals}
            isFiltered={isFiltered}
            canManage={canManage}
            canViewCommercials={canViewCost}
            committed={committed}
            showSource={hasVariations || committed}
            highlighted={highlighted}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onPinnedCellEdit={committed && canEdit ? () => setClassifierOpen(true) : undefined}
            onSelect={(node) =>
              setDrawer({
                mode: 'edit',
                kind: node.isLeaf ? 'item' : 'section',
                parent: null,
                node,
              })
            }
            commands={rowCommands}
            emptyMessage={
              search || pricing !== 'all'
                ? t('grid.noMatches')
                : onDraft
                  ? t('grid.emptyDraft')
                  : t('grid.empty')
            }
          />
        )}
      </div>

      {importOpen ? (
        <BoqImportDialog
          projectId={projectId}
          currency={workspace.currency}
          open
          onClose={() => setImportOpen(false)}
          onImported={(summary) => toast({ title: summary })}
        />
      ) : null}

      <BoqItemDrawer
        key={
          drawer
            ? `${drawer.mode}-${drawer.kind}-${drawer.node?.id ?? drawer.parent?.id ?? 'root'}`
            : 'closed'
        }
        target={drawer}
        currency={workspace.currency}
        readOnly={!canManage}
        isPending={addNode.isPending || updateNode.isPending}
        libraryEnabled={canManage}
        canViewCommercials={canViewCost}
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

      {classifierOpen ? (
        <BoqClassifierDrawer
          open
          currency={workspace.currency}
          contingencyRemaining={band?.contingencyRemaining ?? null}
          contractValue={band?.contractValue ?? null}
          totalClientRevenue={band?.totalClientRevenue ?? null}
          // Absorb (add new ABSORBED scope) and Separate (add a SEPARATE_CHARGE leaf) have no
          // committed HTTP route yet (R11 backend reality) — the drawer previews them but the CTA
          // stays honest. Variation is reachable via the Commercial variations flow.
          absorbEnabled={false}
          separateEnabled={false}
          isPending={false}
          onSubmit={handleClassify}
          onClose={() => setClassifierOpen(false)}
        />
      ) : null}

      {compareOpen ? (
        <BoqCompareSignedPanel
          data={compareQuery.data}
          currency={workspace.currency}
          canViewCost={canViewCost}
          isPending={compareQuery.isPending}
          isError={compareQuery.isError}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {timelineOpen ? (
        <BoqTimelineDrawer
          data={timelineQuery.data}
          currency={workspace.currency}
          canViewMargin={canViewMargin}
          isPending={timelineQuery.isPending}
          isError={timelineQuery.isError}
          onClose={() => setTimelineOpen(false)}
        />
      ) : null}

      {command ? (
        <LifecycleCommandDrawer
          open
          onClose={() => {
            commit.reset();
            discard.reset();
            revise.reset();
            setCommand(null);
          }}
          commandName={t(`commands.${command}.name`)}
          currentStatus={command === 'revise' ? 'BASELINED' : 'DRAFT'}
          nextStatus={
            command === 'commit' ? 'BASELINED' : command === 'discard' ? 'CANCELLED' : 'DRAFT'
          }
          businessImpact={businessImpact(command, workspace, t)}
          reason={
            command === 'revise'
              ? { required: false, label: t('commands.revise.notes'), hint: t('commands.revise.notesHint') }
              : undefined
          }
          confirmLabel={t(`commands.${command}.confirm`)}
          isDestructive={command === 'discard'}
          isPending={commit.isPending || discard.isPending || revise.isPending}
          errorMessage={commandError(command, t)}
          onConfirm={(reason) => runCommand(command, reason)}
        />
      ) : null}
    </div>
  );

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function handleSave(values: NodeFormValues, target: DrawerTarget, library: LibraryIntent) {
    if (!operationalVersionId) return;

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
        runLibrarySideEffects(values, library, payload.unitRate ?? null);
        setDrawer(null);
      },
    });
  }

  /**
   * The who-pays classifier's decision. VARIATION is the only route with a committed write path
   * today: it is raised in the Commercial variations flow. Rather than fabricate a success on a
   * route the backend cannot fulfil, this hands the user to Commercial to raise the draft VO and
   * records the pending affordance (H1) so the moment never dead-ends. Absorb/Separate are disabled
   * in the drawer (no route yet) and never reach here.
   */
  function handleClassify(result: ClassifierResult) {
    setClassifierOpen(false);
    if (result.route === 'VARIATION') {
      setPendingVariations((n) => n + 1);
      toast({ title: t('classifier.variationCreated') });
      router.push(`/projects/${projectId}/commercial/variations`);
    }
  }

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

    if (current === 'commit' && operationalVersionId) commit.mutate(operationalVersionId, close);
    else if (current === 'discard' && operationalVersionId) discard.mutate(operationalVersionId, close);
    else if (current === 'revise') revise.mutate(reason, close);
  }

  function commandError(current: Exclude<Command, null>, translate: (key: string) => string) {
    const mutation = current === 'commit' ? commit : current === 'discard' ? discard : revise;
    if (!mutation.error) return undefined;

    // A 409 on commit is the governance gate — sent for sign-off, not a failure (ADR-011/015).
    if (
      current === 'commit' &&
      mutation.error instanceof ApiError &&
      mutation.error.status === 409
    ) {
      return translate('commit.awaitingApproval');
    }

    return errorText(mutation.error, translate(`commands.${current}.failed`));
  }
}

/**
 * The single primary action for the WORKING flow. Always `brand-primary`, never disabled:
 * `resolveNextStep` returns something doable or nothing at all.
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

/**
 * The commit consequence copy (M3) carries the weight of the transition — fixing the contract
 * value and setting the milestone schedule, after which money changes go through a variation.
 */
function businessImpact(
  command: Exclude<Command, null>,
  workspace: NonNullable<ReturnType<typeof useBoqWorkspace>['data']>,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (command !== 'commit') return t(`commands.${command}.impact`);

  const value = workspace.draft?.totalAmount ?? workspace.moneyBand?.inContractTotal ?? null;
  const formatted = formatMoney(value, workspace.currency, 'en');
  return formatted ? t('commit.impact', { amount: formatted }) : t('commit.impactNoValue');
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
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {/* Skeletons mirror the final layout: a compact strip, then the dominant grid. */}
      <Skeleton className="h-12 w-full" aria-hidden="true" />
      <Skeleton className="h-96 w-full" aria-hidden="true" />
    </div>
  );
}
