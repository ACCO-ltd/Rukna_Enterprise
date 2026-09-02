import { apiClient } from '@/lib/api-client';

/**
 * BOQ item-library API client (ADR-020 CONST-BOQ-020/021).
 *
 * The reusable work-item catalogue behind the `boq-item-library` controller. A QS searches it
 * to assemble a BOQ from known items instead of retyping, and it grows just-in-time via "save
 * to library". It carries **no authoritative rate** — only a *last-used* rate recorded on use,
 * surfaced as assistance and never as truth (CONST-BOQ-021).
 *
 * ─── Wire shape ────────────────────────────────────────────────────────────────
 *
 * `BoqLibraryItem` mirrors the `BoqItemLibrary` Prisma model (`schema.prisma`). It is defined
 * here rather than in `@erp/types` because that package is backend-owned and does not export a
 * DTO for it yet — the same reason `Project` and `Client` are hand-maintained in
 * `lib/api-types.ts`. `Decimal` columns serialize as decimal STRINGS, `DateTime` as ISO
 * strings; `lastUsedRate` is therefore a string and is only ever formatted, never summed.
 *
 * Endpoints (all under `/boq-item-library`, permissions enforced server-side):
 *   GET    /                  search      — requires `view:boq`
 *   POST   /                  create      — requires `manage:boq`
 *   POST   /:id/record-usage  record rate — requires `manage:boq`
 */
export interface BoqLibraryItem {
  id: string;
  organizationId: string;
  code: string;
  description: string;
  defaultUnit: string | null;
  measurementMethod: 'QUANTITY' | 'PERCENTAGE' | 'MILESTONE';
  pricingBasis: 'UNIT_RATE' | 'LUMP_SUM';
  category: string | null;
  /** The last rate this item was used at — assistance only, never authoritative. */
  lastUsedRate: string | null;
  lastUsedAt: string | null;
  lastUsedProjectId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Body for `POST /boq-item-library`, mirroring `CreateBoqItemDto`. */
export interface CreateLibraryItemPayload {
  code: string;
  description: string;
  defaultUnit?: string;
  measurementMethod?: 'QUANTITY' | 'PERCENTAGE' | 'MILESTONE';
  pricingBasis?: 'UNIT_RATE' | 'LUMP_SUM';
  category?: string;
}

/** Body for `POST /boq-item-library/:id/record-usage`, mirroring `RecordItemUsageDto`. */
export interface RecordLibraryUsagePayload {
  /** Decimal string. The rate the item was just used at. */
  rate: string;
  projectId?: string;
}

/** Searches the reusable work-item library by code or description. `q` blank returns the top 50. */
export function searchLibraryItems(query: string): Promise<BoqLibraryItem[]> {
  const trimmed = query.trim();
  const suffix = trimmed ? `?q=${encodeURIComponent(trimmed)}` : '';
  return apiClient<BoqLibraryItem[]>(`/boq-item-library${suffix}`);
}

/**
 * Saves a work item to the library ("save to library & add").
 *
 * Refused with `409` when an item with the same code already exists in the org — the caller
 * surfaces that as a plain conflict message rather than a failure.
 */
export function createLibraryItem(payload: CreateLibraryItemPayload): Promise<BoqLibraryItem> {
  return apiClient<BoqLibraryItem>('/boq-item-library', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Records the rate a library item was just used at (assistance only). Best-effort. */
export function recordLibraryUsage(
  id: string,
  payload: RecordLibraryUsagePayload,
): Promise<BoqLibraryItem> {
  return apiClient<BoqLibraryItem>(`/boq-item-library/${id}/record-usage`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
