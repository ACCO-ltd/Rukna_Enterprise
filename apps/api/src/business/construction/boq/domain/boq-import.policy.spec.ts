import type { BoqImportRow } from '@erp/types';

import {
  MAX_IMPORT_ROWS,
  planBoqImport,
  type BoqImportContext,
} from './boq-import.policy.js';

// A row builder that defaults everything but code/description, so each test states only what
// it exercises. rowNumber tracks the caller's array order unless overridden.
function rows(...specs: Partial<BoqImportRow>[]): BoqImportRow[] {
  return specs.map((spec, index) => ({
    rowNumber: spec.rowNumber ?? index + 1,
    code: spec.code ?? '',
    description: spec.description ?? 'Item',
    unit: spec.unit ?? null,
    quantity: spec.quantity ?? null,
    unitRate: spec.unitRate ?? null,
    sheetAmount: spec.sheetAmount ?? null,
  }));
}

const baseContext: BoqImportContext = {
  boqCurrency: 'USD',
  existingCodes: new Set<string>(),
  mode: 'REPLACE',
};

const ctx = (over: Partial<BoqImportContext> = {}): BoqImportContext => ({ ...baseContext, ...over });

function codes(plan: ReturnType<typeof planBoqImport>): string[] {
  return plan.nodes.map((node) => node.code);
}

function node(plan: ReturnType<typeof planBoqImport>, code: string) {
  const found = plan.nodes.find((n) => n.code === code);
  if (found === undefined) throw new Error(`no planned node ${code}`);
  return found;
}

