import { BoqVersionStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Boq, BoqVersion } from './types';
import { getVersionActions } from './version-actions';

function version(overrides: Partial<BoqVersion> & { id: string }): BoqVersion {
  return {
    boqId: 'b1',
    versionNumber: 1,
    status: BoqVersionStatus.DRAFT,
    notes: null,
    baselinedAt: null,
    baselinedBy: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function boq(overrides: Partial<Boq> = {}): Boq {
  return {
    id: 'b1',
    projectId: 'p1',
    organizationId: 'org-1',
    originalBaselineVersionId: null,
    currentApprovedVersionId: null,
    currentDraftVersionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    versions: [],
    ...overrides,
  };
}

const draft = version({ id: 'v1' });

describe('getVersionActions — baseline and discard', () => {
  it('offers both on the open draft', () => {
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', versions: [draft] }),
      draft,
      false,
    );

    expect(actions.canBaseline).toBe(true);
    expect(actions.canCancelDraft).toBe(true);
  });

  // BoqVersioningService rejects anything that is not the version the BOQ points at.
  it('offers neither on a version that is not the current draft', () => {
    const other = version({ id: 'v2', versionNumber: 2, status: BoqVersionStatus.BASELINED });
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', versions: [draft, other] }),
      other,
      false,
    );

    expect(actions.canBaseline).toBe(false);
    expect(actions.canCancelDraft).toBe(false);
  });

  it('offers neither when the pointer is stale and the version is no longer DRAFT', () => {
    const stale = version({ id: 'v1', status: BoqVersionStatus.CANCELLED });
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', versions: [stale] }),
      stale,
      false,
    );

    expect(actions.canBaseline).toBe(false);
  });

  it('offers neither when nothing is selected', () => {
    expect(getVersionActions(boq({ currentDraftVersionId: 'v1' }), null, false).canBaseline).toBe(
      false,
    );
  });
});

describe('getVersionActions — starting a revision', () => {
  it('is offered once a version is approved and no draft is open', () => {
    const actions = getVersionActions(boq({ currentApprovedVersionId: 'v1' }), null, false);

    expect(actions.canCreateDraft).toBe(true);
  });

  // The API answers 400 — there is nothing to copy from.
  it('is withheld before anything has been baselined', () => {
    expect(getVersionActions(boq(), null, false).canCreateDraft).toBe(false);
  });

  // The API answers 409 — one draft at a time.
  it('is withheld while a draft is already open', () => {
    const actions = getVersionActions(
      boq({ currentApprovedVersionId: 'v1', currentDraftVersionId: 'v2' }),
      null,
      false,
    );

    expect(actions.canCreateDraft).toBe(false);
  });
});

describe('getVersionActions — warnings', () => {
  /**
   * The API permits baselining a draft with no items. Approving an empty Bill of
   * Quantities is almost always a mistake, so the confirmation says so rather than
   * blocking it — the server is the authority on what is allowed.
   */
  it('flags baselining an empty draft', () => {
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', versions: [draft] }),
      draft,
      true,
    );

    expect(actions.canBaseline).toBe(true);
    expect(actions.wouldBaselineEmpty).toBe(true);
  });

  it('does not flag emptiness on a draft that has items', () => {
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', versions: [draft] }),
      draft,
      false,
    );

    expect(actions.wouldBaselineEmpty).toBe(false);
  });

  /**
   * The first baseline also sets originalBaselineVersionId, which the service never
   * overwrites — it is the original contract BOQ every later variation is measured
   * against. Worth saying out loud before it is fixed permanently.
   */
  it('flags the first baseline, which permanently fixes the contract BOQ', () => {
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', originalBaselineVersionId: null, versions: [draft] }),
      draft,
      false,
    );

    expect(actions.isFirstBaseline).toBe(true);
  });

  it('does not flag later baselines', () => {
    const actions = getVersionActions(
      boq({ currentDraftVersionId: 'v1', originalBaselineVersionId: 'v0', versions: [draft] }),
      draft,
      false,
    );

    expect(actions.isFirstBaseline).toBe(false);
  });

  it('does not flag anything when no draft is open', () => {
    const actions = getVersionActions(boq({ currentApprovedVersionId: 'v1' }), null, true);

    expect(actions.wouldBaselineEmpty).toBe(false);
    expect(actions.isFirstBaseline).toBe(false);
  });
});
