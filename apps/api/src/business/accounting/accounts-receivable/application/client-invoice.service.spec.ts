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
  lang: 'en',
};

const dto = { ipcId: 'ipc-1', invoiceDate: '2026-08-01', dueDate: '2026-09-01' };

const effectiveIpc = {
  id: 'ipc-1',
  isEffective: true,
  certifiedTotal: '1000.00',
  currency: 'USD',
  exchangeRateValue: '1',
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
