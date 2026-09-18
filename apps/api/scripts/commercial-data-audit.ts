#!/usr/bin/env tsx
/**
 * Commercial Data Audit — Slice 8
 *
 * Read-only report for ACCO production data health. Run before every production deploy.
 * Prints a structured JSON report to stdout; all checks are SELECT-only.
 *
 * Usage:
 *   pnpm tsx scripts/commercial-data-audit.ts --slug=acco
 *
 * Checks:
 *   1.  BOQ version counts by status
 *   2.  Contracts referencing non-SNAPSHOT BOQ versions (legacy)
 *   3.  Contracts with billingModel = MEASURED_IPC (should be 0 for ACCO)
 *   4.  Invoice state distribution
 *   5.  Invoices with null dueDate
 *   6.  Invoices never delivered but status ≥ NOT_POSTED
 *   7.  Overdue invoices (past dueDate, not yet PAID)
 *   8.  Extra work nodes by type
 *   9.  ABSORBED nodes created before variation-collapse (pre 2026-09-15)
 *  10.  Receipt allocation integrity (Σ allocations > invoice.netAmount)
 *  11.  Unallocated receipts (no InvoiceAllocation rows)
 *  12.  Orphan VariationBillingAllocation rows (variation node inactive)
 */

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
  },
});

const slug = values.slug;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!slug || !platformDatabaseUrl) {
  console.error(
    'Usage: pnpm tsx scripts/commercial-data-audit.ts --slug=acco\n' +
      '       (PLATFORM_DATABASE_URL env var required)',
  );
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printSection(title: string, data: unknown): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
  console.log(JSON.stringify(data, null, 2));
}

