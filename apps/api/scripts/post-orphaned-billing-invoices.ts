#!/usr/bin/env tsx
/**
 * Post Orphaned Billing-Package Invoices — retired-billStage cleanup
 *
 * The two-step "Bill this stage" command (`billStage`) has been retired: it allocated a
 * variation's billing (or created the milestone invoice) as DRAFT and left posting for later.
 * `issuePackage` — the only billing command now — treats a VO whose billing allocation is
 * already fully realized as "already done" and skips it, so a VO invoice `billStage` allocated
 * but never posted is permanently excluded from ever being posted again. The milestone invoice
 * has the same shape of exposure: `issuePackage` always re-processes it, but only when the
 * installment is billed again — an installment invoiced once via `billStage` and never revisited
 * stays DRAFT forever, with `invoiceNumber: null`, exactly matching the "Number pending — cannot
 * be sent" banner in the Send-to-client flow.
 *
 * Under `issuePackage`-only operation, creating and posting always happen in the SAME
 * transaction — so any persisted ClientInvoice that is (a) not POSTED and (b) either carries a
 * `sourceInstallmentId` or is the target of a `VariationBillingAllocation` (treatment INVOICE)
 * can only be a `billStage`-era straggler. That is this script's exact targeting rule. It never
 * touches invoices from the unrelated Accounting "Client Invoices" ad-hoc draft flow, which do
 * not carry either marker.
 *
 * This calls the REAL `ClientInvoiceService.approve()` + `.post()` — the same business logic
 * `issuePackage` uses (real GL account resolution by role, real double-entry validation, real
 * INV-xxxx sequence draw) — rather than hand-writing SQL, so a fixed invoice is indistinguishable
 * from one `issuePackage` posted itself.
 *
 * Usage:
 *   # 1. Discover candidates (always safe — read-only, no --invoice-id needed):
 *   pnpm tsx scripts/post-orphaned-billing-invoices.ts --slug=acco
 *
 *   # 2. Dry-run a specific invoice (still no writes — shows the accounts it would resolve):
 *   pnpm tsx scripts/post-orphaned-billing-invoices.ts --slug=acco --invoice-id=<id>
 *
 *   # 3. Actually approve + post it (requires --apply and --actor together):
 *   pnpm tsx scripts/post-orphaned-billing-invoices.ts --slug=acco --invoice-id=<id> \
 *     --actor=<userId> --apply
 *
 * --invoice-id may repeat to fix several in one run. Each invoice is approved + posted inside
 * its own transaction (matching `issuePackage`'s one-package-at-a-time atomicity) — one failing
 * does not roll back the others.
 *
 * --org-id=<id> picks the organization when a tenant database holds more than one (a leftover
 * local-dev-only situation from shared test fixtures — a real tenant database holds exactly one).
 */

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import type { PrismaClient as TenantPrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../src/platform/tenancy/tenancy.service.js';
import type { InvoiceDocumentService } from '../src/business/accounting/accounts-receivable/application/invoice-document.service.js';
import type { PlatformFileService } from '../src/platform/files/application/platform-file.service.js';
import { ClientInvoiceRepository } from '../src/business/accounting/accounts-receivable/infrastructure/client-invoice.repository.js';
import { ClientInvoiceService } from '../src/business/accounting/accounts-receivable/application/client-invoice.service.js';
import { AccountRepository } from '../src/business/accounting/accounting-core/infrastructure/account.repository.js';
import { PostingAccountResolver } from '../src/business/accounting/accounting-core/application/posting-account-resolver.service.js';
import { DocumentSequenceRepository } from '../src/business/accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { JournalRepository } from '../src/business/accounting/accounting-core/infrastructure/journal.repository.js';
import { AccountingPostingService } from '../src/business/accounting/accounting-core/infrastructure/accounting-posting.service.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    'invoice-id': { type: 'string', multiple: true },
    actor: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'org-id': { type: 'string' },
  },
});

