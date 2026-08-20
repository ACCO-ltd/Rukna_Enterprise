/**
 * ADR-025 — District registry + org short code seed.
 *
 * Idempotent. Sets the organization's shortCode (the company segment of a project code) and
 * seeds the 20 Banaadir districts with their 3-letter codes. Districts are editable in Settings
 * afterwards; this only establishes the starting set.
 *
 * Usage:  npx tsx prisma/seeds/districts.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';

const BANAADIR_DISTRICTS: { code: string; name: string }[] = [
  { code: 'CDS', name: 'Cabdicasiis' },
  { code: 'BDH', name: 'Boondheere' },
  { code: 'DNL', name: 'Dayniile' },
  { code: 'DHL', name: 'Dharkeynley' },
  { code: 'XJJ', name: 'Xamar Jajab' },
  { code: 'XWN', name: 'Xamar Weyne' },
  { code: 'HDN', name: 'Hodan' },
  { code: 'HWD', name: 'Howlwadaag' },
  { code: 'HLW', name: 'Heliwaa' },
  { code: 'KRN', name: 'Kaaraan' },
  { code: 'KXD', name: 'Kaxda' },
  { code: 'SHG', name: 'Shangaani' },
  { code: 'SHB', name: 'Shibis' },
  { code: 'WBR', name: 'Waaberi' },
  { code: 'WDJ', name: 'Wadajir' },
  { code: 'WTN', name: 'Warta Nabadda' },
  { code: 'YQD', name: 'Yaaqshiid' },
  { code: 'DRS', name: 'Daarusalaam' },
  { code: 'GRB', name: 'Garasbaaley' },
  { code: 'GBD', name: 'Gubadley' },
];

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

  let created = 0;
  for (const district of BANAADIR_DISTRICTS) {
    const existing = await prisma.district.findFirst({
      where: { organizationId: org.id, code: district.code },
    });
    if (existing) continue;
    await prisma.district.create({
      data: { organizationId: org.id, code: district.code, name: district.name },
    });
    created += 1;
  }
  console.log(`  ✓ Districts: ${created} created, ${BANAADIR_DISTRICTS.length - created} already present`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
