#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { Client } from 'pg';
import { parseArgs } from 'util';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedDistricts } from '../prisma/seeds/districts.js';
import { seedAccoWorkflows } from '../src/platform/workflows/seeders/acco-workflows.seed.js';
import { seedUserAccess } from './tenant-access.js';
import { seedGovernedSystemRoles } from './governed-roles.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    plan: { type: 'string', default: 'standard' },
    'admin-email': { type: 'string' },
    'admin-password': { type: 'string' },
  },
});

const slug = values['slug'];
const tenantName = values['name'];
const plan = values['plan'] ?? 'standard';
const adminEmail = values['admin-email'] ?? 'admin@acco.com';
const adminPassword = values['admin-password'];

if (!slug || !tenantName || !adminPassword) {
  console.error(
    'Usage: pnpm tenant:provision --slug=acco --name="ACCO Ltd" ' +
      '--admin-email=admin@acco.com --admin-password=<secure-password>',
  );
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
  console.error('Tenant slug must be 3-50 lowercase letters, numbers, or hyphens');
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error('A valid --admin-email is required');
  process.exit(1);
}

if (adminPassword.length < 12) {
  console.error('Admin password must contain at least 12 characters');
  process.exit(1);
}

const PLATFORM_DB_URL = process.env.PLATFORM_DATABASE_URL;
if (!PLATFORM_DB_URL) {
  console.error('PLATFORM_DATABASE_URL env var is required');
  process.exit(1);
}

const dbName = `rukna_${slug}`;
const tenantDbUrl = buildTenantDbUrl(PLATFORM_DB_URL, dbName);

async function main() {
  console.log(`\nProvisioning tenant: ${slug} (${tenantName})`);
  console.log(`  Database: ${dbName}`);
  console.log(`  Plan: ${plan}\n`);

  const platformPrisma = new PlatformPrismaClient({ datasources: { db: { url: PLATFORM_DB_URL } } });

  // 1. Check slug uniqueness
  const existing = await platformPrisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    console.error(`✗ Tenant '${slug}' already exists`);
    await platformPrisma.$disconnect();
    process.exit(1);
  }

  // 2. Create tenant database (skip if already exists)
  console.log(`Creating database ${dbName}...`);
  const pgClient = new Client({ connectionString: adminConnectionString(PLATFORM_DB_URL!) });
  await pgClient.connect();
  try {
    await pgClient.query(`CREATE DATABASE "${dbName}"`);
    console.log(`  ✓ Database created`);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '42P04') {
      console.log(`  ℹ Database already exists — skipping creation`);
    } else {
      throw err;
    }
  } finally {
    await pgClient.end();
  }

  // 3. Apply tenant migrations (deploy = apply existing, never creates new)
  console.log(`Applying tenant migrations...`);
  execSync(
    `npx prisma migrate deploy --schema=prisma/schema.prisma`,
    { env: { ...process.env, DATABASE_URL: tenantDbUrl }, cwd: process.cwd(), stdio: 'inherit' },
  );
  console.log(`  ✓ Migrations applied`);

  // 4. Seed tenant data
  console.log(`Seeding default data...`);
  const tenantPrisma = new PrismaClient({ datasources: { db: { url: tenantDbUrl } } });

  const org = await tenantPrisma.organization.create({
    // ADR-025: shortCode is the company segment of a project code (e.g. ACCO). Seeded from
    // the slug; editable later in org settings.
    data: { name: tenantName, slug, shortCode: slug.toUpperCase().slice(0, 8) },
  });
  console.log(`  ✓ Organization created: ${org.id}`);

  // ADR-025: the District registry is the site segment of every project code, and the New
  // Project form requires one. Without this a freshly provisioned tenant opens that form to an
  // empty, required picker — which is exactly what happened before this line existed.
  const districts = await seedDistricts(tenantPrisma, org.id);
  console.log(`  ✓ Districts seeded: ${districts.created}`);

  const adminRole = await tenantPrisma.role.create({
    data: { name: 'ADMIN', description: 'System administrator', organizationId: org.id },
  });
  console.log(`  ✓ Admin role created`);

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const adminUser = await tenantPrisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      organizationId: org.id,
    },
  });
  console.log(`  ✓ Admin user created: ${adminUser.email}`);

  await tenantPrisma.userRole.create({
    data: { userId: adminUser.id, roleId: adminRole.id },
  });

  const access = await seedUserAccess(tenantPrisma, {
    organizationId: org.id,
    userId: adminUser.id,
    roleId: adminRole.id,
    isDefault: true,
  });
  console.log(`  Assigned active organization membership and ${access.permissionsAssigned} permissions`);

  // ADR-027 GOV-ADM-003: seed the governed CFO + Governance Publisher SYSTEM roles so publish
  // authority (publish:workflow) is available to real holders, not only ADMIN. Assignment (who
  // holds CFO) is org data, granted later in Settings.
  const governed = await seedGovernedSystemRoles(tenantPrisma, org.id);
  for (const role of governed) {
    console.log(`  ✓ Governed role ${role.roleName}: ${role.permissionsLinked} permissions linked`);
  }

  console.log(`  Seeding ACCO workflow chains...`);
  await seedAccoWorkflows(tenantPrisma, org.id);

  await tenantPrisma.$disconnect();

  // 5. Register in platform DB
  console.log(`Registering in platform registry...`);
  await platformPrisma.tenant.create({
    data: { slug, name: tenantName, dbUrl: tenantDbUrl, status: 'ACTIVE', plan },
  });
  await platformPrisma.$disconnect();
  console.log(`  ✓ Tenant registered`);

  console.log(`\n✓ Tenant '${slug}' provisioned successfully`);
  console.log(`  API:      http://${slug}.localhost:3001/api/v1`);
  console.log(`  Web:      http://${slug}.localhost:3000`);
  console.log(`  Admin:    ${adminEmail}`);
  console.log('  Password: supplied securely by the operator (not printed)\n');
}

function buildTenantDbUrl(platformUrl: string, dbName: string): string {
  const url = new URL(platformUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function adminConnectionString(platformUrl: string): string {
  const url = new URL(platformUrl);
  url.pathname = '/postgres';
  return url.toString();
}

main().catch((err) => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});
