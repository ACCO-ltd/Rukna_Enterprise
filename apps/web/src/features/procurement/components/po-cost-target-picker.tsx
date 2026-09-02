'use client';

/**
 * PO line cost-target picker (A3 / D7, no. 148).
 *
 * A purchase-order line is project-cost-relevant by default: it carries a cost-target, which
 * is a project plus a leaf, active cost node on that project's baselined BOQ. The backend
 * captures this once here and every downstream document inherits it (D7), so the value has to
 * be right — a wrong node commits cost against the wrong budget line.
 *
 * A3's first-class exception is the **"Not chargeable to a project cost line"** toggle: an
 * org/overhead line (rent, shared plant, head-office consumables) belongs to no project. When
 * it is on, the cost-target is hidden and cleared and the create payload sends NEITHER field.
 * The backend rejects a half-specified target (one id without the other) with a 400; this
 * picker makes that unreachable from the UI by only ever emitting both ids or neither.
 *
 * ─── Where the BOQ leaf nodes come from ─────────────────────────────────────────────────
 *
 * There is no bespoke "leaf nodes for a picker" endpoint. The BOQ workspace read model
 * (`useBoqWorkspace`) names the baselined version — the contract baseline if the contract
 * references one, else the current approved version — and the tree endpoint (`useBoqTree`)
 * returns it in full. We flatten that and keep the leaf, active nodes: exactly the set the
 * server's `validateCostTarget` accepts. A project with no baselined BOQ has no cost nodes to
 * choose, and the picker says so rather than offering an empty list.
 */

import { useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { flattenTree } from '@/features/boq/boq-rows';
import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { Select } from '@erp/ui';

/** The cost-target a line carries, or the explicit org/overhead opt-out. */
export interface CostTargetValue {
  notChargeable: boolean;
  projectId: string | null;
  boqNodeId: string | null;
}

export function emptyCostTarget(): CostTargetValue {
  return { notChargeable: false, projectId: null, boqNodeId: null };
}

/**
 * A cost-target is complete when it is the org/overhead opt-out, OR it names both a project
 * and a BOQ node. A half-specified target (project chosen, node not yet) is incomplete and
 * blocks submit — it is the exact state the backend refuses with COST_TARGET_INCOMPLETE.
 */
export function isCostTargetComplete(value: CostTargetValue): boolean {
  if (value.notChargeable) return true;
  return Boolean(value.projectId) && Boolean(value.boqNodeId);
}

interface PoCostTargetPickerProps {
  value: CostTargetValue;
  onChange: (value: CostTargetValue) => void;
  /** Rendered when the caller has attempted submit and the target is half-specified. */
  showError: boolean;
}

export function PoCostTargetPicker({ value, onChange, showError }: PoCostTargetPickerProps) {
  const t = useTranslations('procurement.costTarget');
  const tc = useTranslations('procurement.common');
  const ids = { toggle: useId(), project: useId(), node: useId() };

  const { data: projects, isLoading: projectsLoading, isError: projectsError } = useProjects();

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-start gap-2">
        <input
          id={ids.toggle}
          type="checkbox"
          checked={value.notChargeable}
          onChange={(e) =>
            // Turning the opt-out on clears any chosen target so a stale id can never be sent.
            onChange(
              e.target.checked
                ? { notChargeable: true, projectId: null, boqNodeId: null }
                : { notChargeable: false, projectId: null, boqNodeId: null },
            )
          }
          className="mt-0.5 size-4 shrink-0 rounded border-border"
        />
        <label htmlFor={ids.toggle} className="text-xs">
          <span className="font-medium text-foreground">{t('notChargeableLabel')}</span>
          <span className="mt-0.5 block text-muted-foreground">{t('notChargeableHint')}</span>
        </label>
      </div>

      {value.notChargeable ? null : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.project} className="mb-1 block text-xs font-medium">
              {tc('project')}
            </label>
            <Select
              id={ids.project}
              value={value.projectId ?? ''}
              disabled={projectsLoading || projectsError}
              onChange={(value) =>
                // Changing the project invalidates any node chosen under the old one.
                onChange({
                  notChargeable: false,
                  projectId: value || null,
                  boqNodeId: null,
                })
              }
            >
              <option value="">{t('selectProject')}</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </Select>
            {projectsError ? (
              <p className="mt-1 text-xs text-danger">{tc('loadFailed')}</p>
            ) : null}
          </div>

          <BoqNodeSelect
            id={ids.node}
            projectId={value.projectId}
            value={value.boqNodeId}
            onChange={(boqNodeId) =>
              onChange({ notChargeable: false, projectId: value.projectId, boqNodeId })
            }
          />
        </div>
      )}

      {showError && !isCostTargetComplete(value) ? (
        <p className="mt-2 text-xs font-medium text-danger" role="alert">
          {t('incompleteError')}
        </p>
      ) : null}
    </div>
  );
}

interface BoqNodeSelectProps {
  id: string;
  projectId: string | null;
  value: string | null;
  onChange: (boqNodeId: string | null) => void;
}

/**
 * The BOQ cost-node select for the chosen project. Offers only leaf, active nodes of the
 * baselined BOQ — the same set the server accepts (`BOQ_NODE_NOT_COST_NODE` / `_INACTIVE`
 * otherwise). It stays disabled until a project is chosen, because a node without a project
 * is a half-specified target the backend refuses.
 */
function BoqNodeSelect({ id, projectId, value, onChange }: BoqNodeSelectProps) {
  const t = useTranslations('procurement.costTarget');

  const workspace = useBoqWorkspace(projectId ?? '');
  // The baseline the cost-target must reference: the contract baseline when the contract
  // names one, otherwise the current approved version. Not the open draft — an unbaselined
  // node is not yet a real budget line.
  const baselineVersionId =
    workspace.data?.contractBaseline?.id ?? workspace.data?.approved?.id ?? null;

  const tree = useBoqTree(projectId ?? '', projectId ? baselineVersionId : null);

  const leafNodes = useMemo(() => {
    if (!tree.data) return [];
    return flattenTree(tree.data).filter((node) => node.isLeaf && node.isActive);
  }, [tree.data]);

  const loading = Boolean(projectId) && (workspace.isLoading || tree.isLoading);
  const noBaseline = Boolean(projectId) && !workspace.isLoading && baselineVersionId === null;
  const empty = Boolean(projectId) && !loading && !noBaseline && leafNodes.length === 0;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {t('boqNodeLabel')}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        disabled={!projectId || loading || noBaseline || empty}
        onChange={(value) => onChange(value || null)}
      >
        <option value="">
          {!projectId
            ? t('selectProjectFirst')
            : loading
              ? t('loadingNodes')
              : t('selectNode')}
        </option>
        {leafNodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.code} · {node.description}
          </option>
        ))}
      </Select>

      {noBaseline ? <p className="mt-1 text-xs text-muted-foreground">{t('noBaseline')}</p> : null}
      {empty ? <p className="mt-1 text-xs text-muted-foreground">{t('noLeafNodes')}</p> : null}
      {tree.isError ? <p className="mt-1 text-xs text-danger">{t('nodesLoadFailed')}</p> : null}
    </div>
  );
}