function flag(label: string, count: number, threshold = 0): string {
  return count > threshold ? `⚠  ${label}: ${count}` : `✓  ${label}: ${count}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({
    datasources: { db: { url: platformDatabaseUrl } },
  });

  let prisma: PrismaClient | undefined;

  try {
    const tenant = await platform.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, status: true, dbUrl: true },
    });
    if (!tenant) throw new Error(`Tenant '${slug}' not found`);

    prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ACCO Commercial Data Audit`);
    console.log(`  Tenant: ${tenant.slug} (${tenant.name})`);
    console.log(`  Run at: ${new Date().toISOString()}`);
    console.log('═'.repeat(60));

    // ── 1. BOQ version counts by status ───────────────────────────────────────
    const boqVersionCounts = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*) as count
      FROM boq_versions
      GROUP BY status
      ORDER BY status
    `;
    printSection(
      '1. BOQ Version Counts by Status',
      boqVersionCounts.map((r) => ({ status: r.status, count: Number(r.count) })),
    );

    // ── 2. Contracts not pointing to a SNAPSHOT boqVersionId ──────────────────
    const nonSnapshotContracts = await prisma.$queryRaw<
      Array<{ id: string; contract_number: string; boq_version_status: string | null }>
    >`
      SELECT c.id, c.contract_number, bv.status as boq_version_status
      FROM contracts c
      LEFT JOIN boq_versions bv ON bv.id = c.boq_version_id
      WHERE bv.status IS NULL OR bv.status != 'SNAPSHOT'
      ORDER BY c.created_at DESC
    `;
    printSection('2. Contracts With Non-SNAPSHOT BOQ Version (legacy reference)', {
      count: nonSnapshotContracts.length,
      flag: flag('contracts with non-SNAPSHOT BOQ reference', nonSnapshotContracts.length),
      rows: nonSnapshotContracts,
    });

    // ── 3. Contracts with billingModel = MEASURED_IPC ─────────────────────────
    const measuredIpcContracts = await prisma.$queryRaw<
      Array<{ id: string; contract_number: string; billing_model: string }>
    >`
      SELECT id, contract_number, billing_model
      FROM contracts
      WHERE billing_model = 'MEASURED_IPC'
      ORDER BY created_at DESC
    `;
    printSection('3. MEASURED_IPC Contracts (should be 0 for ACCO)', {
      count: measuredIpcContracts.length,
      flag: flag('MEASURED_IPC contracts', measuredIpcContracts.length),
      rows: measuredIpcContracts,
    });

    // ── 4. Invoice state distribution ─────────────────────────────────────────
    const invoiceStateCounts = await prisma.$queryRaw<
      Array<{ document_status: string; posting_status: string; count: bigint }>
    >`
      SELECT document_status, posting_status, COUNT(*) as count
      FROM client_invoices
      GROUP BY document_status, posting_status
      ORDER BY document_status, posting_status
    `;
    printSection(
      '4. Invoice State Distribution',
      invoiceStateCounts.map((r) => ({
        documentStatus: r.document_status,
        postingStatus: r.posting_status,
        count: Number(r.count),
      })),
    );

    // ── 5. Invoices with null dueDate ─────────────────────────────────────────
    const nullDueDateInvoices = await prisma.$queryRaw<
      Array<{ id: string; invoice_number: string | null; document_status: string }>
    >`
      SELECT id, invoice_number, document_status
      FROM client_invoices
      WHERE due_date IS NULL
        AND document_status NOT IN ('CANCELLED', 'DRAFT')
      ORDER BY created_at DESC
    `;
    printSection('5. Posted Invoices With Null dueDate', {
      count: nullDueDateInvoices.length,
      flag: flag('invoices missing due date', nullDueDateInvoices.length),
      rows: nullDueDateInvoices,
    });

    // ── 6. Invoices never delivered (no PackageDelivery) but status ≥ NOT_POSTED ─
    const neverDeliveredInvoices = await prisma.$queryRaw<
      Array<{ id: string; invoice_number: string | null; document_status: string }>
    >`
      SELECT ci.id, ci.invoice_number, ci.document_status
      FROM client_invoices ci
      WHERE ci.posting_status = 'POSTED'
        AND ci.document_status NOT IN ('CANCELLED')
        AND NOT EXISTS (
          SELECT 1 FROM client_invoice_deliveries pd
          WHERE pd.invoice_id = ci.id
        )
      ORDER BY ci.created_at DESC
    `;
    printSection('6. Issued Invoices With No Delivery Record', {
      count: neverDeliveredInvoices.length,
      flag: flag('invoices issued but never delivered', neverDeliveredInvoices.length),
      rows: neverDeliveredInvoices,
    });

    // ── 7. Overdue invoices (past dueDate, not paid) ───────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const overdueInvoices = await prisma.$queryRaw<
      Array<{
        id: string;
        invoice_number: string | null;
        total_amount: string;
        outstanding_amount: string;
        due_date: Date;
        days_overdue: number;
      }>
    >`
      SELECT
        id,
        invoice_number,
        total_amount::text,
        outstanding_amount::text,
        due_date,
        (CURRENT_DATE - due_date::date)::int as days_overdue
      FROM client_invoices
      WHERE due_date < CURRENT_DATE
        AND document_status NOT IN ('CANCELLED')
        AND outstanding_amount > 0
      ORDER BY days_overdue DESC
    `;
    printSection('7. Overdue Invoices', {
      count: overdueInvoices.length,
      flag: flag('overdue invoices', overdueInvoices.length),
      asOf: today,
      rows: overdueInvoices.map((r) => ({
        ...r,
        due_date: r.due_date?.toISOString().slice(0, 10),
      })),
    });

    // ── 8. Extra work nodes by commercial_treatment (source_type = VARIATION) ──
    const extraWorkCounts = await prisma.$queryRaw<
      Array<{ commercial_treatment: string; is_active: boolean; count: bigint }>
    >`
      SELECT commercial_treatment, is_active, COUNT(*) as count
      FROM boq_nodes
      WHERE source_type = 'VARIATION'
      GROUP BY commercial_treatment, is_active
      ORDER BY commercial_treatment, is_active DESC
    `;
    printSection(
      '8. Extra Work BOQ Nodes by Type',
      extraWorkCounts.map((r) => ({
        commercialTreatment: r.commercial_treatment,
        isActive: r.is_active,
        count: Number(r.count),
      })),
    );

    // ── 9. ABSORBED variation nodes created before variation-collapse ──────────
    const COLLAPSE_DATE = new Date('2026-09-15T00:00:00Z');
    const preCollapseAbsorbed = await prisma.$queryRaw<
      Array<{ id: string; created_at: Date; project_id: string }>
    >`
      SELECT bn.id, bn.created_at, b.project_id
      FROM boq_nodes bn
      JOIN boqs b ON b.id = bn.boq_id
      WHERE bn.commercial_treatment = 'ABSORBED'
        AND bn.source_type = 'VARIATION'
        AND bn.created_at < ${COLLAPSE_DATE}
      ORDER BY bn.created_at DESC
    `;
    printSection('9. Pre-Collapse ABSORBED Nodes (created before 2026-09-15)', {
      count: preCollapseAbsorbed.length,
      note: 'These nodes used old ABSORB semantics. Review manually — no auto-convert.',
      rows: preCollapseAbsorbed.map((r) => ({
        ...r,
        created_at: r.created_at?.toISOString().slice(0, 10),
      })),
    });

    // ── 10. Receipt allocation integrity (over-allocated) ─────────────────────
    const overAllocatedInvoices = await prisma.$queryRaw<
      Array<{
        invoice_id: string;
        invoice_number: string | null;
        total_amount: string;
        sum_allocated: string;
      }>
    >`
      SELECT
        ci.id as invoice_id,
        ci.invoice_number,
        ci.total_amount::text,
        SUM(ia.allocated_amount)::text as sum_allocated
      FROM client_invoices ci
      JOIN client_receipt_allocations ia ON ia.client_invoice_id = ci.id
      GROUP BY ci.id, ci.invoice_number, ci.total_amount
      HAVING SUM(ia.allocated_amount) > ci.total_amount + 0.01
    `;
    printSection('10. Over-Allocated Invoices (integrity violation)', {
      count: overAllocatedInvoices.length,
      flag: flag('over-allocated invoices', overAllocatedInvoices.length),
      rows: overAllocatedInvoices,
    });

    // ── 11. Unallocated receipts ───────────────────────────────────────────────
    const unallocatedReceipts = await prisma.$queryRaw<
      Array<{ id: string; receipt_date: Date; total_amount: string; currency_code: string }>
    >`
      SELECT pr.id, pr.receipt_date, pr.total_amount::text, pr.currency_code
      FROM payment_receipts pr
      WHERE NOT EXISTS (
        SELECT 1 FROM client_receipt_allocations ia WHERE ia.payment_receipt_id = pr.id
      )
      ORDER BY pr.receipt_date DESC
    `;
    printSection('11. Unallocated Receipts (no allocation lines)', {
      count: unallocatedReceipts.length,
      note: 'Unallocated receipts are valid (unapplied receipts); review if unexpected.',
      rows: unallocatedReceipts.map((r) => ({
        ...r,
        receipt_date: r.receipt_date?.toISOString().slice(0, 10),
      })),
    });

    // ── 12. Orphan VariationBillingAllocation rows ─────────────────────────────
    const orphanAllocations = await prisma.$queryRaw<
      Array<{ id: string; variation_id: string; installment_id: string }>
    >`
      SELECT vba.id, vba.variation_id, vba.installment_id
      FROM variation_billing_allocations vba
      JOIN boq_nodes bn ON bn.id = vba.variation_id
      WHERE bn.is_active = false
    `;
    printSection('12. Orphan VariationBillingAllocations (variation node inactive)', {
      count: orphanAllocations.length,
      flag: flag('orphan variation billing allocations', orphanAllocations.length),
      note: 'These point to reversed/inactive variation nodes. Safe if the linked invoice was also reversed.',
      rows: orphanAllocations,
    });

    // ── Summary ────────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(flag('non-SNAPSHOT BOQ contract refs', nonSnapshotContracts.length));
    console.log(flag('MEASURED_IPC contracts', measuredIpcContracts.length));
    console.log(flag('invoices missing due date', nullDueDateInvoices.length));
    console.log(flag('overdue invoices', overdueInvoices.length));
    console.log(flag('over-allocated invoices', overAllocatedInvoices.length));
    console.log(flag('orphan variation billing allocations', orphanAllocations.length));
    console.log('');

    const blockers = [
      overAllocatedInvoices.length,
      orphanAllocations.length,
    ].reduce((a, b) => a + b, 0);

    if (blockers > 0) {
      console.log(`⛔  ${blockers} INTEGRITY ISSUE(S) FOUND — review before deploying.`);
    } else {
      console.log('✅  No integrity issues found. Data is consistent.');
    }
    console.log('');
  } finally {
    await platform.$disconnect();
    await prisma?.$disconnect();
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
