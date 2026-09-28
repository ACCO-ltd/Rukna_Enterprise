/**
 * ADR-021 amendment (2026-09-28) — when a programme milestone is ready to verify.
 *
 * A milestone names the work packages that make up its stage. It is ready once it is still
 * PLANNED, at least one package is linked, and every linked package is FULLY verified. With no
 * packages linked there is no evidence either way, so it is never "ready" — the site team verifies
 * such a milestone on their own judgement, exactly as before the link existed.
 *
 * "Fully verified" is decided on exact decimal quantities, never on the rounded display % — a leaf
 * at 199.1 of 200 displays as 100% but is not done, and a verified milestone is billing evidence
 * (ADR-023 CONST-COM-011), so the prompt must not fire early.
 *
 * Readiness is a prompt, not a gate: verifying stays a deliberate human act, and a PLANNED milestone
 * may still be verified when not ready.
 *
 * Pure and synchronous — the caller supplies the figures.
 */

import { Decimal } from '@prisma/client/runtime/library';

const ZERO = new Decimal(0);

/** One BOQ leaf allocated to a package: its measurable quantity, role and verified-to-date. */
export interface ReadinessLeaf {
  /** Null/absent when the leaf is not found on this project's BOQ — it then counts as not done. */
  quantity: Decimal | null;
  nodeRole: string;
  /** Σ quantity verified on the leaf by APPROVED reports. */
  verified: Decimal;
}

/**
 * True when the package has at least one measurable leaf and every measurable leaf has
 * verified ≥ measurable quantity (exact Decimal). A CONTINGENCY leaf is a held reserve, not work,
 * so it is ignored (the roll-up gives it no weight either). A leaf with no measurable quantity
 * cannot be shown complete, so it holds the package open.
 */
export function isPackageFullyVerified(leaves: readonly ReadinessLeaf[]): boolean {
  const work = leaves.filter((leaf) => leaf.nodeRole !== 'CONTINGENCY');
  if (work.length === 0) return false;
  return work.every(
    (leaf) =>
      leaf.quantity !== null &&
      leaf.quantity.greaterThan(ZERO) &&
      leaf.verified.greaterThanOrEqualTo(leaf.quantity),
  );
}

export function isMilestoneReadyToVerify(
  status: string,
  workPackages: readonly { fullyVerified: boolean }[],
): boolean {
  return (
    status === 'PLANNED' && workPackages.length > 0 && workPackages.every((wp) => wp.fullyVerified)
  );
}
