import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type PermissionKey } from '@erp/types';

/**
 * ACCO team roles — the operating scheme for onboarding (revised 2026-09-15).
 *
 * Seeds five **CUSTOM** (editable) roles for the ACCO organization, each with a starting permission
 * set, so people can be created and assigned a role. The apex / finance-leadership roles (ADMIN,
 * CFO, CEO) are governed SYSTEM roles seeded separately (scripts/governed-roles.ts) — they are NOT
 * here. Unlike the governed roles, these five are CUSTOM: a governance admin can add or remove any
 * permission from Admin → Roles as ACCO's practice settles — a starting point, not a frozen catalogue.
 *
 * Scheme (revised): built around real job functions, with the "manages ALL projects" vs "manages
 * only ASSIGNED projects" split made explicit through the project-access bypass set (see
 * project-access.service.ts `PROJECT_MEMBERSHIP_BYPASS_ROLES`), NOT through permissions:
 *   - Construction Director — runs EVERY project end-to-end (org-wide); holds construction approval
 *     authority (projects / contracts / IPA / BOQ commit). Absorbs the old Engineering + QS scope.
 *   - Project Manager — the same delivery work but ONLY on assigned projects; prepares, does not approve.
 *   - Site Engineer — execution on assigned projects; no commercial authority, no cost visibility.
 *   - Procurement Manager — company-wide procurement (org-wide); prepares MRs/POs/GRs, does not approve.
 *   - Finance Officer — the whole finance function (certificates, receipts, receivables, journals,
 *     accounts payable, fiscal periods, year-end); merges the old Finance & Commercial + Accounting.
 * Approvals are domain-split: Construction Director approves construction, CFO holds finance
 * value-band approval, CEO is apex.
 *
 * ⚠ The names here are the SAME strings the approval engine matches on (`roleRequired`) and the
 * notification / project-access bypass filters key on — renaming one in Admin → Roles silently
 * breaks those matches. A permission-based audience/gate would be rename-proof; deferred.
 *
 * Idempotent and additive (upsert by name+org, `createMany` with `skipDuplicates`, never removes a
 * grant), so it is safe to run against the live tenant. It does NOT remove the superseded roles
 * (Management / Engineering / Accounting / Finance & Commercial / Viewer) or move users — that is the
 * separate re-map script's job (scripts/remap-acco-roles.ts). Requires DATABASE_URL → the ACCO tenant DB.
 * Run: docker compose ... run --rm --no-deps migrate pnpm exec tsx prisma/seeds/acco-team-roles.seed.ts
 */

const P = PERMISSIONS;
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

interface TeamRoleSpec {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

const ROLES: TeamRoleSpec[] = [
  {
    name: 'Construction Director',
    description: 'Runs every project end-to-end: scope, BOQ, contracts, IPAs — with construction approval authority.',
    permissions: [
      // Projects — full operational control + construction approval, across ALL projects (org-wide
      // via the access-bypass set) incl. the project registries.
      P.projectsView,
      P.projectsCreate,
      P.projectsManage,
      P.projectsApprove,
      P.projectMembersManage,
      P.projectTypeManage,
      P.districtsManage,
      // BOQ — owns it (absorbs QS): both edit halves, the cost + margin visibility tiers, and the
      // commercial-authority acts (baseline, commit-to-contract, contingency drawdown).
      P.boqView,
      P.boqManage,
      P.boqEditScope,
      P.boqEditCost,
      P.boqViewCost,
      P.boqViewMargin,
      P.boqBaseline,
      P.boqCommit,
      P.boqManageContingency,
      // Contracts + IPAs — create/manage AND approve (construction domain approval).
      P.contractsView,
      P.contractsCreate,
      P.contractsManage,
      P.contractsApprove,
      P.ipaView,
      P.ipaCreate,
      P.ipaManage,
      P.ipaApprove,
      // Cost-control context.
      P.projectBudgetManage,
      P.projectBudgetBaseline,
      P.clientsView,
      P.commitmentsView,
      P.procurementView,
      P.financialPositionView,
    ],
  },
  {
    name: 'Project Manager',
    description: 'Runs assigned projects: scope, BOQ, contracts and IPAs. Prepares — approvals sit above.',
    permissions: [
      // Same delivery work as Construction Director but ONLY on assigned projects (NOT in the
      // access-bypass set) and WITHOUT approval/commit authority.
      P.projectsView,
      P.projectsCreate,
      P.projectsManage,
      P.projectMembersManage,
      P.boqView,
      P.boqManage,
      P.boqEditScope,
      P.boqEditCost,
      P.boqViewCost,
      P.contractsView,
      P.contractsCreate,
      P.contractsManage,
      P.ipaView,
      P.ipaCreate,
      P.ipaManage,
      P.projectBudgetManage,
      P.clientsView,
      P.commitmentsView,
      P.procurementView,
      P.financialPositionView,
    ],
  },
  {
    name: 'Site Engineer',
    description: 'Execution on assigned projects: records scope/progress. No commercial authority.',
    permissions: [
      P.projectsView,
      // Scope/progress edits only — deliberately no cost/margin visibility and no create/approve.
      P.boqView,
      P.boqEditScope,
      P.ipaView,
      P.contractsView,
      P.commitmentsView,
      P.procurementView,
    ],
  },
  {
    name: 'Procurement Manager',
    description: 'Company-wide procurement: material requests, purchase orders and goods receipts.',
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
    name: 'Finance Officer',
    description: 'The whole finance function: certificates, client receipts, receivables, journals, AP, periods and year-end.',
    permissions: [
      // Certificates + client money (from the old Finance & Commercial).
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
      // Ledger + payables + period/year-end (from the old Accounting) — self-serves the full cycle.
      P.accountingView,
      P.accountingManage,
      P.journalsManage,
      P.payablesManage,
      P.periodsManage,
      P.fiscalYearsManage,
      P.financialPositionView,
      // Context needed to certify and see position.
      P.ipaView,
      P.contractsView,
      P.projectsView,
      P.commitmentsView,
      P.procurementView,
      // ADR-029 §8 A-2 — commercial sees the BOQ margin tier (contract value, contingency, margin).
      P.boqView,
      P.boqViewMargin,
    ],
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
