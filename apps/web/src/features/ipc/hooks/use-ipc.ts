'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCertificatePaymentStatus, getIpc, listIpcs } from '../api/ipc-api';
import type { CertificatePaymentStatus, Ipc, IpcDetail } from '../types';

export const ipcKeys = {
  all: ['ipc'] as const,
  list: (applicationId?: string) => [...ipcKeys.all, 'list', applicationId ?? 'all'] as const,
  detail: (id: string) => [...ipcKeys.all, 'detail', id] as const,
  payment: (id: string) => [...ipcKeys.all, 'payment', id] as const,
};

export function useIpcs(applicationId?: string): UseQueryResult<Ipc[], Error> {
  return useQuery({
    queryKey: ipcKeys.list(applicationId),
    queryFn: () => listIpcs(applicationId),
  });
}

export function useIpc(id: string): UseQueryResult<IpcDetail, Error> {
  return useQuery({
    queryKey: ipcKeys.detail(id),
    queryFn: () => getIpc(id),
  });
}

/**
 * Allocation total for a certificate — read `totalAllocated`, never `status`. See the note
 * on `getCertificatePaymentStatus` and `settlementFor`.
 *
 * Kept separate from `useIpc` rather than folded into it: the certificate itself is a fixed
 * document, while what has been paid against it changes whenever a receipt is allocated. A
 * failure here should cost the payment line, not the whole certificate.
 */
export function useCertificatePaymentStatus(
  id: string,
): UseQueryResult<CertificatePaymentStatus, Error> {
  return useQuery({
    queryKey: ipcKeys.payment(id),
    queryFn: () => getCertificatePaymentStatus(id),
  });
}
