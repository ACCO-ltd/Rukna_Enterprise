'use client';

/**
 * Authorization seam for UI affordances.
 *
 * Permission claims come from the user's active organization membership. Components call
 * this seam instead of reading claims directly; the API remains the security boundary.
 */

import { useSyncExternalStore } from 'react';

import type { AuthenticatedUser } from '../session/session-store';
import { sessionStore } from '../session/session-store';

/** Permission strings follow the API's `action:resource` convention (e.g. `create:project`). */
export type PermissionKey = `${string}:${string}`;

/**
 * Explicitly typed so both branches remain type-checked if local development ever needs
 * a temporary diagnostic override.
 */
const PERMISSIONS_ENFORCED: boolean = true;

/**
 * Minimum permission keys that grant visibility of each sidebar module section.
 * Keys must match the module identifiers passed to `moduleVisible()`.
 * A module is visible when the current user holds at least one listed permission.
 */
const MODULE_PERMISSIONS: Record<string, PermissionKey[]> = {
  portfolio:      ['view:project', 'create:project', 'view:client'],
  finance:        ['view:receipt', 'create:receipt'],
  accounting:     ['view:accounting'],
  procurement:    ['view:procurement'],
  // Procurement moved out to its own group in Sprint 5, leaving Inventory (Sprint 7).
  // Keyed on the permission that module will need rather than the one it used to borrow.
  operations:     ['view:inventory'],
  reports:        ['view:report'],
  administration: ['manage:user', 'manage:role', 'view:audit-log'],
};

/**
 * Accounting permissions, named to the platform's `action:resource` convention.
 *
 * `frontend-design.md` §11.2 specifies these as `view:accounting`, `manage:journals`,
 * `manage:ar`, `manage:ap`, `manage:periods` and `manage:year-end`. The last three are not
 * `action:resource` — the live convention is singular and names a resource (`view:project`,
 * `manage:role`), so they are spelled that way here. Raised on issue #25; if the backend
 * seeds the §11.2 spelling instead, this map is the one place to change.
 *
 * These names are shared with the API permission catalogue and enforced on both sides.
 */
export const ACCOUNTING_PERMISSIONS = {
  /** Every accounting page. Read-only views included. */
  view: 'view:accounting',
  /**
   * Create a GL account, and the rest of tenant bootstrap as it lands.
   *
   * **Not in §11.2** — that section lists six permissions for posting and period control and
   * says nothing about setting the chart up, because Sprint 4 shipped the chart read-only.
   * A new key rather than a rename, on the same reasoning as `manageSuppliers`.
   *
   * Deliberately separate from `manageJournals`: the person who posts journals is not
   * necessarily the person who decides what accounts exist, and adding an account with an
   * existing `accountSubtype` turns a resolved control account into an AMBIGUOUS one — it can
   * block posting across every AR and AP screen. That is administrator work.
   */
  manageChart: 'manage:account',
  /** Create, submit, approve, post and reverse manual journals. */
  manageJournals: 'manage:journal',
  /** Post client invoices; post and allocate customer receipts. */
  manageReceivables: 'manage:receivable',
  /** Create and post supplier bills and payments. */
  managePayables: 'manage:payable',
  /** Lock, close, reopen periods; rebuild snapshots. */
  managePeriods: 'manage:period',
  /** Year-end close. CFO only. */
  manageYearEnd: 'manage:fiscal-year',
} as const satisfies Record<string, PermissionKey>;

/**
 * Procurement permissions, taken **verbatim** from `frontend-design.md` §12.2.
 *
 * Deliberately not renamed, unlike the accounting set above. Seven of these nine already
 * match the live `action:resource` convention — `create:purchase-order` is the example
 * `apps/api/CLAUDE.md` itself gives — and `view:procurement` has the same shape as
 * `view:accounting`, which Sprint 4 already adopted.
 *
 * That leaves one genuine outlier: `manageConfig` names a configuration surface rather
 * than a resource. It is spelled as the spec spells it and raised as a naming question on
 * issue #28, rather than corrected here. Sprint 4 renamed §11.2's keys unilaterally and
 * needed a paragraph to justify it; doing that a second time compounds the divergence
 * instead of resolving it, and if the backend seeds the document's spelling, a key we
 * invented would silently never match.
 *
 * These names are shared with the API permission catalogue and enforced on both sides.
 */
export const PROCUREMENT_PERMISSIONS = {
  /** Any procurement page. Minimum required; gates the whole sidebar group. */
  view: 'view:procurement',
  /** Create and deactivate UoM, material categories, spend categories, materials. */
  manageConfig: 'manage:procurement-config',
  /**
   * Create a supplier.
   *
   * **Not in §12.2** — the section predates `GET/POST /suppliers`, which only landed with
   * `7cf2507`. So this is a new key rather than a rename, which is the distinction the
   * paragraph above is guarding: nothing in the document is being overruled.
   *
   * Deliberately not folded into `manageConfig`. A supplier is master data added whenever
   * purchasing widens, not one-time configuration — and gating it on the setup permission
   * would mean a buyer holding `create:purchase-order` could not add the supplier their own
   * order needs, which is the one thing that must not happen on the screen this unblocks.
   *
   * Spelled `manage:supplier` to match the live singular convention (`manage:role`,
   * `manage:user`). Raise it on #28 alongside the `manageConfig`
   * naming question rather than settling it here.
   */
  manageSuppliers: 'manage:supplier',
  /** Create a material request. Submit is available to the requester. */
  createRequest: 'create:material-request',
  /** Approve a material request. */
  approveRequest: 'approve:material-request',
  /** Create a purchase order. */
  createOrder: 'create:purchase-order',
  /** Approve a PO revision — this writes commitment ledger entries. Gate carefully. */
  approveOrder: 'approve:purchase-order',
  /** Create and post a goods receipt. */
  createReceipt: 'create:goods-receipt',
  /** Approve a bill matching exception, releasing the posting block. */
  approveMatchException: 'approve:matching-exception',
  /** The commitment ledger and the project summary card. */
  viewCommitments: 'view:commitment-ledger',
} as const satisfies Record<string, PermissionKey>;

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
