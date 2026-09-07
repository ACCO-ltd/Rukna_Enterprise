'use client';

/**
 * PO line cost-target picker (A3 / D7, no. 148).
 *
 * A purchase-order line is project-cost-relevant by default: it carries a cost-target, which
 * is a project plus a leaf, active cost node on that project's baselined BOQ. The backend
 * captures this once here and every downstream document inherits it (D7), so the value has to
 * be right — a wrong node commits cost against the wrong budget line.
 *
 * ─── The three valid attributions ───────────────────────────────────────────────────────
 *
 *   1. Corporate / non-project   project = null,  node = null
 *   2. Project-level (non-BOQ)   project = set,   node = null,  spend category = set
 *   3. BOQ-coded project cost    project = set,   node = set
 *
 * State 2 is what this picker used to make impossible. It insisted on "both ids or neither",
 * so site security, temporary utilities, project transport, insurance and fuel — real project
 * cost that a contractual bill of quantities has no line for — could only be recorded by
 * inventing a fake BOQ node or by losing it into corporate overhead. The backend's
 * `validateCostTarget` has accepted all three since 2026-09-06; the UI had not caught up, so
 * an entire class of legitimate project cost was unreachable from the product.
 *
 * The rule the picker enforces, matching the server exactly: a BOQ node needs its project, and
 * a project needs a target — either a node, or a spend category.
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
import { useSpendCategories } from '../hooks/use-procurement';
import { Select } from '@erp/ui';

/** The cost-target a line carries, or the explicit org/overhead opt-out. */
export interface CostTargetValue {
  notChargeable: boolean;
  projectId: string | null;
  boqNodeId: string | null;
  /** Project-level target, for cost the BOQ has no line for. Mutually exclusive with a node. */
  spendCategoryId: string | null;
}

export function emptyCostTarget(): CostTargetValue {
  return { notChargeable: false, projectId: null, boqNodeId: null, spendCategoryId: null };
}

/**
 * Complete when it is the org/overhead opt-out, or it names a project AND says what the
 * project is spending on — a BOQ node, or a spend category. A project with neither is the
 * unclassified suspense bucket the server refuses with PROJECT_WITHOUT_COST_TARGET.
 */
export function isCostTargetComplete(value: CostTargetValue): boolean {
  if (value.notChargeable) return true;
  if (!value.projectId) return false;
  return Boolean(value.boqNodeId) || Boolean(value.spendCategoryId);
}

/**
 * The cost-target fields to send for a line, as the create/revise DTOs expect them.
 *
 * One place, so the create form and the amend sheet cannot disagree about which of the three
 * attributions they are emitting — and so a project can never be sent without a target.
 */
export function buildCostTargetPayload(value: CostTargetValue): {
  projectId?: string;
  boqNodeId?: string;
  spendCategoryId?: string;
} {
  if (value.notChargeable || !value.projectId) return {};
  if (value.boqNodeId) return { projectId: value.projectId, boqNodeId: value.boqNodeId };
  if (value.spendCategoryId) {
    return { projectId: value.projectId, spendCategoryId: value.spendCategoryId };
  }
  // Incomplete: submit is already blocked, and sending a bare project would be rejected.
  return {};
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
  const ids = { toggle: useId(), project: useId(), node: useId(), category: useId() };

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
                ? { notChargeable: true, projectId: null, boqNodeId: null, spendCategoryId: null }
                : { notChargeable: false, projectId: null, boqNodeId: null, spendCategoryId: null },
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
                // Changing the project invalidates any target chosen under the old one.
                onChange({
                  notChargeable: false,
                  projectId: value || null,
                  boqNodeId: null,
                  spendCategoryId: null,
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
            disabled={Boolean(value.spendCategoryId)}
            onChange={(boqNodeId) =>
              // A node and a category are alternatives, not a pair: choosing one clears the
              // other so a line can never roll up two ways at once.
              onChange({
                notChargeable: false,
                projectId: value.projectId,
                boqNodeId,
                spendCategoryId: null,
              })
            }
          />

          <SpendCategorySelect
            id={ids.category}
            projectId={value.projectId}
            value={value.spendCategoryId}
            disabled={Boolean(value.boqNodeId)}
            onChange={(spendCategoryId) =>
              onChange({
                notChargeable: false,
                projectId: value.projectId,
                boqNodeId: null,
                spendCategoryId,
              })
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
  disabled?: boolean;
  onChange: (boqNodeId: string | null) => void;
}

/**
 * The BOQ cost-node select for the chosen project. Offers only leaf, active nodes of the
 * baselined BOQ — the same set the server accepts (`BOQ_NODE_NOT_COST_NODE` / `_INACTIVE`
 * otherwise). It stays disabled until a project is chosen, because a node without a project
 * is a half-specified target the backend refuses.
 */
function BoqNodeSelect({ id, projectId, value, disabled, onChange }: BoqNodeSelectProps) {
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
        disabled={disabled || !projectId || loading || noBaseline || empty}
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

/**
 * The project-level alternative to a BOQ node: what this project is spending on when the
 * priced scope has no line for it — site security, transport, insurance, temporary
 * facilities. A construction BOQ is the contractual measured scope, not the complete
 * internal cost-accounting structure, and forcing these into invented BOQ items would
 * corrupt exactly that distinction.
 */
function SpendCategorySelect({
  id,
  projectId,
  value,
  disabled,
  onChange,
}: {
  id: string;
  projectId: string | null;
  value: string | null;
  disabled?: boolean;
  onChange: (spendCategoryId: string | null) => void;
}) {
  const t = useTranslations('procurement.costTarget');
  const categories = useSpendCategories();
  const options = (categories.data ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {t('spendCategoryLabel')}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        disabled={disabled || !projectId || categories.isLoading}
        onChange={(next) => onChange(next || null)}
      >
        <option value="">
          {!projectId
            ? t('selectProjectFirst')
            : categories.isLoading
              ? t('loadingCategories')
              : t('selectCategory')}
        </option>
        {options.map((category) => (
          <option key={category.id} value={category.id}>
            {category.code} · {category.name}
          </option>
        ))}
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">{t('spendCategoryHint')}</p>
      {categories.isError ? (
        <p className="mt-1 text-xs text-danger">{t('categoriesLoadFailed')}</p>
      ) : null}
    </div>
  );
}
