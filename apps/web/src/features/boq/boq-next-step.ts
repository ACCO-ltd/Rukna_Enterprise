import type { BoqReadinessBlockerKind, BoqWorkspaceResponse } from '@erp/types';

import { getVersionActions } from './version-actions';

/**
 * What the user should do next, and where it takes them.
 *
 * The first version of this screen had no such concept. It rendered three peer buttons —
 * Review changes, Discard draft, Submit for baseline — and the only one styled as primary
 * was disabled, because the draft was not ready. So the single element drawing the eye was
 * the single element that could not be pressed, and the one action that actually moved the
 * work forward ("Review 5 blockers") sat as a small outline button inside a *dismissible*
 * banner. A user could close the banner and be left with a screen offering nothing.
 *
 * Resolving it here, rather than in the header, means the header, the sticky bar and any
 * empty state all agree, and the rule is testable without rendering anything.
 */

export type BoqNextStepKind =
  | 'INITIALIZE'
  | 'ADD_ITEMS'
  | 'PRICE_ITEMS'
  | 'FIX_BLOCKERS'
  | 'SUBMIT_BASELINE'
  | 'START_REVISION'
  | 'VIEW_ONLY';

export interface BoqNextStep {
  kind: BoqNextStepKind;
  /**
   * `primary` renders blue — a forward transition. `attention` renders amber — work that
   * has to happen before the transition is possible. `none` renders nothing.
   *
   * A step is never disabled: if the user cannot do the forward thing, the step becomes
   * the thing standing in its way rather than a greyed-out version of the thing they want.
   */
  tone: 'primary' | 'attention' | 'none';
  /** Feeds the label, e.g. "Price 5 items". */
  count?: number;
  /**
   * Rows the grid should filter to when the step is pressed. Present for the fix steps,
   * which makes the button the navigation as well as the instruction.
   */
  targetNodeIds?: string[];
}

/** Blockers a user resolves by pricing a row, as opposed to restructuring the BOQ. */
const PRICING_BLOCKERS: BoqReadinessBlockerKind[] = [
  'MISSING_UNIT',
  'MISSING_QUANTITY',
  'MISSING_RATE',
];

export function resolveNextStep(
  workspace: BoqWorkspaceResponse,
  selectedVersionId: string | null,
): BoqNextStep {
  const { boq, draft, readiness, capabilities } = workspace;

  // Read-only users get no call to action. Showing them one and refusing it is the same
  // dead end in a different costume.
  if (!capabilities.canManage && !capabilities.canBaseline) {
    return { kind: 'VIEW_ONLY', tone: 'none' };
  }

  if (!boq) {
    return capabilities.canManage
      ? { kind: 'INITIALIZE', tone: 'primary' }
      : { kind: 'VIEW_ONLY', tone: 'none' };
  }

  const actions = getVersionActions(workspace, selectedVersionId);
  const onDraft = draft !== null && selectedVersionId === draft.id;

  // Looking at a historical version: the forward move is to open a revision, if one can be
  // opened. Otherwise there is nothing to do here and saying so is honest.
  if (!onDraft) {
    return actions.canCreateDraft
      ? { kind: 'START_REVISION', tone: 'primary' }
      : { kind: 'VIEW_ONLY', tone: 'none' };
  }

  if (!readiness || !capabilities.canManage) {
    return actions.canBaseline
      ? { kind: 'SUBMIT_BASELINE', tone: 'primary' }
      : { kind: 'VIEW_ONLY', tone: 'none' };
  }

  if (readiness.itemCount === 0) {
    return { kind: 'ADD_ITEMS', tone: 'primary' };
  }

  // Pricing before structure: it is the common case by an order of magnitude, and a
  // surveyor filling in rates does not want to be sent to a duplicate-code problem first.
  const pricing = collectNodeIds(readiness.blockers, (kind) => PRICING_BLOCKERS.includes(kind));
  if (pricing.length > 0) {
    return {
      kind: 'PRICE_ITEMS',
      tone: 'attention',
      count: pricing.length,
      targetNodeIds: pricing,
    };
  }

  const structural = collectNodeIds(readiness.blockers, (kind) => !PRICING_BLOCKERS.includes(kind));
  if (!readiness.ready) {
    return {
      kind: 'FIX_BLOCKERS',
      tone: 'attention',
      count: structural.length || readiness.blockers.length,
      targetNodeIds: structural,
    };
  }

  return actions.canBaseline
    ? { kind: 'SUBMIT_BASELINE', tone: 'primary' }
    : // Ready, but this user may not baseline. Nothing to offer, and pretending otherwise
      // would send them to a 403.
      { kind: 'VIEW_ONLY', tone: 'none' };
}

/**
 * Distinct node ids behind the matching blockers.
 *
 * De-duplicated because the server reports one blocker per missing field: an item with no
 * unit, quantity or rate produces three. "Price 3 items" for one unpriced row would be a
 * lie, and the count is the label.
 */
function collectNodeIds(
  blockers: BoqWorkspaceResponse['readiness'] extends null
    ? never
    : NonNullable<BoqWorkspaceResponse['readiness']>['blockers'],
  matches: (kind: BoqReadinessBlockerKind) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const blocker of blockers) {
    if (blocker.nodeId && matches(blocker.kind)) ids.add(blocker.nodeId);
  }
  return [...ids];
}
