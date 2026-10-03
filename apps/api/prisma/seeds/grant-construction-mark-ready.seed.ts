#!/usr/bin/env tsx
/**
 * ADR-043 decision 1 — link `mark-ready:billing` to the Construction Director role, for one tenant.
 *
 * Targeted and additive (see `construction-mark-ready.ts`): one permission, one role, never removes
 * or re-adds anything else, so in-app role edits are kept. Idempotent.
 *
 * Usage (production, after the deploy's migrate step has run):
 *   docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps migrate \
 *     pnpm exec tsx prisma/seeds/grant-construction-mark-ready.seed.ts
 * Requires DATABASE_URL → the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import { grantMarkReadyToConstructionDirector, MARK_READY_ROLE_NAME } from './construction-mark-ready.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main(): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the tenant DB?`);

  const result = await grantMarkReadyToConstructionDirector(prisma, org.id);
  if (result.status === 'role-missing') {
    throw new Error(`Role '${MARK_READY_ROLE_NAME}' not found for org ${ORG_SLUG}; nothing granted.`);
  }
  console.log(
    result.status === 'granted'
      ? `  ✓ ${MARK_READY_ROLE_NAME} (${ORG_SLUG}): mark-ready:billing granted`
      : `  ✓ ${MARK_READY_ROLE_NAME} (${ORG_SLUG}): mark-ready:billing already granted — no change`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
