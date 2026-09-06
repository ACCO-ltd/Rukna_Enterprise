import { describe, expect, it } from 'vitest';
import type { ProjectRequirementRow } from '@erp/types';

import {
  EMPTY_REQUIREMENT_FILTERS,
  filterRequirements,
  hasActiveFilters,
  requirementCategoryOptions,
} from './filter-requirements';

function row(overrides: Partial<ProjectRequirementRow> = {}): ProjectRequirementRow {
  return {
    id: 'mr-1',
    mrNumber: 'MR-00001',
    title: 'Reinforcement steel',
    description: 'Grade 500 rebar for columns',
    status: 'APPROVED',
    approvalStatus: 'APPROVED',
    fulfillmentStatus: 'NOT_ORDERED',
    priority: 'HIGH',
    category: 'Materials',
    requestedDate: '2026-09-05T00:00:00.000Z',
    requiredByDate: '2026-09-15T00:00:00.000Z',
    lineCount: 1,
    currencyCode: 'USD',
    estimatedValue: '50000.00',
    orderedValue: '0.00',
    remainingValue: '50000.00',
    purchaseOrderCount: 0,
    ...overrides,
  };
}

describe('filterRequirements', () => {
  /**
   * The whole reason approval and fulfilment are separate columns: "approved, and nobody has
   * ordered it" is the most operationally urgent set on the screen, and a single merged status
   * filter cannot express it.
   */
  it('can select approved-but-not-ordered, which one merged status could not express', () => {
    const rows = [
      row({ id: 'a', approvalStatus: 'APPROVED', fulfillmentStatus: 'NOT_ORDERED' }),
      row({ id: 'b', approvalStatus: 'APPROVED', fulfillmentStatus: 'PARTIALLY_ORDERED' }),
      row({ id: 'c', approvalStatus: 'DRAFT', fulfillmentStatus: 'NOT_ORDERED' }),
    ];

    const result = filterRequirements(rows, {
      ...EMPTY_REQUIREMENT_FILTERS,
      approvalStatus: 'APPROVED',
      fulfillmentStatus: 'NOT_ORDERED',
    });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  /** A reader searches with whatever they have — a printed MR number, or a word from the title. */
  it('searches the number, the title and the description', () => {
    const rows = [
      row({ id: 'a', mrNumber: 'MR-00042', title: 'Cement', description: null }),
      row({ id: 'b', mrNumber: 'MR-00043', title: 'Rebar', description: 'Grade 500' }),
    ];

    expect(filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search: '00042' })).toHaveLength(1);
    expect(filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search: 'cement' })).toHaveLength(1);
    expect(filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search: 'grade' })).toHaveLength(1);
  });

  it('ignores case and surrounding whitespace', () => {
    const rows = [row({ title: 'Reinforcement steel' })];
    expect(
      filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search: '  REINFORCEMENT ' }),
    ).toHaveLength(1);
  });

  it('combines every filter rather than treating them as alternatives', () => {
    const rows = [
      row({ id: 'a', priority: 'URGENT', category: 'Materials' }),
      row({ id: 'b', priority: 'URGENT', category: 'Equipment' }),
      row({ id: 'c', priority: 'LOW', category: 'Materials' }),
    ];
    const result = filterRequirements(rows, {
      ...EMPTY_REQUIREMENT_FILTERS,
      priority: 'URGENT',
      category: 'Materials',
    });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('returns everything when nothing is filtered', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(filterRequirements(rows, EMPTY_REQUIREMENT_FILTERS)).toHaveLength(2);
  });
});

describe('requirementCategoryOptions', () => {
  /** Offering a category that matches nothing is a dead end, so options come from the data. */
  it('lists only the categories present, de-duplicated and sorted', () => {
    const rows = [
      row({ id: 'a', category: 'Materials' }),
      row({ id: 'b', category: 'Equipment' }),
      row({ id: 'c', category: 'Materials' }),
      row({ id: 'd', category: null }),
    ];
    expect(requirementCategoryOptions(rows)).toEqual(['Equipment', 'Materials']);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty set and for whitespace-only search', () => {
    expect(hasActiveFilters(EMPTY_REQUIREMENT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_REQUIREMENT_FILTERS, search: '   ' })).toBe(false);
  });

  it('is true as soon as any one filter is set', () => {
    expect(hasActiveFilters({ ...EMPTY_REQUIREMENT_FILTERS, priority: 'HIGH' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_REQUIREMENT_FILTERS, search: 'rebar' })).toBe(true);
  });
});
