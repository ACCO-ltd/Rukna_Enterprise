// The seed module lives under prisma/seeds; jest's rootDir is src, so the test that exercises it
// lives here and reaches across (same arrangement as project-subtypes.seed.spec.ts).
import {
  STANDARD_UNITS_OF_MEASURE,
  normaliseUnitSymbol,
  seedUnitsOfMeasure,
} from '../../../../prisma/seeds/units-of-measure.js';

type Row = { organizationId: string; code: string; name: string; symbol: string };

function fakePrisma(initial: Row[] = [], { dropOnInsert = 0 } = {}) {
  const rows = [...initial];
  return {
    rows,
    unitOfMeasure: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
        rows
          .filter((r) => r.organizationId === where.organizationId)
          .map((r) => ({ code: r.code, symbol: r.symbol })),
      ),
      // `dropOnInsert` stands in for skipDuplicates dropping rows a concurrent run inserted.
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        const inserted = data.slice(dropOnInsert);
        rows.push(...inserted);
        return { count: inserted.length };
      }),
    },
  };
}

describe('seedUnitsOfMeasure', () => {
  it('installs the standard construction units on an empty organization', async () => {
    const prisma = fakePrisma();
    const result = await seedUnitsOfMeasure(prisma as never, 'org-1');

    expect(result).toEqual({ created: STANDARD_UNITS_OF_MEASURE.length, alreadyPresent: 0 });
    expect(prisma.rows.map((r) => r.symbol)).toEqual(['m³', 'm²', 'm', 'kg', 't', 'nr', 'item', 'LS', 'sum']);
    expect(prisma.rows.every((r) => r.organizationId === 'org-1')).toBe(true);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const prisma = fakePrisma();
    await seedUnitsOfMeasure(prisma as never, 'org-1');
    const second = await seedUnitsOfMeasure(prisma as never, 'org-1');

    expect(second).toEqual({ created: 0, alreadyPresent: STANDARD_UNITS_OF_MEASURE.length });
    expect(prisma.unitOfMeasure.createMany).toHaveBeenCalledTimes(1);
  });

  it('skips a unit the org already has under another code with the same symbol', async () => {
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'T', name: 'Metric ton', symbol: 't' }]);
    await seedUnitsOfMeasure(prisma as never, 'org-1');

    expect(prisma.rows.filter((r) => r.symbol === 't')).toHaveLength(1);
    expect(prisma.rows.find((r) => r.code === 'TON')).toBeUndefined();
  });

  it('skips a unit whose code exists with a different symbol, and never edits it', async () => {
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'm3', name: 'Cubic meter', symbol: 'cu.m' }]);
    const result = await seedUnitsOfMeasure(prisma as never, 'org-1');

    expect(result.alreadyPresent).toBe(1);
    expect(prisma.rows.filter((r) => r.code.toLowerCase() === 'm3')).toEqual([
      { organizationId: 'org-1', code: 'm3', name: 'Cubic meter', symbol: 'cu.m' },
    ]);
  });

  it('only looks at the target organization', async () => {
    const prisma = fakePrisma([{ organizationId: 'org-other', code: 'M3', name: 'Cubic metre', symbol: 'm³' }]);
    const result = await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(result.created).toBe(STANDARD_UNITS_OF_MEASURE.length);
  });

  it.each(['m3', 'M3', 'm^3', ' m 3 ', 'm³'])('treats an existing %j as cubic metres', async (symbol) => {
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'CUM', name: 'Cubic meter', symbol }]);
    await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(prisma.rows.find((r) => r.code === 'M3')).toBeUndefined();
  });

  it.each(['m2', 'M^2', 'm²'])('treats an existing %j as square metres', async (symbol) => {
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'SQM', name: 'Square meter', symbol }]);
    await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(prisma.rows.find((r) => r.code === 'M2')).toBeUndefined();
    // Metres are still a different unit.
    expect(prisma.rows.find((r) => r.code === 'M')).toBeDefined();
  });

  it('normalises symbols without conflating distinct units', () => {
    expect(normaliseUnitSymbol('m^3')).toBe('m³');
    expect(normaliseUnitSymbol('M2')).toBe('m²');
    expect(normaliseUnitSymbol('m')).toBe('m');
    expect(normaliseUnitSymbol('kg')).toBe('kg');
  });

  it('reports the count the database actually inserted', async () => {
    const prisma = fakePrisma([], { dropOnInsert: 2 });
    const result = await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(result).toEqual({
      created: STANDARD_UNITS_OF_MEASURE.length - 2,
      alreadyPresent: 2,
    });
  });

  it('adds LS and sum without duplicating a lump-sum unit an organization already typed as ls', async () => {
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'LUMP', name: 'Lump', symbol: 'ls' }]);
    await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(prisma.rows.filter((r) => r.symbol.toLowerCase() === 'ls')).toHaveLength(1);
    expect(prisma.rows.filter((r) => r.symbol === 'sum')).toHaveLength(1);
  });

  it('ignores dots when comparing symbols, so an existing L.S. counts as LS', async () => {
    expect(normaliseUnitSymbol('L.S.')).toBe('ls');
    expect(normaliseUnitSymbol('cu. m3')).toBe('cum³');
    const prisma = fakePrisma([{ organizationId: 'org-1', code: 'LUMPSUM', name: 'Lump sum', symbol: 'L.S.' }]);
    await seedUnitsOfMeasure(prisma as never, 'org-1');
    expect(prisma.rows.filter((r) => normaliseUnitSymbol(r.symbol) === 'ls')).toHaveLength(1);
  });
});
