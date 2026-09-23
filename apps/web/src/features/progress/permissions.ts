import type { PermissionKey } from '@/features/auth/permissions/can';

/**
 * Progress permissions — ADR-022 CONST-DOA-008 split.
 *
 * record:progress  — Site Engineer and PM: create/submit DPRs, add measurements, attach evidence.
 * approve:progress — PM only: review, approve, return, reopen DPRs.
 * manage:project   — PM only: programme setup (work packages, baseline, targets, snapshots).
 *
 * The API remains the security boundary; the UI uses these keys to hide actions the caller
 * cannot perform. Taken verbatim from packages/types/src/permissions.ts — no renaming.
 */
export const PROGRESS_PERMISSIONS = {
  /** Create/submit a DPR, add measurements and attach evidence. Held by SE and PM. */
  record: 'record:progress',
  /** Review, approve, return or reopen a DPR. Held by PM only. */
  approve: 'approve:progress',
  /** Programme setup: work packages, baseline, targets, snapshots. Held by PM only. */
  manage: 'manage:project',
} as const satisfies Record<string, PermissionKey>;
