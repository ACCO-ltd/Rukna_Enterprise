/**
 * ADR-021 amendment (2026-09-28) — when a programme milestone is ready to verify.
 *
 * A milestone names the work packages that make up its stage. It is ready once it is still
 * PLANNED, at least one package is linked, and every linked package reads 100% verified. With no
 * packages linked there is no evidence either way, so it is never "ready" — the site team verifies
 * such a milestone on their own judgement, exactly as before the link existed.
 *
 * Readiness is a prompt, not a gate: verifying stays a deliberate human act (it is billing
 * evidence, ADR-023 CONST-COM-011), and a PLANNED milestone may still be verified when not ready.
 *
 * Pure and synchronous — the caller supplies each package's whole-number verified %, the same figure
 * the progress roll-up reports (`packagePercentComplete`).
 */

export function isMilestoneReadyToVerify(
  status: string,
  workPackages: readonly { percentComplete: number }[],
): boolean {
  return (
    status === 'PLANNED' &&
    workPackages.length > 0 &&
    workPackages.every((wp) => wp.percentComplete >= 100)
  );
}
