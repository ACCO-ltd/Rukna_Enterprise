#!/usr/bin/env tsx
/**
 * ADR-022 amendment (2026-10-27) — link `post-own:journal` to the Finance Officer and CFO, and
 * `manage:journal` to the CFO, for one tenant. Targeted and additive (see `journal-self-post-permissions.ts`).
 * Idempotent.
 *
 * Usage (production, after the deploy's migrate step has run):
 *   docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps migrate \
 *     pnpm exec tsx prisma/seeds/grant-journal-self-post.seed.ts
 * Requires DATABASE_URL → the tenant database. ORG_SLUG defaults to "acco".
 * Holders pick the new permission up at their next sign-in (permissions live in the JWT).
 */

import { PrismaClient } from '@prisma/client';

import { grantJournalSelfPostPermissions } from './journal-self-post-permissions.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

async function main(): Promise<void> {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org)
    throw new Error(`Organization '${ORG_SLUG}' not found — is DATABASE_URL the tenant DB?`);

  const results = await grantJournalSelfPostPermissions(prisma, org.id);
  for (const r of results) {
    const note =
      r.status === 'granted'
        ? 'granted'
        : r.status === 'already-granted'
          ? 'already granted — no change'
          : 'ROLE NOT FOUND — nothing granted';
    console.log(`  ${r.status === 'role-missing' ? '!' : '✓'} ${r.roleName} (${ORG_SLUG}): ${r.permission} ${note}`);
  }
  if (results.every((r) => r.status === 'role-missing')) {
    throw new Error(`None of the journal self-post roles exist for org ${ORG_SLUG}; nothing granted.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
