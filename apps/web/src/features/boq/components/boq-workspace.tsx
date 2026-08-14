'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, GitCompare, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { LifecycleCommandDrawer } from '@/components/lifecycle-command-drawer';
import { usePermissions } from '@/features/auth/permissions/can';

import { buildRows, collectSectionIds, countTree, type PricingFilter } from '../boq-rows';
import { compareToCsv, downloadCsv, treeToCsv } from '../boq-export';
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
import { toCreateNodePayload, toUpdateNodePayload, type NodeFormValues } from '../node-form';
import { BOQ_PERMISSIONS } from '../permissions';
import { getVersionActions } from '../version-actions';
import { BoqComparePanel } from './boq-compare-panel';
import { BoqGrid, type BoqRowCommands } from './boq-grid';
import { BoqHeader } from './boq-header';
import { BoqItemDrawer, type DrawerTarget } from './boq-item-drawer';
import { BoqReadinessBanner } from './boq-readiness-banner';
import { BoqSummaryStrip } from './boq-summary-strip';
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

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const counts = useMemo(() => countTree(nodes), [nodes]);
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
    <div className="space-y-5">
      <BoqHeader
        version={selected}
        revision={isDraft ? workspace.revision : null}
        currency={workspace.currency}
        canViewCommercials={canViewCommercials}
        actions={
          <>
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

            {actions.canCreateDraft ? (
              <Button variant="outline" size="sm" onClick={() => setCommand('revise')}>
                {t('actions.startRevision')}
              </Button>
            ) : null}

            {actions.canCancelDraft ? (
              <Button variant="outline" size="sm" onClick={() => setCommand('discard')}>
                {t('actions.discardDraft')}
              </Button>
            ) : null}

            {isDraft && workspace.capabilities.canBaseline ? (
              <Button
                size="sm"
                disabled={!actions.canBaseline}
                title={actions.blockedReason === 'NOT_READY' ? t('actions.notReadyHint') : undefined}
                onClick={() => setCommand('baseline')}
              >
                {t('actions.submitForBaseline')}
              </Button>
            ) : null}
          </>
        }
      />

      <BoqSummaryStrip
        totalAmount={selected?.totalAmount ?? null}
        currency={workspace.currency}
        sectionCount={counts.sections}
        itemCount={counts.items}
        pricedCount={counts.priced}
        contractBaselineLabel={
          workspace.contractBaseline
            ? t('versionNumber', { number: workspace.contractBaseline.versionNumber })
            : t('summary.noContractBaseline')
        }
        contractBaselineNote={
          workspace.contractBaseline
            ? workspace.contractBaseline.id === workspace.approved?.id
              ? t('summary.contractCurrent')
              : t('summary.contractBehind')
            : t('summary.noContractBaselineHint')
        }
        canViewCommercials={canViewCommercials}
      />

      {workspace.readiness ? (
        <BoqReadinessBanner
          readiness={workspace.readiness}
          showClearState={isDraft}
          onReviewBlockers={(nodeIds) => {
            setHighlighted(new Set(nodeIds));
            setPricing('incomplete');
          }}
        />
      ) : null}

      <div className="space-y-3">
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
        onSubmit={(values, target) => handleSave(values, target)}
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

  function handleSave(values: NodeFormValues, target: DrawerTarget) {
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

    addNode.mutate(
      toCreateNodePayload(values, {
        kind: target.kind,
        parentId: target.parent?.id,
      }),
      { onSuccess: () => setDrawer(null) },
    );
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
