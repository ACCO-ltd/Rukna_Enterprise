#!/usr/bin/env tsx
/**
 * ADR-045 — add what paying from a quotation award needs to one existing tenant: the SoD rule
 * ADVANCE_RECIPIENT_CANNOT_RELEASE (active), the BuyerAdvance band bindings (coupled to the
 * supplier-payment bands' state) and the STAFF_ADVANCE posting profile (→ 13100). Targeted and
 * additive (see `quotation-payment-governance.ts`). Idempotent.
 *
 * Usage (production, after the deploy's migrate step has run):
 *   docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps migrate \
 *     pnpm exec tsx prisma/seeds/grant-quotation-payment.seed.ts
 * Requires DATABASE_URL → the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import { grantQuotationPaymentGovernance } from './quotation-payment-governance.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main(): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the tenant DB?`);

  const result = await grantQuotationPaymentGovernance(prisma, org.id);
  if (result.status === 'policy-missing') {
    throw new Error(`No ACTIVE ACCO_GOVERNANCE policy version for org ${ORG_SLUG}; run the governance seed first.`);
  }
  for (const code of result.sodCreated) console.log(`  ✓ SoD rule ${code}: created (active)`);
  for (const code of result.sodAlreadyPresent) console.log(`  ✓ SoD rule ${code}: already present — no change`);
  console.log(
    `  ✓ Buyer-advance bands: ${result.advanceBindingsAfter - result.advanceBindingsBefore} created, ` +
      `${result.advanceBindingsAfter} present (active exactly when the supplier-payment bands are)`,
  );
  console.log(`  ✓ STAFF_ADVANCE posting profile: ${result.staffAdvanceProfile}`);
  if (result.staffAdvanceProfile === 'no-13100-account') {
    console.log('    ! No active 13100 asset account — create the profile in Accounting → Posting profiles.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
