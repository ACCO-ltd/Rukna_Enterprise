import type {
  BoqBaselineReadinessResponse,
  BoqCompareResponse,
  BoqImportPreview,
  BoqImportRequest,
  BoqImportResult,
  BoqResponse,
  BoqTreeNodeResponse,
  BoqWorkspaceResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * BOQ API client.
 *
 * Every shape here comes from `@erp/types` — the feature used to keep its own copies in
 * `features/boq/types.ts` and `lib/api-types.ts`, which is how a `computedTotal` that the
 * server sends as a string ended up typed as a number (B7/B12).
 *
 * **Money and quantities are decimal strings.** Do not parse them to `number` for anything
 * but display; see `lib/money.ts` for arithmetic.
 */

/** Creates the BOQ and its first DRAFT version. Idempotent — a double click is harmless. */
export function initializeBoq(projectId: string): Promise<BoqResponse> {
  return apiClient<BoqResponse>(`/projects/${projectId}/boq`, { method: 'POST' });
}

/**
 * The workspace read model: versions, totals, contract baseline, readiness, capabilities.
 *
 * One request instead of the four the screen used to stitch together. Rate and amount
 * fields come back null when the caller lacks commercial visibility — that decision is the
 * server's, and the UI renders the restriction rather than deciding it.
 */
export function getBoqWorkspace(projectId: string): Promise<BoqWorkspaceResponse> {
  return apiClient<BoqWorkspaceResponse>(`/projects/${projectId}/boq/workspace`);
}

/** Full recursive tree for one version, with server-computed section totals. */
export function getBoqTree(
  projectId: string,
  versionId: string,
): Promise<BoqTreeNodeResponse[]> {
  return apiClient<BoqTreeNodeResponse[]>(
    `/projects/${projectId}/boq/versions/${versionId}/tree`,
  );
}

/** Baseline readiness — the same evaluation the baseline command enforces. */
export function getBoqReadiness(
  projectId: string,
  versionId: string,
): Promise<BoqBaselineReadinessResponse> {
  return apiClient<BoqBaselineReadinessResponse>(
    `/projects/${projectId}/boq/versions/${versionId}/readiness`,
  );
}

/** Diffs two versions. Paired on `originNodeId`, so a renumbered line reads as a change. */
export function compareBoqVersions(
  projectId: string,
  leftId: string,
  rightId: string,
): Promise<BoqCompareResponse> {
  return apiClient<BoqCompareResponse>(
    `/projects/${projectId}/boq/versions/${leftId}/compare/${rightId}`,
  );
}

/**
 * Body for `POST .../nodes`, mirroring CreateNodeDto.
 *
 * `quantity` and `unitRate` are decimal **strings** (CONST-BOQ-014). `sortOrder` is optional
 * — omit it to append; sibling positions are dense, unique and server-owned, so the client
 * no longer allocates them. `currency` is omitted entirely: a BOQ has one currency and the
 * server stamps it (CONST-BOQ-013).
 *
 * Optional fields are omitted rather than sent empty — the pipeline runs
 * `forbidNonWhitelisted` and `""` is an invalid value, not an absent one.
 */
export interface CreateNodePayload {
  parentId?: string;
  sortOrder?: number;
  code: string;
  description: string;
  isLeaf?: boolean;
  unit?: string;
  quantity?: string;
  unitRate?: string;
  measurementMethod?: 'QUANTITY' | 'PERCENTAGE' | 'MILESTONE';
  pricingBasis?: 'UNIT_RATE' | 'LUMP_SUM';
}

/** Body for `PATCH .../nodes/:id`. `parentId` and `sortOrder` are not accepted — use move. */
export type UpdateNodePayload = Omit<CreateNodePayload, 'parentId' | 'sortOrder'>;

export function addBoqNode(
  projectId: string,
  versionId: string,
  payload: CreateNodePayload,
): Promise<BoqTreeNodeResponse> {
  return apiClient<BoqTreeNodeResponse>(
    `/projects/${projectId}/boq/versions/${versionId}/nodes`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export function updateBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<BoqTreeNodeResponse> {
  return apiClient<BoqTreeNodeResponse>(
    `/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

/**
 * Hard delete, draft only.
 *
 * Refused with `400` when the node has children, and with `409` when a claim, request,
 * bill, journal or commitment references it (CONST-BOQ-003) — that response carries
 * `details.references` naming what is in the way.
 */
export function deleteBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
): Promise<void> {
  return apiClient<void>(`/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

/**
 * Repositions a node and its whole subtree, and returns the reindexed tree.
 *
 * One call, not two. The server used to write the given `sortOrder` onto the node alone
 * without reindexing its siblings (B13), so the client had to plan a second displacing
 * write; positions are now dense and server-owned.
 */
export function moveBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
  payload: { newParentId?: string; newSortOrder: number },
): Promise<BoqTreeNodeResponse[]> {
  return apiClient<BoqTreeNodeResponse[]>(
    `/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}/move`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * Locks the open draft in as the approved BOQ.
 *
 * Refused with `400` and `details.blockers` when the version is not Baseline Ready, and
 * with `409` and `details.approvalInstanceId` when a workflow binding gates it — approve
 * the instance, then call this again (ADR-015 re-drive).
 */
export function baselineVersion(projectId: string, versionId: string): Promise<BoqResponse> {
  return apiClient<BoqResponse>(`/projects/${projectId}/boq/versions/${versionId}/baseline`, {
    method: 'POST',
  });
}

/** Discards the open draft. The approved version is untouched. */
export function cancelDraftVersion(
  projectId: string,
  versionId: string,
): Promise<BoqResponse> {
  return apiClient<BoqResponse>(`/projects/${projectId}/boq/versions/${versionId}/cancel`, {
    method: 'POST',
  });
}

/**
 * Starts a revision by copying every node from the approved version into a new draft.
 * Requires an approved version (400 otherwise) and no draft already open (409).
 */
export function createDraftVersion(projectId: string, notes: string): Promise<BoqResponse> {
  return apiClient<BoqResponse>(`/projects/${projectId}/boq/draft`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

/**
 * Import (ADR-016 Phase 2). The browser parses the sheet and maps columns; only the mapped rows
 * cross the wire (the API never sees a file).
 *
 * `previewBoqImport` is a dry-run — it runs the same server planner as the commit and returns the
 * tree it would create plus every finding, changing nothing. `importBoq` commits: it creates the
 * BOQ/draft if needed and writes the whole tree in one transaction, or rejects it with `400` and
 * `details.violations` (all-or-nothing).
 */
export function previewBoqImport(
  projectId: string,
  body: BoqImportRequest,
): Promise<BoqImportPreview> {
  return apiClient<BoqImportPreview>(`/projects/${projectId}/boq/import/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function importBoq(projectId: string, body: BoqImportRequest): Promise<BoqImportResult> {
  return apiClient<BoqImportResult>(`/projects/${projectId}/boq/import`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
