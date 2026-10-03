import type { Prisma } from '@prisma/client';
import { PERMISSION_DEFINITIONS, PERMISSIONS } from '@erp/types';

/**
 * ADR-043 decision 1 — give the Construction Director `mark-ready:billing`, and nothing else.
 *
 * Why not re-run `acco-team-roles.seed.ts` on the live tenant: that seed re-links EVERY permission
 * in its starting sets, so any grant an administrator has since removed from a CUSTOM role in
 * Admin → Roles (Project Manager, Site Engineer, …) would come back, and it rewrites the role
 * descriptions. This touches exactly one role and one permission:
 *   - upserts the `mark-ready:billing` permission row (create only; an existing row is left as is),
 *   - links it to the org's `Construction Director` role (`skipDuplicates`).
 * It never removes a grant, never edits another role, and is safe to run any number of times.
 *
 * ADMIN needs nothing here: the release migration runner re-links every catalogue permission to
 * ADMIN on each deploy (`refreshAdminPermissions` in scripts/migrate-deploy.ts).
 */

export const MARK_READY_ROLE_NAME = 'Construction Director';

type GrantClient = Pick<Prisma.TransactionClient, 'permission' | 'role' | 'rolePermission'>;

export type MarkReadyGrantResult =
  | { status: 'granted'; roleId: string }
  | { status: 'already-granted'; roleId: string }
  | { status: 'role-missing' };

export async function grantMarkReadyToConstructionDirector(
  prisma: GrantClient,
  organizationId: string,
): Promise<MarkReadyGrantResult> {
  const definition = PERMISSION_DEFINITIONS.find((d) => d.key === PERMISSIONS.billingMarkReady)!;

  const role = await prisma.role.findFirst({
    where: { organizationId, name: MARK_READY_ROLE_NAME },
    select: { id: true },
  });
  if (!role) return { status: 'role-missing' };

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

  const { count } = await prisma.rolePermission.createMany({
    data: [{ roleId: role.id, permissionId: permission.id }],
    skipDuplicates: true,
  });
  return count > 0 ? { status: 'granted', roleId: role.id } : { status: 'already-granted', roleId: role.id };
}
