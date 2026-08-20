import { ProjectRole } from '@erp/types';

import type { OrgUser } from '@/features/users/types';

import type { ProjectMember } from './types';

/**
 * ─── Project membership rules the UI has to hold ────────────────────────────────
 *
 * The server enforces three things and no more: the caller must already be a member
 * (`project.service.ts:250,267`), the user must not already be an active member (409), and at
 * least one role must be supplied (`@ArrayMinSize(1)`).
 *
 * Everything else below is the UI's own care, and each is noted where it diverges.
 */

/** Display order — seniority, then the reviewing roles, then read-only. */
export const PROJECT_ROLE_ORDER: ProjectRole[] = [
  ProjectRole.PROJECT_MANAGER,
  ProjectRole.COMMERCIAL_MANAGER,
  ProjectRole.QUANTITY_SURVEYOR,
  ProjectRole.SITE_ENGINEER,
  ProjectRole.FINANCE_REVIEWER,
  ProjectRole.VIEWER,
];

/**
 * Roles the UI offers when adding a member — ACCO's real project team (ADR-022): the Project
 * Manager (who absorbs the old Project Engineer + Coordinator), the Site Engineer, and a
 * read-only Viewer.
 *
 * The other three `ProjectRole` values are deprecated, not deleted. ADR-022 removed the
 * Quantity Surveyor (the Construction Director owns BOQ scope + cost), and treats Commercial
 * Manager / Finance Reviewer as org-level authorities that reach a project through the access
 * scope resolver (ADR-009), not project membership. The enum keeps all six so existing members
 * and the commercial `responsibleRole` union still resolve — this only restricts what is
 * assignable going forward (the same pattern used for BillingModel).
 */
export const ASSIGNABLE_PROJECT_ROLES: ProjectRole[] = [
  ProjectRole.PROJECT_MANAGER,
  ProjectRole.SITE_ENGINEER,
  ProjectRole.VIEWER,
];

/** True for a role still offered when adding a member; false for the ADR-022-deprecated roles. */
export function isAssignableRole(role: ProjectRole): boolean {
  return ASSIGNABLE_PROJECT_ROLES.includes(role);
}

/** `firstName lastName`, falling back to the email when a name is blank. */
export function memberName(member: Pick<ProjectMember, 'user'>): string {
  const full = `${member.user.firstName} ${member.user.lastName}`.trim();
  return full || member.user.email;
}

export function userName(user: OrgUser): string {
  const full = `${user.firstName} ${user.lastName}`.trim();
  return full || user.email;
}

/**
 * The users who may still be added.
 *
 * Adding an existing member answers 409, so they are filtered out rather than offered and
 * refused. Sorted by display name so the picker is stable.
 */
export function addableUsers(users: readonly OrgUser[], members: readonly ProjectMember[]): OrgUser[] {
  const taken = new Set(members.map((member) => member.userId));
  return users
    .filter((user) => !taken.has(user.id))
    .sort((a, b) => userName(a).localeCompare(userName(b)));
}

/** A member's live roles, in display order. `roles` is already filtered to active by the API. */
export function memberRoles(member: ProjectMember): ProjectRole[] {
  const held = new Set(member.roles.map((assignment) => assignment.role));
  return PROJECT_ROLE_ORDER.filter((role) => held.has(role));
}

/**
 * Whether removing `member` would leave the project with no project manager.
 *
 * **Nothing on the server prevents this.** `removeMember` checks only that the target is an
 * active member — so the last PROJECT_MANAGER can be removed, and since `addMember` requires
 * the caller to already be a member, a project with no manager can end up with nobody able to
 * administer it. Recoverable only by direct database access.
 *
 * The UI therefore refuses, rather than warns. It is an affordance and not a control — the
 * endpoint is still callable directly — but it is the difference between a mistake being
 * awkward and being unrecoverable.
 */
export function isLastProjectManager(
  member: ProjectMember,
  members: readonly ProjectMember[],
): boolean {
  if (!memberRoles(member).includes(ProjectRole.PROJECT_MANAGER)) return false;

  const managers = members.filter((candidate) =>
    memberRoles(candidate).includes(ProjectRole.PROJECT_MANAGER),
  );
  return managers.length <= 1;
}

export type RemoveBlockReason = 'last-project-manager' | 'self';

/**
 * Why `member` cannot be removed, or null when they can.
 *
 * Removing yourself is refused for the same reason as the manager rule: `addMember` requires
 * the caller to be a member, so a user who removes themselves cannot put themselves back.
 */
export function removeBlockReason(
  member: ProjectMember,
  members: readonly ProjectMember[],
  currentUserId: string | null,
): RemoveBlockReason | null {
  if (currentUserId && member.userId === currentUserId) return 'self';
  if (isLastProjectManager(member, members)) return 'last-project-manager';
  return null;
}