const slug = values.slug;
const invoiceIds = values['invoice-id'] ?? [];
const actor = values.actor;
const apply = values.apply === true;
const orgIdOverride = values['org-id'];
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!slug || !platformDatabaseUrl) {
  console.error(
    'Usage: pnpm tsx scripts/post-orphaned-billing-invoices.ts --slug=acco [--invoice-id=<id> ...] [--actor=<userId> --apply]\n' +
      '       (PLATFORM_DATABASE_URL env var required)',
  );
  process.exit(1);
}
if (apply && (invoiceIds.length === 0 || !actor)) {
  console.error('--apply requires both --invoice-id (one or more) and --actor=<userId>.');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function section(title: string): void {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

interface Candidate {
  id: string;
  organization_id: string;
  project_id: string;
  contract_id: string | null;
  source_installment_id: string | null;
  document_status: string;
  posting_status: string;
  subtotal: string;
  vat_amount: string;
  total_amount: string;
  currency_code: string;
  invoice_date: Date;
  created_at: Date;
  origin: string;
}

async function findCandidates(prisma: TenantPrismaClient, orgId: string): Promise<Candidate[]> {
  return prisma.$queryRaw<Candidate[]>`
    SELECT
      ci.id,
      ci.organization_id,
      ci.project_id,
      ci.contract_id,
      ci.source_installment_id,
      ci.document_status,
      ci.posting_status,
      ci.subtotal::text,
      ci.vat_amount::text,
      ci.total_amount::text,
      ci.currency_code,
      ci.invoice_date,
      ci.created_at,
      CASE WHEN ci.source_installment_id IS NOT NULL THEN 'MILESTONE' ELSE 'VARIATION' END AS origin
    FROM client_invoices ci
    WHERE ci.organization_id = ${orgId}
      AND ci.posting_status != 'POSTED'
      AND (
        ci.source_installment_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM variation_billing_allocations vba
          WHERE vba.client_invoice_id = ci.id AND vba.treatment = 'INVOICE'
        )
      )
    ORDER BY ci.created_at ASC
  `;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({ datasources: { db: { url: platformDatabaseUrl } } });
  let prisma: TenantPrismaClient | undefined;

  try {
    const tenant = await platform.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, dbUrl: true },
    });
    if (!tenant) throw new Error(`Tenant '${slug}' not found`);

    prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });

    console.log(`\n${'═'.repeat(70)}`);
    console.log('  Post Orphaned Billing-Package Invoices');
    console.log(`  Tenant: ${tenant.slug} (${tenant.name})`);
    console.log(`  Mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (read-only)'}`);
    console.log('═'.repeat(70));

    // Resolve the org for this tenant — commercial data is single-org per tenant in this
    // deployment shape (C1: one PostgreSQL database per tenant client). A tenant DB shared with
    // leftover test fixtures (local dev only) can hold more than one — refuse to guess which.
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
    const org = orgIdOverride
      ? orgs.find((o) => o.id === orgIdOverride)
      : orgs.length === 1
        ? orgs[0]
        : undefined;
    if (!org) {
      console.error(
        orgs.length === 0
          ? `No organization found in tenant '${slug}'.`
          : `Tenant '${slug}' has ${orgs.length} organizations — pass --org-id to pick one:\n` +
            orgs.map((o) => `  ${o.id}  ${o.name}`).join('\n'),
      );
      process.exit(1);
    }

    const candidates = await findCandidates(prisma, org.id);

    section(`Candidates found: ${candidates.length}`);
    if (candidates.length === 0) {
      console.log('None. No billStage-era orphans in this tenant.');
    }
    for (const c of candidates) {
      console.log(
        `  [${c.origin}] ${c.id} — ${c.document_status}/${c.posting_status} — ` +
          `${c.currency_code} ${c.total_amount} — created ${c.created_at.toISOString().slice(0, 10)}` +
          (c.source_installment_id ? ` — installment ${c.source_installment_id}` : ''),
      );
    }

    if (invoiceIds.length === 0) {
      console.log('\nPass --invoice-id=<id> (from the list above) to dry-run or fix a specific invoice.');
      return;
    }

    // ── Wire the REAL posting stack — same collaborators issuePackage uses ────────
    const tenancy = { getClient: () => prisma! } as unknown as TenancyService;
    const documentService = {} as unknown as InvoiceDocumentService; // PDF is lazy-generated on read; not needed to post.
    const files = {} as unknown as PlatformFileService; // same — untouched by approve()/post().

    const resolver = new PostingAccountResolver(new AccountRepository());
    const sequenceRepo = new DocumentSequenceRepository();
    const postingPort = new AccountingPostingService(sequenceRepo, new JournalRepository());

    const clientInvoiceService = new ClientInvoiceService(
      tenancy,
      new ClientInvoiceRepository(),
      sequenceRepo,
      resolver,
      postingPort,
      documentService,
      files,
    );

    for (const invoiceId of invoiceIds) {
      const candidate = candidates.find((c) => c.id === invoiceId);
      section(`Invoice ${invoiceId}`);
      if (!candidate) {
        console.log(
          '  SKIPPED — not in the candidate list above. This script only acts on invoices that ' +
            'carry a sourceInstallmentId or a VariationBillingAllocation; it refuses to touch an ' +
            'unrelated (e.g. ad-hoc Accounting) draft invoice.',
        );
        continue;
      }
      console.log(`  ${candidate.origin} · ${candidate.currency_code} ${candidate.total_amount} · VAT ${candidate.vat_amount}`);

      if (!apply) {
        console.log('  DRY RUN — would approve() then post() this invoice. Re-run with --apply --actor=<userId> to write.');
        continue;
      }

      const identity: RequestIdentity = {
        userId: actor!,
        activeOrganizationId: org.id,
        tenantSlug: tenant.slug,
        roles: ['ADMIN'],
        permissions: [],
      };

      try {
        await prisma.$transaction(async (tx) => {
          await clientInvoiceService.approve(identity, invoiceId, tx);
          const result = await clientInvoiceService.post(identity, { invoiceId }, tx);
          console.log(
            `  POSTED — invoice number ${result.invoiceNumber}, journal entry ${result.journalEntryId}`,
          );
        });
      } catch (err) {
        console.log(`  FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await platform.$disconnect();
    await prisma?.$disconnect();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
