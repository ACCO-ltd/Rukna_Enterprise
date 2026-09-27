/**
 * ADR-029 §2 — the BOQ version statuses that mean "the scope is frozen".
 *
 * R2 introduced COMMITTED as the in-place operational status that committing a BOQ produces;
 * BASELINED still exists until the R2 contract-phase migration flips it. Both mean the same
 * thing to every caller: a contract may be signed against it, and a project's "Baseline the BOQ"
 * readiness step is done. Checking only BASELINED made a committed BOQ read as "not baselined".
 */
export const COMMITTED_BOQ_STATUSES: ReadonlySet<string> = new Set(['COMMITTED', 'BASELINED']);

export function isCommittedBoqStatus(status: string): boolean {
  return COMMITTED_BOQ_STATUSES.has(status);
}

/** True when any of the BOQ's versions is committed (or legacy-baselined). */
export function hasCommittedBoqVersion(versions: ReadonlyArray<{ status: string }> | undefined): boolean {
  return versions?.some((version) => isCommittedBoqStatus(version.status)) ?? false;
}
