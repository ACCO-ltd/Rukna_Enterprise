import { describe, expect, it } from 'vitest';

import {
  canSeeProgressView,
  isHardSetupGap,
  progressLandingView,
  progressSetupGap,
  progressViewHref,
  visibleProgressViews,
  type ProgressAccess,
} from './progress-views';

const NONE: ProgressAccess = { canRecord: false, canApprove: false, canManage: false };
const SITE_ENGINEER: ProgressAccess = { canRecord: true, canApprove: false, canManage: false };
const PM: ProgressAccess = { canRecord: true, canApprove: true, canManage: true };
const REVIEWER: ProgressAccess = { canRecord: false, canApprove: true, canManage: false };
const MANAGER_ONLY: ProgressAccess = { canRecord: false, canApprove: false, canManage: true };

describe('visibleProgressViews', () => {
  it('shows only Performance to a viewer with no progress permissions', () => {
    expect(visibleProgressViews(NONE)).toEqual(['performance']);
  });

  it('shows Today + Performance to a site engineer', () => {
    expect(visibleProgressViews(SITE_ENGINEER)).toEqual(['today', 'performance']);
  });

  it('shows all four views to a PM, in navigation order', () => {
    expect(visibleProgressViews(PM)).toEqual(['today', 'review', 'performance', 'setup']);
  });

  it('shows Review to approve:progress OR manage:project', () => {
    expect(canSeeProgressView('review', REVIEWER)).toBe(true);
    expect(canSeeProgressView('review', MANAGER_ONLY)).toBe(true);
    expect(canSeeProgressView('review', SITE_ENGINEER)).toBe(false);
  });

  it('shows Plan & setup only to manage:project', () => {
    expect(canSeeProgressView('setup', MANAGER_ONLY)).toBe(true);
    expect(canSeeProgressView('setup', REVIEWER)).toBe(false);
    expect(canSeeProgressView('setup', SITE_ENGINEER)).toBe(false);
  });
});

const HARD = { hardGap: true, incomplete: true };
const SOFT = { hardGap: false, incomplete: true };
const DONE = { hardGap: false, incomplete: false };

describe('progressLandingView', () => {
  it('sends a setup manager to Plan & setup when nothing can be recorded yet', () => {
    expect(progressLandingView(PM, HARD)).toBe('setup');
    expect(progressLandingView(MANAGER_ONLY, HARD)).toBe('setup');
  });

  it('keeps a manager who records on Today for a soft gap — field work is not blocked', () => {
    expect(progressLandingView(PM, SOFT)).toBe('today');
  });

  it('sends a manager who does not record to setup for any incomplete setup', () => {
    expect(progressLandingView(MANAGER_ONLY, SOFT)).toBe('setup');
    expect(progressLandingView(MANAGER_ONLY, DONE)).toBe('review');
  });

  it('sends a recorder to Today, gap or not, when they cannot finish setup', () => {
    expect(progressLandingView(SITE_ENGINEER, HARD)).toBe('today');
    expect(progressLandingView(SITE_ENGINEER, DONE)).toBe('today');
    expect(progressLandingView(PM, DONE)).toBe('today');
  });

  it('sends a reviewer who does not record to Review', () => {
    expect(progressLandingView(REVIEWER, HARD)).toBe('review');
    expect(progressLandingView(REVIEWER, DONE)).toBe('review');
  });

  it('falls back to Performance for everyone else', () => {
    expect(progressLandingView(NONE, DONE)).toBe('performance');
    expect(progressLandingView(NONE, HARD)).toBe('performance');
  });
});

describe('progressSetupGap', () => {
  const complete = {
    hasBoqBaseline: true,
    packageCount: 3,
    measurablePackageCount: 3,
    unallocatedPackageCodes: [] as string[],
    weightsComplete: true,
    weightsPercent: 100,
  };

  it('is null when every part of setup is done', () => {
    expect(progressSetupGap(complete)).toBeNull();
  });

  it('reports the first gap in setup order', () => {
    expect(progressSetupGap({ ...complete, hasBoqBaseline: false, packageCount: 0 })).toBe('boq');
    expect(progressSetupGap({ ...complete, packageCount: 0, measurablePackageCount: 0 })).toBe('workPackages');
    expect(progressSetupGap({ ...complete, measurablePackageCount: 0 })).toBe('scheduleOnly');
    expect(
      progressSetupGap({ ...complete, unallocatedPackageCodes: ['WP-07'], weightsComplete: false }),
    ).toBe('allocation');
    expect(progressSetupGap({ ...complete, weightsComplete: false })).toBe('weights');
  });

  it('treats only a missing BOQ or no measurable package as a hard gap', () => {
    expect(isHardSetupGap('boq')).toBe(true);
    expect(isHardSetupGap('workPackages')).toBe(true);
    expect(isHardSetupGap('scheduleOnly')).toBe(true);
    expect(isHardSetupGap('allocation')).toBe(false);
    expect(isHardSetupGap('weights')).toBe(false);
    expect(isHardSetupGap(null)).toBe(false);
  });
});

describe('progressViewHref', () => {
  it('builds the view route', () => {
    expect(progressViewHref('p1', 'setup')).toBe('/projects/p1/progress/setup');
  });
});
