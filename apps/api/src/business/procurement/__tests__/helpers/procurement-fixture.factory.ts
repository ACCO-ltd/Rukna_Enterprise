/**
 * ProcurementFixtureFactory
 *
 * Creates an isolated test organisation with a minimal procurement environment:
 * UoM, MaterialCategory, SpendCategory, Material, Supplier, Project,
 * OverReceiptPolicy (5% org default), and accounting posting prerequisites.
 *
 * Each factory call uses a unique orgId — concurrent test suites never collide.
 * Call cleanup() in afterAll.
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

export interface ProcurementTestEnv {
  orgId: string;
  identity: RequestIdentity;
  supplierId: string;
  projectId: string;
  boqNodeId: string;
  uomId: string;
  materialCategoryId: string;
  spendCategoryId: string;
  materialId: string;
  // Accounting prerequisites for bill posting tests
  apAccountId: string;
  expAccountId: string;
  postingProfileCode: string;
  fiscalYearId: string;
  periodId: string;
}

export class ProcurementFixtureFactory {
  static async create(prisma: PrismaClient): Promise<ProcurementTestEnv> {
    const suffix = `p${Date.now().toString(36)}`;
    const orgId = `proc-org-${suffix}`;
    const userId = `${orgId}-user`;

    // ── Organization ──────────────────────────────────────────────────────────
    await prisma.organization.create({
      data: { id: orgId, name: `Procurement Test Org ${suffix}`, slug: `proc-${suffix}`, status: 'ACTIVE' },
    });

    await prisma.user.create({
      data: {
        id: userId,
        organizationId: orgId,
        email: `${userId}@example.test`,
        passwordHash: 'not-used-by-procurement-tests',
        firstName: 'Procurement',
        lastName: 'Tester',
        status: 'ACTIVE',
      },
    });

    const identity: RequestIdentity = {
      userId,
      activeOrganizationId: orgId,
      tenantSlug: `proc-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };

    // ── Supplier ──────────────────────────────────────────────────────────────
    const supplier = await prisma.supplier.create({
      data: { organizationId: orgId, code: 'SUP-001', name: 'Test Steel Co.', status: 'ACTIVE' },
    });

    // ── Project + BOQ ─────────────────────────────────────────────────────────
    const project = await prisma.project.create({
      data: {
        organizationId: orgId, code: 'PRJ-001', name: 'Test Site',
        status: 'ACTIVE', commercialModel: 'CLIENT_CONTRACT', participationModel: 'SOLE',
        createdBy: userId,
      },
    });
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        joinedBy: userId,
      },
    });

    const boq = await prisma.boq.create({ data: { projectId: project.id, organizationId: orgId } });
    const boqVersion = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });
    const boqNode = await prisma.boqNode.create({
      data: {
        boqId: boq.id, versionId: boqVersion.id, parentId: null,
        code: 'BN-001', path: 'BN-001', description: 'Foundation Works',
        quantity: new Decimal('100'), unit: 'M3', unitRate: new Decimal('500'),
        sortOrder: 1, isLeaf: true, sourceType: 'BASELINE',
      },
    });

    // ── Procurement master data ───────────────────────────────────────────────
    const uom = await prisma.unitOfMeasure.create({
      data: { organizationId: orgId, code: 'TON', name: 'Metric Ton', symbol: 't', status: 'ACTIVE' },
    });

    const matCat = await prisma.materialCategory.create({
      data: { organizationId: orgId, code: 'STEEL', name: 'Steel', status: 'ACTIVE' },
    });

    const spendCat = await prisma.spendCategory.create({
      data: { organizationId: orgId, code: 'DIRECT-MAT', name: 'Direct Material', status: 'ACTIVE' },
    });

    const material = await prisma.material.create({
      data: {
        organizationId: orgId, code: 'REBAR-12', name: '12mm Rebar',
        materialCategoryId: matCat.id, baseUnitOfMeasureId: uom.id,
        defaultSpendCategoryId: spendCat.id, status: 'ACTIVE',
      },
    });

    // ── OverReceiptPolicy — 5% org default (seeded per ADR-007, Decision 11) ──
    await prisma.overReceiptPolicy.create({
      data: {
        organizationId: orgId, scopeType: 'ORGANIZATION',
        overReceiptPercent: new Decimal('5'),
        effectiveFrom: new Date('2020-01-01'), status: 'ACTIVE',
      },
    });

    // ── Accounting prerequisites for bill posting tests ────────────────────────
    const mkAccount = async (code: string, nb: 'DEBIT' | 'CREDIT', cls: string, sub: string, ctrl = false) => {
      const acct = await prisma.account.create({
        data: { id: `${orgId}-${code}`, organizationId: orgId, code, normalBalance: nb as never, createdBy: userId },
      });
      await prisma.accountVersion.create({
        data: {
          accountId: acct.id, versionNumber: 1, name: `${code}`,
          accountClass: cls as never, accountSubtype: sub as never,
          isPostingAllowed: true, isControlAccount: ctrl,
          controlPostingPolicy: ctrl ? 'SYSTEM_ONLY' : 'UNRESTRICTED' as never,
          controlledSubledgerType: ctrl ? 'ACCOUNTS_PAYABLE' : null as never,
          effectiveFrom: new Date('2025-01-01'), effectiveTo: null, changedBy: userId,
        },
      });
      return acct.id;
    };

    const apAccountId  = await mkAccount('AP-PROC',  'CREDIT', 'LIABILITY', 'ACCOUNTS_PAYABLE', true);
    const expAccountId = await mkAccount('EXP-PROC', 'DEBIT',  'EXPENSE',   'ADMINISTRATIVE_EXPENSE');

    // Fiscal year + open period
    const fy = await prisma.fiscalYear.create({
      data: {
        organizationId: orgId, name: 'FY2026',
        startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
        retainedEarningsAccountId: expAccountId, // reuse for simplicity in tests
        status: 'OPEN', createdBy: userId,
      },
    });
    const period = await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId, fiscalYearId: fy.id,
        periodNumber: 8, name: 'August 2026',
        startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31'), status: 'OPEN',
      },
    });

    // Document sequences — JOURNAL_ENTRY required by AccountingPostingService, SUPPLIER_BILL by AP
    for (const seq of [
      { documentType: 'JOURNAL_ENTRY',  prefix: 'JE-',   paddingLength: 6 },
      { documentType: 'SUPPLIER_BILL',  prefix: 'BILL-', paddingLength: 6 },
    ] as const) {
      await prisma.documentNumberSequence.create({
        data: {
          organizationId: orgId, documentType: seq.documentType as never,
          journalCategory: null, prefix: seq.prefix,
          nextNumber: 1, paddingLength: seq.paddingLength, status: 'ACTIVE',
        },
      });
    }

    // PostingProfile for expense lines
    const profileCode = 'DIRECT-EXPENSE';
    const profile = await prisma.postingProfile.create({
      data: { organizationId: orgId, code: profileCode, status: 'ACTIVE', createdBy: userId },
    });
    await prisma.postingProfileVersion.create({
      data: {
        postingProfileId: profile.id, versionNumber: 1, name: 'Direct Expense',
        accountId: expAccountId, effectiveFrom: new Date('2026-01-01'), changedBy: userId,
      },
    });

    return {
      orgId, identity, supplierId: supplier.id, projectId: project.id, boqNodeId: boqNode.id,
      uomId: uom.id, materialCategoryId: matCat.id, spendCategoryId: spendCat.id, materialId: material.id,
      apAccountId, expAccountId, postingProfileCode: profileCode,
      fiscalYearId: fy.id, periodId: period.id,
    };
  }

  static async cleanup(prisma: PrismaClient, orgId: string): Promise<void> {
    // Delete in FK-safe order — procurement tables then shared tables
    await prisma.$executeRaw`DELETE FROM commitment_ledger_entries WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM supplier_bill_match_lines
      WHERE supplier_bill_match_id IN (SELECT id FROM supplier_bill_matches WHERE supplier_bill_id IN (SELECT id FROM supplier_bills WHERE organization_id = ${orgId}))`;
    await prisma.$executeRaw`DELETE FROM supplier_bill_matches WHERE supplier_bill_id IN (SELECT id FROM supplier_bills WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM goods_receipt_line_allocations WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM goods_receipt_lines
      WHERE goods_receipt_note_id IN (SELECT id FROM goods_receipt_notes WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM goods_receipt_notes WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM purchase_order_line_request_allocations WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM purchase_order_lines
      WHERE purchase_order_revision_id IN (SELECT id FROM purchase_order_revisions WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE organization_id = ${orgId}))`;
    await prisma.$executeRaw`DELETE FROM purchase_order_revisions WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM purchase_orders WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM material_request_lines
      WHERE material_request_id IN (SELECT id FROM material_requests WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM material_requests WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM materials WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM material_categories WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM spend_categories WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM units_of_measure WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM over_receipt_policies WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM matching_tolerance_policies WHERE organization_id = ${orgId}`;

    // Accounting cleanup
    await prisma.$executeRaw`UPDATE journal_entries SET status = 'DRAFT' WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM journal_entries WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM supplier_payment_allocations WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM supplier_bill_lines WHERE supplier_bill_id IN (SELECT id FROM supplier_bills WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM supplier_bills WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM document_number_sequences WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM accounting_periods WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM fiscal_years WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM posting_profile_versions WHERE posting_profile_id IN (SELECT id FROM posting_profiles WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM posting_profiles WHERE organization_id = ${orgId}`;

    // Construction chain
    await prisma.$executeRaw`DELETE FROM boq_nodes WHERE version_id IN (SELECT bv.id FROM boq_versions bv JOIN boqs b ON bv.boq_id = b.id JOIN projects p ON b.project_id = p.id WHERE p.organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM boq_versions WHERE boq_id IN (SELECT b.id FROM boqs b JOIN projects p ON b.project_id = p.id WHERE p.organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM boqs WHERE project_id IN (SELECT id FROM projects WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM projects WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM account_versions WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = ${orgId})`;
    await prisma.$executeRaw`DELETE FROM accounts WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM suppliers WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM users WHERE organization_id = ${orgId}`;
    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  }
}
