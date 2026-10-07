import type { Prisma } from '@prisma/client';
import { PERMISSION_DEFINITIONS, PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * ADR-044 §5 — who collects and who chooses competitive quotations, for an existing tenant.
 *
 *   collect:quotation → Procurement Manager (the field buyer)
 *   award:quotation   → Finance Officer, CFO, CEO (product owner 2026-10-07: NOT the Construction
 *                       Director)
 *
 * Same shape as `finance-mr-approval.ts`, for the same reason: re-running `acco-team-roles.seed.ts`
 * or the governed-roles script on a live tenant would re-link every starting permission and undo
 * in-app role edits. This touches exactly these roles and these two permissions, never removes a
 * grant, and is safe to run any number of times. A role the tenant does not have is reported, not
 * created.
 */

export const QUOTATION_GRANTS: ReadonlyArray<{ roleName: string; permission: PermissionKey }> = [
  { roleName: 'Procurement Manager', permission: PERMISSIONS.quotationsCollect },
  { roleName: 'Finance Officer', permission: PERMISSIONS.quotationsAward },
  { roleName: 'CFO', permission: PERMISSIONS.quotationsAward },
  { roleName: 'CEO', permission: PERMISSIONS.quotationsAward },
];

type GrantClient = Pick<Prisma.TransactionClient, 'permission' | 'role' | 'rolePermission'>;

export type QuotationGrantResult = {
  roleName: string;
  permission: PermissionKey;
  status: 'granted' | 'already-granted' | 'role-missing';
};

export async function grantQuotationPermissions(
  prisma: GrantClient,
  organizationId: string,
): Promise<QuotationGrantResult[]> {
  const permissionIds = new Map<PermissionKey, string>();
  for (const key of new Set(QUOTATION_GRANTS.map((g) => g.permission))) {
    const definition = PERMISSION_DEFINITIONS.find((d) => d.key === key)!;
    const permission = await prisma.permission.upsert({
      where: { action_resource: { action: definition.action, resource: definition.resource } },
      create: {
        action: definition.action,
        resource: definition.resource,
        description: definition.description,
        domain: definition.domain,
        riskClass: definition.riskClass,
      },
      update: {},
      select: { id: true },
    });
    permissionIds.set(key, permission.id);
  }

  const results: QuotationGrantResult[] = [];
  for (const grant of QUOTATION_GRANTS) {
    const role = await prisma.role.findFirst({
      where: { organizationId, name: grant.roleName },
      select: { id: true },
    });
    if (!role) {
      results.push({ ...grant, status: 'role-missing' });
      continue;
    }
    const { count } = await prisma.rolePermission.createMany({
      data: [{ roleId: role.id, permissionId: permissionIds.get(grant.permission)! }],
      skipDuplicates: true,
    });
    results.push({ ...grant, status: count > 0 ? 'granted' : 'already-granted' });
  }
  return results;
}
