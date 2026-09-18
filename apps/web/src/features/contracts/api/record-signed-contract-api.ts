import type { ContractPaymentInstallmentResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { PaymentInstallmentPayload } from './contracts-api';
import type { Contract } from '../types';

/**
 * Body accepted by `POST /contracts/record-signed`.
 *
 * Agent A owns the backend for this command. It creates the contract AND activates it
 * atomically — no separate activate call is needed. Unlike the standard `POST /contracts`,
 * `contractValue` here is what the parties physically agreed; it is NOT validated against
 * the BOQ tie-out. The BOQ snapshot is preserved as the reference scope, but the signed
 * value is the authoritative baseline (`baseContractValue`).
 *
 * `signedDocumentId` is a READY platform file already uploaded through the standard two-step
 * flow (presign → PUT → confirm). If supplied, it is bound to the contract before the
 * activation freeze so it becomes part of the immutable record.
 */
export interface RecordSignedContractPayload {
  projectId: string;
  clientId: string;
  /** Optional — server auto-generates from project code if absent. */
  contractNumber?: string;
  /** ISO date the parties signed. New field: stored as `signedDate` on the contract. */
  signedDate: string;
  /** Decimal string — what was physically agreed, e.g. "750000.00". */
  contractValue: string;
  /** Default MILESTONE for ACCO. */
  billingModel?: string;
  /** Free-text payment terms, e.g. "30 days from invoice date". New field on contract. */
  paymentTerms?: string;
  /** Contractual start date — may differ from signedDate. */
  startDate?: string;
  expectedEndDate?: string;
  paymentPlan: PaymentInstallmentPayload[];
  /** Platform file id already in READY state. Bound before activation freeze. */
  signedDocumentId?: string;
}

/**
 * Response from `POST /contracts/record-signed`.
 *
 * Returns the created + activated contract together with the source BOQ snapshot description
 * (plain language — no IDs exposed) and the resolved milestone list, so the frontend can
 * display a confirmation without a follow-up fetch.
 */
export interface RecordSignedContractResponse {
  contract: Contract;
  /** = baseContractValue, what was signed. */
  originalContractValue: string;
  /** = contractValue at creation time (same as original before any variations). */
  currentContractValue: string;
  /** Plain-language BOQ snapshot context. No boqVersionId or COMMITTED enum exposed. */
  sourceSnapshotMetadata: {
    description: string;
  };
  milestones: ContractPaymentInstallmentResponse[];
}

export function recordSignedContract(
  payload: RecordSignedContractPayload,
): Promise<RecordSignedContractResponse> {
  return apiClient<RecordSignedContractResponse>('/contracts/record-signed', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
