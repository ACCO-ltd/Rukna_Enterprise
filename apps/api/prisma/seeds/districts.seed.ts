#!/usr/bin/env tsx
/**
 * ADR-025 — District registry + org short code, for one tenant, from the command line.
 *
 * The registry itself lives in `districts.ts` so provisioning and the release migration runner
 * can install it too; this file is the manual entry point that resolves an organization by
 * slug and sets its `shortCode` (the company segment of a project code) on the way past.
 *
 * Usage:  npx tsx prisma/seeds/districts.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import { seedDistricts } from './districts.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization with slug "${ORG_SLUG}" not found. Run the org seed first.`);

  if (!org.shortCode) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { shortCode: ORG_SLUG.toUpperCase().slice(0, 8) },
    });
    console.log(`  ✓ Organization shortCode set to ${ORG_SLUG.toUpperCase()}`);
  } else {
    console.log(`  · Organization shortCode already ${org.shortCode}`);
  }

  const result = await seedDistricts(prisma, org.id);
  console.log(`  ✓ Districts: ${result.created} created, ${result.alreadyPresent} already present`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
