#!/usr/bin/env tsx
/**
 * AR project-tag reclassification — audit, then (only on approval) correct.
 *
 * Owner decision 2026-09-28 (option C). Before PR #226, invoice reversals (EVT-AR-002) and credit
 * notes (EVT-AR-007) posted their revenue line without the project the invoice's revenue credit
 * carried, so affected projects' revenue and P&L were overstated. Posted journals are NEVER edited:
 * each affected line gets a balanced reclassification in the same revenue account, linked to it.
 *
 * Rules:  src/business/accounting/accounts-receivable/domain/ar-project-retag.policy.ts
 * Engine: src/business/accounting/accounts-receivable/application/ar-project-retag.runner.ts
 *
 * Usage:
 *   # 1. Audit — READ-ONLY. Prints an itemised dry run and writes it to a JSON report.
 *   pnpm tsx scripts/ar-project-retag.ts --slug=acco [--out=retag-report.json]
 *
 *   # 2. The accountant reviews the report. Nothing is posted until they approve it.
 *
 *   # 3. Apply exactly the approved report. Re-audits first and refuses on any difference.
 *   pnpm tsx scripts/ar-project-retag.ts --slug=acco --apply \
 *     --approved-report=retag-report.json --approved-by=<accountant userId> --actor=<userId>
 *
 *   # 4. Re-run the Billing–GL check on its own (read-only):
 *   pnpm tsx scripts/ar-project-retag.ts --slug=acco --verify --approved-report=retag-report.json
 *
 * Guarantees:
 * - Idempotent: each correction is keyed `ar-project-retag:<lineId>`; corrected lines are excluded
 *   from the audit, and the posting service returns the existing journal on a repeat.
 * - Period policy: a correction is dated on the corrected line's own accounting date. A line in a
 *   CLOSED or LOCKED period is reported as BLOCKED and never posted — no period is reopened here.
 * - All corrections, their proofs and snapshot invalidation run in ONE transaction; if any proof
 *   fails (an account total moved, a project moved by the wrong amount, an unaffected project
 *   moved), nothing is committed.
 * - Zero affected lines → nothing to approve, nothing posted, and the report says so.
 *
 * PLATFORM_DATABASE_URL must point at the platform database (tenant registry).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';

import { DocumentSequenceRepository } from '../src/business/accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { JournalRepository } from '../src/business/accounting/accounting-core/infrastructure/journal.repository.js';
import { AccountingPostingService } from '../src/business/accounting/accounting-core/infrastructure/accounting-posting.service.js';
import {
  expectedProjectDeltas,
  projectRevenueEffect,
  retagFingerprint,
  retagStatus,
  type RetagLine,
} from '../src/business/accounting/accounts-receivable/domain/ar-project-retag.policy.js';
import {
  applyRetag,
  auditRetag,
  billingGap,
  revenueByProject,
  type ApprovedRetagReport,
} from '../src/business/accounting/accounts-receivable/application/ar-project-retag.runner.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    'org-id': { type: 'string' },
    out: { type: 'string' },
    apply: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    'approved-report': { type: 'string' },
    'approved-by': { type: 'string' },
    actor: { type: 'string' },
  },
});

const slug = values.slug;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;
if (!slug || !platformDatabaseUrl) {
  console.error('Usage: pnpm tsx scripts/ar-project-retag.ts --slug=<tenant> [--apply …] (PLATFORM_DATABASE_URL required)');
  process.exit(1);
}
if (values.apply && (!values['approved-report'] || !values['approved-by'] || !values.actor)) {
  console.error('--apply requires --approved-report, --approved-by (accountant userId) and --actor.');
  process.exit(1);
}
if (values.verify && !values['approved-report']) {
  console.error('--verify requires --approved-report.');
  process.exit(1);
}

function printReport(lines: RetagLine[], revenue: Map<string, Decimal>): void {
  const bar = '─'.repeat(78);
  console.log(`\n${bar}\n  Untagged reversal / credit-note revenue lines: ${lines.length}\n${bar}`);
  if (lines.length === 0) {
    console.log('  None found. Nothing to correct — no journal will be posted.');
    return;
  }
  for (const l of lines) {
    const source =
      l.sourceKind === 'CREDIT_NOTE'
        ? `credit note ${l.creditNoteNumber ?? l.creditNoteId} on invoice ${l.sourceInvoiceNumber ?? l.sourceInvoiceId}`
        : `reversal of invoice ${l.sourceInvoiceNumber ?? l.sourceInvoiceId}`;
    console.log(
      `  [${retagStatus(l)}] ${l.journalNumber ?? l.journalEntryId}/${l.lineNumber}  ${l.accountingDate}  ` +
        `${l.periodName ?? '?'} (${l.periodStatus ?? '?'})\n` +
        `      ${source}  →  project ${l.intendedProjectCode ?? l.intendedProjectId}\n` +
        `      account ${l.accountCode} ${l.accountName}  Dr ${l.debit}  Cr ${l.credit}  ` +
        `project revenue effect ${projectRevenueEffect(l).toFixed(2)}`,
    );
  }
  const ready = lines.filter((l) => retagStatus(l) === 'READY');
  console.log('\n  Per project (READY lines only): current revenue → after correction');
  for (const [project, delta] of expectedProjectDeltas(ready)) {
    const now = revenue.get(project) ?? new Decimal(0);
    console.log(`    ${project}: ${now.toFixed(2)} → ${now.plus(delta).toFixed(2)}  (${delta.toFixed(2)})`);
  }
  const counts = ['READY', 'ALREADY_CORRECTED', 'BLOCKED_PERIOD'].map(
    (s) => `${s} ${lines.filter((l) => retagStatus(l) === s).length}`,
  );
  console.log(`\n  ${counts.join(' · ')}`);
  if (lines.some((l) => retagStatus(l) === 'BLOCKED_PERIOD')) {
    console.log('  BLOCKED lines sit in CLOSED/LOCKED periods and will NOT be posted. Whether to reopen');
    console.log('  those periods is a separate decision through the normal Setup & close process.');
  }
}

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({ datasources: { db: { url: platformDatabaseUrl } } });
  let prisma: PrismaClient | undefined;
  try {
    const tenant = await platform.tenant.findUnique({
      where: { slug },
      select: { slug: true, name: true, dbUrl: true },
    });
    if (!tenant) throw new Error(`Tenant '${slug}' not found`);
    prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });

    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    const org = values['org-id']
      ? orgs.find((o) => o.id === values['org-id'])
      : orgs.length === 1
        ? orgs[0]
        : undefined;
    if (!org) throw new Error(`Pick an organization with --org-id (${orgs.length} found).`);

    const mode = values.apply ? 'APPLY' : values.verify ? 'VERIFY (read-only)' : 'AUDIT / DRY RUN (read-only)';
    console.log(`\nAR project-tag reclassification — tenant ${tenant.slug} (${tenant.name}) — ${mode}`);

    // ── Audit (default) ──
    if (!values.apply && !values.verify) {
      const lines = await auditRetag(prisma, org.id);
      printReport(lines, await revenueByProject(prisma, org.id));
      const ready = lines.filter((l) => retagStatus(l) === 'READY');
      const report = {
        tenant: tenant.slug,
        organizationId: org.id,
        generatedAt: new Date().toISOString(),
        fingerprint: retagFingerprint(ready),
        ready,
        excluded: lines.filter((l) => retagStatus(l) !== 'READY').map((l) => ({ ...l, status: retagStatus(l) })),
      };
      const out = values.out ?? `ar-project-retag-${tenant.slug}-${report.generatedAt.slice(0, 10)}.json`;
      writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`\n  Report written to ${out} (fingerprint ${report.fingerprint}).`);
      console.log('  Nothing was posted. Send the report to the accountant for approval.');
      return;
    }

    const approved = JSON.parse(readFileSync(values['approved-report']!, 'utf8')) as ApprovedRetagReport;
    if (approved.organizationId !== org.id) throw new Error('Approved report is for a different organization.');
    const projects = [...new Set(approved.ready.map((l) => l.intendedProjectId))];

    // ── Verify (read-only) ──
    if (values.verify) {
      console.log('\n  Billing–GL gap per project in the approved report (0.00 = clears):');
      for (const project of projects) {
        console.log(`    ${project}: ${(await billingGap(prisma, org.id, project)).toFixed(2)}`);
      }
      const open = (await auditRetag(prisma, org.id)).filter((l) => retagStatus(l) === 'READY');
      console.log(`\n  Lines still awaiting correction: ${open.length}`);
      return;
    }

    // ── Apply ──
    if (approved.ready.length === 0) {
      console.log('\n  The approved report contains no lines. Nothing posted.');
      return;
    }
    const posting = new AccountingPostingService(new DocumentSequenceRepository(), new JournalRepository());
    const summary = await applyRetag(prisma, posting, {
      orgId: org.id,
      approved,
      approvedBy: values['approved-by']!,
      actor: values.actor!,
    });

    console.log(`\n  Posted ${summary.posted.length} reclassification(s):`);
    for (const p of summary.posted) console.log(`    ${p}`);
    console.log('  Proof passed: every account net unchanged (trial balance and company revenue unchanged);');
    console.log('  each affected project moved by exactly its expected amount; no other project moved.');
    console.log('\n  Billing–GL gap per affected project (before → after; 0.00 = clears):');
    for (const [project, before] of summary.gapBefore) {
      console.log(`    ${project}: ${before.toFixed(2)} → ${(await billingGap(prisma, org.id, project)).toFixed(2)}`);
    }
    console.log(
      summary.stale.length
        ? `\n  Period snapshots marked INVALID — rebuild through Setup & close: ${summary.stale.join(', ')}`
        : '\n  No period snapshots were affected. Project finance figures are computed live; no cache to rebuild.',
    );
  } finally {
    await prisma?.$disconnect();
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
