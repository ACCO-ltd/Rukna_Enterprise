'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { usePermissions } from '@/features/auth/permissions/can';
import { financePortfolioKeys } from '@/features/finance-projects/hooks';
import { programmeKeys } from '@/features/programme/hooks/programme-keys';

import { markInstallmentReadyToBill, revokeInstallmentReadiness } from '../api/commercial-api';
import { commercialKeys } from './use-commercial';

/**
 * ADR-043 decision 1 — Construction verifies a milestone and marks the stage ready to bill;
 * Finance issues the invoice. The narrow permission the Construction Director holds.
 */
export const MARK_READY_PERMISSION = 'mark-ready:billing' as const;

/**
 * Mirrors the route gate: `view:contract` AND (`manage:receivable` OR `mark-ready:billing`).
 * The API stays the boundary; this only decides whether the buttons render.
 */
export function useCanMarkReadyToBill(): boolean {
  const { can } = usePermissions();
  return can('view:contract') && (can(MARK_READY_PERMISSION) || can('manage:receivable'));
}

/**
 * The schedule (every commercial read of the project), Progress → milestones (each release line's
 * `collectionStatus`) and Finance's portfolio / "To bill" queue.
 */
function invalidateReadiness(qc: QueryClient, projectId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) }),
    qc.invalidateQueries({ queryKey: programmeKeys.milestones(projectId) }),
    qc.invalidateQueries({ queryKey: financePortfolioKeys.all }),
  ]);
}

/** Marks a payment-schedule stage ready to bill (Construction's signal to Finance). */
export function useMarkReadyToBill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ installmentId, note }: { installmentId: string; note?: string }) =>
      markInstallmentReadyToBill(projectId, installmentId, note),
    meta: { successToast: 'commercial.feedback.stageMarkedReady' },
    onSuccess: () => invalidateReadiness(qc, projectId),
  });
}

/** Undoes ready-to-bill before Finance has prepared the invoice. */
export function useRevokeReadyToBill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ installmentId, reason }: { installmentId: string; reason?: string }) =>
      revokeInstallmentReadiness(projectId, installmentId, reason),
    meta: { successToast: 'commercial.feedback.stageReadyUndone' },
    onSuccess: () => invalidateReadiness(qc, projectId),
  });
}
