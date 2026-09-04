import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BoqImportRequest } from '@erp/types';

import { BoqImportService } from './boq-import.service.js';

/**
 * The planner (`boq-import.policy`) is exercised on its own with 29 unit tests. Here the repos and
 * Prisma are mocked, so these assert the *service's* job: resolving/creating the draft, running the
 * real planner, and — crucially — the create inputs it hands `createManyNodes` (ids, wired parentId,
 * the id-materialised path, the APPEND sort offset), plus the all-or-nothing 400, the Replace
 * reference guard, and library de-duplication.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

interface Overrides {
  boq?: unknown;
  project?: unknown;
  existingCodes?: Set<string>;
  version?: unknown;
  existingNodes?: unknown[];
  references?: number;
  libraryExisting?: { code: string; description: string; active: boolean }[];
  units?: { code: string; symbol: string }[];
}

function build(over: Overrides = {}) {
  const repo = {
    findByProject: jest.fn().mockResolvedValue(over.boq ?? null),
    findCodesInVersion: jest.fn().mockResolvedValue(over.existingCodes ?? new Set<string>()),
    createBoq: jest.fn().mockResolvedValue({ id: 'boq1' }),
    findById: jest.fn().mockResolvedValue({
      id: 'boq1',
      organizationId: 'o1',
      currency: 'USD',
      currentDraftVersionId: null,
      currentApprovedVersionId: null,
      versions: [],
    }),
    maxVersionNumber: jest.fn().mockResolvedValue(0),
    createVersion: jest.fn().mockResolvedValue({ id: 'v1', versionNumber: 1 }),
    updateBoq: jest.fn().mockResolvedValue({}),
    findVersion: jest.fn().mockResolvedValue(over.version ?? { id: 'v1', status: 'DRAFT', versionNumber: 1 }),
    findNodesByVersion: jest.fn().mockResolvedValue(over.existingNodes ?? []),
    countReferencesForNodes: jest.fn().mockResolvedValue(over.references ?? 0),
    clearVersionNodes: jest.fn().mockResolvedValue(undefined),
    createManyNodes: jest.fn().mockResolvedValue(undefined),
    recordChangeEvents: jest.fn().mockResolvedValue(undefined),
  };
  const libraryRepo = {
    findAllForDedup: jest.fn().mockResolvedValue(over.libraryExisting ?? []),
    createManyFromImport: jest.fn().mockImplementation((_p, items: unknown[]) => Promise.resolve(items.length)),
  };
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue(over.project ?? { currency: 'USD' }) },
    unitOfMeasure: { findMany: jest.fn().mockResolvedValue(over.units ?? []) },
    $transaction: jest.fn().mockImplementation((cb: (tx: string) => Promise<unknown>) => cb('TX')),
  };
  const tenancy = { getClient: () => prisma };
  const svc = new BoqImportService(tenancy as never, repo as never, libraryRepo as never);
  return { svc, repo, libraryRepo, prisma };
}

function createsFrom(repo: { createManyNodes: jest.Mock }): Prisma.BoqNodeCreateManyInput[] {
  return repo.createManyNodes.mock.calls[0][1] as Prisma.BoqNodeCreateManyInput[];
}

function byCode(creates: Prisma.BoqNodeCreateManyInput[]): Record<string, Prisma.BoqNodeCreateManyInput> {
  return Object.fromEntries(creates.map((c) => [c.code, c]));
}

const req = (over: Partial<BoqImportRequest> = {}): BoqImportRequest => ({
  mode: over.mode ?? 'REPLACE',
  addToLibrary: over.addToLibrary ?? false,
  rows: over.rows ?? [],
});

describe('BoqImportService', () => {
  describe('a fresh, valid import', () => {
    it('creates the BOQ, an empty draft, and the whole tree with wired parents and paths', async () => {
      const { svc, repo } = build();
      const result = await svc.import(
        identity,
        'p1',
        req({
          rows: [
            { rowNumber: 1, code: '02', description: 'Concrete' },
            { rowNumber: 2, code: '02.01', description: 'Substructure' },
            { rowNumber: 3, code: '02.01.001', description: 'Mass concrete', unit: 'm3', quantity: '10', unitRate: '85.00' },
          ],
        }),
      );

      expect(repo.createBoq).toHaveBeenCalled();
      expect(repo.createVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'DRAFT', versionNumber: 1 }),
      );

      const creates = createsFrom(repo);
      expect(creates).toHaveLength(3);
      const nodes = byCode(creates);
      expect(nodes['02'].parentId).toBeNull();
      expect(nodes['02.01'].parentId).toBe(nodes['02'].id);
      expect(nodes['02.01.001'].parentId).toBe(nodes['02.01'].id);
      // Path is the chain of ids, root → self.
      expect(nodes['02.01.001'].path).toBe(`${nodes['02'].id}/${nodes['02.01'].id}/${nodes['02.01.001'].id}`);
      expect(nodes['02'].isLeaf).toBe(false);
      expect(nodes['02.01.001'].isLeaf).toBe(true);
      expect(nodes['02.01.001'].totalAmount).toBe('850.00');

      expect(result.createdSectionCount).toBe(2);
      expect(result.createdItemCount).toBe(1);
      expect(result.versionNumber).toBe(1);
    });

    it('records one IMPORT change event, not one per row', async () => {
      const { svc, repo } = build();
      await svc.import(
        identity,
        'p1',
        req({
          rows: [
            { rowNumber: 1, code: '02', description: 'Concrete' },
            { rowNumber: 2, code: '02.01.001', description: 'Mass', quantity: '10', unitRate: '85.00' },
          ],
        }),
      );
      expect(repo.recordChangeEvents).toHaveBeenCalledTimes(1);
      const events = repo.recordChangeEvents.mock.calls[0][1] as { action: string }[];
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('IMPORT');
    });

    it('synthesises ancestor sections from a flat leaf sheet', async () => {
      const { svc, repo } = build();
      const result = await svc.import(
        identity,
        'p1',
        req({ rows: [{ rowNumber: 1, code: '02.01.001', description: 'Mass concrete', quantity: '10', unitRate: '85.00' }] }),
      );
      const creates = createsFrom(repo);
      expect(creates.map((c) => c.code).sort()).toEqual(['02', '02.01', '02.01.001']);
      expect(result.autoCreatedSectionCount).toBe(2);
    });
  });

  describe('all-or-nothing', () => {
    it('rejects with 400 (violations in details) and creates nothing on a blocking error', async () => {
      const { svc, repo } = build();
      const error = await svc
        .import(identity, 'p1', req({ rows: [{ rowNumber: 1, code: '', description: 'x' }] }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      // The global filter forwards only message + details — violations must ride in details.
      const response = (error as BadRequestException).getResponse() as {
        details?: { violations?: unknown[] };
      };
      expect(response.details?.violations?.length).toBeGreaterThan(0);
      expect(repo.createManyNodes).not.toHaveBeenCalled();
      expect(repo.createBoq).not.toHaveBeenCalled();
    });
  });

  describe('preview (dry-run)', () => {
    it('returns the planned tree and findings without mutating anything', async () => {
      const { svc, repo } = build();
      const result = await svc.preview(
        identity,
        'p1',
        req({ rows: [{ rowNumber: 1, code: '02.01.001', description: 'Mass concrete', quantity: '10', unitRate: '85.00' }] }),
      );
      expect(result.ok).toBe(true);
      expect(result.nodes.map((n) => n.code).sort()).toEqual(['02', '02.01', '02.01.001']);
      expect(result.itemCount).toBe(1);
      expect(result.autoCreatedSectionCount).toBe(2);
      expect(repo.createManyNodes).not.toHaveBeenCalled();
      expect(repo.createBoq).not.toHaveBeenCalled();
    });

    it('reports violations with ok=false instead of throwing', async () => {
      const { svc } = build();
      const result = await svc.preview(identity, 'p1', req({ rows: [{ rowNumber: 1, code: '', description: 'x' }] }));
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('Replace', () => {
    const existingNodes = [{ id: 'n1', code: '99', depth: 0, parentId: null, path: 'n1' }];
    const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', currentDraftVersionId: 'v1', currentApprovedVersionId: null };

    it('is blocked when a draft node is referenced downstream', async () => {
      const { svc, repo } = build({ boq, existingNodes, references: 1 });
      await expect(
        svc.import(identity, 'p1', req({ mode: 'REPLACE', rows: [{ rowNumber: 1, code: '1', description: 'x' }] })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.clearVersionNodes).not.toHaveBeenCalled();
      expect(repo.createManyNodes).not.toHaveBeenCalled();
    });

    it('clears the draft before creating when nothing is referenced', async () => {
      const { svc, repo } = build({ boq, existingNodes, references: 0 });
      await svc.import(identity, 'p1', req({ mode: 'REPLACE', rows: [{ rowNumber: 1, code: '1', description: 'x' }] }));
      expect(repo.clearVersionNodes).toHaveBeenCalledWith(expect.anything(), 'v1');
      expect(repo.clearVersionNodes.mock.invocationCallOrder[0]).toBeLessThan(
        repo.createManyNodes.mock.invocationCallOrder[0],
      );
    });
  });

  describe('Append', () => {
    const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', currentDraftVersionId: 'v1', currentApprovedVersionId: null };
    const existingNodes = [
      { id: 'p01', code: '01', depth: 0, parentId: null, path: 'p01' },
      { id: 'c1', code: '01.01', depth: 1, parentId: 'p01', path: 'p01/c1' },
      { id: 'c2', code: '01.02', depth: 1, parentId: 'p01', path: 'p01/c2' },
    ];

    it('attaches under an existing parent and offsets sort order past its current children', async () => {
      const { svc, repo } = build({ boq, existingNodes, existingCodes: new Set(['01', '01.01', '01.02']) });
      await svc.import(
        identity,
        'p1',
        req({ mode: 'APPEND', rows: [{ rowNumber: 1, code: '01.03', description: 'New item', quantity: '1', unitRate: '2.00' }] }),
      );
      const creates = createsFrom(repo);
      expect(creates).toHaveLength(1);
      expect(creates[0].parentId).toBe('p01');
      expect(creates[0].sortOrder).toBe(2);
      expect(creates[0].path).toBe(`p01/${creates[0].id}`);
    });

    it('rejects a code that already exists in the version', async () => {
      const { svc, repo } = build({ boq, existingNodes, existingCodes: new Set(['01', '01.01', '01.02']) });
      await expect(
        svc.import(identity, 'p1', req({ mode: 'APPEND', rows: [{ rowNumber: 1, code: '01.01', description: 'dup', quantity: '1', unitRate: '2.00' }] })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createManyNodes).not.toHaveBeenCalled();
    });
  });

  describe('draft resolution', () => {
    it('creates a new empty draft derived from the approved version when none is open', async () => {
      const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', currentDraftVersionId: null, currentApprovedVersionId: 'appr1' };
      const { svc, repo } = build({ boq });
      await svc.import(identity, 'p1', req({ rows: [{ rowNumber: 1, code: '1', description: 'x' }] }));
      expect(repo.createVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'DRAFT', derivedFromVersionId: 'appr1' }),
      );
    });

    it('refuses when the current version is not an editable draft', async () => {
      const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', currentDraftVersionId: 'v1', currentApprovedVersionId: null };
      const { svc } = build({ boq, version: { id: 'v1', status: 'BASELINED', versionNumber: 1 } });
      await expect(
        svc.import(identity, 'p1', req({ rows: [{ rowNumber: 1, code: '1', description: 'x' }] })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('add-to-library (Q7)', () => {
    it('creates one library item per new leaf description, skipping ones already present', async () => {
      const { svc, libraryRepo } = build({
        libraryExisting: [{ code: 'MASS-CONCRETE', description: 'Mass concrete', active: true }],
      });
      const result = await svc.import(
        identity,
        'p1',
        req({
          addToLibrary: true,
          rows: [
            { rowNumber: 1, code: '1', description: 'Mass concrete', unit: 'm3', quantity: '1', unitRate: '85.00' },
            { rowNumber: 2, code: '2', description: 'Rebar', unit: 'kg', quantity: '1', unitRate: '1.20' },
          ],
        }),
      );
      const items = libraryRepo.createManyFromImport.mock.calls[0][1] as { code: string; description: string; lastUsedRate?: string }[];
      expect(items).toHaveLength(1);
      expect(items[0].description).toBe('Rebar');
      expect(items[0].code).toBe('REBAR');
      expect(items[0].lastUsedRate).toBe('1.20');
      expect(result.addedToLibraryCount).toBe(1);
    });

    it('does not touch the library when the flag is off', async () => {
      const { svc, libraryRepo } = build();
      await svc.import(identity, 'p1', req({ addToLibrary: false, rows: [{ rowNumber: 1, code: '1', description: 'Rebar', quantity: '1', unitRate: '2.00' }] }));
      expect(libraryRepo.createManyFromImport).not.toHaveBeenCalled();
    });
  });

  describe('unit registry warning', () => {
    it('flags an unknown unit when the registry is populated', async () => {
      const { svc } = build({ units: [{ code: 'm3', symbol: 'm³' }] });
      const result = await svc.import(
        identity,
        'p1',
        req({ rows: [{ rowNumber: 1, code: '1', description: 'x', unit: 'furlong', quantity: '1', unitRate: '2.00' }] }),
      );
      expect(result.warnings.some((w) => w.code === 'UNKNOWN_UNIT')).toBe(true);
    });

    it('stays silent when the registry is empty', async () => {
      const { svc } = build({ units: [] });
      const result = await svc.import(
        identity,
        'p1',
        req({ rows: [{ rowNumber: 1, code: '1', description: 'x', unit: 'furlong', quantity: '1', unitRate: '2.00' }] }),
      );
      expect(result.warnings.some((w) => w.code === 'UNKNOWN_UNIT')).toBe(false);
    });
  });
});
