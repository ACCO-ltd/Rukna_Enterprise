/**
 * The Progress tab's views and who sees them (flow plan PR 5, ADR-038 amendment 2026-09-28).
 *
 * Each view is a real route: `/projects/{id}/progress/{view}`. A view the reader cannot use is
 * removed from the sub-navigation, never shown disabled; the bare `/progress` route redirects to
 * the reader's landing view.
 *
 * Pure functions, so the rules are tested once and the shell, the landing redirect and the route
 * guard can never disagree.
 */

export const PROGRESS_VIEWS = ['today', 'review', 'performance', 'setup'] as const;
export type ProgressView = (typeof PROGRESS_VIEWS)[number];

/** The permission answers the view rules need — resolved once from `usePermissions().can()`. */
export interface ProgressAccess {
  /** `record:progress` — writes daily reports. */
  canRecord: boolean;
  /** `approve:progress` — reviews daily reports. */
  canApprove: boolean;
  /** `manage:project` — sets the programme up (and, from commit e, verifies milestones). */
  canManage: boolean;
}

export function isProgressView(value: string): value is ProgressView {
  return (PROGRESS_VIEWS as readonly string[]).includes(value);
}

/**
 * Whether the reader may open a view.
 *
 * - Today: `record:progress`.
 * - Review: `approve:progress` OR `manage:project` — reports to approve, and (commit e) milestones
 *   ready to verify.
 * - Performance: everyone who reaches the tab (the tab itself is gated on viewing the project).
 * - Plan & setup: `manage:project`.
 */
export function canSeeProgressView(view: ProgressView, access: ProgressAccess): boolean {
  switch (view) {
    case 'today':
      return access.canRecord;
    case 'review':
      return access.canApprove || access.canManage;
    case 'performance':
      return true;
    case 'setup':
      return access.canManage;
  }
}

/** The views the reader may open, in navigation order. Never empty — Performance is universal. */
export function visibleProgressViews(access: ProgressAccess): ProgressView[] {
  return PROGRESS_VIEWS.filter((view) => canSeeProgressView(view, access));
}

/**
 * Where `/progress` lands.
 *
 * 1. Setup is incomplete and the reader can finish it → Plan & setup. Nothing else on the tab
 *    works until it is done, so sending the one person who can do it anywhere else wastes a click.
 * 2. The reader records progress → Today.
 * 3. The reader reviews → Review.
 * 4. Otherwise → Performance.
 *
 * `setupIncomplete` is `null` while it is still unknown; callers wait for an answer rather than
 * redirecting on a guess (which would bounce a setup manager to Today and back).
 */
export function progressLandingView(access: ProgressAccess, setupIncomplete: boolean): ProgressView {
  if (setupIncomplete && access.canManage) return 'setup';
  if (access.canRecord) return 'today';
  if (canSeeProgressView('review', access)) return 'review';
  return 'performance';
}

export function progressViewHref(projectId: string, view: ProgressView): string {
  return `/projects/${projectId}/progress/${view}`;
}

// ─── Setup completeness ──────────────────────────────────────────────────────────────────

/** What is still missing before daily reports and performance mean anything, in setup order. */
export type ProgressSetupGap = 'boq' | 'workPackages' | 'allocation' | 'weights';

export interface ProgressSetupFacts {
  /** The BOQ has a baselined (or contract) version to measure against. */
  hasBoqBaseline: boolean;
  /** Number of work packages. */
  packageCount: number;
  /**
   * Every measurable package has at least one BOQ item allocated. Schedule-only phases
   * (mobilisation, design) have no BOQ scope by design and do not count against this.
   */
  allPackagesAllocated: boolean;
  /** The server's `weightsComplete` flag from the roll-up — never recomputed here. */
  weightsComplete: boolean;
}

/**
 * The first gap in setup order, or `null` when setup is complete. "Setup incomplete" means: no
 * BOQ baseline, or no work packages, or a package with nothing allocated, or weights not at 100%.
 * Milestones and the planned baseline are not part of it — the tab works without them.
 */
export function progressSetupGap(facts: ProgressSetupFacts): ProgressSetupGap | null {
  if (!facts.hasBoqBaseline) return 'boq';
  if (facts.packageCount === 0) return 'workPackages';
  if (!facts.allPackagesAllocated) return 'allocation';
  if (!facts.weightsComplete) return 'weights';
  return null;
}
