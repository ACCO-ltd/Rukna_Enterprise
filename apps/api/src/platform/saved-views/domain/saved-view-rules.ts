/**
 * Step 2a (ADR-047): what a saved list view may hold. Pure. The state is replayed into a list's
 * own controls, so it is bounded and string-only — nothing in it is ever executed or queried
 * as-is; each list re-validates its own filter values exactly as when the user picks them.
 */

import type { SavedViewState } from '@erp/types';

export const LIST_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VIEW_NAME_MAX = 60;
export const MAX_VIEWS_PER_USER_PER_LIST = 30;

const MAX_TEXT = 200;
const MAX_KEY = 64;
const MAX_FILTERS = 20;
const MAX_COLUMNS = 50;

export function savedViewStateProblems(state: unknown): string[] {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return ['The view state must be an object.'];
  const s = state as Record<string, unknown>;
  const problems: string[] = [];
  const allowed = new Set(['search', 'filters', 'sort', 'columns']);
  const extra = Object.keys(s).filter((k) => !allowed.has(k));
  if (extra.length > 0) problems.push(`Unknown view settings: ${extra.sort().join(', ')}.`);

  if (s.search !== undefined && (typeof s.search !== 'string' || s.search.length > MAX_TEXT)) {
    problems.push(`The search must be text of at most ${MAX_TEXT} characters.`);
  }
  if (s.filters !== undefined) {
    const f = s.filters;
    if (typeof f !== 'object' || f === null || Array.isArray(f)) problems.push('Filters must be an object.');
    else {
      const entries = Object.entries(f);
      if (entries.length > MAX_FILTERS) problems.push(`A view can hold at most ${MAX_FILTERS} filters.`);
      if (entries.some(([k, v]) => k.length > MAX_KEY || typeof v !== 'string' || v.length > MAX_TEXT)) {
        problems.push('Each filter must be a short key with a text value.');
      }
    }
  }
  if (s.sort !== undefined && s.sort !== null) {
    const sort = s.sort as Record<string, unknown>;
    if (
      typeof sort !== 'object' ||
      typeof sort.key !== 'string' ||
      sort.key.length === 0 ||
      sort.key.length > MAX_KEY ||
      (sort.direction !== 'asc' && sort.direction !== 'desc')
    ) {
      problems.push('The sort must name a column and a direction (asc or desc).');
    }
  }
  if (s.columns !== undefined) {
    const c = s.columns;
    if (!Array.isArray(c) || c.length > MAX_COLUMNS || c.some((k) => typeof k !== 'string' || k.length === 0 || k.length > MAX_KEY)) {
      problems.push(`Columns must be a list of at most ${MAX_COLUMNS} column keys.`);
    }
  }
  return problems;
}

/** Keep only the recognised settings, so what is stored is exactly what was validated. */
export function normaliseSavedViewState(state: SavedViewState): SavedViewState {
  const out: SavedViewState = {};
  if (state.search) out.search = state.search.trim();
  if (state.filters) {
    const filters = Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v !== ''));
    if (Object.keys(filters).length > 0) out.filters = filters;
  }
  if (state.sort) out.sort = { key: state.sort.key, direction: state.sort.direction };
  if (state.columns) out.columns = [...state.columns];
  return out;
}
