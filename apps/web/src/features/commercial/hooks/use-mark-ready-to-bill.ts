'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { markInstallmentReadyToBill, revokeInstallmentReadiness } from '../api/commercial-api';

/** Marks a payment installment as commercially ready to bill (Slice 3B). */
export function useMarkReadyToBill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ installmentId, note }: { installmentId: string; note?: string }) =>
      markInstallmentReadyToBill(projectId, installmentId, note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['commercial', 'current-cycle', projectId] });
    },
  });
}

/** Revokes ready-to-bill status before an invoice exists (Slice 3B). */
export function useRevokeReadyToBill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ installmentId, reason }: { installmentId: string; reason?: string }) =>
      revokeInstallmentReadiness(projectId, installmentId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['commercial', 'current-cycle', projectId] });
    },
  });
}
