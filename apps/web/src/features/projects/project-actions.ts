import { ProjectStatus } from '@erp/types';

import type { ProjectDetail } from './types';

/**
 * Which commands a project will accept in its current state.
 *
 * This mirrors ProjectService's rules exactly — LIFECYCLE_REQUIRED_FROM, CANCEL_ALLOWED_FROM,
 * the suspension block on transitions, and the DRAFT-only edit rule. The server remains
 * the authority (`constraints.md:299`); this exists so the UI offers only commands that
 * will succeed, rather than presenting buttons that answer 400.
 *
 * Keeping it as data in one pure function, rather than conditionals spread through the
 * detail view, means the rules can be tested directly and audited against the backend in
 * one sitting.
 */
// ADR-019 CONST-PLC-001/004: six-state lifecycle. `start` is the single DRAFT → ACTIVE
// command that replaced the retired approve → mobilize → activate chain.
export type ProjectCommand = 'start' | 'practical-completion' | 'closeout' | 'close';

/** The single lifecycle command available from each status, if any. */
const NEXT_COMMAND: Partial<Record<ProjectStatus, ProjectCommand>> = {
  [ProjectStatus.DRAFT]: 'start',
  [ProjectStatus.ACTIVE]: 'practical-completion',
  [ProjectStatus.PRACTICAL_COMPLETION]: 'closeout',
  [ProjectStatus.CLOSEOUT]: 'close',
};

const CANCEL_ALLOWED_FROM: ProjectStatus[] = [ProjectStatus.DRAFT, ProjectStatus.ACTIVE];

const TERMINAL: ProjectStatus[] = [ProjectStatus.CLOSED, ProjectStatus.CANCELLED];

export interface AvailableActions {
  /** The forward lifecycle step, or null when there is none (or it is blocked). */
  advance: ProjectCommand | null;
  canEdit: boolean;
  canCancel: boolean;
  canSuspend: boolean;
  canResume: boolean;
  /** True when a suspension is what is blocking the forward step. */
  advanceBlockedBySuspension: boolean;
}

export function isSuspended(project: ProjectDetail): boolean {
  // The API returns only unresolved suspensions here, so presence means "suspended now".
  // Belt and braces: also check resumedAt, in case that filter ever changes.
  return project.suspensions.some((s) => s.resumedAt === null);
}

export function getAvailableActions(project: ProjectDetail): AvailableActions {
  const suspended = isSuspended(project);
  const nextCommand = NEXT_COMMAND[project.status] ?? null;
  const isTerminal = TERMINAL.includes(project.status);

  return {
    // Lifecycle transitions are rejected while a suspension is active — the project must
    // be resumed first.
    advance: suspended ? null : nextCommand,
    advanceBlockedBySuspension: suspended && nextCommand !== null,
    canEdit: project.status === ProjectStatus.DRAFT,
    canCancel: CANCEL_ALLOWED_FROM.includes(project.status),
    // Suspending a closed or cancelled project is meaningless, and a project can hold
    // only one active suspension at a time.
    canSuspend: !isTerminal && !suspended,
    canResume: suspended,
  };
}
