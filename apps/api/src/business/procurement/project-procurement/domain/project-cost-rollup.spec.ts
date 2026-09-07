import { Decimal } from '@prisma/client/runtime/library';

import {
  ZERO,
  addStage,
  buildPosition,
  emptyStageTotals,
  percentOf,
  rollUpCostByBoq,
  type BoqNodeShape,
} from './project-cost-rollup.js';

function d(value: string | number): Decimal {
  return new Decimal(value);
}

function totals(committed: string, accrued = '0', actual = '0') {
  const t = emptyStageTotals();
  addStage(t, 'COMMITTED', d(committed));
  addStage(t, 'ACCRUED', d(accrued));
  addStage(t, 'ACTUAL', d(actual));
  return t;
}

/**
 * A three-level BOQ: two sections, one with two children, one of which has a leaf of its own.
 * Cost is coded to leaves — that is what a PO line points at — so every assertion about a section
 * is really an assertion about the rollup.
 */
const TREE: BoqNodeShape[] = [
  { id: 's1', parentId: null, code: '001', description: 'Preliminaries', depth: 0, sortOrder: 0, isLeaf: false },
  { id: 's2', parentId: null, code: '002', description: 'Substructure', depth: 0, sortOrder: 1, isLeaf: false },
  { id: 's2a', parentId: 's2', code: '002.001', description: 'Excavation', depth: 1, sortOrder: 0, isLeaf: true },
  { id: 's2b', parentId: 's2', code: '002.002', description: 'Concrete', depth: 1, sortOrder: 1, isLeaf: false },
  { id: 's2b1', parentId: 's2b', code: '002.002.001', description: 'Blinding', depth: 2, sortOrder: 0, isLeaf: true },
];

describe('percentOf', () => {
  /**
   * The distinction the whole budget feature rests on: a project with no budget has not spent 0%
   * of it. Returning 0 would invent a control that does not exist.
   */
  it('is null when there is nothing to be a percentage of', () => {
    expect(percentOf(d(100), null)).toBeNull();
    expect(percentOf(d(100), ZERO)).toBeNull();
  });

  it('reports one decimal place', () => {
    expect(percentOf(d(176), d(1000))).toBe(17.6);
    expect(percentOf(d(1), d(3))).toBe(33.3);
  });
});

describe('buildPosition', () => {
  it('reports committed-to-date as the sum of the three stages, with or without a budget', () => {
    const position = buildPosition(totals('420000', '310000', '265000'), null, 'USD', true);
    expect(position.committed).toBe('420000.00');
    // 420k still on order + 310k received-not-billed + 265k billed.
    expect(position.committedToDate).toBe('995000.00');
  });

  /**
   * The defect this replaces. COMMITTED is a signed running balance that goods receipt reduces,
   * so `budget − committed` gave a project back headroom it had already spent: receiving what
   * you ordered restored the budget. The three stages always sum to what was committed, so
   * measuring against their total holds at every point in the lifecycle.
   */
  it('does not release budget headroom as an order moves through its stages', () => {
    const budget = d('1000');
    const afterOrder = buildPosition(totals('400', '0', '0'), budget, 'USD', true);
    const afterReceipt = buildPosition(totals('0', '400', '0'), budget, 'USD', true);
    const afterBill = buildPosition(totals('0', '0', '400'), budget, 'USD', true);

    expect(afterOrder.uncommittedBudget).toBe('600.00');
    expect(afterReceipt.uncommittedBudget).toBe('600.00');
    expect(afterBill.uncommittedBudget).toBe('600.00');
  });

  it('leaves every budget figure null when no budget is baselined', () => {
    const position = buildPosition(totals('420000'), null, 'USD', true);
    expect(position.budgetTotal).toBeNull();
    expect(position.uncommittedBudget).toBeNull();
    expect(position.budgetLessActual).toBeNull();
    expect(position.committedOfBudgetPercent).toBeNull();
    expect(position.actualOfBudgetPercent).toBeNull();
  });

  /**
   * The two remainders are NOT interchangeable, which is exactly why neither is called
   * "remaining". Uncommitted budget is what is still free to spend, measured against everything
   * ordered, received or billed; budget less actual counts money already on a purchase order as
   * available, and reading it as headroom is how a project overspends a budget it believes it is
   * under.
   */
  it('keeps the two budget remainders distinct', () => {
    const position = buildPosition(totals('760000', '560000', '465000'), d('2800000'), 'USD', true);
    // 2.8m budget less 1.785m committed to date (760k + 560k + 465k).
    expect(position.uncommittedBudget).toBe('1015000.00');
    expect(position.budgetLessActual).toBe('2335000.00');
    expect(position.uncommittedBudget).not.toBe(position.budgetLessActual);
  });

  it('names each ratio for its own numerator', () => {
    const position = buildPosition(totals('420000', '310000', '265000'), d('2400000'), 'USD', true);
    expect(position.committedOfBudgetPercent).toBe(17.5);
    expect(position.accruedOfBudgetPercent).toBe(12.9);
    expect(position.actualOfBudgetPercent).toBe(11);
  });

  /** Withheld, never zeroed — a figure the caller may not see must not read as "nothing spent". */
  it('withholds money and percentages without financial visibility', () => {
    const position = buildPosition(totals('420000'), d('2400000'), 'USD', false);
    expect(position.committed).toBeNull();
    expect(position.budgetTotal).toBeNull();
    expect(position.uncommittedBudget).toBeNull();
    expect(position.committedOfBudgetPercent).toBeNull();
  });
});

