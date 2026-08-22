/**
 * Seeds the full ACCO governance configuration (workflow chains, value bands, lifecycle/BOQ/DPR
 * chains, SoD rules) into an EXISTING tenant.
 *
 * `seedAccoWorkflows` normally runs once at tenant provisioning. Tenants provisioned before the
 * ADR-022 bands/chains existed need this to catch up — it is idempotent (find-or-create), so it is
 * safe to re-run. It seeds everything **inactive**; go-live is a separate deliberate step
 * (`dev-activate-doa-bands.seed.ts`) once role-holders exist.
 *
 *     pnpm governance:seed            # seed into the ACCO tenant DB (uses .env DATABASE_URL)
 *     ACCO_ORG_SLUG=other pnpm governance:seed
 *
 * Requires DATABASE_URL pointing at the tenant database.
 */

import { PrismaClient } from '@prisma/client';

import { seedAccoWorkflows } from '../../src/platform/workflows/seeders/acco-workflows.seed.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization "${ORG_SLUG}" not found. Provision the tenant first.`);
  console.log(`Seeding ACCO governance for: ${org.name} (${org.id})`);
  await seedAccoWorkflows(prisma, org.id);
  console.log('\n✓ Governance config seeded (inactive). Activate with the dev-activation seed.');
}

main()
  .catch((err) => {
    console.error('Governance seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
