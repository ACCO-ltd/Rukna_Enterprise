#!/usr/bin/env tsx
/**
 * Recompute stored `ProgressSnapshot.physicalPercent` under the value-weighted roll-up.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────
 *
 * A work package's percentage used to be the plain average of its BOQ leaves, so a 1-lot item and
 * a 10,000 m³ item counted the same. Snapshots froze whatever the formula said at capture time, so
 * without this pass the progress curve bends at the changeover: every point before the fix reads
 * on the old formula and every point after it on the new one.
 *
 * ─── What it can and cannot reconstruct ──────────────────────────────────────────
 *
 * A snapshot recorded "everything approved as of `capturedAt`". This replays that by summing
 * measurements whose DPR was approved at or before that instant, using today's work packages,
 * allocations and BOQ values.
 *
 * That is a faithful replay **only if** the underlying data has not moved since. Three cases where
 * it cannot be:
 *
 *   1. A report **reopened and re-approved** with different quantities — only the current
 *      quantities survive, so the replay uses those.
 *   2. Work packages, allocations or weights **changed** after the snapshot — the replay uses
 *      today's structure, not the structure in force at the time.
 *   3. A BOQ **re-rated** since — the replay values leaves at today's rates.
 *
 * None of these are recoverable from what is stored; there is no history table behind any of them.
 * The script reports the old and new value for every row it touches so the difference is auditable,
 * and `--dry-run` prints without writing.
 *
 * `verifiedPercent` and `costConsumedPercent` are NOT touched. Neither depends on work-package
 * weighting.
 *
 * Usage:
 *   pnpm --filter @erp/api exec tsx scripts/recompute-progress-snapshots.ts --slug=acco --dry-run
 *   pnpm --filter @erp/api exec tsx scripts/recompute-progress-snapshots.ts --slug=acco --apply
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { weightedPackagePercent } from '../src/business/construction/progress/domain/progress-rollup.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

const slug = values.slug;
const apply = values.apply === true;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!slug || !platformDatabaseUrl) {
  console.error(
    'Usage: tsx scripts/recompute-progress-snapshots.ts --slug=acco [--dry-run|--apply]\n' +
      '(PLATFORM_DATABASE_URL is required)',
  );
  process.exit(1);
}

if (!apply) {
  console.log('DRY RUN — nothing will be written. Re-run with --apply to persist.\n');
}

const ZERO = new Decimal(0);

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({
    datasources: { db: { url: platformDatabaseUrl } },
  });

  let changed = 0;
  let unchanged = 0;

  try {
    const tenant = await platform.tenant.findUnique({
      where: { slug },
      select: { slug: true, dbUrl: true },
    });
    if (!tenant) throw new Error(`Tenant '${slug}' was not found`);

    const prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
    try {
      const snapshots = await prisma.progressSnapshot.findMany({
        orderBy: [{ projectId: 'asc' }, { periodEndDate: 'asc' }],
        select: {
          id: true,
          projectId: true,
          periodEndDate: true,
          capturedAt: true,
          physicalPercent: true,
        },
      });

      if (snapshots.length === 0) {
        console.log('No progress snapshots found. Nothing to do.');
        return;
      }
      console.log(`${snapshots.length} snapshot(s) to replay.\n`);

      // Work packages and allocations are read once per project, not once per snapshot.
      const structureByProject = new Map<
        string,
        { weight: Decimal; leaves: string[] }[]
      >();
      const valueByLeaf = new Map<string, Decimal>();

      for (const snapshot of snapshots) {
        let packages = structureByProject.get(snapshot.projectId);
        if (!packages) {
          const rows = await prisma.workPackage.findMany({
            where: { projectId: snapshot.projectId },
            select: { progressWeight: true, boqLinks: { select: { boqNodeId: true } } },
          });
          packages = rows.map((wp) => ({
            weight: new Decimal(wp.progressWeight.toString()),
            leaves: wp.boqLinks.map((b) => b.boqNodeId),
          }));
          structureByProject.set(snapshot.projectId, packages);

          const leafIds = packages.flatMap((p) => p.leaves);
          if (leafIds.length > 0) {
            const nodes = await prisma.boqNode.findMany({
              where: { id: { in: leafIds } },
              select: { id: true, totalAmount: true },
            });
            for (const n of nodes) {
              valueByLeaf.set(n.id, new Decimal(n.totalAmount?.toString() ?? '0'));
            }
          }
        }

        // Everything approved as of this snapshot's capture — the reading it froze.
        const measurements = await prisma.progressMeasurement.findMany({
          where: {
            dpr: {
              projectId: snapshot.projectId,
              status: 'APPROVED',
              approvedAt: { lte: snapshot.capturedAt },
            },
          },
          select: {
            boqNodeId: true,
            quantity: true,
            boqNode: { select: { quantity: true } },
          },
        });

        const verifiedByLeaf = new Map<string, { verified: Decimal; scope: Decimal }>();
        for (const m of measurements) {
          const entry = verifiedByLeaf.get(m.boqNodeId) ?? {
            verified: ZERO,
            scope: new Decimal(m.boqNode.quantity?.toString() ?? '0'),
          };
          entry.verified = entry.verified.plus(new Decimal(m.quantity.toString()));
          verifiedByLeaf.set(m.boqNodeId, entry);
        }

        const percentByLeaf = new Map<string, number>();
        for (const [leafId, e] of verifiedByLeaf) {
          if (!e.scope.greaterThan(ZERO)) continue;
          percentByLeaf.set(
            leafId,
            Math.min(100, Math.round(e.verified.div(e.scope).mul(100).toNumber())),
          );
        }

        let weighted = ZERO;
        for (const wp of packages) {
          weighted = weighted.plus(
            wp.weight.mul(weightedPackagePercent(wp.leaves, percentByLeaf, valueByLeaf)),
          );
        }
        const next = Math.round(weighted.toNumber() * 100) / 100;
        const previous = Number(snapshot.physicalPercent.toString());

        if (Math.abs(next - previous) < 0.005) {
          unchanged += 1;
          continue;
        }

        changed += 1;
        const date = snapshot.periodEndDate.toISOString().slice(0, 10);
        const delta = next - previous;
        console.log(
          `  ${snapshot.projectId}  ${date}  ${previous.toFixed(2)}% → ${next.toFixed(2)}%` +
            `  (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)} pp)`,
        );

        if (apply) {
          await prisma.progressSnapshot.update({
            where: { id: snapshot.id },
            data: { physicalPercent: new Decimal(next) },
          });
        }
      }

      console.log(
        `\n${changed} snapshot(s) ${apply ? 'updated' : 'would change'}, ${unchanged} unchanged.`,
      );
      if (changed > 0 && !apply) console.log('Re-run with --apply to persist.');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
