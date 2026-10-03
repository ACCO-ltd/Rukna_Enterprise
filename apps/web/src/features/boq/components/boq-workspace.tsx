'use client';

import { useCallback, useMemo, useState } from 'react';
import { ClipboardList, Download, FileSpreadsheet, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, EmptyState, Notice, Skeleton, useToast } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { LifecycleCommandDialog } from '@/components/lifecycle-command-dialog';
import { usePermissions } from '@/features/auth/permissions/can';
import { useProject } from '@/features/projects/hooks/use-project';
import { useUnitsOfMeasure } from '@/features/units-of-measure/hooks/use-units-of-measure';

import { buildRows, collectSectionIds, countTree, flattenTree, siblingBounds } from '../boq-rows';
import { computeRollup } from '../boq-totals';
import { treeToCsv, downloadCsv } from '../boq-export';
import { importTemplateCsv } from '../boq-import-mapping';
import {
  useBoqCompareToSigned,
  useBoqTimeline,
  useBoqTree,
  useBoqWorkspace,
  useCancelDraftVersion,
  useAddExtraWork,
  useCreateDraftVersion,
  useDeleteNode,
  useInitializeBoq,
  useMoveNode,
  useAddNode,
  useUpdateNode,
} from '../hooks/use-boq';
import { useCreateLibraryItem, useRecordLibraryUsage } from '../hooks/use-boq-item-library';
import { cellEditPayload } from '../cell-edit-payload';
import {
  toCreateNodePayload,
  toNodeFormValues,
  toUpdateNodePayload,
  type NodeFormValues,
} from '../node-form';
import { BOQ_PERMISSIONS } from '../permissions';
import { getVersionActions } from '../version-actions';
import { BoqClassifierDialog, type ClassifierResult } from './boq-classifier-dialog';
import { BoqCompareSignedDialog } from './boq-compare-signed-dialog';
import { BoqContextBar } from './boq-context-bar';
import { BoqGrid, type BoqRowCommands, type PendingLine } from './boq-grid';
import { BoqImportView, type ImportOutcome } from './boq-import-view';
import { BoqItemDialog, type ItemDialogTarget, type LibraryIntent } from './boq-item-dialog';
import { BoqHistoryDialog } from './boq-history-dialog';
import { UnitsUnavailableNotice } from './boq-unit-select';
import { BoqToolbar, type LineFilter } from './boq-toolbar';
import type { BoqTreeNodeResponse } from '@erp/types';
import { financeProjectRedirects } from '@/features/finance-projects/redirects';

/** Procurement setup's unit registry (nav-groups.ts), behind `manage:procurement-config`. */
const UNITS_ADMIN_HREF = '/procurement/setup/uom';

/**
 * The BOQ tab.
 *
 * One bar on top owns the BOQ's state and its one next step (`BoqContextBar`); a find-and-narrow
 * toolbar; then the bill itself, edited in place while it is a draft. Import is a page inside the
 * tab, not a modal. Everything commercial is decided server-side — the workspace query withholds
 * figures a tier cannot see — and this screen renders what is present rather than re-deciding it.
 */
