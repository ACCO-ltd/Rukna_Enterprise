import { ProjectStatus } from '@erp/types';

/**
 * Project wire shapes now live in `src/lib/api-types.ts` alongside every other shape the
 * API returns, so a backend contract has one place to be checked and one place to be
 * deleted when `@erp/types` finally ships DTOs (B12). They are re-exported here so feature
 * code can keep importing from `./types`.
 */
export type {
  Project,
  ProjectDetail,
  ProjectMember,
  ProjectMemberRoleAssignment,
  ProjectSuspension,
  ProjectWorkspaceSummary,
} from '@/lib/api-types';
export type { ProjectWorkspaceGuidanceItemResponse as ProjectWorkspaceGuidanceItem } from '@erp/types';

/** Lifecycle order, used to present status groupings in a stable, meaningful sequence. */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.ACTIVE,
  ProjectStatus.PRACTICAL_COMPLETION,
  ProjectStatus.CLOSEOUT,
  ProjectStatus.CLOSED,
  ProjectStatus.CANCELLED,
];
