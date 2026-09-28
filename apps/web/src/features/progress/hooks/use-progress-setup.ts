'use client';

import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';

import {
  progressSetupGap,
  type ProgressSetupFacts,
  type ProgressSetupGap,
} from '../domain/progress-views';
import { useProjectRollup } from './use-progress';

export interface ProgressSetupStatus {
  /** Both reads are still in flight — do not decide anything yet. */
  isPending: boolean;
  /** A read failed; the gap is unknown. Views fall back to their own error states. */
  isError: boolean;
  /** Known facts, once both reads are in. */
  facts: ProgressSetupFacts | null;
  /** The first missing setup step, `null` when complete, `undefined` while unknown. */
  gap: ProgressSetupGap | null | undefined;
}

/**
 * Is Progress set up enough for daily reports and performance to mean something?
 *
 * Built only from data the server already returns: the BOQ workspace (is there a baselined or
 * contract version?) and the work-package roll-up (packages, their allocated item counts, and the
 * server's own `weightsComplete` flag — never recomputed from the weights here).
 */
export function useProgressSetup(projectId: string): ProgressSetupStatus {
  const workspace = useBoqWorkspace(projectId);
  const rollup = useProjectRollup(projectId);

  const isPending = workspace.isPending || rollup.isPending;
  const isError = workspace.isError || rollup.isError;

  if (isPending || isError || !workspace.data || !rollup.data) {
    return { isPending, isError, facts: null, gap: undefined };
  }

  const measurable = rollup.data.packages.filter((p) => !p.scheduleOnly);
  const facts: ProgressSetupFacts = {
    hasBoqBaseline: Boolean(workspace.data.approved ?? workspace.data.contractBaseline),
    packageCount: rollup.data.packages.length,
    measurablePackageCount: measurable.length,
    unallocatedPackageCodes: measurable.filter((p) => p.leafCount === 0).map((p) => p.code),
    weightsComplete: rollup.data.weightsComplete,
    weightsPercent: Math.round(Number(rollup.data.weightsTotal) * 100),
  };

  return { isPending: false, isError: false, facts, gap: progressSetupGap(facts) };
}
