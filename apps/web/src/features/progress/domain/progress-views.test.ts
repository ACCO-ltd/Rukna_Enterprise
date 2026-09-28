import { describe, expect, it } from 'vitest';

import {
  canSeeProgressView,
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

describe('progressLandingView', () => {
  it('sends a setup manager to Plan & setup while setup is incomplete', () => {
    expect(progressLandingView(PM, true)).toBe('setup');
    expect(progressLandingView(MANAGER_ONLY, true)).toBe('setup');
  });

  it('sends a recorder to Today once setup is complete', () => {
    expect(progressLandingView(PM, false)).toBe('today');
    expect(progressLandingView(SITE_ENGINEER, false)).toBe('today');
  });

  it('does not send a non-manager to setup even when it is incomplete', () => {
    expect(progressLandingView(SITE_ENGINEER, true)).toBe('today');
    expect(progressLandingView(REVIEWER, true)).toBe('review');
  });

  it('sends a reviewer who does not record to Review', () => {
    expect(progressLandingView(REVIEWER, false)).toBe('review');
    expect(progressLandingView(MANAGER_ONLY, false)).toBe('review');
  });

  it('falls back to Performance for everyone else', () => {
    expect(progressLandingView(NONE, false)).toBe('performance');
    expect(progressLandingView(NONE, true)).toBe('performance');
  });
});

describe('progressSetupGap', () => {
  const complete = { hasBoqBaseline: true, packageCount: 3, allPackagesAllocated: true, weightsComplete: true };

  it('is null when every part of setup is done', () => {
    expect(progressSetupGap(complete)).toBeNull();
  });

  it('reports the first gap in setup order', () => {
    expect(progressSetupGap({ ...complete, hasBoqBaseline: false, packageCount: 0 })).toBe('boq');
    expect(progressSetupGap({ ...complete, packageCount: 0 })).toBe('workPackages');
    expect(progressSetupGap({ ...complete, allPackagesAllocated: false, weightsComplete: false })).toBe(
      'allocation',
    );
    expect(progressSetupGap({ ...complete, weightsComplete: false })).toBe('weights');
  });
});

describe('progressViewHref', () => {
  it('builds the view route', () => {
    expect(progressViewHref('p1', 'setup')).toBe('/projects/p1/progress/setup');
  });
});
