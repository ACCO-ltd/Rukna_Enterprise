#!/usr/bin/env tsx
/**
 * ADR-044 §6/§7 — add the quotation SoD rules (active) and the quotation award value bands
 * (inactive) to one existing tenant. Targeted and additive (see `quotation-governance.ts`).
 * Idempotent.
 *
 * Usage (production, after the deploy's migrate step has run):
 *   docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps migrate \
 *     pnpm exec tsx prisma/seeds/grant-quotation-sod-rules.seed.ts
 * Requires DATABASE_URL → the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import { grantQuotationGovernance } from './quotation-governance.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main(): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org)
    throw new Error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the tenant DB?`);

  const result = await grantQuotationGovernance(prisma, org.id);
  if (result.status === 'policy-missing') {
    throw new Error(
      `No ACTIVE ACCO_GOVERNANCE policy version for org ${ORG_SLUG}; run the governance seed first.`,
    );
  }
  for (const code of result.created) console.log(`  ✓ SoD rule ${code}: created (active)`);
  for (const code of result.alreadyPresent) console.log(`  ✓ SoD rule ${code}: already present — no change`);
  console.log(
    `  ✓ Quotation award bands: ${result.awardBandsAfter - result.awardBandsBefore} created, ` +
      `${result.awardBandsAfter} present (inactive until activated together with the PO bands)`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
