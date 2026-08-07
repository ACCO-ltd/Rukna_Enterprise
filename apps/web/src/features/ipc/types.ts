import { IpcStatus } from '@erp/types';

export type {
  Ipc,
  IpcDetail,
  IpcItem,
  IpcDeduction,
  CertificatePaymentStatus,
} from '@/lib/api-types';

export { IpcStatus };

/** Request body for `POST /ipc`. `certifiedTotal` is server-computed — do not send it. */
export interface IssueIpcPayload {
  applicationId: string;
  status: 'CERTIFIED' | 'PARTIALLY_CERTIFIED' | 'REJECTED';
  currency: string;
  exchangeRateCurrency?: string;
  exchangeRateBase?: string;
  exchangeRateValue?: string;
  exchangeRateDate?: string;
  notes?: string;
  items: Array<{
    applicationItemId: string;
    certifiedQuantity: string;
    varianceReason?: string;
  }>;
  /** Ad-hoc deductions only. RETENTION and ADVANCE_RECOVERY are server auto-generated. */
  deductions: Array<{
    deductionType: string;
    basis: string;
    amount: string;
  }>;
}
