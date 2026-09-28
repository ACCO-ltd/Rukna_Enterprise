/**
 * Project activity history (ADR-019 amendment 2026-09-28) — the pure half.
 *
 * `AuditLog` has no project column, so "this project's history" is assembled from rows that can
 * be tied to the project reliably. There are two kinds:
 *
 * 1. **Outbox rows** — written by `TransactionalAuditOutboxService` in the same transaction as the
 *    change. `resource` is a type name (`Contract`), `sourceCommand` is set, and `resourceId` is
 *    the record's own id; the repository ties them to the project through the ids the project
 *    owns (`ACTIVITY_OUTBOX_RESOURCES`).
 * 2. **Request-logged rows** — written by `AuditInterceptor` after any successful mutation.
 *    `resource` is the route pattern, `sourceCommand` is null, and `resourceId` is the route's
 *    `:id` / `:projectId`. Only routes whose id IS the project and that have NO outbox row are
 *    catalogued here (`ACTIVITY_ROUTES`), so nothing appears twice.
 *
 * Every family is read behind the permission that reads that record elsewhere, so the history
 * never shows a member more than their own screens do.
 */

import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/types';

export type ActivityFamily = 'project' | 'members' | 'contract' | 'documents' | 'programme' | 'boq';

/**
 * The extra permission that reads each family elsewhere in the API. `null` = nothing beyond the
 * `view:project` + membership the project endpoints already require (members, the document
 * register, programme and progress are all read on exactly those terms).
 */
export const ACTIVITY_FAMILY_PERMISSION: Record<ActivityFamily, string | null> = {
  project: null,
  members: null,
  // Contract terms, payment schedule and variations are all read behind `view:contract`.
  contract: PERMISSIONS.contractsView,
  // The document register deliberately reuses `view:project` (see PERMISSIONS).
  documents: null,
  programme: null,
  boq: PERMISSIONS.boqView,
};

/** The families a caller holding `permissions` may read (on top of project membership). */
export function readableActivityFamilies(permissions: readonly string[]): Set<ActivityFamily> {
  return new Set(
    (Object.keys(ACTIVITY_FAMILY_PERMISSION) as ActivityFamily[]).filter((family) => {
      const required = ACTIVITY_FAMILY_PERMISSION[family];
      return required === null || permissions.includes(required);
    }),
  );
}

/** Outbox resource types per family. Their ids are resolved from the project by the repository. */
export const ACTIVITY_OUTBOX_RESOURCES = {
  project: ['Project'],
  contract: [
    'Contract',
    'ContractPaymentPlan', // audited by contract id
    'ContractRetentionTerms', // keyed by contract id
    'ContractPaymentInstallment',
    'ContractAdvanceTerm',
    'ContractDeliverable',
    'ContractGuarantee',
    // Rows audited before the ContractMilestone -> ContractDeliverable rename keep the old type.
    'ContractMilestone',
    'VariationOrder',
  ],
  documents: ['ProjectDocument', 'ProjectDocumentRevision'],
  programme: ['ProgrammeBaseline'],
} as const satisfies Partial<Record<ActivityFamily, readonly string[]>>;

/**
 * Outbox commands recorded on the Project resource that belong to the contract family: the
 * commercial workspace records a project-level payment against the project id. A reader without
 * `view:contract` does not see them.
 */
export const PROJECT_ROW_COMMERCIAL_PREFIX = 'commercial.';

export interface ActivityRoute {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Route pattern without the global prefix, exactly as the controller declares it. */
  route: string;
  command: string;
  resourceType: string;
  family: ActivityFamily;
}

/**
 * Request-logged routes whose `resourceId` is the project and that write no outbox row.
 *
 * Left out on purpose: BOQ line edits (one row per cell edit would drown the history),
 * `boq/import/preview` and `programme/suggest-weights` (read-only POSTs), `boq/extra-work` and
 * `programme/baseline/*` (they write outbox rows — listing them would show each event twice), and
 * every route whose id is not the project (DPR submit/approve, milestone verify).
 */
