import type { Prisma } from '@prisma/client';
import { PERMISSION_DEFINITIONS, PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * ADR-022 amendment (2026-10-27) — who may approve and post their own journals without a second
 * person, for an existing tenant.
 *
 *   post-own:journal → Finance Officer, CFO
 *   manage:journal   → CFO (so the CFO can work journals at all; the Finance Officer already has it)
 *
 * Same shape as `quotation-permissions.ts`, for the same reason: re-running `acco-team-roles.seed.ts`
 * or the governed-roles script on a live tenant would re-link every starting permission and undo
 * in-app role edits. This touches exactly these roles and permissions, never removes a grant, and is
 * safe to run any number of times. A role the tenant does not have is reported, not created.
 */

export const JOURNAL_SELF_POST_GRANTS: ReadonlyArray<{ roleName: string; permission: PermissionKey }> = [
  { roleName: 'Finance Officer', permission: PERMISSIONS.journalsPostOwn },
  { roleName: 'CFO', permission: PERMISSIONS.journalsManage },
  { roleName: 'CFO', permission: PERMISSIONS.journalsPostOwn },
];

type GrantClient = Pick<Prisma.TransactionClient, 'permission' | 'role' | 'rolePermission'>;

export type JournalSelfPostGrantResult = {
  roleName: string;
  permission: PermissionKey;
  status: 'granted' | 'already-granted' | 'role-missing';
};

export async function grantJournalSelfPostPermissions(
  prisma: GrantClient,
  organizationId: string,
): Promise<JournalSelfPostGrantResult[]> {
  const permissionIds = new Map<PermissionKey, string>();
  for (const key of new Set(JOURNAL_SELF_POST_GRANTS.map((g) => g.permission))) {
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

  const results: JournalSelfPostGrantResult[] = [];
  for (const grant of JOURNAL_SELF_POST_GRANTS) {
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
