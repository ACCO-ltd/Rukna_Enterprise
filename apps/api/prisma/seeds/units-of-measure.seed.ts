#!/usr/bin/env tsx
/**
 * ADR-039: the standard construction units (m³, m², m, kg, t, nr, item) for one tenant, from the
 * command line. The set and the idempotent routine live in `units-of-measure.ts`, which tenant
 * provisioning and the release migration runner also call.
 *
 * Usage:  npx tsx prisma/seeds/units-of-measure.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import { seedUnitsOfMeasure } from './units-of-measure.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization with slug "${ORG_SLUG}" not found. Run the org seed first.`);

  const result = await seedUnitsOfMeasure(prisma, org.id);
  console.log(`  ✓ Units of measure: ${result.created} created, ${result.alreadyPresent} already present`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
