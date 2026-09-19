#!/usr/bin/env tsx
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedDistricts } from '../prisma/seeds/districts.js';
import { seedAccoWorkflows } from '../src/platform/workflows/seeders/acco-workflows.seed.js';
import { seedUserAccess } from './tenant-access.js';
import { seedGovernedSystemRoles } from './governed-roles.js';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.organization.findFirst();
  if (existing) {
    console.log(`Org already exists: ${existing.name} (${existing.id}) — nothing to do.`);
    return;
  }

  console.log('Seeding dev tenant (acco)...');

  const org = await prisma.organization.create({
    data: { name: 'ACCO Ltd', slug: 'acco', shortCode: 'ACCO' },
  });
  console.log(`  ✓ Organization: ${org.id}`);

  const { created: districtCount } = await seedDistricts(prisma, org.id);
  console.log(`  ✓ Districts: ${districtCount}`);

  const adminRole = await prisma.role.create({
    data: { name: 'ADMIN', description: 'System administrator', organizationId: org.id },
  });
  console.log(`  ✓ ADMIN role: ${adminRole.id}`);

  const passwordHash = await bcrypt.hash('acco.admin@123', 12);
  const user = await prisma.user.create({
    data: {
      email: 'admin@acco.com',
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      organizationId: org.id,
    },
  });
  console.log(`  ✓ Admin user: ${user.email}`);

  await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });

  const access = await seedUserAccess(prisma, {
    organizationId: org.id,
    userId: user.id,
    roleId: adminRole.id,
    isDefault: true,
  });
  console.log(`  ✓ Membership + ${access.permissionsAssigned} permissions`);

  const governed = await seedGovernedSystemRoles(prisma, org.id);
  for (const role of governed) {
    console.log(`  ✓ Governed role ${role.roleName}: ${role.permissionsLinked} permissions`);
  }

  await seedAccoWorkflows(prisma, org.id);
  console.log(`  ✓ Workflow chains seeded`);

  console.log('\nDone. Login: admin@acco.com / acco.admin@123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
