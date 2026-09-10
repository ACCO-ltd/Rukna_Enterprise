import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { ClientInvoiceService } from './client-invoice.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const dto = { ipcId: 'ipc-1', invoiceDate: '2026-08-01', dueDate: '2026-09-01' };

const effectiveIpc = {
  id: 'ipc-1',
  isEffective: true,
  certifiedTotal: '1000.00',
  currency: 'USD',
  application: {
    contract: {
      id: 'c-1',
      clientId: 'client-1',
      projectId: 'p-1',
      client: { name: 'ACCO' },
    },
  },
};

function build(ipc: unknown) {
  const repo = {
    findByIpc: jest.fn(),
    create: jest.fn(),
  };
  const prisma = {
    interimPaymentCertificate: { findFirst: jest.fn().mockResolvedValue(ipc) },
  };
  const tenancy = { getClient: () => prisma };
  const service = new ClientInvoiceService(
    tenancy as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { repo, service };
}

describe('A5 — IPC-to-invoice idempotency (CONST-COM-006)', () => {
  it('returns the existing invoice without creating a second one', async () => {
    const { repo, service } = build(effectiveIpc);
    const existing = { id: 'inv-existing' };
    repo.findByIpc.mockResolvedValue(existing);

    const result = await service.generateFromIpc(identity, dto);

    expect(result).toBe(existing);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates exactly one invoice on first generation', async () => {
    const { repo, service } = build(effectiveIpc);
    repo.findByIpc.mockResolvedValue(null);
    const created = { id: 'inv-new' };
    repo.create.mockResolvedValue(created);

    const result = await service.generateFromIpc(identity, dto);

    expect(result).toBe(created);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('resolves a concurrent race to the winner (P2002 on unique source_ipc_id)', async () => {
    const { repo, service } = build(effectiveIpc);
    const winner = { id: 'inv-winner' };
    // First lookup: nothing yet. After the losing insert: the winner exists.
    repo.findByIpc.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    repo.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.generateFromIpc(identity, dto);

    expect(result).toBe(winner);
  });

  it('rejects when the IPC is not yet effective', async () => {
    const { repo, service } = build({ ...effectiveIpc, isEffective: false });
    repo.findByIpc.mockResolvedValue(null);
    await expect(service.generateFromIpc(identity, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects when the IPC does not exist in this tenant', async () => {
    const { repo, service } = build(null);
    repo.findByIpc.mockResolvedValue(null);
    await expect(service.generateFromIpc(identity, dto)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ADR-023 — generateFromInstallment (milestone billing)', () => {
  const instDto = { installmentId: 'inst-1', invoiceDate: '2026-06-05', dueDate: '2026-07-05' };
  const milestoneContract = {
    id: 'c-1',
    contractNumber: 'CN-1',
    clientId: 'client-1',
    projectId: 'p-1',
    currency: 'USD',
    contractValue: '1000000',
    billingModel: 'MILESTONE',
    status: 'ACTIVE',
    client: { name: 'ACCO' },
  };
  const structureInstallment = {
    id: 'inst-1',
    name: 'Structure',
    percentage: '0.3',
    contract: milestoneContract,
  };

  function buildInstallment(inst: unknown) {
    const repo = {
      findByInstallment: jest.fn().mockResolvedValue(null),
      findInstallmentForBilling: jest.fn().mockResolvedValue(inst),
      create: jest.fn(),
    };
    const prisma = {};
    const tenancy = { getClient: () => prisma };
    const service = new ClientInvoiceService(
      tenancy as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { repo, service };
  }

  it('creates one invoice for percentage × contract value (30% of 1,000,000)', async () => {
    const { repo, service } = buildInstallment(structureInstallment);
    repo.create.mockResolvedValue({ id: 'inv-new' });
    await service.generateFromInstallment(identity, instDto);
    expect(repo.create).toHaveBeenCalledTimes(1);
    const data = repo.create.mock.calls[0][1];
    expect(data.sourceInstallmentId).toBe('inst-1');
    expect(data.subtotal.toString()).toBe('300000');
    expect(data.vatAmount.toString()).toBe('15000');
    expect(data.totalAmount.toString()).toBe('315000');
  });

  // ADR-029 T-6 — the invoice amount derives from the FROZEN baseContractValue. A variation that raised
  // the current contractValue to 1.2M must not change the milestone invoice (still 30% of the 1M base).
  it('T-6: derives the invoice from baseContractValue, not the raised current value', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      contract: { ...milestoneContract, contractValue: '1200000', baseContractValue: '1000000' },
    });
    repo.create.mockResolvedValue({ id: 'inv-new' });
    await service.generateFromInstallment(identity, instDto);
    const data = repo.create.mock.calls[0][1];
    expect(data.subtotal.toString()).toBe('300000'); // 30% of the 1M base, not 1.2M current
  });

  // ADR-029 M-4 — a legacy contract with a null base falls back to contractValue; never fails.
  it('M-4: a legacy contract with a null base falls back to contractValue', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      contract: { ...milestoneContract, baseContractValue: null },
    });
    repo.create.mockResolvedValue({ id: 'inv-new' });
    await service.generateFromInstallment(identity, instDto);
    expect(repo.create.mock.calls[0][1].subtotal.toString()).toBe('300000');
  });

  it('is idempotent — returns the existing invoice, no second create', async () => {
    const { repo, service } = buildInstallment(structureInstallment);
    const existing = { id: 'inv-existing' };
    repo.findByInstallment.mockResolvedValue(existing);
    const result = await service.generateFromInstallment(identity, instDto);
    expect(result).toBe(existing);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a certified-progress (MEASURED_IPC) contract', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      contract: { ...milestoneContract, billingModel: 'MEASURED_IPC' },
    });
    await expect(service.generateFromInstallment(identity, instDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects when the contract is not ACTIVE', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      contract: { ...milestoneContract, status: 'DRAFT' },
    });
    await expect(service.generateFromInstallment(identity, instDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('CONST-COM-011: rejects when the linked programme milestone is not verified', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      programmeMilestoneId: 'ms-1',
      programmeMilestone: { id: 'ms-1', status: 'PLANNED' },
    });
    await expect(service.generateFromInstallment(identity, instDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('CONST-COM-011: bills when the linked programme milestone is verified', async () => {
    const { repo, service } = buildInstallment({
      ...structureInstallment,
      programmeMilestoneId: 'ms-1',
      programmeMilestone: { id: 'ms-1', status: 'VERIFIED' },
    });
    repo.create.mockResolvedValue({ id: 'inv-new' });
    await service.generateFromInstallment(identity, instDto);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe('ADR-029 R-4 — generateFromSeparateCharge (one-off separate-charge billing)', () => {
  const scDto = { boqNodeId: 'node-1', invoiceDate: '2026-06-05', dueDate: '2026-07-05' };
  const contract = {
    id: 'c-1',
    projectId: 'p-1',
    clientId: 'client-1',
    currency: 'USD',
    client: { name: 'ACCO' },
  };
  // The node as `findSeparateChargeForBilling` returns it: a SEPARATE_CHARGE leaf whose version → boq →
  // project carries the one active client contract.
  const separateChargeNode = {
    id: 'node-1',
    code: 'SC-01',
    description: 'Client-requested extra fence',
    totalAmount: '20000.00',
    commercialTreatment: 'SEPARATE_CHARGE',
    isLeaf: true,
    version: { boq: { project: { contracts: [contract] } } },
  };

  function buildSeparateCharge(node: unknown) {
    const repo = {
      findByBoqNode: jest.fn().mockResolvedValue(null),
      findSeparateChargeForBilling: jest.fn().mockResolvedValue(node),
      create: jest.fn(),
    };
    const tenancy = { getClient: () => ({}) };
    const service = new ClientInvoiceService(
      tenancy as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { repo, service };
  }

  it('creates ONE draft invoice tagged by the node, with a null sourceInstallmentId', async () => {
    const { repo, service } = buildSeparateCharge(separateChargeNode);
    repo.create.mockResolvedValue({ id: 'inv-new' });
    await service.generateFromSeparateCharge(identity, scDto);
    expect(repo.create).toHaveBeenCalledTimes(1);
    const data = repo.create.mock.calls[0][1];
    // The source tag: sourceBoqNodeId set, sourceInstallmentId absent (installment path untouched).
    expect(data.sourceBoqNodeId).toBe('node-1');
    expect(data.sourceInstallmentId).toBeUndefined();
    expect(data.sourceIpcId).toBeUndefined();
    // Amount is the leaf's own totalAmount (20,000) + 5% VAT — never re-keyed.
    expect(data.subtotal.toString()).toBe('20000');
    expect(data.vatAmount.toString()).toBe('1000');
    expect(data.totalAmount.toString()).toBe('21000');
    // Client + contract come from the project's one active client contract.
    expect(data.clientId).toBe('client-1');
    expect(data.contractId).toBe('c-1');
    expect(data.currencyCode).toBe('USD');
  });

  it('is idempotent — returns the existing invoice, no second create', async () => {
    const { repo, service } = buildSeparateCharge(separateChargeNode);
    const existing = { id: 'inv-existing' };
    repo.findByBoqNode.mockResolvedValue(existing);
    const result = await service.generateFromSeparateCharge(identity, scDto);
    expect(result).toBe(existing);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('resolves a concurrent race to the winner (P2002 on unique source_boq_node_id)', async () => {
    const { repo, service } = buildSeparateCharge(separateChargeNode);
    const winner = { id: 'inv-winner' };
    repo.findByBoqNode.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    repo.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await service.generateFromSeparateCharge(identity, scDto);
    expect(result).toBe(winner);
  });

  it('rejects when the node is not a billable SEPARATE_CHARGE leaf', async () => {
    const { repo, service } = buildSeparateCharge(null);
    await expect(service.generateFromSeparateCharge(identity, scDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects when the project has no active client contract to bill against', async () => {
    const { repo, service } = buildSeparateCharge({
      ...separateChargeNode,
      version: { boq: { project: { contracts: [] } } },
    });
    await expect(service.generateFromSeparateCharge(identity, scDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an unpriced separate-charge line (no amount to bill)', async () => {
    const { repo, service } = buildSeparateCharge({ ...separateChargeNode, totalAmount: null });
    await expect(service.generateFromSeparateCharge(identity, scDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});