export const ACTIVITY_ROUTES: readonly ActivityRoute[] = [
  { method: 'PATCH', route: '/projects/:id', command: 'project.update', resourceType: 'Project', family: 'project' },
  { method: 'POST', route: '/projects/:id/members', command: 'project.addMember', resourceType: 'ProjectMember', family: 'members' },
  { method: 'DELETE', route: '/projects/:id/members/:userId', command: 'project.removeMember', resourceType: 'ProjectMember', family: 'members' },
  { method: 'PATCH', route: '/projects/:id/members/:userId/roles', command: 'project.setMemberRoles', resourceType: 'ProjectMember', family: 'members' },
  { method: 'POST', route: '/projects/:projectId/boq', command: 'boq.create', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/import', command: 'boq.import', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/draft', command: 'boq.createDraft', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/versions/:versionId/commit', command: 'boq.commit', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/versions/:versionId/baseline', command: 'boq.baseline', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/versions/:versionId/cancel', command: 'boq.cancelDraft', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/boq/versions/:versionId/contingency/draw', command: 'boq.drawContingency', resourceType: 'Boq', family: 'boq' },
  { method: 'POST', route: '/projects/:projectId/programme/milestones', command: 'programme.addMilestone', resourceType: 'ProgrammeMilestone', family: 'programme' },
  { method: 'PUT', route: '/projects/:projectId/programme/targets', command: 'programme.setTargets', resourceType: 'Programme', family: 'programme' },
  { method: 'POST', route: '/projects/:projectId/programme/apply-schedule-template', command: 'programme.applyTemplate', resourceType: 'Programme', family: 'programme' },
  { method: 'POST', route: '/projects/:projectId/work-packages', command: 'programme.addWorkPackage', resourceType: 'WorkPackage', family: 'programme' },
  { method: 'POST', route: '/projects/:projectId/work-packages/delivery-plan', command: 'programme.setDeliveryPlan', resourceType: 'WorkPackage', family: 'programme' },
  { method: 'POST', route: '/projects/:projectId/progress/reports', command: 'progress.createReport', resourceType: 'ProgressReport', family: 'programme' },
  { method: 'POST', route: '/projects/:projectId/progress/snapshots', command: 'progress.captureSnapshot', resourceType: 'ProgressSnapshot', family: 'programme' },
];

/** The global prefix `main.ts` sets; the interceptor stores the route with it. */
const GLOBAL_PREFIX = '/api/v1';

/** Stored `resource` values a catalogued route can appear as (with and without the prefix). */
export function storedRouteForms(route: string): string[] {
  return [`${GLOBAL_PREFIX}${route}`, route];
}

function stripPrefix(resource: string): string {
  return resource.startsWith(`${GLOBAL_PREFIX}/`) ? resource.slice(GLOBAL_PREFIX.length) : resource;
}

/**
 * The stable code and resource type of a stored row. Outbox rows carry their own command and
 * type; request-logged rows are looked up in the catalogue. A row that matches neither (it
 * cannot be selected, but the mapping is total) falls back to `<resource>.<action>`.
 */
export function describeActivityRow(row: {
  action: string;
  resource: string;
  sourceCommand: string | null;
}): { command: string; resourceType: string } {
  if (row.sourceCommand) return { command: row.sourceCommand, resourceType: row.resource };
  const route = stripPrefix(row.resource);
  const match = ACTIVITY_ROUTES.find((r) => r.route === route && r.method === row.action);
  if (match) return { command: match.command, resourceType: match.resourceType };
  return { command: `${row.resource}.${row.action}`.toLowerCase(), resourceType: row.resource };
}

// ── Paging ──────────────────────────────────────────────────────────────────────

export const ACTIVITY_DEFAULT_LIMIT = 25;
export const ACTIVITY_MAX_LIMIT = 100;

/** `?limit=` → 1..100 (default 25). Non-numeric or < 1 is a 400; above the max is clamped. */
export function parseActivityLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return ACTIVITY_DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException('limit must be a positive integer.');
  }
  return Math.min(value, ACTIVITY_MAX_LIMIT);
}

export interface ActivityCursor {
  createdAt: Date;
  id: string;
}

/** Keyset cursor over `(createdAt DESC, id DESC)`, opaque to clients. */
export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id]), 'utf8').toString(
    'base64url',
  );
}

export function decodeActivityCursor(raw: string | undefined): ActivityCursor | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      parsed[1].length > 0
    ) {
      const createdAt = new Date(parsed[0]);
      if (!Number.isNaN(createdAt.getTime())) return { createdAt, id: parsed[1] };
    }
  } catch {
    // fall through to the 400
  }
  throw new BadRequestException('Invalid activity cursor.');
}
