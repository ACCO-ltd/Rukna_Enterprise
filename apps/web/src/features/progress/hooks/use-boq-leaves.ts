'use client';

import { useBoqTree, useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { claimableLines, lineLabel, type ClaimableLine } from '@/features/ipa/boq-leaves';

export type { ClaimableLine };
export { lineLabel };

/**
 * The project's BOQ leaves, for the measurement and work-package allocation pickers.
 *
 * Reuses the same path the IPA claim editor uses: resolve the baselined (or contract) version,
 * fetch its tree, flatten to leaves. Progress measures against leaves only (CONST-PROG), which
 * is exactly what `claimableLines` returns.
 */
export function useBoqLeaves(projectId: string): {
  leaves: ClaimableLine[];
  isPending: boolean;
  hasBaseline: boolean;
} {
  const workspace = useBoqWorkspace(projectId);
  const versionId =
    workspace.data?.approved?.id ?? workspace.data?.contractBaseline?.id ?? null;
  const tree = useBoqTree(projectId, versionId);

  return {
    leaves: tree.data ? claimableLines(tree.data) : [],
    isPending: workspace.isPending || (versionId !== null && tree.isPending),
    hasBaseline: versionId !== null,
  };
}
