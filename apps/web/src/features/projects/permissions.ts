import type { PermissionKey } from '@/features/auth/permissions/can';

/**
 * Project permissions.
 *
 * Every write route on a project carries the same guard on the API side —
 * `@RequirePermissions(PERMISSIONS.projectsManage)` on `PATCH /projects/:id`, `start`,
 * `practical-completion`, `closeout`, `close`, `cancel`, `suspend` and `resume` alike. One
 * permission covers the whole set, so the UI gates on the same single key rather than
 * inventing a finer-grained vocabulary the server does not have.
 *
 * (`reopen-to-active` and `reopen-to-practical-completion` need `projectsApprove` instead, but
 * the workspace does not offer them — a reopen is an exception path, not a header button.)
 *
 * Taken verbatim from the API catalogue (`packages/types/src/permissions.ts`) — no renaming.
 * The API remains the security boundary; this hides controls a user cannot use, so they do not
 * discover their own permissions by collecting 403s.
 */
export const PROJECT_PERMISSIONS = {
  /** Edit project information, and run every lifecycle command. */
  manage: 'manage:project',
} as const satisfies Record<string, PermissionKey>;
