// ─── Saved list views (Step 2a, ADR-047) ─────────────────────────────────────
// A named list state on one list (`listKey`). Personal to its owner until an admin
// (manage:organization) publishes it, after which everyone in the company sees it.

export interface SavedViewState {
  search?: string;
  /** Filter key → value, exactly as the list's filter bar holds them. */
  filters?: Record<string, string>;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  /** Visible column keys, in order. Absent = the list's default columns. */
  columns?: string[];
}

export interface SavedViewDto {
  id: string;
  listKey: string;
  name: string;
  state: SavedViewState;
  published: boolean;
  /** True when the caller owns it (and so may rename or delete it). */
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedViewInput {
  listKey: string;
  name: string;
  state: SavedViewState;
}

export interface UpdateSavedViewInput {
  name?: string;
  state?: SavedViewState;
}
