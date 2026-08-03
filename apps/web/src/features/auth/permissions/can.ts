/**
 * Authorization seam for UI affordances.
 *
 * Deliberately permissive today, and that is a documented decision rather than an
 * oversight. Two facts drive it:
 *
 *  1. `tenant-provision.ts` seeds a single ADMIN role with NO rolePermissions, and the
 *     `permissions` table is never populated — so every JWT carries `permissions: []`.
 *     A faithful permission check would hide every action from every user, including the
 *     administrator.
 *  2. No Projects or BOQ endpoint uses RolesGuard. Only JwtAuthGuard is applied, so the
 *     server enforces the lifecycle state machine and nothing else.
 *
 * Showing an action the server would reject is the lesser evil versus shipping an app
 * where nothing is clickable. `constraints.md:299` is explicit that frontend
 * authorization exists for user experience only — the server is the boundary.
 *
 * When permissions are seeded and guards are added, this is the single file to change.
 * Components must call `can()` rather than reading `permissions` directly, so that switch
 * stays a one-file change.
 */

import { sessionStore } from '../session/session-store';

/** Permission strings follow the API's `action:resource` convention (e.g. `create:project`). */
export type PermissionKey = `${string}:${string}`;

/**
 * Flip to `true` once the backend seeds the `permissions` table and applies RolesGuard to
 * the Projects and BOQ controllers. The enforcing implementation below is already correct;
 * this is the entire switch.
 *
 * Typed as `boolean` rather than inferred as `false` so the enforcing branch stays
 * type-checked instead of being treated as unreachable.
 */
const PERMISSIONS_ENFORCED: boolean = false;

export function can(permission: PermissionKey): boolean {
  if (!PERMISSIONS_ENFORCED) return true;

  return sessionStore.getState().user?.permissions.includes(permission) ?? false;
}

/** True when the signed-in user holds the named platform role. */
export function hasRole(role: string): boolean {
  return sessionStore.getState().user?.roles.includes(role) ?? false;
}
