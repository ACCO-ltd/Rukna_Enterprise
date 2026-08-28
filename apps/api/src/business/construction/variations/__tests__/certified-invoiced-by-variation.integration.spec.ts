import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { VariationOrderPrismaRepository } from '../infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from '../application/variation-order.service.js';

/**
 * ADR-026 CONST-VAR-008 (Variations Phase 3) — live-DB proof of the certified-&-invoiced-by-variation
 * read model. It rides the existing join `IpcItem.certifiedAmount → applicationItem(IpaItem).boqNodeId
 * → BoqNode.sourceChangeOrderId → VariationOrder` — no column is threaded onto IPA/IPC/Invoice.
 *
 * Fixture (one contract): a BASELINE BOQ leaf + a VARIATION leaf tagged to VO-001.
 *   - IPC #1 EFFECTIVE, ClientInvoice POSTED   → certifies + invoices BOTH nodes.
 *   - IPC #2 EFFECTIVE, ClientInvoice NOT_POSTED → certifies (not invoices) the VARIATION node.
 *   - IPC #3 NON-effective (superseded)        → must be excluded from certified entirely.
 * A second org's contract proves tenant isolation.
 */
describe('certifiedInvoicedByVariation (CONST-VAR-008)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `vp3-org-${suffix}`;
  const otherOrgId = `vp3-other-${suffix}`;

  let service: VariationOrderService;
  let identity: RequestIdentity;
  let identityNoFin: RequestIdentity;
  let contractId: string;
  let voId: string;
  let otherContractId: string;

  // Amounts chosen so every bucket is distinct and reconciliation is checkable by eye.
  const BASE_CERT_1 = '1000.00'; // baseline node, IPC#1 (effective + posted)
  const VAR_CERT_1 = '500.00'; //  variation node, IPC#1 (effective + posted)
  const VAR_CERT_2 = '250.00'; //  variation node, IPC#2 (effective, NOT posted)
  const VAR_CERT_SUP = '999.00'; // variation node, IPC#3 (NON-effective — must be ignored)

  beforeAll(async () => {
    const ungoverned = {
      gateStateTransition: async () => null,
    } as unknown as CommandGovernanceService;
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    // assertContract is exercised by real routing in prod; here we let every assert pass and rely on
    // the repository's org+contract scoping (the thing under test) to enforce isolation.
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = {
      record: async () => undefined,
    } as unknown as TransactionalAuditOutboxService;

    service = new VariationOrderService(
      tenancy,
      new VariationOrderPrismaRepository(),
      projectAccess,
      auditOutbox,
      ungoverned,
    );

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `vp3-${suffix}`,
      roles: ['admin'],
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.financialPositionView],
    };
    identityNoFin = { ...identity, permissions: [PERMISSIONS.contractsView] };

    await seedOrg(orgId, `vp3-${suffix}`);
    ({ contractId, voId } = await seedContractWithData(orgId));

    // A second org whose contract data must never leak into org-1's read.
    await seedOrg(otherOrgId, `vp3o-${suffix}`);
    const other = await seedContractWithData(otherOrgId);
    otherContractId = other.contractId;
  });

  async function seedOrg(id: string, slug: string) {
    await prisma.organization.create({ data: { id, name: `Org ${slug}`, slug, status: 'ACTIVE' } });
  }

  /**
   * Seeds, for the given org: a project + baselined BOQ (one BASELINE leaf), a VARIATION leaf tagged
   * to a VO, a contract, and three IPCs (effective+posted, effective+unposted, non-effective) with
   * their IPA/items/invoices. Returns the contract + VO ids.
   */
  async function seedContractWithData(org: string) {
    const project = await prisma.project.create({
      data: {
        organizationId: org,
        code: `VP3-${org.slice(-6)}`,
        name: 'CIV project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    const boq = await prisma.boq.create({
      data: { organizationId: org, projectId: project.id, currency: 'USD' },
    });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    await prisma.boq.update({
      where: { id: boq.id },
      data: { currentApprovedVersionId: version.id },
    });

    const baselineNode = await prisma.boqNode.create({
      data: {
        boqId: boq.id,
        versionId: version.id,
        path: '01.001',
        code: '01.001',
        description: 'Baseline item',
        isLeaf: true,
        depth: 0,
        sortOrder: 0,
        unit: 'm3',
        quantity: new Decimal('100'),
        unitRate: new Decimal('10'),
        currency: 'USD',
        totalAmount: new Decimal('1000'),
        sourceType: 'BASELINE',
      },
    });

    const client = await prisma.client.create({
      data: { organizationId: org, code: `CL-${org.slice(-6)}`, name: 'Client' },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: org,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-${org.slice(-6)}`,
        contractValue: new Decimal('5000'),
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });

    // A client-approved VO + the VARIATION BOQ leaf that carries its provenance.
    const vo = await prisma.variationOrder.create({
      data: {
        organizationId: org,
        contractId: contract.id,
        reference: 'VO-001',
        status: 'CLIENT_APPROVED',
        title: 'Extra scope',
        createdBy: 'u1',
      },
    });
    const variationNode = await prisma.boqNode.create({
      data: {
        boqId: boq.id,
        versionId: version.id,
        path: '02.001',
        code: '02.001',
        description: 'Variation item',
        isLeaf: true,
        depth: 0,
        sortOrder: 1,
        unit: 'm3',
        quantity: new Decimal('50'),
        unitRate: new Decimal('20'),
        currency: 'USD',
        totalAmount: new Decimal('1000'),
        sourceType: 'VARIATION',
        sourceChangeOrderId: vo.id,
      },
    });

    // The DB enforces one EFFECTIVE IPC per IPA (partial unique index ipc_one_effective_per_application),
    // so each effective certificate lives on its own application. IPA#1 covers both nodes (IPC#1) and
    // also carries a superseded, non-effective certificate; IPA#2 covers the variation node (IPC#2).
    const makeItem = (applicationId: string, boqNodeId: string, rate: string, qty: string) =>
      prisma.interimPaymentApplicationItem.create({
        data: {
          applicationId,
          boqNodeId,
          measurementMethodSnapshot: 'QUANTITY',
          unitRateSnapshot: new Decimal(rate),
          currencySnapshot: 'USD',
          cumulativeClaimed: new Decimal(qty),
          periodQuantity: new Decimal(qty),
          periodAmount: new Decimal('1000'),
        },
      });

    const ipa1 = await prisma.interimPaymentApplication.create({
      data: { contractId: contract.id, organizationId: org, applicationNumber: 1, status: 'SUBMITTED', createdBy: 'u1' },
    });
    const baseItem1 = await makeItem(ipa1.id, baselineNode.id, '10', '100');
    const varItem1 = await makeItem(ipa1.id, variationNode.id, '20', '50');

    const ipa2 = await prisma.interimPaymentApplication.create({
      data: { contractId: contract.id, organizationId: org, applicationNumber: 2, status: 'SUBMITTED', createdBy: 'u1' },
    });
    const varItem2 = await makeItem(ipa2.id, variationNode.id, '20', '25');

    // IPC #1 (IPA#1) — EFFECTIVE + POSTED invoice: certifies + invoices BOTH nodes.
    await createCertificate(org, ipa1.id, {
      number: 1,
      isEffective: true,
      invoicePosted: true,
      clientId: client.id,
      contractId: contract.id,
      projectId: project.id,
      items: [
        { applicationItemId: baseItem1.id, certifiedAmount: BASE_CERT_1 },
        { applicationItemId: varItem1.id, certifiedAmount: VAR_CERT_1 },
      ],
    });
    // IPC #2 (IPA#2) — EFFECTIVE + UNPOSTED invoice: certifies the VARIATION node only, invoices nothing.
    await createCertificate(org, ipa2.id, {
      number: 1,
      isEffective: true,
      invoicePosted: false,
      clientId: client.id,
      contractId: contract.id,
      projectId: project.id,
      items: [{ applicationItemId: varItem2.id, certifiedAmount: VAR_CERT_2 }],
    });
    // IPC #3 (IPA#1) — NON-effective (superseded): must be excluded from certified AND invoiced.
    await createCertificate(org, ipa1.id, {
      number: 2,
      isEffective: false,
      invoicePosted: false,
      clientId: client.id,
      contractId: contract.id,
      projectId: project.id,
      items: [{ applicationItemId: varItem1.id, certifiedAmount: VAR_CERT_SUP }],
    });

    return { contractId: contract.id, voId: vo.id };
  }

  async function createCertificate(
    org: string,
    applicationId: string,
    opts: {
      number: number;
      isEffective: boolean;
      invoicePosted: boolean;
      clientId: string;
      contractId: string;
      projectId: string;
      items: Array<{ applicationItemId: string; certifiedAmount: string }>;
    },
  ) {
    const total = opts.items.reduce((s, i) => s.plus(new Decimal(i.certifiedAmount)), new Decimal(0));
    const cert = await prisma.interimPaymentCertificate.create({
      data: {
        applicationId,
        organizationId: org,
        certificateNumber: opts.number,
        status: 'CERTIFIED',
        isEffective: opts.isEffective,
        effectiveAt: opts.isEffective ? new Date() : null,
        certifiedTotal: total,
        currency: 'USD',
        createdBy: 'u1',
        items: {
          create: opts.items.map((i) => ({
            applicationItemId: i.applicationItemId,
            certifiedQuantity: new Decimal('1'),
            certifiedAmount: new Decimal(i.certifiedAmount),
            varianceQuantity: new Decimal('0'),
          })),
        },
      },
    });
    // A ClientInvoice exists for every certificate here; only #1 is POSTED.
    await prisma.clientInvoice.create({
      data: {
        organizationId: org,
        invoiceNumber: `INV-${cert.id.slice(-10)}`,
        invoiceDate: new Date(),
        dueDate: new Date(),
        clientId: opts.clientId,
        sourceIpcId: cert.id,
        projectId: opts.projectId,
        contractId: opts.contractId,
        currencyCode: 'USD',
        subtotal: total,
        vatAmount: new Decimal('0'),
        totalAmount: total,
        outstandingAmount: total,
        billingAddressSnapshot: {},
        postingStatus: opts.invoicePosted ? 'POSTED' : 'NOT_POSTED',
        createdBy: 'u1',
      },
    });
    return cert;
  }

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await prisma.clientInvoice.deleteMany({ where: { organizationId: org } });
      await prisma.$executeRaw`DELETE FROM interim_payment_certificate_items WHERE certificate_id IN (SELECT id FROM interim_payment_certificates WHERE organization_id = ${org})`;
      await prisma.interimPaymentCertificate.deleteMany({ where: { organizationId: org } });
      await prisma.$executeRaw`DELETE FROM interim_payment_application_items WHERE application_id IN (SELECT id FROM interim_payment_applications WHERE organization_id = ${org})`;
      await prisma.interimPaymentApplication.deleteMany({ where: { organizationId: org } });
      await prisma.$executeRaw`DELETE FROM boq_nodes WHERE boq_id IN (SELECT id FROM boqs WHERE organization_id = ${org})`;
      await prisma.variationOrder.deleteMany({ where: { organizationId: org } });
      await prisma.contract.deleteMany({ where: { organizationId: org } });
      await prisma.client.deleteMany({ where: { organizationId: org } });
      await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: org } } });
      await prisma.boq.deleteMany({ where: { organizationId: org } });
      await prisma.project.deleteMany({ where: { organizationId: org } });
      await prisma.organization.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('groups a certified+invoiced variation line under its VO, and base-scope under base', async () => {
    const res = await service.certifiedInvoicedByVariation(identity, contractId);

    // Base scope: baseline node certified 1000 (IPC#1 effective) and invoiced 1000 (IPC#1 posted).
    expect(res.baseScope.certifiedToDate).toBe('1000.00');
    expect(res.baseScope.invoicedToDate).toBe('1000.00');

    // The VO: certified = 500 (IPC#1) + 250 (IPC#2 effective) = 750; invoiced = 500 (only IPC#1 posted).
    // The non-effective IPC#3 (999) is excluded from BOTH.
    expect(res.byVariation).toHaveLength(1);
    const vo = res.byVariation[0]!;
    expect(vo.variationId).toBe(voId);
    expect(vo.reference).toBe('VO-001');
    expect(vo.title).toBe('Extra scope');
    expect(vo.certifiedToDate).toBe('750.00');
    expect(vo.invoicedToDate).toBe('500.00');
  });

  it('reconciles: base + Σ VOs equals the whole certified / invoiced gross', async () => {
    const res = await service.certifiedInvoicedByVariation(identity, contractId);

    const sumCertified = new Decimal(res.baseScope.certifiedToDate!).plus(
      res.byVariation.reduce((s, v) => s.plus(new Decimal(v.certifiedToDate!)), new Decimal(0)),
    );
    const sumInvoiced = new Decimal(res.baseScope.invoicedToDate!).plus(
      res.byVariation.reduce((s, v) => s.plus(new Decimal(v.invoicedToDate!)), new Decimal(0)),
    );

    expect(sumCertified.toFixed(2)).toBe(res.totalCertifiedToDate);
    expect(sumInvoiced.toFixed(2)).toBe(res.totalInvoicedToDate);
    // Whole certified gross = 1000 (base) + 750 (VO) = 1750; whole invoiced = 1000 + 500 = 1500.
    expect(res.totalCertifiedToDate).toBe('1750.00');
    expect(res.totalInvoicedToDate).toBe('1500.00');
  });

  it('nulls every money field without financialPositionView (structure still returned)', async () => {
    const res = await service.certifiedInvoicedByVariation(identityNoFin, contractId);

    expect(res.canViewFinancials).toBe(false);
    expect(res.baseScope.certifiedToDate).toBeNull();
    expect(res.baseScope.invoicedToDate).toBeNull();
    expect(res.totalCertifiedToDate).toBeNull();
    expect(res.totalInvoicedToDate).toBeNull();
    // The VO row is still present (so callers know the VO exists) — only its money is redacted.
    expect(res.byVariation).toHaveLength(1);
    expect(res.byVariation[0]!.certifiedToDate).toBeNull();
    expect(res.byVariation[0]!.invoicedToDate).toBeNull();
  });

  it('is tenant-isolated: another org cannot read this contract, and vice versa', async () => {
    // org-1 identity against org-2's contract: no rows resolve → empty, zeroed reconciliation.
    const crossed = await service.certifiedInvoicedByVariation(identity, otherContractId);
    expect(crossed.byVariation).toHaveLength(0);
    expect(crossed.baseScope.certifiedToDate).toBe('0.00');
    expect(crossed.totalCertifiedToDate).toBe('0.00');
    expect(crossed.totalInvoicedToDate).toBe('0.00');
  });
});
