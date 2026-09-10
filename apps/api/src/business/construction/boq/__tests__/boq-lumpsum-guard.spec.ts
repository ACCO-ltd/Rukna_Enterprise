import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqTreeService } from '../application/boq-tree.service.js';

/**
 * ADR-029 V-4 / D7 / INV-6 — LUMP-SUM guard (DB-free).
 *
 * ACCO contracts are lump-sum: a post-commit change to an internal site quantity is cost variance,
 * NEVER a client re-price. The client's number moves only through an approved variation (V-1/V-2).
 * This proves the guarantee at the BOQ write boundary with a mocked repo: on a COMMITTED version a
 * leaf quantity edit that would move the in-contract total is REJECTED by the pin (409
 * CONTRACT_VALUE_LOCKED) before it ever reaches the database — so `baseContractValue`,
 * `contractValue`, and the milestone installment amounts (all derived from the frozen base / held on
 * the Contract, never recomputed from a leaf) cannot change. A money-neutral edit is allowed and does
 * not touch the amount. The end-to-end ledger check runs DB-backed in boq-commit.spec.ts.
 */

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

// A committed BOQ with one IN_CONTRACT priced leaf: quantity 100 × rate 10 = 1000.
const boq = {
  id: 'boq-1',
  organizationId: 'org-1',
  currency: 'USD',
  versions: [{ id: 'v-op', status: 'COMMITTED' }],
};

const workLeaf = {
  id: 'n-1',
  versionId: 'v-op',
  isLeaf: true,
  code: '01.001',
  description: 'Concrete',
  unit: 'm3',
  quantity: new Decimal('100.000'),
  unitRate: new Decimal('10.00'),
  totalAmount: '1000.00',
  depth: 1,
  commercialTreatment: 'IN_CONTRACT',
  nodeRole: 'WORK',
  measurementMethod: 'QUANTITY',
  pricingBasis: 'UNIT_RATE',
};

function build() {
  const prisma = {};
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;

  const repo = {
    findByProject: jest.fn(async () => boq),
    findVersion: jest.fn(async () => ({ id: 'v-op', status: 'COMMITTED' })),
    findNodeById: jest.fn(async () => workLeaf),
    countChildren: jest.fn(async () => 0),
    findCodesInVersion: jest.fn(async () => new Set<string>()),
    updateNode: jest.fn(async (_p: unknown, _id: string, data: unknown) => ({ ...workLeaf, ...(data as object) })),
  };

  const service = new BoqTreeService(tenancy, repo as never);
  return { service, repo };
}

describe('ADR-029 V-4 — lump-sum guard (post-commit quantity edit leaves client figures unchanged)', () => {
  it('rejects a quantity edit that moves the in-contract total (409), never reaching the DB', async () => {
    const { service, repo } = build();
    // 100 → 150 would move the leaf amount 1000 → 1500: a client re-price the pin forbids.
    const err = await service
      .updateNode(identity, 'p-1', 'v-op', 'n-1', { quantity: '150.000' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      errorCode: 'CONTRACT_VALUE_LOCKED',
    });
    // The write never happened — so nothing the contract value / installments derive from moved.
    expect(repo.updateNode).not.toHaveBeenCalled();
  });

  it('allows a money-neutral description edit and does not touch the amount', async () => {
    const { service, repo } = build();
    await service.updateNode(identity, 'p-1', 'v-op', 'n-1', {
      description: 'Concrete (corrected wording)',
    });
    expect(repo.updateNode).toHaveBeenCalledTimes(1);
    // The persisted patch keeps the same totalAmount — a description edit is not a re-price.
    const patch = repo.updateNode.mock.calls[0]![2] as { totalAmount: string };
    expect(patch.totalAmount).toBe('1000.00');
  });

  it('rejects a quantity+rate edit that raises the total without the variation seam', async () => {
    const { service, repo } = build();
    const err = await service
      .updateNode(identity, 'p-1', 'v-op', 'n-1', { quantity: '100.000', unitRate: '12.00' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(repo.updateNode).not.toHaveBeenCalled();
  });
});
