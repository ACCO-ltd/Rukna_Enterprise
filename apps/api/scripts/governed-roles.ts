import type { Prisma } from '@prisma/client';
import { PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * ADR-027 GOV-ADM-003 — governed system-role templates.
 *
 * The platform seeds named SYSTEM roles for approved ACCO operating roles. A SYSTEM role is
 * inspectable but its name, purpose, and permission set cannot be edited or deleted through the
 * organization administration API (RolesService protects `kind === 'SYSTEM'`). These two roles
 * carry the publish authority for approval policies (the user's item 6): the CEO-approved decision
 * is that `publish:workflow` is held by ADMIN + CFO + Governance Publisher.
 *
 * `CFO` also carries the finance approval perms so a real CFO holder can sign the value-band chains
 * (PO/payment/subcontract/IPC) their role appears in — governance never activates until such a
 * holder exists (see dev-activate-doa-bands.seed.ts).
 *
 * These are a starting permission set, not a frozen catalogue: a governance administrator can still
 * clone them into a CUSTOM role and adjust. The SYSTEM originals stay protected.
 */

const P = PERMISSIONS;

export interface GovernedRoleSpec {
  name: string;
  description: string;
  purpose: string;
  permissions: PermissionKey[];
}

// Governance Publisher — authors and publishes approval policies, and reviews access impact. It
// deliberately holds NO business-transaction approval permission: publishing a policy and approving
// a transaction under it are separate duties.
const GOVERNANCE_PUBLISHER: GovernedRoleSpec = {
  name: 'GOVERNANCE_PUBLISHER',
  description: 'Authors, reviews, and publishes approval-policy versions (ADR-027).',
  purpose:
    'Owns approval-policy authoring and publication, independent of the transactions the ' +
    'policies govern. Reviews role and policy access impact.',
  permissions: [
    P.workflowsView,
    P.workflowsManage,
    P.workflowsPublish,
    P.governanceImpactView,
    P.rolesView,
    P.auditLogsView,
  ],
};

// CFO — the finance authority in the ACCO value-band chains, and a permitted policy publisher
// (matrix: "Reviewer/publisher: CFO or Governance Administrator"). Gets the finance approve perms
// for the bands the CFO role appears in, plus the read/impact perms needed to review a policy.
const CFO: GovernedRoleSpec = {
  name: 'CFO',
  description: 'Chief Financial Officer — finance approval authority and approval-policy publisher.',
  purpose:
    'Approves finance value-band transactions (purchase orders, supplier payments, certificates) ' +
    'and publishes/retires approval-policy versions per the ACCO approval-policy matrix.',
  permissions: [
    P.workflowsPublish,
    P.workflowsView,
    P.workflowsManage,
    P.governanceImpactView,
    // Finance approval authority for the value-band chains the CFO role appears in
    // (ACCO approval-policy matrix: purchase orders, supplier payments, and the certificate
    // chains route through the CFO in their upper bands).
    P.materialRequestsApprove,
    P.purchaseOrdersApprove,
    P.matchingExceptionsApprove,
    P.ipaApprove,
    P.contractsApprove,
    // Finance visibility to review what is being approved.
    P.financialPositionView,
    P.accountingView,
    P.commitmentsView,
    P.procurementView,
    P.ipaView,
    P.ipcView,
    P.contractsView,
    P.projectsView,
    P.rolesView,
  ],
};

export const GOVERNED_SYSTEM_ROLES: readonly GovernedRoleSpec[] = [GOVERNANCE_PUBLISHER, CFO];

type GovernedRolesClient = Pick<Prisma.TransactionClient, 'role' | 'permission' | 'rolePermission'>;

export interface GovernedRoleSeedResult {
  roleName: string;
  roleId: string;
  grantsAdded: number;
  permissionsLinked: number;
}

/**
 * Upserts one governed SYSTEM role and links exactly its declared permission set. Idempotent:
 * the role is matched by (name, organizationId); missing permission catalogue rows are created;
 * RolePermission links are added with skipDuplicates. Never removes links (additive), so it is safe
 * to run against a live tenant.
 */
export async function seedGovernedRole(
  prisma: GovernedRolesClient,
  organizationId: string,
  spec: GovernedRoleSpec,
): Promise<GovernedRoleSeedResult> {
  const role = await prisma.role.upsert({
    where: { name_organizationId: { name: spec.name, organizationId } },
    create: {
      name: spec.name,
      description: spec.description,
      kind: 'SYSTEM',
      purpose: spec.purpose,
      organizationId,
    },
    // Keep the governed metadata current, but never downgrade an existing role's kind.
    update: { description: spec.description, purpose: spec.purpose, kind: 'SYSTEM' },
    select: { id: true },
  });

  const permissionIds: string[] = [];
  for (const key of spec.permissions) {
    const separator = key.indexOf(':');
    const action = key.slice(0, separator);
    const resource = key.slice(separator + 1);
    const permission = await prisma.permission.upsert({
      where: { action_resource: { action, resource } },
      create: { action, resource, description: `${action}:${resource}` },
      update: {},
      select: { id: true },
    });
    permissionIds.push(permission.id);
  }

  const before = await prisma.rolePermission.count({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    skipDuplicates: true,
  });
  const after = await prisma.rolePermission.count({ where: { roleId: role.id } });

  return {
    roleName: spec.name,
    roleId: role.id,
    grantsAdded: after - before,
    permissionsLinked: after,
  };
}

/** Seeds every governed SYSTEM role for an organization. Idempotent. */
export async function seedGovernedSystemRoles(
  prisma: GovernedRolesClient,
  organizationId: string,
): Promise<GovernedRoleSeedResult[]> {
  const results: GovernedRoleSeedResult[] = [];
  for (const spec of GOVERNED_SYSTEM_ROLES) {
    results.push(await seedGovernedRole(prisma, organizationId, spec));
  }
  return results;
}
