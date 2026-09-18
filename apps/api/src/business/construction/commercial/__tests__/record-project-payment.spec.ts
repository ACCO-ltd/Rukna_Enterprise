import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { IAccountingPostingPort } from '../../../accounting/accounting-core/application/ports/accounting-posting.port.js';
import { AccountRepository } from '../../../accounting/accounting-core/infrastructure/account.repository.js';
import { PostingAccountResolver } from '../../../accounting/accounting-core/application/posting-account-resolver.service.js';
import { PaymentReceiptArRepository } from '../../../accounting/accounts-receivable/infrastructure/payment-receipt-ar.repository.js';
import { ClientInvoiceRepository } from '../../../accounting/accounts-receivable/infrastructure/client-invoice.repository.js';
import { CustomerReceiptService } from '../../../accounting/accounts-receivable/application/customer-receipt.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';
import {
  AccountingFixtureFactory,
  type AccountingTestEnv,
} from '../../../accounting/__tests__/helpers/fixture.factory.js';
import { buildServices } from '../../../accounting/__tests__/helpers/build-services.js';

/**
 * Slice 5B — record-project-payment: end-to-end DB proof for
 * `CommercialBillingService.recordProjectPayment()` and `getDepositAccounts()`.
 *
 * Uses a real PrismaClient + AccountingFixtureFactory (accounts, periods, sequences,
 * bank account) so the GL journal (EVT-AR-003) is actually posted to the database.
 *
 * Scenarios (17 total):
 *   RPP-01 Full payment  — invoice outstanding → 0
 *   RPP-02 Partial       — outstanding decremented, not zero
 *   RPP-03 Multi-invoice — two invoices, both allocated
 *   RPP-04 Unallocated   — Σ allocated < receipt → unallocatedAmount > 0
 *   RPP-05 Unapplied     — allocations: [], fully unapplied receipt
 *   RPP-06 Bad bank      — bankAccountId not found → NotFoundException
 *   RPP-07 No receipts   — bank.allowsReceipts = false → BadRequestException
 *   RPP-08 Closed bank   — bank.status = CLOSED → BadRequestException
 *   RPP-09 Wrong project — invoice belongs to a different project → NotFoundException
 *   RPP-10 Not posted    — invoice postingStatus = NOT_POSTED → BadRequestException
 *   RPP-11 Zero balance  — invoice outstandingAmount = 0 → BadRequestException
 *   RPP-12 Over-allocate — alloc.amount > invoice outstanding → BadRequestException
 *   RPP-13 Alloc > total — Σ allocations > receipt amount → BadRequestException
 *   RPP-14 Currency mismatch — invoice currency ≠ receipt currency → BadRequestException
 *   RPP-15 No contract   — project has no active contract → BadRequestException
 *   RPP-16 Atomicity     — GL posting failure → receipt NOT committed, outstanding unchanged
 *   RPP-17 getDepositAccounts — returns ACTIVE+allowsReceipts, omits closed/no-receipts
 */
