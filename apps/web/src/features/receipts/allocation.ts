import type { Contract } from '@/features/contracts/types';
import type { Ipc } from '@/features/ipc/types';
import type { Ipa } from '@/features/ipa/types';

import type { ReceiptAllocation } from './types';

/**
 * ─── Money arithmetic on this screen ────────────────────────────────────────────
 *
 * Everything here works in integer MINOR UNITS — cents — parsed from the decimal strings
 * the API sends. Summing `0.1 + 0.2` in binary floating point is the textbook example of
 * why not to do this with `Number`, and the figure being computed is "how much of this
 * payment is still unallocated", which decides whether a request is accepted.
 *
 * The alternative was a decimal library, which would be the first runtime dependency added
 * for arithmetic. At two decimal places and ACCO's contract values, integers are exact and
 * cost nothing.
 */

/** `"1234.50"` → `123450`. Returns 0 for anything unparseable. */
export function toMinorUnits(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;

  const trimmed = value.trim();
  if (!trimmed) return 0;

  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');

  const major = Number.parseInt(whole || '0', 10);
  const minor = Number.parseInt(fraction.padEnd(2, '0').slice(0, 2) || '0', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return 0;

  const total = major * 100 + minor;
  return negative ? -total : total;
}

/** `123450` → `"1234.50"`. The inverse, for values sent back to the API. */
export function fromMinorUnits(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Total already allocated on a receipt, in minor units. */
export function allocatedMinor(allocations: readonly ReceiptAllocation[]): number {
  return allocations.reduce((sum, a) => sum + toMinorUnits(a.allocatedAmount), 0);
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
  if (!Number.isFinite(Number(trimmed))) return 'not-a-number';

  const minor = toMinorUnits(trimmed);
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
