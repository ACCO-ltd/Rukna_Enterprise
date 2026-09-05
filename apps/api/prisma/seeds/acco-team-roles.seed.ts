import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * ACCO team roles — the 6-role operating scheme for onboarding (approved 2026-09-05).
 *
 * Seeds six **CUSTOM** (editable) roles for the ACCO organization, each with a starting permission
 * set, so people can be created and assigned a role. Unlike the governed SYSTEM roles
 * (ADMIN / CFO / GOVERNANCE_PUBLISHER), these are CUSTOM: a governance admin can add or remove any
 * permission from Admin → Roles as ACCO's practice settles — this is a starting point, not a frozen
 * catalogue.
 *
 * Design (from the confirmed scheme): **approval authority concentrates in Management** across
 * domains (a clean segregation of duties for a small team — the domain roles create/prepare, one
 * role approves). ACCO can delegate specific approvals (e.g. procurement exceptions) to a domain
 * role later if Management-approves-everything proves impractical.
 *
 * Idempotent and additive (upsert by name+org, `createMany` with `skipDuplicates`, never removes a
 * grant), so it is safe to run against the live tenant. Requires DATABASE_URL → the ACCO tenant DB.
 * Run: docker compose ... run --rm --no-deps migrate pnpm exec tsx prisma/seeds/acco-team-roles.seed.ts
 */

const P = PERMISSIONS;
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

// Read-only visibility across the business surfaces (no People/governance internals).
const BUSINESS_VIEWS: PermissionKey[] = [
  P.projectsView,
  P.boqView,
  P.contractsView,
  P.ipaView,
  P.ipcView,
  P.receiptsView,
  P.clientsView,
  P.procurementView,
  P.commitmentsView,
  P.accountingView,
  P.financialPositionView,
  P.organizationsView,
];

interface TeamRoleSpec {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

const ROLES: TeamRoleSpec[] = [
  {
    name: 'Management',
    description: 'Oversight and approvals across the business, with full visibility.',
    permissions: [
      ...BUSINESS_VIEWS,
      // Oversight views into people, access governance and the audit trail.
      P.usersView,
      P.rolesView,
      P.permissionsView,
      P.workflowsView,
      P.governanceImpactView,
      P.auditLogsView,
      // Approval authority across domains.
      P.projectsApprove,
      P.contractsApprove,
      P.ipaApprove,
      P.materialRequestsApprove,
      P.purchaseOrdersApprove,
      P.goodsReceiptExceptionsApprove,
      P.matchingExceptionsApprove,
      P.boqBaseline,
    ],
  },
  {
    name: 'Engineering',
    description: 'Runs projects: scope, BOQ, contracts and interim payment applications.',
    permissions: [
      P.projectsView,
      P.projectsCreate,
      P.projectsManage,
      P.projectMembersManage,
      P.projectTypeManage,
      P.districtsManage,
      P.boqView,
      P.boqManage,
      P.contractsView,
      P.contractsCreate,
      P.contractsManage,
      P.ipaView,
      P.ipaCreate,
      P.ipaManage,
      P.clientsView,
      P.commitmentsView,
      P.procurementView,
      P.financialPositionView,
    ],
  },
  {
    name: 'Procurement',
    description: 'Material requests, purchase orders and goods receipts.',
    permissions: [
      P.procurementView,
      P.procurementConfigManage,
      P.materialRequestsCreate,
      P.materialRequestsSubmit,
      P.purchaseOrdersCreate,
      P.goodsReceiptsCreate,
      P.goodsReceiptsPost,
      P.commitmentsView,
      // Cost-targeting a PO line picks a BOQ node in a project.
      P.projectsView,
      P.boqView,
    ],
  },
  {
    name: 'Finance & Commercial',
    description: 'Certificates, client receipts, receivables and client records.',
    permissions: [
      P.ipcView,
      P.ipcIssue,
      P.ipcSupersede,
      P.receiptsView,
      P.receiptsCreate,
      P.receiptsAllocate,
      P.clientsView,
      P.clientsCreate,
      P.clientsManage,
      P.receivablesManage,
      // Context needed to certify against an application and see position.
      P.ipaView,
      P.contractsView,
      P.projectsView,
      P.financialPositionView,
      P.accountingView,
    ],
  },
  {
    name: 'Accounting',
    description: 'Journals, accounts payable, fiscal periods and year-end.',
    permissions: [
      P.accountingView,
      P.accountingManage,
      P.financialPositionView,
      P.journalsManage,
      P.payablesManage,
      P.periodsManage,
      P.fiscalYearsManage,
      P.commitmentsView,
      P.procurementView,
      P.contractsView,
      P.projectsView,
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only access to projects, commercial and accounting records.',
    permissions: [...BUSINESS_VIEWS],
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!org) {
      console.error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the ACCO tenant DB?`);
      process.exit(1);
    }
    console.log(`Seeding ${ROLES.length} team roles for ${org.name} (${org.id})`);

    for (const spec of ROLES) {
      const role = await prisma.role.upsert({
        where: { name_organizationId: { name: spec.name, organizationId: org.id } },
        create: {
          name: spec.name,
          description: spec.description,
          kind: 'CUSTOM',
          organizationId: org.id,
        },
        update: { description: spec.description },
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
      console.log(`  ✓ ${spec.name}: ${after - before} new grant(s), ${after} permission(s) linked`);
    }

    console.log('Done. These roles are CUSTOM — adjust any permission set from Admin → Roles.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
