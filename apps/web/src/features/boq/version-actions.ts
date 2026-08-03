import { BoqVersionStatus } from '@erp/types';

import type { Boq, BoqVersion } from './types';

/**
 * Which versioning commands the BOQ will accept, given the version currently on screen.
 *
 * Mirrors BoqVersioningService: baseline and cancel act only on the version the BOQ points
 * at as its current draft and only while that version is still DRAFT; a new draft can be
 * started only from an approved version and only when no draft is open. The server remains
 * the authority — this exists so the UI offers commands that will succeed rather than
 * buttons that answer 400 or 409.
 */
export interface VersionActions {
  /** Lock the open draft in as the approved BOQ. */
  canBaseline: boolean;
  /** Discard the open draft. */
  canCancelDraft: boolean;
  /** Start a revision by copying the approved version. */
  canCreateDraft: boolean;
  /** True when baselining would approve a BOQ with no items — allowed, but worth warning. */
  wouldBaselineEmpty: boolean;
  /** True when this baseline establishes the original contract BOQ, which is immutable. */
  isFirstBaseline: boolean;
}

export function getVersionActions(
  boq: Boq,
  selected: BoqVersion | null,
  /** True when the selected version contains no items at all. */
  isEmpty: boolean,
): VersionActions {
  const isOpenDraft =
    selected !== null &&
    selected.id === boq.currentDraftVersionId &&
    selected.status === BoqVersionStatus.DRAFT;

  return {
    canBaseline: isOpenDraft,
    canCancelDraft: isOpenDraft,
    // Both conditions matter: without an approved version there is nothing to copy (400),
    // and with a draft already open the API refuses a second one (409).
    canCreateDraft: boq.currentApprovedVersionId !== null && boq.currentDraftVersionId === null,
    wouldBaselineEmpty: isOpenDraft && isEmpty,
    isFirstBaseline: isOpenDraft && boq.originalBaselineVersionId === null,
  };
}
