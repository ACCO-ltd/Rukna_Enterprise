#!/usr/bin/env tsx
/**
 * Re-map ACCO users from the superseded role scheme to the revised one (2026-09-15).
 *
 * The revised scheme replaces the old assignable roles. This script MOVES each existing user off the
 * superseded roles and onto the new ones, so the old roles end with zero live assignments and can
 * then be deleted (deletion is blocked while a role has holders). It is the mandatory middle step of
 * the live-tenant sequence:
 *
 *   1. seed the new roles     — prisma/seeds/acco-team-roles.seed.ts + sync-governance-publish-authority.seed.ts
 *   2. RUN THIS SCRIPT        — move every user old → new (dual-writes OrganizationMembershipRole + legacy UserRole)
 *   3. delete the old roles   — Management / Engineering / Accounting / Finance & Commercial / Viewer (now unheld)
 *
 * Old → new mapping:
 *   Procurement            → Procurement Manager     (auto, 1:1)
 *   Finance & Commercial   → Finance Officer         (auto, merge)
 *   Accounting             → Finance Officer         (auto, merge)
 *   Engineering            → Construction Director | Project Manager | Site Engineer   (AMBIGUOUS — per person)
 *   Management             → CEO | CFO | Construction Director                          (AMBIGUOUS — per person)
 *   Viewer                 → (dropped, or an explicit new role)                         (AMBIGUOUS — per person)
 *
 * The ambiguous splits are Eng Ahmed's call per person: supply them with repeated
 * `--mapping <email>=<New Role>` args (a person's ambiguous old roles all collapse to that new role),
 * or pass `--drop-viewers` to drop every Viewer with no replacement. The script HARD-FAILS listing
 * anyone whose ambiguous role has no decision, rather than guessing.
 *
 * Safe by construction: per-user transaction; the "add" reuses `ensureUserMembershipRole` (idempotent,
 * dual-write); the "remove" soft-removes the membership role (`removedAt`) and deletes the legacy
 * UserRole. `--dry-run` writes nothing and prints the full plan. `--revoke-sessions` revokes refresh
 * tokens for moved users so the new role names propagate on next request instead of ≤15 min later.
 *
 * Usage:
 *   PLATFORM_DATABASE_URL=... pnpm exec tsx scripts/remap-acco-roles.ts --slug=acco --dry-run \
 *     --mapping "ahmed@acco.example=CEO" --mapping "jane@acco.example=Project Manager" --drop-viewers
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { ensureUserMembershipRole } from './tenant-access.js';

// Old roles that map 1:1 (or many-to-one) with no human decision needed.
const AUTO_MAP: Record<string, string> = {
  Procurement: 'Procurement Manager',
  'Finance & Commercial': 'Finance Officer',
  Accounting: 'Finance Officer',
};

// Old roles whose successor differs per person — an explicit `--mapping` is required for each holder
// (the valid successors are documented in the header above); Viewer may instead be dropped via
// --drop-viewers. Only the names matter here — they gate which held roles are treated as deprecated.
const AMBIGUOUS = new Set(['Engineering', 'Management', 'Viewer']);

const DEPRECATED_ROLES = new Set([...Object.keys(AUTO_MAP), ...AMBIGUOUS]);

// Every valid destination role name (the 5 custom + governed ADMIN/CEO/CFO). Guards typos in --mapping.
const NEW_ROLE_NAMES = new Set([
  'ADMIN',
  'CEO',
  'CFO',
  'Construction Director',
  'Project Manager',
  'Site Engineer',
  'Procurement Manager',
  'Finance Officer',
]);

const { values } = parseArgs({
  options: {
    slug: { type: 'string', default: 'acco' },
    'dry-run': { type: 'boolean', default: false },
    mapping: { type: 'string', multiple: true, default: [] as string[] },
    'drop-viewers': { type: 'boolean', default: false },
    'revoke-sessions': { type: 'boolean', default: false },
  },
});

const slug = values.slug as string;
const dryRun = values['dry-run'] as boolean;
const dropViewers = values['drop-viewers'] as boolean;
const revokeSessions = values['revoke-sessions'] as boolean;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!platformDatabaseUrl) {
  console.error('PLATFORM_DATABASE_URL is required (used to resolve the tenant database).');
  process.exit(1);
}

// Parse `--mapping email=Role Name` into a per-email destination role, validating the role name.
function parseMappings(raw: string[]): Map<string, string> {
  const byEmail = new Map<string, string>();
  for (const entry of raw) {
    const eq = entry.indexOf('=');
    if (eq === -1) {
      console.error(`Invalid --mapping "${entry}" — expected "<email>=<New Role>".`);
      process.exit(1);
    }
    const email = entry.slice(0, eq).trim().toLowerCase();
    const roleName = entry.slice(eq + 1).trim();
    if (!NEW_ROLE_NAMES.has(roleName)) {
      console.error(`Invalid --mapping target "${roleName}" for ${email} — not a role in the new scheme.`);
      process.exit(1);
    }
    byEmail.set(email, roleName);
  }
  return byEmail;
}

interface UserPlan {
  email: string;
  oldRoleNames: string[];
  targetRoleNames: string[];
  missing: string[]; // ambiguous old roles with no decision
}

async function main(): Promise<void> {
  const mappingByEmail = parseMappings(values.mapping as string[]);
  const platform = new PlatformPrismaClient({ datasources: { db: { url: platformDatabaseUrl } } });

  try {
    const tenant = await platform.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Tenant '${slug}' was not found.`);

    const prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
    try {
      // name → id for every role in the tenant, so we can resolve targets and old-role ids.
      const roles = await prisma.role.findMany({ select: { id: true, name: true } });
      const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

      const users = await prisma.user.findMany({
        include: {
          memberships: { include: { roles: { include: { role: true } } } },
          userRoles: { include: { role: true } },
        },
        orderBy: { email: 'asc' },
      });

      const plans: UserPlan[] = [];
      const missingTargetRoles = new Set<string>();

      for (const user of users) {
        const membership = user.memberships.find((m) => m.organizationId === user.organizationId);

        // Live old roles the user holds, from either table.
        const oldRoleNames = new Set<string>();
        for (const mr of membership?.roles ?? []) {
          if (mr.removedAt === null && DEPRECATED_ROLES.has(mr.role.name)) oldRoleNames.add(mr.role.name);
        }
        for (const ur of user.userRoles) {
          if (DEPRECATED_ROLES.has(ur.role.name)) oldRoleNames.add(ur.role.name);
        }
        if (oldRoleNames.size === 0) continue;

        const targets = new Set<string>();
        const missing: string[] = [];
        const explicit = mappingByEmail.get(user.email.toLowerCase());

        for (const oldName of oldRoleNames) {
          if (AUTO_MAP[oldName]) {
            targets.add(AUTO_MAP[oldName]);
          } else if (oldName === 'Viewer' && dropViewers && !explicit) {
            // dropped — no destination role
          } else if (explicit) {
            targets.add(explicit);
          } else {
            missing.push(oldName);
          }
        }

        for (const t of targets) {
          if (!roleIdByName.has(t)) missingTargetRoles.add(t);
        }

        plans.push({
          email: user.email,
          oldRoleNames: [...oldRoleNames],
          targetRoleNames: [...targets],
          missing,
        });
      }

      // Guard 1 — any ambiguous old role without a decision aborts before any write.
      const needMapping = plans.filter((p) => p.missing.length > 0);
      if (needMapping.length > 0) {
        console.error('\nMISSING per-person mapping for ambiguous roles — aborting (nothing written):');
        for (const p of needMapping) {
          console.error(`  ${p.email}: holds [${p.missing.join(', ')}] — pass --mapping "${p.email}=<New Role>"`);
        }
        console.error('\n(Or --drop-viewers to drop every Viewer with no replacement.)');
        process.exit(1);
      }

      // Guard 2 — the destination roles must already be seeded.
      if (missingTargetRoles.size > 0) {
        console.error(
          `\nDestination roles not found in tenant '${slug}': ${[...missingTargetRoles].join(', ')}.\n` +
            'Run acco-team-roles.seed.ts + sync-governance-publish-authority.seed.ts FIRST.',
        );
        process.exit(1);
      }

      console.log(`\n${dryRun ? 'DRY RUN — ' : ''}Re-mapping ${plans.length} user(s) in tenant '${slug}':`);
      for (const p of plans) {
        const dropped = p.targetRoleNames.length === 0 ? ' (roles dropped)' : '';
        console.log(`  ${p.email}: [${p.oldRoleNames.join(', ')}] → [${p.targetRoleNames.join(', ')}]${dropped}`);
      }

      if (dryRun) {
        console.log('\nDry run complete — no changes written.');
        return;
      }

      let moved = 0;
      for (const user of users) {
        const plan = plans.find((p) => p.email === user.email);
        if (!plan) continue;

        const membership = user.memberships.find((m) => m.organizationId === user.organizationId);
        const oldRoleIds = plan.oldRoleNames
          .map((n) => roleIdByName.get(n))
          .filter((id): id is string => Boolean(id));

        await prisma.$transaction(async (tx) => {
          // Add the new roles (idempotent, dual-writes OrganizationMembershipRole + legacy UserRole).
          for (const targetName of plan.targetRoleNames) {
            await ensureUserMembershipRole(tx, {
              organizationId: user.organizationId,
              userId: user.id,
              roleId: roleIdByName.get(targetName)!,
            });
          }
          // Soft-remove the old membership roles and drop the legacy UserRole rows.
          if (membership && oldRoleIds.length > 0) {
            await tx.organizationMembershipRole.updateMany({
              where: { membershipId: membership.id, roleId: { in: oldRoleIds }, removedAt: null },
              data: { removedAt: new Date() },
            });
          }
          if (oldRoleIds.length > 0) {
            await tx.userRole.deleteMany({ where: { userId: user.id, roleId: { in: oldRoleIds } } });
          }
          if (revokeSessions) {
            await tx.refreshToken.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          }
        });
        moved += 1;
      }

      console.log(`\nDone — re-mapped ${moved} user(s).`);
      console.log(
        `The superseded roles (${[...DEPRECATED_ROLES].join(', ')}) should now ` +
          'have zero live assignments and can be deleted.',
      );
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown re-map failure';
  console.error(`Role re-map failed: ${message}`);
  process.exitCode = 1;
});
