import { ProjectCategory } from '@prisma/client';

// The seed module lives under prisma/seeds; jest's rootDir is src, so the test that exercises it
// lives here and reaches across. It imports the pure, DB-free seed function + its starting set.
import {
  PROJECT_SUBTYPE_SEED,
  seedProjectSubtypes,
} from '../../../../prisma/seeds/project-subtypes.seed.js';

/** A minimal in-memory stand-in for the `projectSubtype` delegate the seed touches. */
function fakePrisma(initial: { category: ProjectCategory; name: string }[] = []) {
  const rows = [...initial];
  return {
    rows,
    projectSubtype: {
      findMany: jest.fn(async () => rows.map((r) => ({ category: r.category, name: r.name }))),
      createMany: jest.fn(async ({ data }: { data: { category: ProjectCategory; name: string }[] }) => {
        rows.push(...data.map((d) => ({ category: d.category, name: d.name })));
        return { count: data.length };
      }),
    },
  };
}

const TOTAL = Object.values(PROJECT_SUBTYPE_SEED).reduce((n, names) => n + names.length, 0);

describe('seedProjectSubtypes (PTD1-PTD5)', () => {
  it('creates the full ACCO starting set on an empty org', async () => {
    const prisma = fakePrisma();
    const result = await seedProjectSubtypes(prisma as never, 'org-1');

    expect(result.created).toBe(TOTAL);
    expect(result.alreadyPresent).toBe(0);
    expect(prisma.rows).toHaveLength(TOTAL);
    // Every created row carries the org id.
    expect(prisma.projectSubtype.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ organizationId: 'org-1', category: ProjectCategory.COMMERCIAL }),
      ]),
    });
  });

  it('is idempotent — a second run creates nothing', async () => {
    const prisma = fakePrisma();
    await seedProjectSubtypes(prisma as never, 'org-1');
    prisma.projectSubtype.createMany.mockClear();

    const second = await seedProjectSubtypes(prisma as never, 'org-1');
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(TOTAL);
    expect(prisma.projectSubtype.createMany).not.toHaveBeenCalled();
  });

  it('adds only the missing rows on a partially-seeded org', async () => {
    const prisma = fakePrisma([{ category: ProjectCategory.COMMERCIAL, name: 'Hotels' }]);
    const result = await seedProjectSubtypes(prisma as never, 'org-1');

    expect(result.created).toBe(TOTAL - 1);
    expect(result.alreadyPresent).toBe(1);
  });
});
