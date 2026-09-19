import type { BoqWorkspaceResponse } from '@erp/types';

/**
 * BOQ version housekeeping after contract signing became the snapshot command.
 * Manual baseline/commit is intentionally absent from this interface.
 */
export interface VersionActions {
  canCancelDraft: boolean;
  canCreateDraft: boolean;
}

export function getVersionActions(
  workspace: BoqWorkspaceResponse,
  selectedVersionId: string | null,
): VersionActions {
  const { boq, draft, capabilities } = workspace;
  const isOpenDraft =
    boq !== null && draft !== null && selectedVersionId === draft.id && draft.status === 'DRAFT';

  return {
    canCancelDraft: isOpenDraft && capabilities.canManage,
    canCreateDraft:
      capabilities.canManage &&
      boq !== null &&
      boq.currentApprovedVersionId !== undefined &&
      boq.currentDraftVersionId === undefined,
  };
}
