#!/usr/bin/env tsx
/**
 * Reap abandoned uploads (Phase 7 Step 2, audit P1-3).
 *
 * `POST /files` creates a row before the bytes exist, so two ordinary things leave one behind
 * forever: a user who picks a file and changes their mind, and an upload that succeeds while the
 * attach that should have followed it fails. Nothing reaped them.
 *
 * A file is reapable only by being **TEMPORARY** past the retention window — nothing ever bound
 * it, so no business record can be harmed by its removal. BOUND and IMMUTABLE files are never
 * considered; the filter is on lifecycle first and age second, so an old attachment is not one
 * slow query away from deletion.
 *
 * There is no scheduler in this codebase and inventing one for a single daily sweep would be a
 * background system nobody can test. This is a script, like the migration runner and the seeds
 * beside it, and it is invoked the same way.
 *
 *   # every tenant, default 24-hour retention
 *   pnpm --filter @erp/api exec tsx scripts/cleanup-abandoned-files.ts
 *
 *   # see what it would remove, change nothing
 *   ... scripts/cleanup-abandoned-files.ts --dry-run
 *
 *   # a different window, one tenant
 *   ... scripts/cleanup-abandoned-files.ts --hours 72 --tenant acco
 *
 * In production, from cron on the host (the container already holds the credentials):
 *
 *   17 3 * * *  docker exec rukna_api node dist/scripts/cleanup-abandoned-files.js >> /var/log/rukna-file-cleanup.log 2>&1
 *
 * Idempotent and restartable: each file is removed storage-first and independently, a failure on
 * one is logged and skipped, and re-running finishes the job. Safe to run concurrently with the
 * API; safe to run twice.
 */
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';

const RETENTION_HOURS_DEFAULT = Number(process.env.FILE_TEMPORARY_RETENTION_HOURS ?? 24);
const BATCH = 500;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const dryRun = process.argv.includes('--dry-run');
const retentionHours = Number(arg('hours') ?? RETENTION_HOURS_DEFAULT);
const onlyTenant = arg('tenant');

if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
  console.error('--hours must be a positive number');
  process.exit(1);
}

const storage = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.MINIO_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  },
  forcePathStyle: true,
});

/** One tenant database. Returns what it did, so the caller can total it up. */
async function sweepTenant(slug: string, databaseUrl: string, cutoff: Date) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let deleted = 0;
  let failed = 0;
  try {
    const candidates = await prisma.platformFile.findMany({
      where: { lifecycle: 'TEMPORARY', createdAt: { lt: cutoff } },
      select: { id: true, storageBucket: true, storageKey: true, createdAt: true, originalName: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });

    for (const file of candidates) {
      if (dryRun) {
        console.log(`  would reap ${file.id}  ${file.createdAt.toISOString()}  ${file.originalName}`);
        deleted += 1;
        continue;
      }
      try {
        // Storage first: a row without bytes is reapable next run, bytes without a row are
        // invisible and permanent.
        await storage.send(
          new DeleteObjectCommand({ Bucket: file.storageBucket, Key: file.storageKey }),
        );
        await prisma.platformFile.delete({ where: { id: file.id } });
        deleted += 1;
      } catch (err) {
        failed += 1;
        console.warn(`  ! ${file.id}: ${(err as Error).message}`);
      }
    }
    console.log(
      `${slug}: examined ${candidates.length}, ${dryRun ? 'would reap' : 'reaped'} ${deleted}` +
        (failed ? `, failed ${failed}` : '') +
        (candidates.length === BATCH ? ' (batch full — run again)' : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
  return { deleted, failed, batchFull: false };
}

async function main() {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
  console.log(
    `Reaping TEMPORARY files created before ${cutoff.toISOString()} ` +
      `(retention ${retentionHours}h)${dryRun ? ' — DRY RUN' : ''}`,
  );

  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (platformUrl) {
    const platform = new PlatformPrismaClient({ datasources: { db: { url: platformUrl } } });
    try {
      const tenants = await platform.tenant.findMany({
        where: { status: { not: 'TERMINATED' }, ...(onlyTenant ? { slug: onlyTenant } : {}) },
        select: { slug: true, dbUrl: true },
      });
      if (tenants.length === 0) {
        console.log('No tenants to sweep.');
        return;
      }
      let deleted = 0;
      let failed = 0;
      for (const tenant of tenants) {
        const result = await sweepTenant(tenant.slug, tenant.dbUrl, cutoff);
        deleted += result.deleted;
        failed += result.failed;
      }
      console.log(`\nTotal: ${dryRun ? 'would reap' : 'reaped'} ${deleted}, failed ${failed}`);
      return;
    } finally {
      await platform.$disconnect();
    }
  }

  // Single-database development: no platform registry, one DATABASE_URL.
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set PLATFORM_DATABASE_URL (multi-tenant) or DATABASE_URL (single database).');
    process.exit(1);
  }
  await sweepTenant('default', url, cutoff);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
