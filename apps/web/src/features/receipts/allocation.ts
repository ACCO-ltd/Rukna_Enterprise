import type { Contract } from '@/features/contracts/types';
import type { Ipc } from '@/features/ipc/types';
import type { Ipa } from '@/features/ipa/types';
import {
  MONEY_SCALE,
  fromMinorUnits as fromMinor,
  parseMinorUnits,
  sumMinorUnits,
  toMinorUnits as toMinor,
} from '@/lib/money';

import type { ReceiptAllocation } from './types';

/**
 * ─── Money arithmetic on this screen ────────────────────────────────────────────
 *
 * Everything here works in integer MINOR UNITS — cents — parsed from the decimal strings
 * the API sends. Summing `0.1 + 0.2` in binary floating point is the textbook example of
 * why not to do this with `Number`, and the figure being computed is "how much of this
 * payment is still unallocated", which decides whether a request is accepted.
 *
 * The parser lives in `@/lib/money` — it began here, and moved when the accounting workspace
 * needed it too. The re-exports below keep this module's callers working; new code should
 * import from `@/lib/money` directly and name its scale.
 */

/** @deprecated Import from `@/lib/money` and pass `MONEY_SCALE` explicitly. */
export function toMinorUnits(value: string | null | undefined): number {
  return toMinor(value, MONEY_SCALE);
}

/** @deprecated Import from `@/lib/money` and pass `MONEY_SCALE` explicitly. */
export function fromMinorUnits(minor: number): string {
  return fromMinor(minor, MONEY_SCALE);
}

/** Total already allocated on a receipt, in minor units. */
export function allocatedMinor(allocations: readonly ReceiptAllocation[]): number {
  return sumMinorUnits(
    allocations.map((a) => a.allocatedAmount),
    MONEY_SCALE,
  );
}

/**
 * What is left of a receipt to allocate.
 *
 * Mirrors the server's own guard (`finance.service.ts:59`), which rejects an allocation
 * that would push the total past the receipt amount. Computing it here means the form can
 * show the remaining balance live and stop an over-allocation before the round-trip,
 * rather than surfacing a 400 the user has to read.
 */
export function unallocatedMinor(
  receiptAmount: string,
  allocations: readonly ReceiptAllocation[],
): number {
  return toMinorUnits(receiptAmount) - allocatedMinor(allocations);
}

/** True when the receipt has been applied exactly, with nothing left over. */
export function isFullyAllocated(
  receiptAmount: string,
  allocations: readonly ReceiptAllocation[],
): boolean {
  return unallocatedMinor(receiptAmount, allocations) === 0;
}

/**
 * True when MORE has been allocated than was received.
 *
 * This is not a hypothetical. C17 (issue #14) lets a negative allocation through, which
 * frees headroom for later ones; deleting the negative afterwards leaves the receipt
 * genuinely over-allocated, and nothing on the server re-checks it. Real receipts are in
 * that state now.
 *
 * Kept distinct from `isFullyAllocated` because the two must not read the same. An earlier
 * version tested `<= 0` for "fully allocated", which badged an over-allocated receipt as
 * tidily settled — the one presentation guaranteed to stop anyone noticing.
 */
export function isOverAllocated(
  receiptAmount: string,
  allocations: readonly ReceiptAllocation[],
): boolean {
  return unallocatedMinor(receiptAmount, allocations) < 0;
}

export type AllocationProblem = 'empty' | 'not-a-number' | 'not-positive' | 'exceeds-balance';

/**
 * Validates a typed allocation against the remaining balance.
 *
 * `not-positive` catches zero and negatives, which the API accepts: `@IsDecimal()` permits
 * `"-100.00"`, and the server's guard only checks the UPPER bound, so a negative allocation
 * would pass and silently increase the receipt's unallocated balance.
 */
export function allocationProblem(
  typed: string,
  receiptAmount: string,
  allocations: readonly ReceiptAllocation[],
): AllocationProblem | null {
  const trimmed = typed.trim();
  if (!trimmed) return 'empty';

  // The strict parser, not `Number.isFinite`: `Number("1,234")` is NaN but `Number("")` is 0,
  // and a coalescing parse would turn a typo into a valid zero rather than a rejection.
  const minor = parseMinorUnits(trimmed, MONEY_SCALE);
  if (minor === null) return 'not-a-number';
  if (minor <= 0) return 'not-positive';
  if (minor > unallocatedMinor(receiptAmount, allocations)) return 'exceeds-balance';

  return null;
}

/**
 * ─── Finding certificates to allocate against ───────────────────────────────────
 *
 * There is no endpoint for "certificates belonging to this client". `GET /ipc` filters on
 * `applicationId` alone, and a certificate row carries nothing else identifying — so the
 * link back to a client runs certificate → application → contract → client, three hops
 * across three unfiltered lists, joined here. Raised as C16.
 *
 * At ACCO's scale three list calls are affordable. This is written as a pure join so the
 * cost is visible and the mapping is testable, rather than hidden in a component.
 */
export interface CertificateOption {
  certificate: Ipc;
  contract: Contract;
  /** Already allocated to this certificate from the receipt being edited, in minor units. */
  allocatedFromThisReceipt: number;
}

export function certificatesForClient(
  certificates: readonly Ipc[],
  applications: readonly Ipa[],
  contracts: readonly Contract[],
  clientId: string,
  allocations: readonly ReceiptAllocation[] = [],
): CertificateOption[] {
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const contractIdByApplication = new Map(applications.map((a) => [a.id, a.contractId]));

  const allocatedByCertificate = new Map<string, number>();
  for (const allocation of allocations) {
    allocatedByCertificate.set(
      allocation.certificateId,
      (allocatedByCertificate.get(allocation.certificateId) ?? 0) +
        toMinorUnits(allocation.allocatedAmount),
    );
  }

  const options: CertificateOption[] = [];

  for (const certificate of certificates) {
    // A superseded certificate is not the one that gets paid — exactly one certificate per
    // application is effective, and allocating against a replaced one would record money
    // against a document the client no longer owes on.
    if (!certificate.isEffective) continue;

    const contractId = contractIdByApplication.get(certificate.applicationId);
    if (contractId === undefined) continue;

    const contract = contractById.get(contractId);
    if (contract === undefined || contract.clientId !== clientId) continue;

    options.push({
      certificate,
      contract,
      allocatedFromThisReceipt: allocatedByCertificate.get(certificate.id) ?? 0,
    });
  }

  return options;
}
