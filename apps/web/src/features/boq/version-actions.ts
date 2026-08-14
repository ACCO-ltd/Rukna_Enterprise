import type { BoqWorkspaceResponse } from '@erp/types';

/**
 * Which versioning commands the BOQ will accept, given the version currently on screen.
 *
 * Mirrors `BoqVersioningService`: baseline and cancel act only on the version the BOQ points
 * at as its current draft and only while that version is DRAFT; a revision can be started
 * only from an approved version and only when no draft is open.
 *
 * Two things changed with ADR-016. Permissions are now consulted — the feature had no
 * `can()` call at all, so a viewer was shown a Baseline button the server would refuse. And
 * readiness is no longer guessed from "does this version have any items": the server
 * evaluates it, and `blockedReason` reports the server's verdict rather than a second
 * opinion about it.
 */
export interface VersionActions {
  /** Lock the open draft in as the approved BOQ. */
  canBaseline: boolean;
  /** Discard the open draft. */
  canCancelDraft: boolean;
  /** Start a revision by copying the approved version. */
  canCreateDraft: boolean;
  /** Set when the baseline command exists but is not currently available. */
  blockedReason: 'NOT_READY' | 'NO_PERMISSION' | null;
  /** True when this baseline establishes the original contract BOQ, which is immutable. */
  isFirstBaseline: boolean;
  /** True when this is a post-award revision, which changes the consequence copy. */
  isPostAwardRevision: boolean;
}

export function getVersionActions(
  workspace: BoqWorkspaceResponse,
  selectedVersionId: string | null,
): VersionActions {
  const { boq, draft, readiness, capabilities } = workspace;

  const isOpenDraft =
    boq !== null && draft !== null && selectedVersionId === draft.id && draft.status === 'DRAFT';

  const ready = readiness?.ready ?? false;

  return {
    canBaseline: isOpenDraft && capabilities.canBaseline && ready,
    canCancelDraft: isOpenDraft && capabilities.canManage,
    // Both conditions matter: without an approved version there is nothing to copy (400),
    // and with a draft already open the API refuses a second one (409).
    canCreateDraft:
      capabilities.canManage &&
      boq !== null &&
      boq.currentApprovedVersionId !== undefined &&
      boq.currentDraftVersionId === undefined,
    blockedReason: !isOpenDraft
      ? null
      : !capabilities.canBaseline
        ? 'NO_PERMISSION'
        : !ready
          ? 'NOT_READY'
          : null,
    isFirstBaseline: isOpenDraft && boq?.originalBaselineVersionId === undefined,
    isPostAwardRevision: isOpenDraft && boq?.originalBaselineVersionId !== undefined,
  };
}
