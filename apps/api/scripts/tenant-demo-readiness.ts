#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { PERMISSION_DEFINITIONS } from '@erp/types';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
  },
});

const slug = values.slug;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!slug || !platformDatabaseUrl) {
  console.error(
    'Usage: pnpm tenant:demo-readiness --slug=acco ' +
      '(PLATFORM_DATABASE_URL is required)',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({
    datasources: { db: { url: platformDatabaseUrl } },
  });

  try {
    const tenant = await platform.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, status: true, dbUrl: true },
    });
    if (!tenant) throw new Error(`Tenant '${slug}' was not found`);

    const prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
    try {
      const [
        users,
        projects,
        clients,
        contracts,
        applications,
        certificates,
        receipts,
        workflowDefinitions,
        workflowBindings,
        requiredPolicies,
        governancePolicies,
        activeSodRules,
        unpublishedAuditOutboxEvents,
        adminUsers,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.project.count(),
        prisma.client.count(),
        prisma.contract.count(),
        prisma.interimPaymentApplication.count(),
        prisma.interimPaymentCertificate.count(),
        prisma.paymentReceipt.count(),
        prisma.workflowDefinition.findMany({
          select: { isActive: true, requiresCeoConfirmation: true },
        }),
        prisma.workflowTriggerBinding.findMany({ select: { isActive: true } }),
        prisma.workflowRequirementPolicy.count({ where: { requirement: 'REQUIRED' } }),
        prisma.workflowPolicyVersion.findMany({
          select: { policyKey: true, version: true, status: true, effectiveFrom: true, amountBasis: true },
          orderBy: [{ policyKey: 'asc' }, { version: 'desc' }],
        }),
        prisma.segregationOfDutiesRule.count({ where: { isActive: true } }),
        prisma.auditOutboxEvent.count({ where: { publishedAt: null } }),
        prisma.user.findMany({
          where: { userRoles: { some: { role: { name: 'ADMIN' } } } },
          select: {
            email: true,
            organizationId: true,
            memberships: {
              where: { status: 'ACTIVE' },
              select: {
                organizationId: true,
                roles: { where: { removedAt: null }, select: { roleId: true } },
              },
            },
            userRoles: {
              select: {
                roleId: true,
                role: {
                  select: {
                    rolePermissions: {
                      select: { permission: { select: { action: true, resource: true } } },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

      const expectedPermissionKeys = new Set(
        PERMISSION_DEFINITIONS.map(({ action, resource }) => `${action}:${resource}`),
      );
      const admins = adminUsers.map((user) => {
        const membership = user.memberships.find(
          (candidate) => candidate.organizationId === user.organizationId,
        );
        const assignedRoleIds = new Set(membership?.roles.map(({ roleId }) => roleId) ?? []);
        const permissionKeys = new Set(
          user.userRoles.flatMap(({ role }) =>
            role.rolePermissions.map(
              ({ permission }) => `${permission.action}:${permission.resource}`,
            ),
          ),
        );
        const missingPermissions = [...expectedPermissionKeys].filter(
          (key) => !permissionKeys.has(key),
        );
        return {
          email: user.email,
          activeMembership: Boolean(membership),
          missingMembershipRoles: user.userRoles.filter(
            ({ roleId }) => !assignedRoleIds.has(roleId),
          ).length,
          missingCanonicalPermissions: missingPermissions.length,
        };
      });

      const inactiveDefinitionsAwaitingCeo = workflowDefinitions.filter(
        (definition) => !definition.isActive && definition.requiresCeoConfirmation,
      ).length;

      console.log(`Demo readiness for tenant '${tenant.slug}' (${tenant.name})`);
      console.log(`  Tenant status: ${tenant.status}`);
      console.log(`  Demo data: ${projects} projects, ${clients} clients, ${contracts} contracts, ` +
        `${applications} IPAs, ${certificates} IPCs, ${receipts} receipts`);
      console.log(`  Users: ${users}; ADMIN users: ${admins.length}`);
      for (const admin of admins) {
        console.log(`    ${admin.email}: membership=${admin.activeMembership ? 'ready' : 'missing'}, ` +
          `membership roles missing=${admin.missingMembershipRoles}, ` +
          `canonical permissions missing=${admin.missingCanonicalPermissions}`);
      }
      console.log(`  Workflow definitions: ${workflowDefinitions.length} total, ` +
        `${workflowDefinitions.filter(({ isActive }) => isActive).length} active, ` +
        `${inactiveDefinitionsAwaitingCeo} awaiting CEO confirmation`);
      console.log(`  Workflow bindings: ${workflowBindings.length} total, ` +
        `${workflowBindings.filter(({ isActive }) => isActive).length} active`);
      console.log(`  Required workflow policies: ${requiredPolicies}`);
      for (const policy of governancePolicies) {
        console.log(
          `  Governance policy: ${policy.policyKey} v${policy.version} status=${policy.status}, ` +
          `effectiveFrom=${policy.effectiveFrom?.toISOString() ?? 'not set'}, amountBasis=${policy.amountBasis}`,
        );
      }
      console.log(`  Active SoD rules: ${activeSodRules}; unpublished audit outbox events: ${unpublishedAuditOutboxEvents}`);
      console.log('  Result: read-only report; no credentials, database URLs, or tenant data were changed.');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown readiness failure';
  console.error(`Demo readiness check failed: ${message}`);
  process.exitCode = 1;
});