export function BoqWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.boq');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const { toast } = useToast();
  const router = useRouter();

  const project = useProject(projectId).data;
  const workspaceQuery = useBoqWorkspace(projectId);
  const workspace = workspaceQuery.data;

  const [view, setView] = useState<'bill' | 'import'>('bill');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LineFilter>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<PendingLine | null>(null);
  const [itemDialog, setItemDialog] = useState<ItemDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BoqTreeNodeResponse | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  // `?extraWork=1` — arriving from Commercial's "New separate charge…": open the who-pays decision
  // straight away (it is only rendered for someone who may edit the BOQ, below).
  const searchParams = useSearchParams();
  const [classifierOpen, setClassifierOpen] = useState(() => searchParams?.get('extraWork') === '1');
  const [compareOpen, setCompareOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [imported, setImported] = useState<ImportOutcome | null>(null);

  // The one operational version: the working draft, else the approved/committed one.
  const operationalVersionId =
    workspace?.draft?.id ?? workspace?.approved?.id ?? workspace?.versions[0]?.id ?? null;

  const treeQuery = useBoqTree(projectId, operationalVersionId);
  const compareQuery = useBoqCompareToSigned(projectId, compareOpen);
  const timelineQuery = useBoqTimeline(projectId, timelineOpen);

  const initialize = useInitializeBoq(projectId);
  const addNode = useAddNode(projectId, operationalVersionId ?? '');
  const updateNode = useUpdateNode(projectId, operationalVersionId ?? '');
  // Inline grid edits: the cell shows the saved value itself, so these stay silent.
  const addLine = useAddNode(projectId, operationalVersionId ?? '', { silent: true });
  const updateCell = useUpdateNode(projectId, operationalVersionId ?? '', { silent: true });
  const deleteNode = useDeleteNode(projectId, operationalVersionId ?? '');
  const moveNode = useMoveNode(projectId, operationalVersionId ?? '');
  const addExtraWork = useAddExtraWork(projectId);
  const discard = useCancelDraftVersion(projectId);
  const revise = useCreateDraftVersion(projectId);
  const recordLibraryUsage = useRecordLibraryUsage();
  const saveLibraryItem = useCreateLibraryItem();

  // The unit registry (`GET /units-of-measure`, view:project) — the grid's unit picker and the
  // item dialog's. Units come from the list only (ADR-039 owner decision); managing them is
  // Procurement setup, for whoever holds procurement-config rights.
  const unitsQuery = useUnitsOfMeasure();
  const unitsAdminHref = can('manage:procurement-config') ? UNITS_ADMIN_HREF : null;

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const counts = useMemo(() => countTree(nodes), [nodes]);
  const hasVariations = useMemo(() => flattenTree(nodes).some((node) => node.sourceType === 'VARIATION'), [nodes]);
  const rollup = useMemo(() => computeRollup(nodes), [nodes]);
  const rows = useMemo(
    () => buildRows(nodes, { collapsed, search, pricing: filter === 'unpriced' ? 'incomplete' : 'all' }),
    [nodes, collapsed, search, filter],
  );
  const bounds = useCallback((node: BoqTreeNodeResponse) => siblingBounds(nodes, node), [nodes]);

  if (workspaceQuery.isPending) return <WorkspaceSkeleton label={tCommon('loading')} />;

  if (workspaceQuery.isError) {
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[errorText(workspaceQuery.error, t('loadFailedHint'))]} />
    );
  }

  if (!workspace) return null;

  const { capabilities } = workspace;
  const canEdit = capabilities.canEdit;
  const canViewCost = capabilities.canViewCost;
  const onDraft = operationalVersionId === workspace.draft?.id;
  const canManage = can(BOQ_PERMISSIONS.manage) && canEdit && onDraft;
  const signed = workspace.mainContractStatus === 'ACTIVE';
  const committed = workspace.moneyBand?.lifeStage === 'COMMITTED';
  const actions = getVersionActions(workspace, operationalVersionId);
  // Only when there is no current main contract: a reopened or draft one is continued in
  // Commercial, and record-signed would refuse a second (409).
  const hasContract = Boolean(workspace.mainContractStatus);
  const canCreateContract =
    !hasContract &&
    can('create:contract') &&
    can('approve:contract') &&
    project?.commercialModel !== 'INTERNAL_CAPITAL';

  const importView = (
    <BoqImportView
      projectId={projectId}
      currency={workspace.currency}
      existing={{ sections: counts.sections, items: counts.items }}
      canViewCost={canViewCost}
      onCancel={() => setView('bill')}
      onImported={(outcome) => {
        setImported(outcome);
        setView('bill');
      }}
    />
  );

  // ─── Empty ──────────────────────────────────────────────────────────────────
  if (!workspace.boq) {
    if (view === 'import' && canEdit) return importView;
    return (
      <EmptyState
        variant="page"
        icon={<ClipboardList size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('empty.title')}
        description={canEdit ? t('empty.description') : t('empty.readOnly')}
        action={
          canEdit ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button className="gap-2" onClick={() => setView('import')}>
                  <FileSpreadsheet size={16} aria-hidden="true" />
                  {t('empty.import')}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  loading={initialize.isPending}
                  loadingText={t('initializing')}
                  onClick={() => initialize.mutate()}
                >
                  <Plus size={16} aria-hidden="true" />
                  {t('empty.startBlank')}
                </Button>
              </div>
              <Button
                variant="link"
                size="sm"
                className="h-auto gap-1.5 p-0"
                onClick={() => downloadCsv('BOQ-import-template.csv', importTemplateCsv())}
              >
                <Download size={14} aria-hidden="true" />
                {t('import.upload.template')}
              </Button>
            </div>
          ) : undefined
        }
      />
    );
  }

  if (view === 'import' && canManage) return importView;

  const isFiltered = search.trim().length > 0 || filter !== 'all';
  const unpricedCount = Math.max(0, counts.items - counts.priced);
  const allSectionIds = collectSectionIds(nodes);

  const toggleCollapsed = (nodeId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const rowCommands: BoqRowCommands | null = canManage
    ? {
        onEdit: (node) => setItemDialog({ mode: 'edit', kind: node.isLeaf ? 'item' : 'section', parent: null, node }),
        onAddFromLibrary: (parent) =>
          setItemDialog({ mode: 'add', kind: 'item', parent, node: null, siblingCodes: parent.children.map((c) => c.code) }),
        onAddSection: (parent) => {
          if (collapsed.has(parent.id)) toggleCollapsed(parent.id);
          setPending({ parentId: parent.id, kind: 'section' });
        },
        onDelete: (node) => {
          deleteNode.reset();
          setDeleteTarget(node);
        },
        onMove: (node, direction) =>
          moveNode.mutate({
            nodeId: node.id,
            ...(node.parentId ? { newParentId: node.parentId } : {}),
            newSortOrder: Math.max(0, node.sortOrder + direction),
          }),
        bounds,
        onEditField: async (node, field, value) => {
          await updateCell.mutateAsync({ nodeId: node.id, payload: cellEditPayload(field, value, unitsQuery.data) });
        },
        onCreate: async ({ parent, kind, description }) => {
          // No code: the server numbers the line from its position (D2).
          await addLine.mutateAsync({
            ...(parent ? { parentId: parent.id } : {}),
            description,
            isLeaf: kind === 'item',
          });
        },
      }
    : null;

  const createContractHref = `/projects/${projectId}/commercial/contract/new`;

  return (
    <div className="space-y-3">
      <BoqContextBar
        workspace={workspace}
        stage={{ editable: canManage, signed, committed, contractInProgress: hasContract && !signed }}
        counts={counts}
        actions={actions}
        canCreateContract={canCreateContract}
        canImport={canManage && !signed}
        createContractHref={createContractHref}
        onShowUnpriced={() => {
          setSearch('');
          setFilter('unpriced');
          document.getElementById('boq-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onAddExtraWork={() => setClassifierOpen(true)}
        onImport={() => {
          setImported(null);
          setView('import');
        }}
        onExport={() =>
          downloadCsv(
            'BOQ.csv',
            treeToCsv(nodes, workspace.currency, { includePricing: canViewCost, headers: exportHeaders(t) }),
          )
        }
        onHistory={() => setTimelineOpen(true)}
        onCompare={workspace.compareToSignedAvailable ? () => setCompareOpen(true) : undefined}
        onRevise={() => setReviseOpen(true)}
        onDiscard={() => {
          discard.reset();
          setDiscardOpen(true);
        }}
      />

      {imported ? (
        <Notice tone="success">
          {t('import.done', { items: imported.items, sections: imported.sections, file: imported.fileName })}
        </Notice>
      ) : null}

      {/* The unit cells pick from the registry only; with nothing to pick, say why once here. */}
      {canManage && (unitsQuery.isError || (unitsQuery.isSuccess && unitsQuery.data.length === 0)) ? (
        <UnitsUnavailableNotice reason={unitsQuery.isError ? 'error' : 'empty'} adminHref={unitsAdminHref} />
      ) : null}

      <div id="boq-grid" className="scroll-mt-4 space-y-3">
        <BoqToolbar
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          unpricedCount={unpricedCount}
          showFilter={canViewCost}
          onExpandAll={() => setCollapsed(new Set())}
          onCollapseAll={() => setCollapsed(new Set(allSectionIds))}
        />

        {treeQuery.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : treeQuery.isError ? (
          <Alert variant="error" messages={[errorText(treeQuery.error, t('loadFailed'))]} />
        ) : (
          <BoqGrid
            rows={rows}
            currency={workspace.currency}
            totalAmount={workspace.draft?.totalAmount ?? workspace.approved?.totalAmount ?? null}
            sectionTotals={rollup.sectionTotals}
            isFiltered={isFiltered}
            canViewCommercials={canViewCost}
            committed={committed}
            showSource={hasVariations || committed}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onPinnedCellEdit={committed || (signed && canEdit) ? () => setClassifierOpen(true) : undefined}
            onSelect={(node) => setItemDialog({ mode: 'edit', kind: node.isLeaf ? 'item' : 'section', parent: null, node })}
            commands={rowCommands}
            pending={pending}
            onPendingChange={setPending}
            units={unitsQuery.data}
            emptyMessage={isFiltered ? t('grid.noMatches') : onDraft ? t('grid.emptyDraft') : t('grid.empty')}
          />
        )}

        {rowCommands && !isFiltered && !pending ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-brand-primary"
            onClick={() => setPending({ parentId: null, kind: 'section' })}
          >
            <Plus size={14} aria-hidden="true" />
            {t('grid.addSection')}
          </Button>
        ) : null}
      </div>

      <BoqItemDialog
        key={itemDialog ? `${itemDialog.mode}-${itemDialog.kind}-${itemDialog.node?.id ?? itemDialog.parent?.id ?? 'root'}` : 'closed'}
        target={itemDialog}
        currency={workspace.currency}
        readOnly={!canManage}
        isPending={addNode.isPending || updateNode.isPending}
        libraryEnabled={canManage}
        canViewCommercials={canViewCost}
        canSaveToLibrary={canManage}
        unitsAdminHref={unitsAdminHref}
        error={itemDialog ? (addNode.error ?? updateNode.error ?? undefined) : undefined}
        onClose={() => {
          addNode.reset();
          updateNode.reset();
          setItemDialog(null);
        }}
        onSubmit={(values, target, library) => handleSave(values, target, library)}
      />

      {deleteTarget ? (
        <ConfirmActionDialog
          title={t('grid.deleteTitle', { code: deleteTarget.code, name: deleteTarget.description })}
          description={t('grid.deleteBody')}
          confirmLabel={deleteTarget.isLeaf ? t('grid.delete') : t('grid.deleteSection')}
          destructive
          isPending={deleteNode.isPending}
          errorMessage={deleteNode.isError ? errorText(deleteNode.error, t('grid.deleteFailed')) : undefined}
          onConfirm={() => deleteNode.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
          onDismiss={() => setDeleteTarget(null)}
        />
      ) : null}

      {discardOpen && operationalVersionId ? (
        <ConfirmActionDialog
          title={t('contextBar.discardTitle', { version: workspace.draft?.versionNumber ?? 1 })}
          description={t('contextBar.discardBody', { items: counts.items, sections: counts.sections })}
          confirmLabel={t('contextBar.discardConfirm')}
          destructive
          isPending={discard.isPending}
          errorMessage={discard.isError ? errorText(discard.error, t('commands.discard.failed')) : undefined}
          onConfirm={() => discard.mutate(operationalVersionId, { onSuccess: () => setDiscardOpen(false) })}
          onDismiss={() => setDiscardOpen(false)}
        />
      ) : null}

      {reviseOpen ? (
        <LifecycleCommandDialog
          open
          onClose={() => {
            revise.reset();
            setReviseOpen(false);
          }}
          commandName={t('commands.revise.name')}
          statusVocabulary="boqVersion"
          currentStatus="COMMITTED"
          nextStatus="DRAFT"
          businessImpact={t('commands.revise.impact')}
          reason={{ required: false, label: t('commands.revise.notes'), hint: t('commands.revise.notesHint') }}
          confirmLabel={t('commands.revise.confirm')}
          isPending={revise.isPending}
          errorMessage={revise.isError ? errorText(revise.error, t('commands.revise.failed')) : undefined}
          onConfirm={(reason) => revise.mutate(reason, { onSuccess: () => setReviseOpen(false) })}
        />
      ) : null}

      {classifierOpen && canEdit ? (
        <BoqClassifierDialog
          open
          currency={workspace.currency}
          contingencyRemaining={workspace.moneyBand?.contingencyRemaining ?? null}
          contractValue={workspace.moneyBand?.contractValue ?? null}
          totalClientRevenue={workspace.moneyBand?.totalClientRevenue ?? null}
          // All three routes write via POST …/boq/extra-work (R5, variation-collapse).
          absorbEnabled
          separateEnabled
          sections={nodes
            .filter((node) => !node.isLeaf)
            .map((node) => ({ id: node.id, code: node.code, description: node.description }))}
          isPending={addExtraWork.isPending}
          errorMessage={addExtraWork.isError ? (addExtraWork.error as Error | undefined)?.message : undefined}
          onSubmit={handleClassify}
          onClose={() => {
            addExtraWork.reset();
            setClassifierOpen(false);
          }}
        />
      ) : null}

      {compareOpen ? (
        <BoqCompareSignedDialog
          data={compareQuery.data}
          currency={workspace.currency}
          canViewCost={canViewCost}
          isPending={compareQuery.isPending}
          isError={compareQuery.isError}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {timelineOpen ? (
        <BoqHistoryDialog
          data={timelineQuery.data}
          currency={workspace.currency}
          canViewMargin={capabilities.canViewMargin}
          isPending={timelineQuery.isPending}
          isError={timelineQuery.isError}
          onClose={() => setTimelineOpen(false)}
        />
      ) : null}
    </div>
  );

  // ─── Handlers ────────────────────────────────────────────────────────────────

  function handleSave(values: NodeFormValues, target: ItemDialogTarget, library: LibraryIntent) {
    if (!operationalVersionId) return;

    if (target.mode === 'edit' && target.node) {
      updateNode.mutate(
        {
          nodeId: target.node.id,
          payload: toUpdateNodePayload(values, {
            kind: target.kind,
            initial: toNodeFormValues(target.node),
            pricing: workspace?.capabilities.canViewCost ?? false,
          }),
        },
        { onSuccess: () => setItemDialog(null) },
      );
      return;
    }

    const payload = toCreateNodePayload(values, {
      kind: target.kind,
      parentId: target.parent?.id,
      pricing: workspace?.capabilities.canViewCost ?? false,
    });
    addNode.mutate(payload, {
      onSuccess: () => {
        runLibrarySideEffects(values, library, payload.unitRate ?? null);
        setItemDialog(null);
      },
    });
  }

  /** The who-pays classifier's decision (R5, variation-collapse). */
  function handleClassify(result: ClassifierResult) {
    addExtraWork.mutate(
      {
        treatment: result.route,
        lines: [
          {
            description: result.description,
            amount: result.amount,
            ...(result.parentId ? { parentId: result.parentId } : {}),
          },
        ],
        ...(result.clientApprovalReference ? { clientApprovalReference: result.clientApprovalReference } : {}),
      },
      {
        onSuccess: () => {
          setClassifierOpen(false);
          toast({
            title: t(
              result.route === 'VARIATION'
                ? 'classifier.variationRaised'
                : result.route === 'ABSORB'
                  ? 'classifier.absorbed'
                  : 'classifier.separateAdded',
            ),
            ...(result.route === 'SEPARATE'
              ? {
                  description: t('classifier.separateDraftCreated'),
                  duration: 9000,
                  action: {
                    label: t('classifier.reviewInBilling'),
                    onClick: () => router.push(financeProjectRedirects.billing(projectId)),
                  },
                }
              : {}),
          });
        },
      },
    );
  }

  function runLibrarySideEffects(values: NodeFormValues, library: LibraryIntent, unitRate: string | null) {
    if (library.pickedItemId && unitRate) {
      recordLibraryUsage.mutate({ id: library.pickedItemId, payload: { rate: unitRate, projectId } });
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
      <Skeleton className="h-14 w-full" aria-hidden="true" />
      <Skeleton className="h-96 w-full" aria-hidden="true" />
    </div>
  );
}
