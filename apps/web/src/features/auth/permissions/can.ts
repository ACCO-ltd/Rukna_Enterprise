'use client';

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
 * Components must call `can()` / `usePermissions()` rather than reading `permissions`
 * directly, so that switch stays a one-file change.
 */

import { useSyncExternalStore } from 'react';

import type { AuthenticatedUser } from '../session/session-store';
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

/**
 * Minimum permission keys that grant visibility of each sidebar module section.
 * Keys must match the module identifiers passed to `moduleVisible()`.
 * When PERMISSIONS_ENFORCED is false every module is visible regardless.
 */
const MODULE_PERMISSIONS: Record<string, PermissionKey[]> = {
  portfolio:      ['view:project', 'create:project', 'view:client'],
  finance:        ['view:receipt', 'create:receipt'],
  operations:     ['view:purchase-order'],
  reports:        ['view:report'],
  administration: ['manage:user', 'manage:role', 'view:audit-log', 'manage:exchange-rate'],
};

// ─── Core logic (shared by plain functions and the hook) ──────────────────────

function canWith(user: AuthenticatedUser | null, permission: PermissionKey): boolean {
  if (!PERMISSIONS_ENFORCED) return true;
  return user?.permissions.includes(permission) ?? false;
}

function moduleVisibleWith(user: AuthenticatedUser | null, module: string): boolean {
  if (!PERMISSIONS_ENFORCED) return true;
  const keys = MODULE_PERMISSIONS[module];
  if (!keys) return false;
  return keys.some((k) => user?.permissions.includes(k) ?? false);
}

// ─── Non-reactive functions (safe to call outside React components) ───────────

/** Returns true when the current user holds the given permission. */
export function can(permission: PermissionKey): boolean {
  return canWith(sessionStore.getState().user, permission);
}

/** True when the signed-in user holds the named platform role. */
export function hasRole(role: string): boolean {
  return sessionStore.getState().user?.roles.includes(role) ?? false;
}

// ─── Reactive hook ────────────────────────────────────────────────────────────

/**
 * Reactive permission resolver for React components.
 *
 * Re-renders automatically when the session changes (login, logout, token refresh).
 * Use this in components; use the plain `can()` function in non-component contexts
 * such as route guards or server actions.
 *
 * @example
 * const { can, canAny, moduleVisible } = usePermissions();
 * can('approve:contract')              // show / disable a button
 * canAny(['create:ipa', 'view:ipa'])   // any of these grants access
 * moduleVisible('administration')      // hide entire sidebar section
 */
export function usePermissions() {
  const user = useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getState().user,
    () => null, // server snapshot — SSR always starts with no session
  );

  return {
    can: (permission: PermissionKey) => canWith(user, permission),
    canAny: (permissions: PermissionKey[]) => permissions.some((p) => canWith(user, p)),
    moduleVisible: (module: string) => moduleVisibleWith(user, module),
  };
}
