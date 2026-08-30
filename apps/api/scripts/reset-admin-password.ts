#!/usr/bin/env tsx
/**
 * Reset a user's password in a tenant database.
 *
 * Looks the tenant up in the platform registry to get its DB URL, then bcrypt-hashes
 * (cost 12, same as provisioning) and updates the user's passwordHash. The password is
 * passed as an argument and never printed.
 *
 *   docker compose -f deploy/docker-compose.prod.yml run --rm migrate \
 *     pnpm admin:reset-password --email=admin@acco.com --password='<new-strong-password>'
 *
 * --slug defaults to DEFAULT_TENANT_SLUG (single-tenant), else pass --slug explicitly.
 */
import { parseArgs } from 'util';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
  },
});

const slug = values['slug'] ?? process.env.DEFAULT_TENANT_SLUG;
const email = values['email'];
const password = values['password'];

if (!slug) {
  console.error('No tenant: pass --slug or set DEFAULT_TENANT_SLUG');
  process.exit(1);
}
if (!email || !password) {
  console.error("Usage: pnpm admin:reset-password --email=<email> --password='<new-password>'");
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters');
  process.exit(1);
}

const PLATFORM_DB_URL = process.env.PLATFORM_DATABASE_URL;
if (!PLATFORM_DB_URL) {
  console.error('PLATFORM_DATABASE_URL env var is required');
  process.exit(1);
}

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({ datasources: { db: { url: PLATFORM_DB_URL } } });
  const tenant = await platform.tenant.findUnique({ where: { slug } });
  await platform.$disconnect();
  if (!tenant) {
    console.error(`Tenant '${slug}' not found in the platform registry`);
    process.exit(1);
  }

  const tenantPrisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
  const passwordHash = await bcrypt.hash(password!, 12);
  const result = await tenantPrisma.user.updateMany({ where: { email }, data: { passwordHash } });
  await tenantPrisma.$disconnect();

  if (result.count === 1) {
    console.log(`✓ Password updated for ${email} (tenant '${slug}')`);
  } else {
    console.error(`✗ Expected exactly one user '${email}', updated ${result.count}. No change intended?`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Password reset failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
