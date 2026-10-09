/**
 * ADR-045 — the posting profile that names where buyer (staff) cash advances are held
 * (13100 Staff advances in the construction chart). Resolved effective-dated, like the bill
 * expense profiles; it is the only profile allowed to point at an ASSET account.
 */
export const STAFF_ADVANCE_PROFILE_CODE = 'STAFF_ADVANCE';
