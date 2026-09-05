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
  it('derives forecast exposure as committed less actual', () => {
    const position = buildPosition(totals('420000', '310000', '265000'), null, 'USD', true);
    expect(position.committed).toBe('420000.00');
    expect(position.forecastExposure).toBe('155000.00');
  });

  /**
   * More billed than committed is a data problem to investigate, not a negative exposure to
   * report. Flooring at zero keeps a broken ledger from rendering as a nonsense figure.
   */
  it('floors exposure at zero rather than reporting a negative', () => {
    const position = buildPosition(totals('100', '0', '250'), null, 'USD', true);
    expect(position.forecastExposure).toBe('0.00');
  });

  it('leaves every percentage null when no budget is baselined', () => {
    const position = buildPosition(totals('420000'), null, 'USD', true);
    expect(position.budgetTotal).toBeNull();
    expect(position.committedPercentOfBudget).toBeNull();
    expect(position.actualPercentOfBudget).toBeNull();
  });

  it('measures each stage against the budget when one exists', () => {
    const position = buildPosition(totals('420000', '310000', '265000'), d('2400000'), 'USD', true);
    expect(position.committedPercentOfBudget).toBe(17.5);
    expect(position.accruedPercentOfBudget).toBe(12.9);
    expect(position.actualPercentOfBudget).toBe(11);
  });

  /** Withheld, never zeroed — a figure the caller may not see must not read as "nothing spent". */
  it('withholds money and percentages without financial visibility', () => {
    const position = buildPosition(totals('420000'), d('2400000'), 'USD', false);
    expect(position.committed).toBeNull();
    expect(position.budgetTotal).toBeNull();
    expect(position.committedPercentOfBudget).toBeNull();
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
    expect(section.remaining).toBe('900.00');
    expect(section.percentUsed).toBe(10);
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
    expect(leaf.remaining).toBeNull();
    expect(leaf.percentUsed).toBeNull();
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
    expect(projectLevel.remaining).toBe('180.00');
    expect(projectLevel.depth).toBe(0);
    // It is the last row, after the BOQ sections it sits beside.
    expect(rows.at(-1)!.kind).toBe('PROJECT_LEVEL');
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
    expect(section.percentUsed).toBeNull();
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
    expect(rows.find((r) => r.code === '002.001')!.remaining).toBe('400.00');
  });
});
