/**
 * DEV-ONLY — switch ADR-022 CONST-DOA-005 value-threshold routing ON for a dev tenant, and give
 * the seeded admin every band role so the whole approval loop is walkable by one person.
 *
 * ACCO's PO/payment bands are seeded **inactive** by `acco-workflows.seed.ts` (governance never
 * takes effect until a deliberate activation with real role-holders). This script performs that
 * activation for a dev database so an engineer can watch:
 *
 *     submit a PO / approve a payment → 409 (gated, routed to the amount band's chain)
 *       → approve each step from the panel → re-drive → transitioned
 *
 * It (1) activates the band bindings + their definitions and (2) upserts the CONSTRUCTION_DIRECTOR
 * / FINANCE_OFFICER / CFO / BOARD_CHAIRMAN / GROUP_CEO roles and assigns them to every active
 * membership in the org (in dev, just the admin). Idempotent; never on an automatic seed path.
 *
 *     npx tsx prisma/seeds/dev-activate-doa-bands.seed.ts          # activate + grant roles
 *     npx tsx prisma/seeds/dev-activate-doa-bands.seed.ts --off    # deactivate the bands again
 *
 * Requires DATABASE_URL pointing at the dev tenant database, and ACCO_ORG_SLUG (default "acco").
 */

import { PrismaClient } from '@prisma/client';

import {
  accoPurchaseOrderBands,
  accoSupplierPaymentBands,
} from '../../src/platform/workflows/seeders/acco-value-bands.js';
import { accoApprovalChains } from '../../src/platform/workflows/seeders/acco-lifecycle-chains.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';
const DISABLE = process.argv.includes('--off');

// Every ACCO governance definition the seeder created (value bands + fixed lifecycle chains),
// and every distinct approver role any of them can demand — derived from the specs so this
// script never drifts from what was seeded.
const ALL_BANDS = [...accoPurchaseOrderBands(), ...accoSupplierPaymentBands()];
const ALL_CHAINS = accoApprovalChains();
const DEF_NAMES = [...ALL_BANDS.map((b) => b.name), ...ALL_CHAINS.map((c) => c.name)];
const APPROVER_ROLES = [
  ...new Set([...ALL_BANDS.flatMap((b) => b.steps), ...ALL_CHAINS.flatMap((c) => c.steps)]),
];

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization "${ORG_SLUG}" not found. Provision the tenant first.`);
  const isActive = !DISABLE;
  console.log(`ACCO DOA config for org: ${org.name} (${org.id}) → ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

  // 1. Activate (or deactivate) the band + chain definitions and their bindings.
  const defs = await prisma.workflowDefinition.findMany({
    where: { organizationId: org.id, name: { in: DEF_NAMES } },
    select: { id: true },
  });
  const defIds = defs.map((d) => d.id);
  await prisma.workflowDefinition.updateMany({ where: { id: { in: defIds } }, data: { isActive } });
  await prisma.workflowTriggerBinding.updateMany({
    where: { workflowDefinitionId: { in: defIds } },
    data: { isActive },
  });
  console.log(`  ✓ ${defIds.length} definitions + their bindings set ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

  if (!isActive) {
    console.log('\nDeactivated — PO/payment/project/BOQ/DPR commands proceed ungated again.');
    return;
  }

  // 2. Grant every approver role to every active membership (dev: the admin), so one person can
  //    walk any chain. Roles are org-scoped; assignment is what auth reads into identity.roles.
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId: org.id, removedAt: null },
    select: { id: true, userId: true },
  });
  const assigner = memberships[0]?.userId ?? 'dev-seed';

  for (const roleName of APPROVER_ROLES) {
    const role = await prisma.role.upsert({
      where: { name_organizationId: { name: roleName, organizationId: org.id } },
      create: { name: roleName, description: `ADR-022 authority role (${roleName})`, organizationId: org.id },
      update: {},
    });
    for (const m of memberships) {
      const existing = await prisma.organizationMembershipRole.findFirst({
        where: { membershipId: m.id, roleId: role.id, removedAt: null },
      });
      if (!existing) {
        await prisma.organizationMembershipRole.create({
          data: { membershipId: m.id, roleId: role.id, assignedBy: assigner },
        });
      }
    }
  }
  console.log(`  ✓ Granted ${APPROVER_ROLES.length} approver roles to ${memberships.length} membership(s)`);

  console.log(
    '\nSubmit a PO or approve a payment to see it route to its amount band and gate ' +
      '(409 + approvalInstanceId), then approve each step from the panel and re-drive. ' +
      'Sign out/in first so the new roles land in your token.',
  );
}

main()
  .catch((err) => {
    console.error('DOA band activation failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
