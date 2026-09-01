/**
 * Matching Tolerance Seed — ACCO's explicit policy (A2 / A14).
 *
 * Seeds ONE organization-scoped MatchingTolerancePolicy expressing ACCO's stated 3-way match rule:
 *   unit price   2%   (priceVariancePercent)
 *   quantity     0%   (quantityVariancePercent — billed qty may not exceed accepted/received qty)
 *   rounding   ≤ USD 5 per invoice  — this is a PER-INVOICE control, NOT a per-line one, so it is
 *              intentionally NOT stored as amountVarianceAbsolute (which the engine reads as a
 *              per-line limit). It lives as the PER_INVOICE_ROUNDING_ABS constant in
 *              bill-matching.service.ts. Seeding it here would change the mechanism.
 *
 * These figures match the platform fallback in bill-matching.service.ts, so behaviour is unchanged;
 * seeding makes the policy explicit and configurable (an org can now revise it in data without a code
 * change), and satisfies A14's "seed ACCO's tolerance if not already seeded".
 *
 * Idempotent: safe to run repeatedly — it will not create a second ACTIVE org-scoped row.
 * Usage:  npx tsx --env-file=.env prisma/seeds/matching-tolerance-acco.seed.ts
 *
 * Requires DATABASE_URL pointing to the ACCO tenant database.
 * Requires ACCO_ORG_SLUG (defaults to "acco").
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';
const SEED_USER = 'seed:matching-tolerance-acco';

// ACCO's explicit tolerances (A2). Do NOT invent a generic policy — these are the stated figures.
const PRICE_VARIANCE_PERCENT = new Prisma.Decimal('2');
const QUANTITY_VARIANCE_PERCENT = new Prisma.Decimal('0');

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Organization with slug "${ORG_SLUG}" not found. Run the org seed first.`);
  }
  const orgId = org.id;
  console.log(`Seeding matching tolerance for org: ${org.name} (${orgId})`);

  const existing = await prisma.matchingTolerancePolicy.findFirst({
    where: { organizationId: orgId, scopeType: 'ORGANIZATION', status: 'ACTIVE' },
  });

  if (existing) {
    await prisma.matchingTolerancePolicy.update({
      where: { id: existing.id },
      data: {
        priceVariancePercent: PRICE_VARIANCE_PERCENT,
        quantityVariancePercent: QUANTITY_VARIANCE_PERCENT,
        // Per-invoice rounding stays in code (see header) — clear any per-line absolute so the
        // per-invoice USD-5 control remains the single source of the rounding rule.
        amountVarianceAbsolute: null,
        approvedBy: SEED_USER,
      },
    });
    console.log('  ✓ MatchingTolerancePolicy (ORGANIZATION) updated — 2% price / 0% qty');
  } else {
    await prisma.matchingTolerancePolicy.create({
      data: {
        organizationId: orgId,
        scopeType: 'ORGANIZATION',
        priceVariancePercent: PRICE_VARIANCE_PERCENT,
        quantityVariancePercent: QUANTITY_VARIANCE_PERCENT,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        approvedBy: SEED_USER,
      },
    });
    console.log('  ✓ MatchingTolerancePolicy (ORGANIZATION) created — 2% price / 0% qty');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
