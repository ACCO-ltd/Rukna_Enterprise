import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { BoqItemLibraryService } from './boq-item-library.service.js';

/**
 * ADR-020 CONST-BOQ-020/021 — the reusable BOQ work-item library. Fast search, just-in-time create,
 * and a last-used rate recorded as assistance (never authoritative).
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

function build(over: { existingByCode?: unknown; itemById?: unknown } = {}) {
  const repo = {
    search: jest.fn().mockResolvedValue([]),
    findByCode: jest.fn().mockResolvedValue('existingByCode' in over ? over.existingByCode : null),
    findById: jest.fn().mockResolvedValue('itemById' in over ? over.itemById : { id: 'item1' }),
    create: jest.fn().mockImplementation((_p, data) => Promise.resolve({ id: 'item1', ...data })),
    recordUsage: jest.fn().mockResolvedValue({ id: 'item1' }),
  };
  const svc = new BoqItemLibraryService({ getClient: () => ({}) } as never, repo as never);
  return { svc, repo };
}

describe('BoqItemLibraryService', () => {
  it('search passes the query through to the repository', async () => {
    const { svc, repo } = build();
    await svc.search(identity, 'rebar');
    expect(repo.search).toHaveBeenCalledWith(expect.anything(), 'o1', 'rebar');
  });

  it('create saves a new item with the creator and org', async () => {
    const { svc, repo } = build();
    await svc.create(identity, { code: 'RC-C25', description: 'Supply and cast RC C25', defaultUnit: 'm³' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', code: 'RC-C25', createdBy: 'u1', defaultUnit: 'm³' }),
    );
  });

  it('create rejects a duplicate code', async () => {
    const { svc } = build({ existingByCode: { id: 'dup' } });
    await expect(
      svc.create(identity, { code: 'RC-C25', description: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recordUsage stores the last-used rate as a Decimal (assistance, CONST-BOQ-021)', async () => {
    const { svc, repo } = build();
    await svc.recordUsage(identity, 'item1', { rate: '102.50', projectId: 'p1' });
    expect(repo.recordUsage).toHaveBeenCalledWith(
      expect.anything(),
      'item1',
      expect.objectContaining({ lastUsedProjectId: 'p1' }),
    );
    const arg = repo.recordUsage.mock.calls[0][2];
    expect(arg.lastUsedRate).toBeInstanceOf(Decimal);
    expect(arg.lastUsedRate.equals(new Decimal('102.50'))).toBe(true);
  });

  it('recordUsage 404s for an unknown item', async () => {
    const { svc } = build({ itemById: null });
    await expect(svc.recordUsage(identity, 'nope', { rate: '1' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
