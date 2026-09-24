// Pure validation for a Delivery Plan batch save (BOQ-derived work packages + leaf allocations,
// created together). No Prisma, no NestJS — the service loads what already exists and calls this
// before it ever opens a transaction, so a bad batch is rejected with a clear reason instead of a
// raw unique-constraint 500 partway through a write.

export interface DeliveryPlanPackageInput {
  code: string;
  name: string;
  responsibleOwner?: string | null;
  /** Fraction 0..1. Undefined/omitted means "not set yet" (0 on the row), never invented. */
  progressWeight?: number;
  boqNodeIds: string[];
}

export interface DeliveryPlanValidationError {
  /** Which submitted package the problem belongs to, or `null` for a whole-batch problem. */
  packageIndex: number | null;
  message: string;
}

/**
 * Checks a batch against itself and against what the project already has, WITHOUT touching the
 * database — every fact it needs (existing codes, existing allocations) is supplied by the caller,
 * already read once. Returns every problem found, not just the first, so a PM reviewing a rejected
 * plan sees the whole list at once rather than fixing one field per round trip.
 */
export function validateDeliveryPlanBatch(
  packages: readonly DeliveryPlanPackageInput[],
  existingCodes: ReadonlySet<string>,
  alreadyAllocatedLeafIds: ReadonlySet<string>,
): DeliveryPlanValidationError[] {
  const errors: DeliveryPlanValidationError[] = [];

  if (packages.length === 0) {
    errors.push({ packageIndex: null, message: 'The plan has no packages to save.' });
    return errors;
  }

  const codesInBatch = new Map<string, number>(); // code -> first index that used it
  const leafIdsInBatch = new Map<string, number>(); // boqNodeId -> first index that used it

  packages.forEach((pkg, index) => {
    const code = pkg.code.trim();
    const name = pkg.name.trim();

    if (!code) errors.push({ packageIndex: index, message: 'Package code is required.' });
    if (!name) errors.push({ packageIndex: index, message: 'Package name is required.' });

    if (pkg.progressWeight !== undefined && (pkg.progressWeight < 0 || pkg.progressWeight > 1)) {
      errors.push({ packageIndex: index, message: `"${name || code}" — weight must be between 0 and 1.` });
    }

    if (code) {
      const firstIndex = codesInBatch.get(code);
      if (firstIndex !== undefined) {
        errors.push({
          packageIndex: index,
          message: `Code "${code}" is used by more than one package in this plan.`,
        });
      } else {
        codesInBatch.set(code, index);
      }
      if (existingCodes.has(code)) {
        errors.push({
          packageIndex: index,
          message: `Code "${code}" is already used by an existing work package.`,
        });
      }
    }

    for (const leafId of pkg.boqNodeIds) {
      const firstIndex = leafIdsInBatch.get(leafId);
      if (firstIndex !== undefined && firstIndex !== index) {
        errors.push({
          packageIndex: index,
          message: `"${name || code}" — a BOQ item is assigned to more than one package in this plan.`,
        });
      }
      leafIdsInBatch.set(leafId, index);
      if (alreadyAllocatedLeafIds.has(leafId)) {
        errors.push({
          packageIndex: index,
          message: `"${name || code}" — a BOQ item is already allocated to an existing work package.`,
        });
      }
    }
  });

  return errors;
}
