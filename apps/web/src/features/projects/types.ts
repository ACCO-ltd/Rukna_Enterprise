import { ProjectStatus, type ProjectRole } from '@erp/types';

/**
 * Wire shape of a project as returned by `GET /projects`.
 *
 * `apps/web/CLAUDE.md` says to import shared types rather than redefine them, and that is
 * the right rule — but `@erp/types` currently exports the `ProjectStatus` enum and no
 * Project DTO, and `packages/types` is owned by the backend. So the enum is imported and
 * the record shape is declared here, deliberately, until a shared DTO exists (B12).
 *
 * Field types mirror the Prisma model and its JSON serialization:
 *  - `contractValue` is a Decimal(18,2) and serializes as a STRING, not a number. It is
 *    never parsed for arithmetic — only formatted for display. See the money policy in
 *    src/lib/format.ts.
 *  - Dates serialize as ISO 8601 strings.
 *  - Everything optional in the schema is genuinely nullable here.
 */
export interface Project {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  status: ProjectStatus;
  contractValue: string | null;
  currency: string | null;
  clientName: string | null;
  startDate: string | null;
  expectedEndDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSuspension {
  id: string;
  projectId: string;
  reason: string;
  suspendedAt: string;
  suspendedBy: string;
  resumedAt: string | null;
  resumedBy: string | null;
}

export interface ProjectMemberRoleAssignment {
  id: string;
  role: ProjectRole;
  assignedAt: string;
}

export interface ProjectMember {
  id: string;
  userId: string;
  joinedAt: string;
  joinedBy: string;
  removedAt: string | null;
  roles: ProjectMemberRoleAssignment[];
  user: { id: string; firstName: string; lastName: string; email: string };
}

/**
 * Shape of `GET /projects/:id`, which includes active members and any active suspension.
 *
 * Both collections are pre-filtered by the API: `members` excludes removed members and
 * `suspensions` contains at most the one unresolved record. So a non-empty `suspensions`
 * array means the project is suspended right now — it is not a history.
 *
 * `members` is always empty in practice today: no project can be given a first member
 * (B1). The field is typed correctly so the members UI is a rendering change once the
 * backend fix lands, not a modelling one.
 */
export interface ProjectDetail extends Project {
  members: ProjectMember[];
  suspensions: ProjectSuspension[];
}

/** Lifecycle order, used to present status groupings in a stable, meaningful sequence. */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.APPROVED,
  ProjectStatus.MOBILIZING,
  ProjectStatus.ACTIVE,
  ProjectStatus.PRACTICAL_COMPLETION,
  ProjectStatus.CLOSEOUT,
  ProjectStatus.CLOSED,
  ProjectStatus.CANCELLED,
];