describe('CommercialBillingService.recordProjectPayment (Slice 5B)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);

  let env: AccountingTestEnv;
  let service: CommercialBillingService;
  let failingService: CommercialBillingService; // RPP-16 only — GL posting throws
  let identity: RequestIdentity;

  // Entities created in seed()
  let projectId: string;
  let contractId: string;
  let noContractProjectId: string; // RPP-15: project with no active contract

  // Each bank account requires its own unique GL account (unique constraint on gl_account_id).
  // This helper creates a fresh CASH_AND_BANK GL account and returns its id.
  async function makeBankGlAccount(code: string): Promise<string> {
    const id = `${env.orgId}-${code}`;
    await prisma.account.create({
      data: { id, organizationId: env.orgId, code, normalBalance: 'DEBIT' as never, createdBy: 'u1' },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: id, versionNumber: 1, name: `${code} Account`,
        accountClass: 'ASSET' as never, accountSubtype: 'CASH_AND_BANK' as never,
        isPostingAllowed: true, isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED' as never, controlledSubledgerType: null,
        effectiveFrom: new Date('2025-01-01'), effectiveTo: null, changedBy: 'u1',
      },
    });
    return id;
  }

  // Re-usable invoice helpers
  async function makePostedInvoice(opts: {
    totalAmount: string;
    currencyCode?: string;
    outstandingAmount?: string;
    projectIdOverride?: string | null;
  }): Promise<{ id: string }> {
    const total = opts.totalAmount;
    const outstanding = opts.outstandingAmount ?? total;
    return prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId: opts.projectIdOverride === undefined ? projectId : opts.projectIdOverride,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        subtotal: new Decimal(total),
        vatAmount: new Decimal('0'),
        totalAmount: new Decimal(total),
        outstandingAmount: new Decimal(outstanding),
        currencyCode: opts.currencyCode ?? 'USD',
        billingAddressSnapshot: {},
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        postedAt: new Date(),
        postedBy: 'u1',
        createdBy: 'u1',
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    env = await AccountingFixtureFactory.create(prisma);
    const services = buildServices(prisma);

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertMember: async () => undefined,
      assertContract: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = {
      record: async () => undefined,
    } as unknown as TransactionalAuditOutboxService;

    service = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      {} as never,
      {} as never,
      {} as never,
      services.customerReceiptService,
      auditOutbox,
    );

    // RPP-16: same service but with a posting port that throws inside the transaction
    const failingPostingPort = {
      post: async () => { throw new Error('Simulated GL failure — roll back'); },
    } as unknown as IAccountingPostingPort;
    const failingReceiptService = new CustomerReceiptService(
      tenancy,
      new PaymentReceiptArRepository(),
      new ClientInvoiceRepository(),
      new AccountRepository(),
      new PostingAccountResolver(new AccountRepository()),
      failingPostingPort,
    );
    failingService = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      {} as never,
      {} as never,
      {} as never,
      failingReceiptService,
      auditOutbox,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: env.orgId,
      tenantSlug: env.identity.tenantSlug,
      roles: ['ADMIN'],
      permissions: [
        PERMISSIONS.contractsView,
        PERMISSIONS.receivablesManage,
        PERMISSIONS.financialPositionView,
      ],
    };

    await seed();
  });

  async function seed() {
    // ── Project A (has active contract) ──────────────────────────────────────
    const project = await prisma.project.create({
      data: {
        organizationId: env.orgId,
        code: `PAY-${suffix.slice(-6)}`,
        name: 'Payment Test Project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: 'u1',
      },
    });
    projectId = project.id;

    const boq = await prisma.boq.create({
      data: { organizationId: env.orgId, projectId: project.id },
    });
    const boqVersion = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: env.orgId,
        projectId: project.id,
        clientId: env.clientId,
        boqVersionId: boqVersion.id,
        contractNumber: `CT-PAY-${suffix.slice(-6)}`,
        contractValue: new Decimal('500000'),
        baseContractValue: new Decimal('500000'),
        currency: 'USD',
        status: 'ACTIVE',
        billingModel: 'MILESTONE',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;

    // ── Project B (no contract) for RPP-15 ───────────────────────────────────
    const noContractProject = await prisma.project.create({
      data: {
        organizationId: env.orgId,
        code: `NC-${suffix.slice(-6)}`,
        name: 'No-contract Project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: 'u1',
      },
    });
    noContractProjectId = noContractProject.id;
  }

  afterAll(async () => {
    await AccountingFixtureFactory.cleanup(prisma, env.orgId);
    await prisma.$disconnect();
  });

  // ─── RPP-01: Full payment ──────────────────────────────────────────────────

  it('RPP-01: full-payment receipt → invoice outstanding becomes 0, result correct', async () => {
    const inv = await makePostedInvoice({ totalAmount: '40000' });

    const result = await service.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2026-09-17',
      amount: '40000.00',
      currency: 'USD',
      allocations: [{ clientInvoiceId: inv.id, amount: 40000 }],
    });

    expect(result.amount).toBe('40000.00');
    expect(result.unallocatedAmount).toBe('0.00');
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].invoiceId).toBe(inv.id);
    expect(result.allocations[0].allocatedAmount).toBe('40000.00');

    const afterInv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(afterInv.outstandingAmount.toFixed(2)).toBe('0.00');

    const receipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: result.receiptId } });
    expect(receipt.postingStatus).toBe('POSTED');
    expect(receipt.allocatedAmount.toFixed(2)).toBe('40000.00');
    expect(receipt.unallocatedAmount.toFixed(2)).toBe('0.00');
  });

  // ─── RPP-02: Partial payment ───────────────────────────────────────────────

  it('RPP-02: partial payment → outstanding decremented but not zero', async () => {
    const inv = await makePostedInvoice({ totalAmount: '50000' });

    const result = await service.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2026-09-17',
      amount: '20000.00',
      currency: 'USD',
      allocations: [{ clientInvoiceId: inv.id, amount: 20000 }],
    });

    expect(result.unallocatedAmount).toBe('0.00');

    const afterInv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(afterInv.outstandingAmount.toFixed(2)).toBe('30000.00');
  });

  // ─── RPP-03: Multi-invoice allocation ─────────────────────────────────────

  it('RPP-03: multi-invoice allocation → both invoices partially settled', async () => {
    const inv1 = await makePostedInvoice({ totalAmount: '30000' });
    const inv2 = await makePostedInvoice({ totalAmount: '25000' });

    const result = await service.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2026-09-17',
      amount: '45000.00',
      currency: 'USD',
      allocations: [
        { clientInvoiceId: inv1.id, amount: 30000 },
        { clientInvoiceId: inv2.id, amount: 15000 },
      ],
    });

    expect(result.unallocatedAmount).toBe('0.00');
    expect(result.allocations).toHaveLength(2);

    const afterInv1 = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv1.id } });
    expect(afterInv1.outstandingAmount.toFixed(2)).toBe('0.00');

    const afterInv2 = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv2.id } });
    expect(afterInv2.outstandingAmount.toFixed(2)).toBe('10000.00');
  });

  // ─── RPP-04: Unallocated remainder ────────────────────────────────────────

  it('RPP-04: receipt > Σ outstanding → correct unallocatedAmount', async () => {
    const inv = await makePostedInvoice({ totalAmount: '20000' });

    const result = await service.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2026-09-17',
      amount: '35000.00',
      currency: 'USD',
      allocations: [{ clientInvoiceId: inv.id, amount: 20000 }],
    });

    expect(result.unallocatedAmount).toBe('15000.00');
    expect(result.amount).toBe('35000.00');

    const receipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: result.receiptId } });
    expect(receipt.unallocatedAmount.toFixed(2)).toBe('15000.00');
  });

  // ─── RPP-05: Fully unapplied receipt ──────────────────────────────────────

  it('RPP-05: allocations:[] → receipt fully unapplied, no allocation rows', async () => {
    const result = await service.recordProjectPayment(identity, projectId, {
      bankAccountId: env.bankAccountId,
      receiptDate: '2026-09-17',
      amount: '10000.00',
      currency: 'USD',
      allocations: [],
    });

    expect(result.unallocatedAmount).toBe('10000.00');
    expect(result.allocations).toHaveLength(0);

    const allocCount = await prisma.clientReceiptAllocation.count({
      where: { paymentReceiptId: result.receiptId },
    });
    expect(allocCount).toBe(0);
  });

  // ─── RPP-06: Bank account not found ───────────────────────────────────────

  it('RPP-06: unknown bankAccountId → NotFoundException', async () => {
    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: 'nonexistent-bank-id',
        receiptDate: '2026-09-17',
        amount: '5000.00',
        currency: 'USD',
        allocations: [],
      }),
    ).rejects.toThrow('not found');
  });

  // ─── RPP-07: allowsReceipts = false ───────────────────────────────────────

  it('RPP-07: bank with allowsReceipts:false → BadRequestException', async () => {
    const glId07 = await makeBankGlAccount(`BNK-07-${suffix.slice(-6)}`);
    const paymentOnlyBank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: glId07,
        bankName: 'Payments Only Bank',
        accountName: 'Payments',
        accountNumber: `POB-${suffix.slice(-6)}`,
        currencyCode: 'USD',
        allowsReceipts: false,
        allowsPayments: true,
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: paymentOnlyBank.id,
        receiptDate: '2026-09-17',
        amount: '5000.00',
        currency: 'USD',
        allocations: [],
      }),
    ).rejects.toThrow('does not allow receipts');
  });

  // ─── RPP-08: Bank account CLOSED ──────────────────────────────────────────

  it('RPP-08: bank.status=CLOSED → BadRequestException', async () => {
    const glId08 = await makeBankGlAccount(`BNK-08-${suffix.slice(-6)}`);
    const closedBank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: glId08,
        bankName: 'Closed Bank',
        accountName: 'Closed',
        accountNumber: `CLB-${suffix.slice(-6)}`,
        currencyCode: 'USD',
        allowsReceipts: true,
        status: 'CLOSED',
        createdBy: 'u1',
      },
    });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: closedBank.id,
        receiptDate: '2026-09-17',
        amount: '5000.00',
        currency: 'USD',
        allocations: [],
      }),
    ).rejects.toThrow('CLOSED');
  });

  // ─── RPP-09: Invoice belongs to a different project ───────────────────────

  it('RPP-09: invoice not on this project → NotFoundException', async () => {
    // projectId: null (belongs to no project — not found when queried with our projectId)
    const orphanInv = await makePostedInvoice({
      totalAmount: '10000',
      projectIdOverride: null,
    });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '10000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: orphanInv.id, amount: 10000 }],
      }),
    ).rejects.toThrow('not found');
  });

  // ─── RPP-10: Invoice not POSTED ───────────────────────────────────────────

  it('RPP-10: invoice.postingStatus=NOT_POSTED → BadRequestException', async () => {
    const draftInv = await prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        subtotal: new Decimal('10000'),
        vatAmount: new Decimal('0'),
        totalAmount: new Decimal('10000'),
        outstandingAmount: new Decimal('10000'),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: 'u1',
      },
      select: { id: true },
    });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '10000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: draftInv.id, amount: 10000 }],
      }),
    ).rejects.toThrow('POSTED');
  });

  // ─── RPP-11: Invoice outstanding = 0 ──────────────────────────────────────

  it('RPP-11: invoice.outstandingAmount=0 → BadRequestException', async () => {
    const paidInv = await makePostedInvoice({
      totalAmount: '10000',
      outstandingAmount: '0',
    });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '10000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: paidInv.id, amount: 10000 }],
      }),
    ).rejects.toThrow('no outstanding balance');
  });

  // ─── RPP-12: Allocation > invoice outstanding ──────────────────────────────

  it('RPP-12: allocation amount > invoice outstanding → BadRequestException', async () => {
    const inv = await makePostedInvoice({ totalAmount: '10000', outstandingAmount: '5000' });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '8000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: inv.id, amount: 8000 }],
      }),
    ).rejects.toThrow('exceeds');
  });

  // ─── RPP-13: Σ allocations > receipt amount ───────────────────────────────

  it('RPP-13: Σ allocations > receipt amount → BadRequestException (caught before per-invoice check)', async () => {
    const inv1 = await makePostedInvoice({ totalAmount: '50000' });
    const inv2 = await makePostedInvoice({ totalAmount: '50000' });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '80000.00',
        currency: 'USD',
        allocations: [
          { clientInvoiceId: inv1.id, amount: 50000 },
          { clientInvoiceId: inv2.id, amount: 50000 },
        ],
      }),
    ).rejects.toThrow('exceed receipt amount');
  });

  // ─── RPP-14: Currency mismatch ────────────────────────────────────────────

  it('RPP-14: invoice currency (SAR) ≠ receipt currency (USD) → BadRequestException', async () => {
    const sarInv = await makePostedInvoice({ totalAmount: '10000', currencyCode: 'SAR' });

    await expect(
      service.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '10000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: sarInv.id, amount: 10000 }],
      }),
    ).rejects.toThrow('Currency mismatch');
  });

  // ─── RPP-15: No active contract ───────────────────────────────────────────

  it('RPP-15: project with no active contract → BadRequestException', async () => {
    await expect(
      service.recordProjectPayment(identity, noContractProjectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '5000.00',
        currency: 'USD',
        allocations: [],
      }),
    ).rejects.toThrow('no active contract');
  });

  // ─── RPP-16: Atomicity — GL failure rolls back receipt ────────────────────

  it('RPP-16: GL posting failure → receipt NOT committed, invoice outstanding unchanged', async () => {
    const inv = await makePostedInvoice({ totalAmount: '15000' });
    const beforeOutstanding = '15000.00';

    await expect(
      failingService.recordProjectPayment(identity, projectId, {
        bankAccountId: env.bankAccountId,
        receiptDate: '2026-09-17',
        amount: '15000.00',
        currency: 'USD',
        allocations: [{ clientInvoiceId: inv.id, amount: 15000 }],
      }),
    ).rejects.toThrow('Simulated GL failure');

    // No receipt row persisted
    const receiptCount = await prisma.paymentReceipt.count({
      where: { organizationId: env.orgId, clientId: env.clientId, totalAmount: new Decimal('15000') },
    });
    expect(receiptCount).toBe(0);

    // Invoice outstanding unchanged
    const afterInv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(afterInv.outstandingAmount.toFixed(2)).toBe(beforeOutstanding);
  });

  // ─── RPP-17: getDepositAccounts ───────────────────────────────────────────

  it('RPP-17: getDepositAccounts returns only ACTIVE+allowsReceipts accounts', async () => {
    // Create extra accounts to verify filtering
    const glId17a = await makeBankGlAccount(`BNK-17A-${suffix.slice(-6)}`);
    const closedBank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: glId17a,
        bankName: 'A Closed Bank',
        accountName: 'Closed',
        accountNumber: `DA-CLB-${suffix.slice(-6)}`,
        currencyCode: 'USD',
        allowsReceipts: true,
        status: 'CLOSED',
        createdBy: 'u1',
      },
    });
    const glId17b = await makeBankGlAccount(`BNK-17B-${suffix.slice(-6)}`);
    const noReceiptsBank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: glId17b,
        bankName: 'Z No-Receipts Bank',
        accountName: 'No Receipts',
        accountNumber: `DA-NRB-${suffix.slice(-6)}`,
        currencyCode: 'USD',
        allowsReceipts: false,
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });

    const accounts = await service.getDepositAccounts(identity, projectId);

    const ids = accounts.map((a) => a.id);
    expect(ids).not.toContain(closedBank.id);
    expect(ids).not.toContain(noReceiptsBank.id);
    // The factory bank is ACTIVE + allowsReceipts:true — must appear
    expect(ids).toContain(env.bankAccountId);

    for (const a of accounts) {
      expect(a.id).toBeTruthy();
      expect(a.bankName).toBeTruthy();
      expect(a.accountNumber).toBeTruthy();
      expect(a.currencyCode).toBeTruthy();
    }
  });
});
