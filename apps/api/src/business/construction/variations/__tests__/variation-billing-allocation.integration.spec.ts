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
 * ADR-030 CONST-COM-028 (Commercial redesign, variation billing P1) — live-DB proof of the realization
 * ledger and its "exactly once" invariant, through `VariationOrderService.allocateVariationBilling`.
 *
 * The invariant: a VO's allocations move MONOTONICALLY toward its `netValue`, never overshoot it in
 * magnitude, and stay sign-consistent; fully realized ⇔ Σ == netValue. And crucially, realization
 * NEVER moves the contract value (entitlement) — the two layers are independent.
 *
 * Fixture (one org): an ADDITION VO (net +2000, CLIENT_APPROVED), an OMISSION VO (net −3000,
 * CLIENT_APPROVED), and a DRAFT VO (net +1000, not billable). A second org proves tenant isolation.
 * The audit outbox is mocked (it has its own tests); the allocation write still commits in its tx.
 */
describe('allocateVariationBilling (CONST-COM-028)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `vba-org-${suffix}`;
  const otherOrgId = `vba-other-${suffix}`;

  let service: VariationOrderService;
  let identity: RequestIdentity;
  let contractId: string;
  let contractValueBefore: string;
  let additionVoId: string;
  let omissionVoId: string;
  let draftVoId: string;
  let otherVoId: string;

  beforeAll(async () => {
    const ungoverned = { gateStateTransition: async () => null } as unknown as CommandGovernanceService;
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;

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
      tenantSlug: `vba-${suffix}`,
      roles: ['ADMIN'],
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.financialPositionView],
    };

    await seedOrg(orgId, `vba-${suffix}`);
    const seeded = await seedContractWithVos(orgId);
    contractId = seeded.contractId;
    contractValueBefore = seeded.contractValue;
    additionVoId = seeded.additionVoId;
    omissionVoId = seeded.omissionVoId;
    draftVoId = seeded.draftVoId;

    await seedOrg(otherOrgId, `vbao-${suffix}`);
    const other = await seedContractWithVos(otherOrgId);
    otherVoId = other.additionVoId;
  });

  async function seedOrg(id: string, slug: string) {
    await prisma.organization.create({ data: { id, name: `Org ${slug}`, slug, status: 'ACTIVE' } });
  }

  async function seedContractWithVos(org: string) {
    const project = await prisma.project.create({
      data: { organizationId: org, code: `VBA-${org.slice(-6)}`, name: 'VBA project', currency: 'USD', createdBy: 'u1' },
    });
    const boq = await prisma.boq.create({
      data: { organizationId: org, projectId: project.id, currency: 'USD' },
    });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const client = await prisma.client.create({
      data: { organizationId: org, code: `CL-${org.slice(-6)}`, name: 'Client' },
    });
    const contractValue = '500000.00';
    const contract = await prisma.contract.create({
      data: {
        organizationId: org,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-${org.slice(-6)}`,
        contractValue: new Decimal(contractValue),
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });

    // ADDITION VO — net +2000 (one line, amount 2000), client-approved (billable entitlement).
    const additionVo = await prisma.variationOrder.create({
      data: {
        organizationId: org,
        contractId: contract.id,
        reference: 'VO-001',
        status: 'CLIENT_APPROVED',
        title: 'Extra scope',
        createdBy: 'u1',
        lines: {
          create: [
            {
              description: 'Add work',
              quantity: new Decimal('1'),
              unitRate: new Decimal('2000'),
              amount: new Decimal('2000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // OMISSION VO — net −3000, client-approved.
    const omissionVo = await prisma.variationOrder.create({
      data: {
        organizationId: org,
        contractId: contract.id,
        reference: 'VO-002',
        status: 'CLIENT_APPROVED',
        title: 'Descoped work',
        createdBy: 'u1',
        lines: {
          create: [
            {
              description: 'Remove work',
              quantity: new Decimal('1'),
              unitRate: new Decimal('-3000'),
              amount: new Decimal('-3000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // DRAFT VO — net +1000, NOT client-approved (must refuse allocation).
    const draftVo = await prisma.variationOrder.create({
      data: {
        organizationId: org,
        contractId: contract.id,
        reference: 'VO-003',
        status: 'DRAFT',
        title: 'Proposed scope',
        createdBy: 'u1',
        lines: {
          create: [
            {
              description: 'Maybe work',
              quantity: new Decimal('1'),
              unitRate: new Decimal('1000'),
              amount: new Decimal('1000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });

    return {
      contractId: contract.id,
      contractValue,
      additionVoId: additionVo.id,
      omissionVoId: omissionVo.id,
      draftVoId: draftVo.id,
    };
  }

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await prisma.variationBillingAllocation.deleteMany({ where: { organizationId: org } });
      await prisma.$executeRaw`DELETE FROM variation_order_lines WHERE variation_order_id IN (SELECT id FROM variation_orders WHERE organization_id = ${org})`;
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

  it('realizes a partial then a closing slice, accumulating to netValue exactly (exactly once)', async () => {
    const first = await service.allocateVariationBilling(identity, additionVoId, {
      amount: '1200.00',
      treatment: 'INVOICE',
    });
    expect(first.netValue).toBe('2000.00');
    expect(first.remainingUnallocated).toBe('800.00');
    expect(first.fullyRealized).toBe(false);

    const second = await service.allocateVariationBilling(identity, additionVoId, {
      amount: '800.00',
      treatment: 'INVOICE',
    });
    expect(second.remainingUnallocated).toBe('0.00');
    expect(second.fullyRealized).toBe(true);

    // Two ledger rows persisted, Σ == net.
    const rows = await prisma.variationBillingAllocation.findMany({ where: { variationId: additionVoId } });
    expect(rows).toHaveLength(2);
    const total = rows.reduce((s, r) => s.plus(r.amount as Decimal), new Decimal(0));
    expect(total.toFixed(2)).toBe('2000.00');
  });

  it('refuses a further nonzero slice once the VO is fully realized', async () => {
    // additionVoId is fully realized by the previous test.
    await expect(
      service.allocateVariationBilling(identity, additionVoId, { amount: '0.01', treatment: 'INVOICE' }),
    ).rejects.toThrow(/OVERSHOOTS_NET|WRONG_SIGN/);
  });

  it('rejects a slice that overshoots the net in magnitude', async () => {
    await expect(
      service.allocateVariationBilling(identity, omissionVoId, {
        amount: '-3000.01',
        treatment: 'STAGE_REDUCTION',
      }),
    ).rejects.toThrow(/OVERSHOOTS_NET/);
  });

  it('realizes an omission symmetrically as a STAGE_REDUCTION to the negative net', async () => {
    const r = await service.allocateVariationBilling(identity, omissionVoId, {
      amount: '-3000.00',
      treatment: 'STAGE_REDUCTION',
    });
    expect(r.netValue).toBe('-3000.00');
    expect(r.remainingUnallocated).toBe('0.00');
    expect(r.fullyRealized).toBe(true);
  });

  it('enforces treatment/sign coupling and rejects CREDIT_NOTE in P1', async () => {
    // INVOICE must be positive.
    await expect(
      service.allocateVariationBilling(identity, omissionVoId, { amount: '-100.00', treatment: 'INVOICE' }),
    ).rejects.toThrow(/positive/);
    // STAGE_REDUCTION must be negative.
    await expect(
      service.allocateVariationBilling(identity, omissionVoId, { amount: '100.00', treatment: 'STAGE_REDUCTION' }),
    ).rejects.toThrow(/negative/);
    // CREDIT_NOTE is Phase 2.
    await expect(
      service.allocateVariationBilling(identity, omissionVoId, { amount: '-100.00', treatment: 'CREDIT_NOTE' }),
    ).rejects.toThrow(/Phase 2/);
  });

  it('refuses to bill a variation that is not client-approved', async () => {
    await expect(
      service.allocateVariationBilling(identity, draftVoId, { amount: '100.00', treatment: 'INVOICE' }),
    ).rejects.toThrow(/not client-approved/);
    // No ledger row was written.
    const rows = await prisma.variationBillingAllocation.findMany({ where: { variationId: draftVoId } });
    expect(rows).toHaveLength(0);
  });

  it('never moves the contract value — entitlement and realization are separate layers', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect((contract.contractValue as Decimal).toFixed(2)).toBe(contractValueBefore);
  });

  it('is tenant-isolated: another org cannot allocate against this org identity', async () => {
    await expect(
      service.allocateVariationBilling(identity, otherVoId, { amount: '100.00', treatment: 'INVOICE' }),
    ).rejects.toThrow(/not found/i);
    // And nothing leaked into the other org's ledger.
    const rows = await prisma.variationBillingAllocation.findMany({ where: { organizationId: otherOrgId } });
    expect(rows).toHaveLength(0);
  });
});
