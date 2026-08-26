import type { PermissionKey } from '@/features/auth/permissions/can';

/**
 * Progress permissions.
 *
 * The progress module has always gated its write chain (create/submit/approve/return a DPR,
 * create a work package, allocate a BOQ node) on the project-manage permission — every one of
 * those routes carries `@RequirePermissions(PERMISSIONS.projectsManage)` on the API side. The
 * Round-2 manual snapshot capture (`POST /projects/:id/progress/snapshots`) is gated on the
 * same permission, so capturing a snapshot reuses `manage` rather than inventing a new key.
 *
 * Taken verbatim from the API catalogue (`packages/types/src/permissions.ts`) — no renaming.
 * The API remains the security boundary; this hides the capture action a user cannot perform.
 */
export const PROGRESS_PERMISSIONS = {
  /** Capture a manual progress snapshot (and the rest of the progress write chain). */
  manage: 'manage:project',
} as const satisfies Record<string, PermissionKey>;
