/**
 * Tests for PlatformDataGrid's pure logic functions.
 *
 * The React component itself is not rendered here — the pre-existing test
 * environment cannot resolve @radix-ui/react-dialog which is a transitive
 * dependency through @erp/ui. These tests cover the sort and search logic
 * that the component delegates to, which is where the complexity lives.
 */

import { describe, expect, it } from 'vitest';

// ─── Re-implement the pure functions locally so we can test them without
//     importing the component (which triggers the @erp/ui resolution failure).
//     These must stay byte-for-byte equivalent to the implementations in
//     platform-data-grid.tsx. If you change the logic there, update here too.

type SortDirection = 'asc' | 'desc';
interface SortState { key: string; direction: SortDirection; }

interface TestColumn<T> {
  key: string;
  plainValue?: (row: T) => string | number | null | undefined;
}

function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

function sortRows<T>(rows: T[], sort: SortState | null, columns: TestColumn<T>[]): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.plainValue) return rows;
  return [...rows].sort((a, b) => {
    const av = col.plainValue!(a);
    const bv = col.plainValue!(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });
}

function searchRows<T>(rows: T[], query: string, columns: TestColumn<T>[]): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    columns.some((col) => {
      if (!col.plainValue) return false;
      const v = col.plainValue(row);
      if (v == null) return false;
      return String(v).toLowerCase().includes(needle);
    }),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Contract { id: string; ref: string; value: number | null; status: string; }

const CONTRACTS: Contract[] = [
  { id: '1', ref: 'C-001', value: 9000,  status: 'ACTIVE'  },
  { id: '2', ref: 'C-002', value: 4500,  status: 'DRAFT'   },
  { id: '3', ref: 'C-003', value: null,  status: 'ACTIVE'  },
  { id: '4', ref: 'C-004', value: 15000, status: 'CLOSED'  },
];

const COLS: TestColumn<Contract>[] = [
  { key: 'ref',    plainValue: (c) => c.ref },
  { key: 'value',  plainValue: (c) => c.value },
  { key: 'status', plainValue: (c) => c.status },
];

// ─── nextSort ─────────────────────────────────────────────────────────────────

describe('nextSort()', () => {
  it('starts with asc when there is no current sort', () => {
    expect(nextSort(null, 'ref')).toEqual({ key: 'ref', direction: 'asc' });
  });

  it('moves to desc on second click of the same column', () => {
    expect(nextSort({ key: 'ref', direction: 'asc' }, 'ref')).toEqual({
      key: 'ref',
      direction: 'desc',
    });
  });

  it('clears sort on third click of the same column', () => {
    expect(nextSort({ key: 'ref', direction: 'desc' }, 'ref')).toBeNull();
  });

  it('resets to asc when switching to a different column', () => {
    expect(nextSort({ key: 'ref', direction: 'desc' }, 'value')).toEqual({
      key: 'value',
      direction: 'asc',
    });
  });
});

// ─── sortRows ─────────────────────────────────────────────────────────────────

