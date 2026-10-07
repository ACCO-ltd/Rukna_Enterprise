import type { Prisma } from '@prisma/client';
import { PERMISSION_DEFINITIONS, PERMISSIONS } from '@erp/types';

/**
 * Owner decision 2026-10-06 — the finance team approves material requests: give the Finance
 * Officer `approve:material-request`, and nothing else.
 *
 * Same shape as `construction-mark-ready.ts`, for the same reason: re-running
 * `acco-team-roles.seed.ts` on a live tenant would re-link every starting permission and undo
 * in-app role edits. This touches exactly one role and one permission, never removes a grant,
 * and is safe to run any number of times. The Finance Officer already sees every project and
 * holds `view:procurement`, so the grant alone lets them open and approve a request.
 */

export const MR_APPROVER_ROLE_NAME = 'Finance Officer';

type GrantClient = Pick<Prisma.TransactionClient, 'permission' | 'role' | 'rolePermission'>;

export type MrApprovalGrantResult =
  | { status: 'granted'; roleId: string }
  | { status: 'already-granted'; roleId: string }
  | { status: 'role-missing' };

export async function grantMaterialRequestApprovalToFinance(
  prisma: GrantClient,
  organizationId: string,
): Promise<MrApprovalGrantResult> {
  const definition = PERMISSION_DEFINITIONS.find(
    (d) => d.key === PERMISSIONS.materialRequestsApprove,
  )!;

  const role = await prisma.role.findFirst({
    where: { organizationId, name: MR_APPROVER_ROLE_NAME },
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
  return count > 0
    ? { status: 'granted', roleId: role.id }
    : { status: 'already-granted', roleId: role.id };
}
