import { describe, expect, it } from 'vitest';

import { testNode } from '@/features/boq/test-node';

import { claimableLines, isClaimable, lineLabel, unclaimedLines } from './boq-leaves';

const tree = [
  testNode({
    id: 'sec1',
    code: '01',
    description: 'Substructure Works',
    children: [
      testNode({
        id: 'leaf1',
        code: '01.01',
        description: 'Excavation',
        isLeaf: true,
        unit: 'm3',
        quantity: '1200.000',
        unitRate: '45.00',
        currency: 'USD',
      }),
      testNode({
        id: 'leaf2',
        code: '01.02',
        description: 'Foundations',
        isLeaf: true,
        unit: 'm3',
        quantity: '480.000',
        unitRate: '320.00',
        currency: 'USD',
      }),
    ],
  }),
  testNode({
    id: 'sec2',
    code: '02',
    description: 'Superstructure',
    children: [
      testNode({
        id: 'sub',
        code: '02.01',
        description: 'Frame',
        children: [
          testNode({
            id: 'leaf3',
            code: '02.01.01',
            description: 'Columns',
            isLeaf: true,
            unitRate: '410.00',
            currency: 'USD',
          }),
        ],
      }),
    ],
  }),
];

describe('claimableLines', () => {
  it('returns only leaves, never summary sections', () => {
    expect(claimableLines(tree).map((l) => l.id)).toEqual(['leaf1', 'leaf2', 'leaf3']);
  });

  // A leaf's own code means little alone — the surveyor is looking for where it sits.
  it('keeps the ancestry of each leaf', () => {
    const lines = claimableLines(tree);
    expect(lines[0]?.path).toEqual(['Substructure Works']);
    expect(lines[2]?.path).toEqual(['Superstructure', 'Frame']);
  });

  it('carries the rate and unit needed to claim against the line', () => {
    const line = claimableLines(tree)[0];
    expect(line).toMatchObject({
      unit: 'm3',
      quantity: '1200.000',
      unitRate: '45.00',
      currency: 'USD',
    });
  });

  it('returns an empty list for an empty tree', () => {
    expect(claimableLines([])).toEqual([]);
  });

  it('handles a leaf at the root with no ancestry', () => {
    const flat = [
      testNode({ id: 'solo', code: '99', description: 'Provisional sum', isLeaf: true }),
    ];
    expect(claimableLines(flat)[0]?.path).toEqual([]);
  });
});

describe('isClaimable', () => {
  // The API requires a unitRateSnapshot and a currencySnapshot, so a leaf missing either
  // cannot be claimed. It is still LISTED — vanishing from a BOQ the surveyor is reading
  // from is worse than being shown as unavailable.
  it('rejects a leaf with no rate', () => {
    const [line] = claimableLines([
      testNode({ id: 'x', code: '9', description: 'No rate', isLeaf: true, currency: 'USD' }),
    ]);
    expect(isClaimable(line!)).toBe(false);
  });

  /**
   * A node with no currency used to be possible and used to block a claim. Since ADR-016 a
   * BOQ has one currency and the server stamps it on every node (CONST-BOQ-013), so a
   * priced leaf always carries one and the rate is the only thing left to check.
   */
  it('accepts a priced leaf without asking for a currency it always has', () => {
    const [line] = claimableLines([
      testNode({ id: 'x', code: '9', description: 'Priced', isLeaf: true, unitRate: '10.00' }),
    ]);

    expect(line!.currency).toBe('USD');
    expect(isClaimable(line!)).toBe(true);
  });

  it('accepts a fully priced leaf', () => {
    expect(isClaimable(claimableLines(tree)[0]!)).toBe(true);
  });
});

describe('unclaimedLines', () => {
  // (applicationId, boqNodeId) is unique, so a second claim on the same node is a 409.
  // A shorter list beats an error the user has to interpret.
  it('removes lines already on the application', () => {
    const lines = claimableLines(tree);
    expect(unclaimedLines(lines, ['leaf1', 'leaf3']).map((l) => l.id)).toEqual(['leaf2']);
  });

  it('returns everything when nothing is claimed', () => {
    const lines = claimableLines(tree);
    expect(unclaimedLines(lines, [])).toHaveLength(3);
  });

  it('returns nothing when everything is claimed', () => {
    const lines = claimableLines(tree);
    expect(unclaimedLines(lines, ['leaf1', 'leaf2', 'leaf3'])).toEqual([]);
  });
});

describe('lineLabel', () => {
  it('reads as a trail from section to line', () => {
    const lines = claimableLines(tree);
    expect(lineLabel(lines[0]!)).toBe('Substructure Works › 01.01 Excavation');
    expect(lineLabel(lines[2]!)).toBe('Superstructure › Frame › 02.01.01 Columns');
  });

  it('omits the trail for a root-level line', () => {
    const [line] = claimableLines([
      testNode({ id: 'solo', code: '99', description: 'Provisional sum', isLeaf: true }),
    ]);
    expect(lineLabel(line!)).toBe('99 Provisional sum');
  });
});