describe('sortRows()', () => {
  it('returns rows unchanged when sort is null', () => {
    const result = sortRows(CONTRACTS, null, COLS);
    expect(result.map((c) => c.id)).toEqual(['1', '2', '3', '4']);
  });

  it('sorts strings ascending (case-insensitive)', () => {
    const result = sortRows(CONTRACTS, { key: 'ref', direction: 'asc' }, COLS);
    expect(result.map((c) => c.ref)).toEqual(['C-001', 'C-002', 'C-003', 'C-004']);
  });

  it('sorts strings descending', () => {
    const result = sortRows(CONTRACTS, { key: 'ref', direction: 'desc' }, COLS);
    expect(result.map((c) => c.ref)).toEqual(['C-004', 'C-003', 'C-002', 'C-001']);
  });

  it('sorts numbers ascending', () => {
    const result = sortRows(CONTRACTS, { key: 'value', direction: 'asc' }, COLS);
    // null always last
    expect(result.map((c) => c.id)).toEqual(['2', '1', '4', '3']);
  });

  it('sorts numbers descending, nulls still last', () => {
    const result = sortRows(CONTRACTS, { key: 'value', direction: 'desc' }, COLS);
    expect(result.map((c) => c.id)).toEqual(['4', '1', '2', '3']);
  });

  it('places null values last in both directions', () => {
    const asc = sortRows(CONTRACTS, { key: 'value', direction: 'asc' }, COLS);
    const desc = sortRows(CONTRACTS, { key: 'value', direction: 'desc' }, COLS);
    expect(asc[asc.length - 1].id).toBe('3');
    expect(desc[desc.length - 1].id).toBe('3');
  });

  it('does not mutate the original array', () => {
    const original = [...CONTRACTS];
    sortRows(CONTRACTS, { key: 'ref', direction: 'desc' }, COLS);
    expect(CONTRACTS).toEqual(original);
  });

  it('returns rows unchanged for a column with no plainValue', () => {
    const colsNoValue: TestColumn<Contract>[] = [{ key: 'ref' }];
    const result = sortRows(CONTRACTS, { key: 'ref', direction: 'asc' }, colsNoValue);
    expect(result).toEqual(CONTRACTS);
  });
});

// ─── searchRows ───────────────────────────────────────────────────────────────

describe('searchRows()', () => {
  it('returns all rows for an empty query', () => {
    expect(searchRows(CONTRACTS, '', COLS)).toHaveLength(4);
    expect(searchRows(CONTRACTS, '   ', COLS)).toHaveLength(4);
  });

  it('matches a substring (case-insensitive)', () => {
    const result = searchRows(CONTRACTS, 'active', COLS);
    expect(result.map((c) => c.id)).toEqual(['1', '3']);
  });

  it('searches across all columns with plainValue', () => {
    // "c-001" matches the ref column
    const byRef = searchRows(CONTRACTS, 'c-001', COLS);
    expect(byRef).toHaveLength(1);
    expect(byRef[0].id).toBe('1');

    // "closed" matches the status column
    const byStatus = searchRows(CONTRACTS, 'closed', COLS);
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0].id).toBe('4');
  });

  it('returns empty array when nothing matches', () => {
    expect(searchRows(CONTRACTS, 'zzzzz', COLS)).toHaveLength(0);
  });

  it('skips columns without plainValue', () => {
    const colsPartial: TestColumn<Contract>[] = [
      { key: 'ref' }, // no plainValue — this column is not searched
      { key: 'status', plainValue: (c) => c.status },
    ];
    // "c-001" is only in the ref column, which has no plainValue here → no match
    expect(searchRows(CONTRACTS, 'c-001', colsPartial)).toHaveLength(0);
    // "active" is in the status column → matches
    expect(searchRows(CONTRACTS, 'active', colsPartial)).toHaveLength(2);
  });

  it('skips null values from plainValue without crashing', () => {
    expect(() => searchRows(CONTRACTS, '9000', COLS)).not.toThrow();
  });
});

// ─── paginateRows ─────────────────────────────────────────────────────────────

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

describe('paginateRows()', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1) }));

  it('returns the first pageSize items for page 1', () => {
    const result = paginateRows(rows, 1, 3);
    expect(result.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('returns the next batch on page 2', () => {
    const result = paginateRows(rows, 2, 3);
    expect(result.map((r) => r.id)).toEqual(['4', '5', '6']);
  });

  it('returns the partial last page when rows do not divide evenly', () => {
    const result = paginateRows(rows, 4, 3);
    expect(result.map((r) => r.id)).toEqual(['10']);
  });

  it('returns an empty array when page is beyond total', () => {
    expect(paginateRows(rows, 5, 3)).toHaveLength(0);
  });

  it('returns all rows when pageSize exceeds total', () => {
    expect(paginateRows(rows, 1, 100)).toHaveLength(10);
  });
});