describe('planBoqImport', () => {
  describe('a well-formed hierarchical sheet', () => {
    const plan = planBoqImport(
      rows(
        { code: '02', description: 'Concrete works' },
        { code: '02.01', description: 'Substructure' },
        { code: '02.01.001', description: 'Mass concrete', unit: 'm3', quantity: '10', unitRate: '85.00' },
        { code: '02.01.002', description: 'Reinforcement', unit: 'kg', quantity: '250', unitRate: '1.20' },
      ),
      ctx(),
    );

    it('accepts it with no violations', () => {
      expect(plan.ok).toBe(true);
      expect(plan.violations).toHaveLength(0);
    });

    it('marks parents as sections and childless codes as leaves', () => {
      expect(node(plan, '02').isLeaf).toBe(false);
      expect(node(plan, '02.01').isLeaf).toBe(false);
      expect(node(plan, '02.01.001').isLeaf).toBe(true);
      expect(node(plan, '02.01.002').isLeaf).toBe(true);
    });

    it('derives parentCode from the dotted code', () => {
      expect(node(plan, '02').parentCode).toBeNull();
      expect(node(plan, '02.01').parentCode).toBe('02');
      expect(node(plan, '02.01.001').parentCode).toBe('02.01');
    });

    it('sets depth from the segment count (root is 0)', () => {
      expect(node(plan, '02').depth).toBe(0);
      expect(node(plan, '02.01').depth).toBe(1);
      expect(node(plan, '02.01.001').depth).toBe(2);
    });

    it('recomputes the leaf amount and leaves sections null', () => {
      expect(node(plan, '02.01.001').totalAmount).toBe('850.00');
      expect(node(plan, '02.01.002').totalAmount).toBe('300.00');
      expect(node(plan, '02').totalAmount).toBeNull();
    });

    it('gives leaves the BOQ currency and sections none', () => {
      expect(node(plan, '02.01.001').currency).toBe('USD');
      expect(node(plan, '02').currency).toBeNull();
    });

    it('orders nodes parents-before-children', () => {
      const order = codes(plan);
      expect(order.indexOf('02')).toBeLessThan(order.indexOf('02.01'));
      expect(order.indexOf('02.01')).toBeLessThan(order.indexOf('02.01.001'));
    });

    it('numbers siblings densely in sheet order', () => {
      expect(node(plan, '02.01.001').sortOrder).toBe(0);
      expect(node(plan, '02.01.002').sortOrder).toBe(1);
    });
  });

  describe('missing ancestors', () => {
    const plan = planBoqImport(
      rows(
        { code: '02.01.001', description: 'Mass concrete', unit: 'm3', quantity: '10', unitRate: '85.00' },
      ),
      ctx(),
    );

    it('synthesises the ancestor sections from the code', () => {
      expect(plan.ok).toBe(true);
      expect(codes(plan).sort()).toEqual(['02', '02.01', '02.01.001']);
      expect(node(plan, '02').autoCreated).toBe(true);
      expect(node(plan, '02.01').autoCreated).toBe(true);
      expect(node(plan, '02').isLeaf).toBe(false);
    });

    it('warns once per synthesised section', () => {
      const auto = plan.warnings.filter((w) => w.code === 'AUTO_CREATED_SECTION');
      expect(auto.map((w) => w.nodeCode).sort()).toEqual(['02', '02.01']);
    });

    it('names an auto-created section after its code until renamed', () => {
      expect(node(plan, '02').description).toBe('02');
    });
  });

  describe('a section that carries pricing', () => {
    const plan = planBoqImport(
      rows(
        { code: '03', description: 'Masonry', unit: 'm2', quantity: '5', unitRate: '40.00' },
        { code: '03.01', description: 'Blockwork', unit: 'm2', quantity: '5', unitRate: '40.00' },
      ),
      ctx(),
    );

    it('treats it as a section and drops the pricing, with a warning not an error', () => {
      expect(plan.ok).toBe(true);
      const section = node(plan, '03');
      expect(section.isLeaf).toBe(false);
      expect(section.quantity).toBeNull();
      expect(section.unitRate).toBeNull();
      expect(section.unit).toBeNull();
      expect(section.totalAmount).toBeNull();
      expect(plan.warnings.some((w) => w.code === 'SECTION_CARRIES_PRICING' && w.nodeCode === '03')).toBe(true);
    });
  });

  describe('duplicate codes', () => {
    it('blocks a code that appears twice in the sheet', () => {
      const plan = planBoqImport(
        rows(
          { code: '01.01', description: 'First', quantity: '1', unitRate: '2.00' },
          { code: '01.01', description: 'Second', quantity: '1', unitRate: '3.00' },
        ),
        ctx(),
      );
      expect(plan.ok).toBe(false);
      const dup = plan.violations.filter((v) => v.code === 'DUPLICATE_CODE');
      expect(dup).toHaveLength(1);
      expect(dup[0].rowNumber).toBe(2);
    });
  });

  describe('APPEND mode', () => {
    it('blocks a code that already exists in the version', () => {
      const plan = planBoqImport(
        rows({ code: '01.01', description: 'Dup', quantity: '1', unitRate: '2.00' }),
        ctx({ mode: 'APPEND', existingCodes: new Set(['01.01']) }),
      );
      expect(plan.ok).toBe(false);
      expect(plan.violations.some((v) => v.code === 'DUPLICATE_CODE')).toBe(true);
    });

    it('attaches to an existing parent without re-creating it', () => {
      const plan = planBoqImport(
        rows({ code: '01.05', description: 'New item', unit: 'nr', quantity: '2', unitRate: '10.00' }),
        ctx({ mode: 'APPEND', existingCodes: new Set(['01']) }),
      );
      expect(plan.ok).toBe(true);
      // 01 exists already, so it is NOT planned, but the new leaf points at it.
      expect(codes(plan)).toEqual(['01.05']);
      expect(node(plan, '01.05').parentCode).toBe('01');
      expect(plan.warnings.some((w) => w.code === 'AUTO_CREATED_SECTION')).toBe(false);
    });
  });

  describe('row-shape violations', () => {
    it('flags a missing code', () => {
      const plan = planBoqImport(rows({ code: '  ', description: 'x' }), ctx());
      expect(plan.violations.some((v) => v.code === 'MISSING_CODE')).toBe(true);
      expect(plan.ok).toBe(false);
    });

    it('flags a missing description but still places the node', () => {
      const plan = planBoqImport(rows({ code: '01.01', description: '   ', quantity: '1', unitRate: '1.00' }), ctx());
      expect(plan.violations.some((v) => v.code === 'MISSING_DESCRIPTION')).toBe(true);
      expect(plan.ok).toBe(false);
    });

    it('flags an invalid code shape', () => {
      const plan = planBoqImport(rows({ code: '02..1', description: 'x' }), ctx());
      expect(plan.violations.some((v) => v.code === 'INVALID_CODE')).toBe(true);
    });
  });

  describe('pricing violations', () => {
    it('rejects a non-numeric quantity', () => {
      const plan = planBoqImport(rows({ code: '1', description: 'x', quantity: 'ten', unitRate: '2.00' }), ctx());
      expect(plan.violations.some((v) => v.code === 'NON_NUMERIC_QUANTITY')).toBe(true);
    });

    it('rejects a negative rate', () => {
      const plan = planBoqImport(rows({ code: '1', description: 'x', quantity: '1', unitRate: '-2.00' }), ctx());
      expect(plan.violations.some((v) => v.code === 'NEGATIVE_RATE')).toBe(true);
    });

    it('rejects a rate with too many decimal places', () => {
      const plan = planBoqImport(rows({ code: '1', description: 'x', quantity: '1', unitRate: '2.005' }), ctx());
      expect(plan.violations.some((v) => v.code === 'RATE_SCALE')).toBe(true);
    });
  });

  describe('soft findings', () => {
    it('warns on an unpriced leaf but imports it', () => {
      const plan = planBoqImport(rows({ code: '1', description: 'x', unit: 'm', quantity: '5' }), ctx());
      expect(plan.ok).toBe(true);
      expect(plan.warnings.some((w) => w.code === 'UNPRICED_ITEM')).toBe(true);
      expect(node(plan, '1').totalAmount).toBeNull();
    });

    it('warns on a unit outside the registry when one is supplied', () => {
      const plan = planBoqImport(
        rows({ code: '1', description: 'x', unit: 'furlong', quantity: '1', unitRate: '2.00' }),
        ctx({ knownUnits: new Set(['m', 'm2', 'm3', 'kg']) }),
      );
      expect(plan.warnings.some((w) => w.code === 'UNKNOWN_UNIT')).toBe(true);
    });

    it('does not check units when no registry is supplied', () => {
      const plan = planBoqImport(rows({ code: '1', description: 'x', unit: 'furlong', quantity: '1', unitRate: '2.00' }), ctx());
      expect(plan.warnings.some((w) => w.code === 'UNKNOWN_UNIT')).toBe(false);
    });

    it('warns when the sheet amount disagrees with qty × rate, but stores the computed value', () => {
      const plan = planBoqImport(
        rows({ code: '1', description: 'x', quantity: '10', unitRate: '85.00', sheetAmount: '900.00' }),
        ctx(),
      );
      expect(plan.warnings.some((w) => w.code === 'AMOUNT_MISMATCH')).toBe(true);
      expect(node(plan, '1').totalAmount).toBe('850.00');
    });

    it('is silent when the sheet amount matches', () => {
      const plan = planBoqImport(
        rows({ code: '1', description: 'x', quantity: '10', unitRate: '85.00', sheetAmount: '850.00' }),
        ctx(),
      );
      expect(plan.warnings.some((w) => w.code === 'AMOUNT_MISMATCH')).toBe(false);
    });
  });

  describe('structural limits', () => {
    it('rejects a code deeper than the hierarchy allows', () => {
      const tooDeep = '1.2.3.4.5.6.7.8.9'; // depth 8, limit is 7
      const plan = planBoqImport(rows({ code: tooDeep, description: 'x', quantity: '1', unitRate: '1.00' }), ctx());
      expect(plan.violations.some((v) => v.code === 'MAX_DEPTH_EXCEEDED')).toBe(true);
    });

    it('rejects a sheet over the row cap without planning anything', () => {
      const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ code: `${i + 1}`, description: 'x' }));
      const plan = planBoqImport(rows(...many), ctx());
      expect(plan.ok).toBe(false);
      expect(plan.violations.some((v) => v.code === 'TOO_MANY_ROWS')).toBe(true);
      expect(plan.nodes).toHaveLength(0);
    });
  });

  describe('an empty sheet', () => {
    it('plans nothing and does not fail', () => {
      const plan = planBoqImport([], ctx());
      expect(plan.ok).toBe(true);
      expect(plan.nodes).toHaveLength(0);
      expect(plan.violations).toHaveLength(0);
    });
  });
});
