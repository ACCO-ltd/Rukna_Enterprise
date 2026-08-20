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
