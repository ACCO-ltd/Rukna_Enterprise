#!/usr/bin/env tsx
/**
 * Owner decision 2026-10-06 — link `approve:material-request` to the Finance Officer role, for one
 * tenant. Targeted and additive (see `finance-mr-approval.ts`). Idempotent.
 *
 * Usage (production, after the deploy's migrate step has run):
 *   docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps migrate \
 *     pnpm exec tsx prisma/seeds/grant-finance-mr-approval.seed.ts
 * Requires DATABASE_URL → the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

import {
  grantMaterialRequestApprovalToFinance,
  MR_APPROVER_ROLE_NAME,
} from './finance-mr-approval.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main(): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org)
    throw new Error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the tenant DB?`);

  const result = await grantMaterialRequestApprovalToFinance(prisma, org.id);
  if (result.status === 'role-missing') {
    throw new Error(
      `Role '${MR_APPROVER_ROLE_NAME}' not found for org ${ORG_SLUG}; nothing granted.`,
    );
  }
  console.log(
    result.status === 'granted'
      ? `  ✓ ${MR_APPROVER_ROLE_NAME} (${ORG_SLUG}): approve:material-request granted`
      : `  ✓ ${MR_APPROVER_ROLE_NAME} (${ORG_SLUG}): approve:material-request already granted — no change`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
