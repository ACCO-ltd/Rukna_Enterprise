/**
 * Primary create-actions surfaced in the command menu's "Actions" group.
 *
 * Each action maps a verb-first label to a `/new` route that is verified to exist under
 * `app/(app)/…/new/page.tsx`. Actions carry the same two gates the sidebar uses:
 *
 *  - `moduleKey` — the sidebar module the action belongs to. The user must be able to see
 *    that module (`moduleVisible`) for the action to appear, matching how a destination
 *    inside that domain is gated.
 *  - `permissionKey` — an optional finer gate. When present the user must also hold it
 *    (`can`). Absent means module visibility is sufficient, exactly as an ungated nav item.
 *
 * Honesty rule (ux-doctrine §4): an action is only listed when its route is built. There is
 * no "coming soon" action.
 */

import type { PermissionKey } from '@/features/auth/permissions/can';

export interface CommandAction {
  /** Stable id, also the i18n key suffix under `commandMenu.action.*`. */
  id: string;
  /** Destination route. Verified to exist. */
  href: string;
  /** Sidebar module this action lives under — gates via `moduleVisible`. */
  moduleKey: string;
  /** Optional finer permission gate, checked with `can`. */
  permissionKey?: PermissionKey;
}

/**
 * Each `permissionKey` mirrors the finer gate the destination screen actually enforces on its
 * own "New …" button (verified against the feature components). Where a create screen gates on
 * module visibility alone — clients, contracts, receipts, journals — the action carries no
 * `permissionKey`, so the command menu shows exactly what the sidebar + screen would allow,
 * never more and never less.
 */
export const COMMAND_ACTIONS: CommandAction[] = [
  { id: 'createProject', href: '/projects/new', moduleKey: 'portfolio', permissionKey: 'create:project' },
  { id: 'newClient', href: '/clients/new', moduleKey: 'portfolio' },
  { id: 'newContract', href: '/contracts/new', moduleKey: 'portfolio' },
  {
    id: 'newMaterialRequest',
    href: '/procurement/requests/new',
    moduleKey: 'procurement',
    permissionKey: 'create:material-request',
  },
  {
    id: 'newPurchaseOrder',
    href: '/procurement/orders/new',
    moduleKey: 'procurement',
    permissionKey: 'create:purchase-order',
  },
  {
    id: 'newGoodsReceipt',
    href: '/procurement/grn/new',
    moduleKey: 'procurement',
    permissionKey: 'create:goods-receipt',
  },
  { id: 'newReceipt', href: '/receipts/new', moduleKey: 'accounting' },
  { id: 'newJournal', href: '/finance/accounting/journals/new', moduleKey: 'accounting' },
  {
    id: 'newBill',
    href: '/finance/accounting/bills/new',
    moduleKey: 'accounting',
    permissionKey: 'manage:payable',
  },
  {
    id: 'newPayment',
    href: '/finance/accounting/payments/new',
    moduleKey: 'accounting',
    permissionKey: 'manage:payable',
  },
];
