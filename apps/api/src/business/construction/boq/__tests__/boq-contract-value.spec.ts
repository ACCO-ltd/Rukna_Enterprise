import {
  inContractBillableTotal,
  contributesToInContractTotal,
  contingencyRemaining,
  isContingencyLeaf,
} from '../domain/boq-contract-value.policy.js';

/**
 * The in-contract billable total (ADR-029 T-1 / L-5) — the one figure a committed BOQ ties out
 * to, and the exact function R3's contract tie-out reuses. Pure and DB-free, so this runs on its
 * own. Rule: Σ leaf.totalAmount over every leaf EXCEPT SEPARATE_CHARGE — IN_CONTRACT, CONTINGENCY
 * and ABSORBED count; SEPARATE_CHARGE is out; sections carry nothing.
 */

type NodeFixture = {
  isLeaf: boolean;
  commercialTreatment: 'IN_CONTRACT' | 'SEPARATE_CHARGE' | 'ABSORBED';
  totalAmount: string | null;
  nodeRole?: 'WORK' | 'CONTINGENCY';
};

const leaf = (
  totalAmount: string | null,
  commercialTreatment: NodeFixture['commercialTreatment'] = 'IN_CONTRACT',
  nodeRole: NodeFixture['nodeRole'] = 'WORK',
): NodeFixture => ({ isLeaf: true, commercialTreatment, totalAmount, nodeRole });

const section = (): NodeFixture => ({ isLeaf: false, commercialTreatment: 'IN_CONTRACT', totalAmount: null });

describe('inContractBillableTotal — ADR-029 T-1', () => {
  it('sums IN_CONTRACT leaves and ignores sections', () => {
    const total = inContractBillableTotal([
      section(),
      leaf('100.00'),
      leaf('250.50'),
    ] as never);
    expect(total?.toFixed(2)).toBe('350.50');
  });

  it('includes CONTINGENCY leaves — the allowance is part of the contract value', () => {
    const total = inContractBillableTotal([
      leaf('100.00'),
      leaf('40.00', 'IN_CONTRACT', 'CONTINGENCY'),
    ] as never);
    expect(total?.toFixed(2)).toBe('140.00');
  });

  it('excludes SEPARATE_CHARGE leaves — billed outside the contract', () => {
    const total = inContractBillableTotal([
      leaf('100.00'),
      leaf('500.00', 'SEPARATE_CHARGE'),
    ] as never);
    expect(total?.toFixed(2)).toBe('100.00');
  });

  it('includes ABSORBED leaves — funded by an equal contingency draw, so net-zero to the total', () => {
    const total = inContractBillableTotal([
      leaf('100.00'),
      leaf('25.00', 'ABSORBED'),
    ] as never);
    expect(total?.toFixed(2)).toBe('125.00');
  });

  it('returns null when nothing contributes — never a false zero', () => {
    expect(inContractBillableTotal([section()] as never)).toBeNull();
    expect(inContractBillableTotal([leaf('500.00', 'SEPARATE_CHARGE')] as never)).toBeNull();
  });

  it('classifies contribution per node', () => {
    expect(contributesToInContractTotal(leaf('1.00') as never)).toBe(true);
    expect(contributesToInContractTotal(leaf('1.00', 'IN_CONTRACT', 'CONTINGENCY') as never)).toBe(true);
    expect(contributesToInContractTotal(leaf('1.00', 'SEPARATE_CHARGE') as never)).toBe(false);
    expect(contributesToInContractTotal(leaf('1.00', 'ABSORBED') as never)).toBe(true);
    expect(contributesToInContractTotal(section() as never)).toBe(false);
  });
});

/**
 * Contingency remaining (ADR-029 CONST-BOQ-028 / spec C-2) — Σ totalAmount over CONTINGENCY-role
 * leaves, derived from the live amounts (a draw lowers the leaf, so the live sum IS what is left).
 */
describe('contingencyRemaining — ADR-029 C-2', () => {
  it('sums only CONTINGENCY-role leaves', () => {
    const total = contingencyRemaining([
      leaf('1000.00'),
      leaf('500.00', 'IN_CONTRACT', 'CONTINGENCY'),
      leaf('250.00', 'IN_CONTRACT', 'CONTINGENCY'),
    ] as never);
    expect(total?.toFixed(2)).toBe('750.00');
  });

  it('ignores WORK, SEPARATE_CHARGE and ABSORBED leaves and sections', () => {
    const total = contingencyRemaining([
      section(),
      leaf('1000.00'),
      leaf('500.00', 'SEPARATE_CHARGE', 'CONTINGENCY'), // still a CONTINGENCY leaf → counts
      leaf('40.00', 'ABSORBED'),
    ] as never);
    // Only the SEPARATE_CHARGE line carries nodeRole CONTINGENCY here, so it is the sole contributor.
    expect(total?.toFixed(2)).toBe('500.00');
  });

  it('reflects a draw: the remaining is the live post-draw allowance amount', () => {
    // 500 allowance after a 500 draw is a 0.00 line — a real fact, not "no allowance".
    const total = contingencyRemaining([
      leaf('0.00', 'IN_CONTRACT', 'CONTINGENCY'),
    ] as never);
    expect(total?.toFixed(2)).toBe('0.00');
  });

  it('returns null when there is no contingency line — never a false zero', () => {
    expect(contingencyRemaining([leaf('1000.00'), section()] as never)).toBeNull();
  });

  it('isContingencyLeaf marks only CONTINGENCY-role leaves', () => {
    expect(isContingencyLeaf(leaf('1.00', 'IN_CONTRACT', 'CONTINGENCY') as never)).toBe(true);
    expect(isContingencyLeaf(leaf('1.00') as never)).toBe(false);
    // A section marked CONTINGENCY carries no amount, so it is not a contributor.
    expect(isContingencyLeaf({ isLeaf: false, nodeRole: 'CONTINGENCY' } as never)).toBe(false);
  });
});
