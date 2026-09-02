#!/usr/bin/env tsx
/**
 * Project type (PTD1-PTD5) — the ProjectSubtype registry starting set, and the idempotent routine
 * that installs it, for one tenant, from the command line.
 *
 * ─── Why a module + a script ──────────────────────────────────────────────────────
 *
 * `seedProjectSubtypes` is exported so tenant provisioning (every new tenant) and the release
 * migration runner (a one-time back-fill for the live ACCO tenant that predates this feature) can
 * call it — the same shape the District registry uses. Without a caller a fresh tenant would open
 * the New Project form to a subtype picker with nothing in it. This file is also a manual entry
 * point: it resolves an organization by slug and seeds it.
 *
 * ─── What it will not do ──────────────────────────────────────────────────────────
 *
 * It only ever *creates* a (category, name) pair that is absent for the organization. It never
 * renames, never reactivates and never deletes, because the registry is editable in Settings and a
 * seed that overrode a deliberate change would be a data-loss bug wearing a helpful face. Category
 * is a fixed enum; only the subtype rows are seeded.
 *
 * ─── Scope ────────────────────────────────────────────────────────────────────────
 *
 * A pure classification/reporting attribute: subtypes drive no workflow, template or approval, and
 * are not part of the project code (ADR-025 unchanged). This is ACCO's starting set, not a universal
 * truth — a tenant is expected to curate it in Settings.
 *
 * Usage:  npx tsx prisma/seeds/project-subtypes.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco".
 */

import { PrismaClient, ProjectCategory } from '@prisma/client';

/** ACCO's starting subtypes, grouped by the fixed category enum. */
export const PROJECT_SUBTYPE_SEED: Readonly<Record<ProjectCategory, readonly string[]>> = {
  [ProjectCategory.COMMERCIAL]: [
    'Office buildings',
    'Retail spaces',
    'Mixed-use developments',
    'Hotels',
  ],
  [ProjectCategory.RESIDENTIAL]: [
    'Single-family homes',
    'Multi-family apartments',
    'Housing estates',
    'Villas',
  ],
  [ProjectCategory.INFRASTRUCTURE_CIVIL]: [
    'Roads',
    'Bridges',
    'Drainage systems',
    'Water supply network',
    'Paving',
  ],
  [ProjectCategory.INSTITUTIONAL_PUBLIC]: [
    'Hospitals',
    'Clinics',
    'Schools',
    'Universities',
    'Government facilities',
  ],
  [ProjectCategory.INDUSTRIAL]: [
    'Warehouses',
    'Manufacturing plants',
    'Logistics hubs',
    'Processing facilities',
  ],
  [ProjectCategory.RENOVATION_FITOUT]: [
    'Interior fit-outs',
    'Structural refurbishments',
    'Building upgrades',
  ],
};

export interface ProjectSubtypeSeedResult {
  created: number;
  alreadyPresent: number;
}

/**
 * Idempotent. Adds only the (category, name) pairs this organization does not already have. Safe to
 * re-run against a partially-seeded or fully-seeded tenant.
 */
export async function seedProjectSubtypes(
  prisma: Pick<PrismaClient, 'projectSubtype'>,
  organizationId: string,
): Promise<ProjectSubtypeSeedResult> {
  const desired = Object.entries(PROJECT_SUBTYPE_SEED).flatMap(([category, names]) =>
    names.map((name) => ({ category: category as ProjectCategory, name })),
  );

  const existing = await prisma.projectSubtype.findMany({
    where: { organizationId },
    select: { category: true, name: true },
  });
  const present = new Set(existing.map((row) => `${row.category}:${row.name}`));

  const missing = desired.filter((row) => !present.has(`${row.category}:${row.name}`));
  if (missing.length > 0) {
    await prisma.projectSubtype.createMany({
      data: missing.map((row) => ({ ...row, organizationId })),
    });
  }

  return { created: missing.length, alreadyPresent: desired.length - missing.length };
}

async function main() {
  const prisma = new PrismaClient();
  const orgSlug = process.env.ORG_SLUG ?? 'acco';
  try {
    const org = await prisma.organization.findFirst({ where: { slug: orgSlug } });
    if (!org) {
      throw new Error(`Organization with slug "${orgSlug}" not found. Run the org seed first.`);
    }

    const result = await seedProjectSubtypes(prisma, org.id);
    console.log(
      `  ✓ Project subtypes: ${result.created} created, ${result.alreadyPresent} already present`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the CLI entry point when executed directly, not when imported by provisioning/backfill.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].includes('project-subtypes.seed');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
