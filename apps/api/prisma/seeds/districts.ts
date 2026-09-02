import type { PrismaClient } from '@prisma/client';

/**
 * The district registry's starting set, and the routine that installs it.
 *
 * ─── Why this is a module and not only a script ──────────────────────────────────
 *
 * It used to be a standalone `npx tsx` script with no callers anywhere in the API. That is
 * fine for a one-off, but it meant the 20 districts existed in the repository and in nobody's
 * database unless an operator remembered to run them by hand — and a tenant that missed it
 * got a required District picker with nothing in it and no way to tell why. Exported as a
 * function it can be called from tenant provisioning (every new tenant) and from the release
 * migration runner (a one-time backfill for tenants that predate this).
 *
 * ─── What it will not do ─────────────────────────────────────────────────────────
 *
 * It only ever *creates* a district whose code is absent. It never renames, never reactivates
 * and never deletes, because a district's code is permanent once a project is numbered under
 * it (ADR-025) and the registry is editable in Settings — a seed that corrected what someone
 * deliberately changed would be a data-loss bug wearing a helpful face.
 *
 * ─── Scope ───────────────────────────────────────────────────────────────────────
 *
 * These are the districts of Banaadir. They are a starting set for a Mogadishu-based tenant,
 * not a universal truth: a tenant operating elsewhere should expect to remove them and add
 * its own, which Settings supports. That is also why the backfill in `migrate-deploy` only
 * runs against a registry that is completely empty.
 */
export const BANAADIR_DISTRICTS: readonly { code: string; name: string }[] = [
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

export interface DistrictSeedResult {
  created: number;
  alreadyPresent: number;
}

/** Idempotent. Adds only the codes this organization does not already have. */
export async function seedDistricts(
  prisma: PrismaClient,
  organizationId: string,
): Promise<DistrictSeedResult> {
  const existing = await prisma.district.findMany({
    where: { organizationId },
    select: { code: true },
  });
  const present = new Set(existing.map((district) => district.code));

  const missing = BANAADIR_DISTRICTS.filter((district) => !present.has(district.code));
  if (missing.length > 0) {
    await prisma.district.createMany({
      data: missing.map((district) => ({ ...district, organizationId })),
    });
  }

  return {
    created: missing.length,
    alreadyPresent: BANAADIR_DISTRICTS.length - missing.length,
  };
}
