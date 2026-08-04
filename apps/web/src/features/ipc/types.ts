import { IpcStatus } from '@erp/types';

/**
 * IPC wire shapes live in `src/lib/api-types.ts` with every other shape the API returns.
 *
 * This module is READ-ONLY. Issuing a certificate is E5 and is gated on C1 (issue #12) —
 * the API requires the client to compute `certifiedTotal` and every deduction amount, and
 * the frontend will not author contract valuation until that is settled. Reading
 * certificates is unaffected, and receipts need it to allocate against them.
 */
export type {
  Ipc,
  IpcDetail,
  IpcItem,
  IpcDeduction,
  CertificatePaymentStatus,
} from '@/lib/api-types';

export { IpcStatus };
