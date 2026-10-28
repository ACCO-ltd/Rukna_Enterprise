import { normaliseSavedViewState, savedViewStateProblems } from './saved-view-rules.js';

describe('saved view rules (Step 2a, ADR-047)', () => {
  it('accepts a full, ordinary list state', () => {
    expect(
      savedViewStateProblems({
        search: 'water',
        filters: { status: 'APPROVED', client: 'c1' },
        sort: { key: 'dueDate', direction: 'asc' },
        columns: ['number', 'client', 'total'],
      }),
    ).toEqual([]);
    expect(savedViewStateProblems({})).toEqual([]);
  });

  it('rejects unknown settings, non-text filters and a malformed sort', () => {
    expect(savedViewStateProblems({ sql: 'x' })).toEqual(['Unknown view settings: sql.']);
    expect(savedViewStateProblems({ filters: { status: 3 } })).toEqual(['Each filter must be a short key with a text value.']);
    expect(savedViewStateProblems({ sort: { key: 'x', direction: 'up' } })).toEqual([
      'The sort must name a column and a direction (asc or desc).',
    ]);
    expect(savedViewStateProblems([])).toEqual(['The view state must be an object.']);
    expect(savedViewStateProblems({ columns: [''] })).toEqual(['Columns must be a list of at most 50 column keys.']);
  });

  it('normalise drops empty filters and trims the search', () => {
    expect(normaliseSavedViewState({ search: ' a ', filters: { status: '', client: 'c1' }, sort: null })).toEqual({
      search: 'a',
      filters: { client: 'c1' },
    });
  });
});
