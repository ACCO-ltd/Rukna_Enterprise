import { BadRequestException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProgressService, type SaveDeliveryPlanDto } from './progress.service.js';

/**
 * Delivery Plan batch save: create N packages + their leaf allocations together, all-or-nothing.
 * Mirrors the mocked-transaction style `schedule-template.spec.ts` already uses for
 * `applyScheduleTemplate` — the same atomicity primitive (`prisma.$transaction`), the same bar:
 * prove the service validates BEFORE writing anything, and that a failure inside the transaction
 * never yields a partial result the caller could mistake for success.
 */
const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

type Over = {
  workPackages?: unknown[];
  boqNodes?: unknown[];
  allocateBoqNode?: jest.Mock;
};

function build(over: Over = {}) {
  let wpSeq = 0;
  const prisma = {
    // Real Prisma runs the callback inside an actual DB transaction; this mock runs it against the
    // same client, which is enough to prove the service's own contract (validate-then-write,
    // propagate-on-failure) without standing up a database for a codebase-standard pattern that
    // already has no db-level test for its one existing user (applyScheduleTemplate).
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  const repo = {
    findBoqNodesForAllocation: jest.fn().mockResolvedValue(
      over.boqNodes ?? [
        { id: 'leaf-1', isLeaf: true },
        { id: 'leaf-2', isLeaf: true },
        { id: 'leaf-3', isLeaf: true },
      ],
    ),
    findWorkPackages: jest.fn().mockResolvedValue(over.workPackages ?? []),
    createWorkPackage: jest.fn().mockImplementation((_tx, data) => {
      wpSeq += 1;
      return Promise.resolve({ id: `wp-${wpSeq}`, code: data.code, name: data.name });
    }),
    allocateBoqNode:
      over.allocateBoqNode ?? jest.fn().mockResolvedValue({ id: 'wpn-1' }),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgressService(
    { getClient: () => prisma } as never,
    repo as never,
    projectAccess as never,
    {} as never, // financialPosition — unused here
    {} as never, // commandGovernance — unused here
    { bind: jest.fn(), markImmutable: jest.fn(), markManyImmutable: jest.fn() } as never,
    { findApproved: jest.fn().mockResolvedValue(null) } as never,
  );
  return { repo, service };
}

const plan = (over: Partial<SaveDeliveryPlanDto> = {}): SaveDeliveryPlanDto => ({
  packages: [
    { code: 'WP-01', name: 'Substructure', boqNodeIds: ['leaf-1', 'leaf-2'] },
    { code: 'WP-02', name: 'Superstructure', boqNodeIds: ['leaf-3'] },
  ],
  ...over,
});

describe('ProgressService.saveDeliveryPlan', () => {
  it('creates every package and allocates every leaf inside one transaction', async () => {
    const { repo, service } = build();

    const res = await service.saveDeliveryPlan(identity, 'p-1', plan());

    expect(repo.createWorkPackage).toHaveBeenCalledTimes(2);
    expect(repo.allocateBoqNode).toHaveBeenCalledTimes(3);
    expect(res.packages).toEqual([
      { id: 'wp-1', code: 'WP-01', name: 'Substructure' },
      { id: 'wp-2', code: 'WP-02', name: 'Superstructure' },
    ]);
  });

  it('rejects before writing anything when a code is reused within the batch', async () => {
    const { repo, service } = build();
    const bad = plan({
      packages: [
        { code: 'WP-01', name: 'A', boqNodeIds: ['leaf-1'] },
        { code: 'WP-01', name: 'B', boqNodeIds: ['leaf-2'] },
      ],
    });

    await expect(service.saveDeliveryPlan(identity, 'p-1', bad)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
    expect(repo.allocateBoqNode).not.toHaveBeenCalled();
  });

  it('rejects before writing anything when a code collides with an existing work package', async () => {
    const { repo, service } = build({ workPackages: [{ code: 'WP-01', boqLinks: [] }] });

    await expect(service.saveDeliveryPlan(identity, 'p-1', plan())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });

  it('rejects before writing anything when a leaf is already allocated to an existing package', async () => {
    const { repo, service } = build({
      workPackages: [{ code: 'WP-99', boqLinks: [{ boqNodeId: 'leaf-2' }] }],
    });

    await expect(service.saveDeliveryPlan(identity, 'p-1', plan())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });

  it('rejects a BOQ id that is not a leaf, before writing anything', async () => {
    const { repo, service } = build({
      boqNodes: [
        { id: 'leaf-1', isLeaf: true },
        { id: 'leaf-2', isLeaf: true },
        { id: 'leaf-3', isLeaf: false }, // a section, not a leaf
      ],
    });

    await expect(service.saveDeliveryPlan(identity, 'p-1', plan())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });

  it('rejects a BOQ id that does not belong to this project, before writing anything', async () => {
    const { repo, service } = build({
      boqNodes: [
        { id: 'leaf-1', isLeaf: true },
        { id: 'leaf-2', isLeaf: true },
        // leaf-3 missing entirely — not found for this project.
      ],
    });

    await expect(service.saveDeliveryPlan(identity, 'p-1', plan())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });

  it('never returns a partial result when the transaction itself fails partway through', async () => {
    // Both packages pass validation; the write starts, but the second allocation fails (the DB-level
    // backstop for a race two validation passes cannot see). The whole call must reject — a caller
    // that only checked "did it throw" must never also see a packages[] with some entries.
    const failingAllocate = jest
      .fn()
      .mockResolvedValueOnce({ id: 'wpn-1' })
      .mockResolvedValueOnce({ id: 'wpn-2' })
      .mockRejectedValueOnce(new Error('unique constraint violation on boq_node_id'));
    const { repo, service } = build({ allocateBoqNode: failingAllocate });

    await expect(service.saveDeliveryPlan(identity, 'p-1', plan())).rejects.toThrow(
      'unique constraint violation',
    );
    // createWorkPackage DID run inside the (mocked) transaction — the point of this test is that the
    // method call as a whole rejects rather than resolving with a partial packages[]; the real
    // Postgres transaction is what erases those writes, which this mock cannot simulate but which
    // `prisma.$transaction` — the same primitive `applyScheduleTemplate` already relies on — guarantees.
    expect(repo.createWorkPackage).toHaveBeenCalledTimes(2);
  });
});
