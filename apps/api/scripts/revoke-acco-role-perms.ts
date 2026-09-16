#!/usr/bin/env tsx
/**
 * Revoke project-financial permissions from ACCO's delivery roles (Eng Ahmed, 2026-09-15).
 *
 * Project money must not be visible to Project Managers or Site Engineers, and the Construction
 * Director sees delivery COSTS but not profit/margin. Money-related data is for Finance Officer +
 * CFO (and CEO / ADMIN) only. The role seed (prisma/seeds/acco-team-roles.seed.ts) is purely
 * ADDITIVE — re-running it never removes a grant — so this script performs the one-off removal on
 * the live tenant, exactly mirroring the reduced permission sets now baked into that seed.
 *
 * It is SURGICAL: it deletes only the named RolePermission rows for the three named roles and
 * touches nothing else, so it is safe to re-run and safe alongside any admin-added grants. Resolves
 * the tenant DB the same way as remap-acco-roles.ts (PLATFORM_DATABASE_URL → tenant.dbUrl).
 *
 * Usage:
 *   PLATFORM_DATABASE_URL=... pnpm exec tsx scripts/revoke-acco-role-perms.ts --slug=acco --dry-run
 *   PLATFORM_DATABASE_URL=... pnpm exec tsx scripts/revoke-acco-role-perms.ts --slug=acco
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type PermissionKey } from '@erp/types';

import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';

const P = PERMISSIONS;

// The permissions to REMOVE from each role. Keep this in lock-step with the reduced sets in
// prisma/seeds/acco-team-roles.seed.ts — the seed is the source of truth for what each role KEEPS,
// this is the mirror of what each role LOST relative to the previous scheme.
const REMOVALS: Record<string, PermissionKey[]> = {
  // Costs, not profit: withhold the BOQ margin tier and the project P&L (revenue vs cost = profit).
  'Construction Director': [P.boqViewMargin, P.financialPositionView],
  // No BOQ cost (incl. the manage:boq umbrella that grants cost view), no contracts, no IPAs, no
  // budget, no project P&L, no commitment ledger. Procurement is KEPT (Eng Ahmed, 2026-09-16) — the
  // PM manages material ordering and delivery on their projects, so `view:procurement` is NOT revoked.
  'Project Manager': [
    P.boqManage,
    P.boqEditCost,
    P.boqViewCost,
    P.contractsView,
    P.contractsCreate,
    P.contractsManage,
    P.ipaView,
    P.ipaCreate,
    P.ipaManage,
    P.projectBudgetManage,
    P.financialPositionView,
    P.commitmentsView,
  ],
  // Fully money-blind: scope + progress only.
  'Site Engineer': [P.ipaView, P.contractsView, P.commitmentsView, P.procurementView],
};

const { values } = parseArgs({
  options: {
    slug: { type: 'string', default: 'acco' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const slug = values.slug as string;
const dryRun = values['dry-run'] as boolean;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!platformDatabaseUrl) {
  console.error('PLATFORM_DATABASE_URL is required (used to resolve the tenant database).');
  process.exit(1);
}

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({ datasources: { db: { url: platformDatabaseUrl } } });

  try {
    const tenant = await platform.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Tenant '${slug}' was not found.`);

    const prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
    try {
      const org = await prisma.organization.findFirst({ where: { slug } });
      if (!org) throw new Error(`Organization '${slug}' was not found in tenant '${slug}'.`);

      // Resolve every removal key to a Permission id up front (a key with no Permission row simply
      // means the grant never existed — nothing to delete).
      const permissionIdByKey = new Map<PermissionKey, string>();
      const allKeys = [...new Set(Object.values(REMOVALS).flat())];
      for (const key of allKeys) {
        const separator = key.indexOf(':');
        const action = key.slice(0, separator);
        const resource = key.slice(separator + 1);
        const permission = await prisma.permission.findUnique({
          where: { action_resource: { action, resource } },
          select: { id: true },
        });
        if (permission) permissionIdByKey.set(key, permission.id);
      }

      console.log(`\n${dryRun ? 'DRY RUN — ' : ''}Revoking project-financial permissions in tenant '${slug}':`);

      for (const [roleName, keys] of Object.entries(REMOVALS)) {
        const role = await prisma.role.findUnique({
          where: { name_organizationId: { name: roleName, organizationId: org.id } },
          select: { id: true },
        });
        if (!role) {
          console.warn(`  ! ${roleName}: role not found — skipped.`);
          continue;
        }

        const before = await prisma.rolePermission.count({ where: { roleId: role.id } });
        const removeIds = keys
          .map((key) => permissionIdByKey.get(key))
          .filter((id): id is string => Boolean(id));

        // How many of the target grants are actually present (so the log reflects reality, not intent).
        const present = await prisma.rolePermission.count({
          where: { roleId: role.id, permissionId: { in: removeIds } },
        });

        if (!dryRun && present > 0) {
          await prisma.rolePermission.deleteMany({
            where: { roleId: role.id, permissionId: { in: removeIds } },
          });
        }

        const after = dryRun ? before - present : await prisma.rolePermission.count({ where: { roleId: role.id } });
        console.log(
          `  ✓ ${roleName}: ${dryRun ? 'would remove' : 'removed'} ${present} grant(s) ` +
            `(${before} → ${after}); target keys: [${keys.join(', ')}]`,
        );
      }

      console.log(dryRun ? '\nDry run complete — no changes written.' : '\nDone — permissions revoked.');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown revoke failure';
  console.error(`Role permission revoke failed: ${message}`);
  process.exitCode = 1;
});
