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

/** What the landing rule needs to know about setup. */
export interface ProgressSetupState {
  /** Nothing can be recorded yet: no BOQ baseline, or no measurable work package. */
  hardGap: boolean;
  /** Any setup gap at all, including unallocated packages or weights below 100%. */
  incomplete: boolean;
}

/**
 * Where `/progress` lands.
 *
 * 1. A setup manager goes to Plan & setup when nothing can be recorded yet (the hard gate), or
 *    when setup is incomplete and they do not record progress themselves — setup is their job.
 * 2. The reader records progress → Today. A soft gap (an unallocated package, weights below 100%)
 *    never keeps the site team away from Today.
 * 3. The reader reviews → Review.
 * 4. Otherwise → Performance.
 */
export function progressLandingView(access: ProgressAccess, setup: ProgressSetupState): ProgressView {
  if (access.canManage && (setup.hardGap || (setup.incomplete && !access.canRecord))) return 'setup';
  if (access.canRecord) return 'today';
  if (canSeeProgressView('review', access)) return 'review';
  return 'performance';
}

export function progressViewHref(projectId: string, view: ProgressView): string {
  return `/projects/${projectId}/progress/${view}`;
}

// ─── Setup completeness ──────────────────────────────────────────────────────────────────

/**
 * What is still missing, in setup order.
 *
 * Hard gaps — nothing can be measured, so Today, Review and Performance show one empty state:
 * - `boq`: no baselined BOQ.
 * - `workPackages`: no work packages at all.
 * - `scheduleOnly`: packages exist, but every one is a schedule-only phase with no BOQ scope.
 *
 * Soft gaps — reports can still be recorded and reviewed; Performance figures are provisional:
 * - `allocation`: a measurable package has no BOQ items.
 * - `weights`: the server's `weightsComplete` flag is false.
 */
export type ProgressSetupGap = 'boq' | 'workPackages' | 'scheduleOnly' | 'allocation' | 'weights';

const HARD_GAPS: ReadonlySet<ProgressSetupGap> = new Set(['boq', 'workPackages', 'scheduleOnly']);

export function isHardSetupGap(gap: ProgressSetupGap | null | undefined): boolean {
  return Boolean(gap && HARD_GAPS.has(gap));
}

export interface ProgressSetupFacts {
  /** The BOQ has a baselined (or contract) version to measure against. */
  hasBoqBaseline: boolean;
  /** Number of work packages, schedule-only phases included. */
  packageCount: number;
  /** Work packages that carry BOQ scope (not schedule-only phases). */
  measurablePackageCount: number;
  /** Codes of measurable packages with no BOQ item allocated. */
  unallocatedPackageCodes: string[];
  /** The server's `weightsComplete` flag from the roll-up — never recomputed here. */
  weightsComplete: boolean;
  /** The server's weights total, as a whole percent, for the provisional-figures notice. */
  weightsPercent: number;
}

/** The first gap in setup order, or `null` when setup is complete. Milestones and the baseline are not part of it. */
export function progressSetupGap(facts: ProgressSetupFacts): ProgressSetupGap | null {
  if (!facts.hasBoqBaseline) return 'boq';
  if (facts.packageCount === 0) return 'workPackages';
  if (facts.measurablePackageCount === 0) return 'scheduleOnly';
  if (facts.unallocatedPackageCodes.length > 0) return 'allocation';
  if (!facts.weightsComplete) return 'weights';
  return null;
}