describe('rollUpCostByBoq', () => {
  /**
   * Cost lands on leaves and must appear on every ancestor, or a section reads as zero while its
   * children carry the money. This is the single most important behaviour in the file.
   */
  it('rolls leaf cost up through every ancestor', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([
        ['s2a', totals('100', '80', '60')],
        ['s2b1', totals('50', '40', '30')],
      ]),
      budgetByNode: new Map(),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    const byCode = new Map(rows.map((r) => [r.code, r]));

    expect(byCode.get('002')!.committed).toBe('150.00');
    expect(byCode.get('002')!.accrued).toBe('120.00');
    expect(byCode.get('002.002')!.committed).toBe('50.00');
    expect(byCode.get('002.002.001')!.committed).toBe('50.00');
    // Untouched scope is omitted: three hundred zero rows would bury the five that matter.
    expect(byCode.has('001')).toBe(false);
  });

  it('rolls budget up the same hierarchy and derives remaining from it', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([['s2a', totals('100')]]),
      budgetByNode: new Map([
        ['s2a', d('400')],
        ['s2b1', d('600')],
      ]),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    const section = rows.find((r) => r.code === '002')!;

    expect(section.budget).toBe('1000.00');
    expect(section.uncommittedBudget).toBe('900.00');
    expect(section.committedOfBudgetPercent).toBe(10);
  });

  /** Without a budget there is nothing for cost to remain of, and no percentage to be used. */
  it('leaves remaining and percentUsed null where no budget is set', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([['s2a', totals('100')]]),
      budgetByNode: new Map(),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    const leaf = rows.find((r) => r.code === '002.001')!;
    expect(leaf.budget).toBeNull();
    expect(leaf.uncommittedBudget).toBeNull();
    expect(leaf.committedOfBudgetPercent).toBeNull();
    expect(leaf.actualOfBudgetPercent).toBeNull();
  });

  /**
   * Project cost with no BOQ line — site office, transport, insurance — is real and appears as a
   * peer of the sections. It is not hidden and not folded into one of them. Cost with no
   * *project* never reaches this function; that is corporate overhead.
   */
  it('reports project-level cost as its own row, not inside a section', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([
        ['s2a', totals('100')],
        [null, totals('70', '50', '33')],
      ]),
      budgetByNode: new Map([[null, d('250')]]),
      projectLevelLabel: 'Project-level (non-BOQ)',
      mayViewFinancials: true,
    });
    const projectLevel = rows.find((r) => r.kind === 'PROJECT_LEVEL')!;

    expect(projectLevel.code).toBeNull();
    expect(projectLevel.description).toBe('Project-level (non-BOQ)');
    expect(projectLevel.committed).toBe('70.00');
    // 250 budget less 153 committed to date (70 on order + 50 received + 33 billed).
    expect(projectLevel.uncommittedBudget).toBe('97.00');
    expect(projectLevel.depth).toBe(0);
    // It is the last row, after the BOQ sections it sits beside.
    expect(rows.at(-1)!.kind).toBe('PROJECT_LEVEL');
  });

  /**
   * Project-level cost is spendable, and it is broken out by the category it was coded to.
   * Budget and cost meet on the same `spendCategoryId`, which is exactly what makes the budget
   * consumable rather than a reporting artefact.
   */
  it('breaks project-level cost into its named spend categories', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([[null, totals('8400', '24600')]]),
      budgetByNode: new Map([[null, d('390000')]]),
      projectLevelLabel: 'Project-level (non-BOQ)',
      mayViewFinancials: true,
      projectLevelByCategory: [
        { spendCategoryId: 'c-transport', name: 'Transport', cost: totals('8400', '12600'), budget: d('120000') },
        { spendCategoryId: 'c-overhead', name: 'Site overhead', cost: totals('0', '12000'), budget: d('180000') },
        // Budgeted, nothing bought yet — a real state, and it must still appear.
        { spendCategoryId: 'c-insurance', name: 'Insurance', cost: null, budget: d('90000') },
      ],
    });

    const parent = rows.find((r) => r.kind === 'PROJECT_LEVEL')!;
    expect(parent.hasChildren).toBe(true);

    const children = rows.filter((r) => r.kind === 'PROJECT_LEVEL_CATEGORY');
    expect(children.map((c) => c.description)).toEqual(['Transport', 'Site overhead', 'Insurance']);
    expect(children[0]!.committed).toBe('8400.00');
    expect(children[0]!.budget).toBe('120000.00');
    expect(children[0]!.depth).toBe(1);
    // Budgeted with no spend reads as a zero against a real budget, not as absent.
    expect(children[2]!.committed).toBe('0.00');
    expect(children[2]!.uncommittedBudget).toBe('90000.00');
  });

  it('leaves the project-level bucket childless when no category has been used', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([[null, totals('70')]]),
      budgetByNode: new Map([[null, d('250')]]),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    expect(rows.find((r) => r.kind === 'PROJECT_LEVEL')!.hasChildren).toBe(false);
    expect(rows.filter((r) => r.kind === 'PROJECT_LEVEL_CATEGORY')).toHaveLength(0);
  });

  it('orders rows depth-first so a section is followed by its own children', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([
        ['s2a', totals('10')],
        ['s2b1', totals('20')],
      ]),
      budgetByNode: new Map(),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    expect(rows.map((r) => r.code)).toEqual(['002', '002.001', '002.002', '002.002.001']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2]);
  });

  it('marks which rows can be expanded', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([['s2b1', totals('20')]]),
      budgetByNode: new Map(),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get('002')!.hasChildren).toBe(true);
    expect(byCode.get('002.002.001')!.hasChildren).toBe(false);
  });

  it('withholds money but keeps the structure without financial visibility', () => {
    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([['s2a', totals('100')]]),
      budgetByNode: new Map([['s2a', d('400')]]),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: false,
    });
    const section = rows.find((r) => r.code === '002')!;
    expect(section.committed).toBeNull();
    expect(section.budget).toBeNull();
    expect(section.committedOfBudgetPercent).toBeNull();
    // The scope itself is not a secret — a reader still sees which sections exist.
    expect(section.description).toBe('Substructure');
  });

  /** Reversals are ordinary signed rows, so a cancelled commitment nets out by summation alone. */
  it('nets signed reversal entries out of the rollup', () => {
    const netted = emptyStageTotals();
    addStage(netted, 'COMMITTED', d('500'));
    addStage(netted, 'COMMITTED', d('-500'));

    const rows = rollUpCostByBoq({
      nodes: TREE,
      costByNode: new Map([['s2a', netted]]),
      budgetByNode: new Map([['s2a', d('400')]]),
      projectLevelLabel: 'Project-level',
      mayViewFinancials: true,
    });
    expect(rows.find((r) => r.code === '002.001')!.committed).toBe('0.00');
    expect(rows.find((r) => r.code === '002.001')!.uncommittedBudget).toBe('400.00');
  });
});
