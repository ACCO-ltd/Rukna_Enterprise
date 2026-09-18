'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { commercialKeys } from '@/features/commercial/hooks/use-commercial';

import { recordSignedContract, type RecordSignedContractPayload } from '../api/record-signed-contract-api';
import { contractKeys } from './use-contracts';

/**
 * Input to the record mutation. The raw `File` object (if any) is uploaded inside
 * `mutationFn` before the contract call — callers never touch the file upload directly.
 * The file is optional; a signed document can be attached later from the security tab.
 */
export interface RecordSignedContractInput extends Omit<RecordSignedContractPayload, 'signedDocumentId'> {
  /** Optional signed contract file. Uploaded first; fileId forwarded as signedDocumentId. */
  file?: File;
}

/**
 * Atomic "record a signed contract" mutation.
 *
 * Sequence (all awaited inside `mutationFn` → single `isPending` state):
 *   1. If a file was attached: presign → PUT → confirm → receive fileId.
 *   2. POST /contracts/record-signed (with signedDocumentId if step 1 ran).
 *   3. On success: invalidate the commercial summary cache and navigate to contract-security.
 *
 * The contract is created ACTIVE — no separate activate call. DRAFT/ACTIVE lifecycle details
 * are not surfaced to the user.
 */
export function useRecordSignedContract(projectId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const upload = useFileUpload();

  return useMutation({
    mutationFn: async ({ file, ...rest }: RecordSignedContractInput) => {
      let signedDocumentId: string | undefined;
      if (file) {
        signedDocumentId = await upload.mutateAsync(file);
      }
      return recordSignedContract({ ...rest, signedDocumentId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commercialKeys.summary(projectId) });
      void queryClient.invalidateQueries({ queryKey: contractKeys.list(projectId) });
      router.push(`/projects/${projectId}/commercial/contract-security`);
    },
  });
}
