import { describe, expect, it } from 'vitest';
import type {
  BoqBaselineReadinessResponse,
  BoqVersionSummary,
  BoqWorkspaceResponse,
} from '@erp/types';

import { getVersionActions } from './version-actions';

function version(overrides: Partial<BoqVersionSummary> & { id: string }): BoqVersionSummary {
  return {
    boqId: 'b1',
    versionNumber: 1,
    status: 'DRAFT',
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalAmount: '1000.00',
    itemCount: 4,
    isContractBaseline: false,
    ...overrides,
  };
}

function readiness(ready: boolean): BoqBaselineReadinessResponse {
  return {
    ready,
    sectionCount: 1,
    itemCount: 4,
    pricedItemCount: ready ? 4 : 2,
    incompleteItemCount: ready ? 0 : 2,
    duplicateCodeCount: 0,
    totalAmount: '1000.00',
    currency: 'USD',
    blockers: ready
      ? []
      : [
          {
            kind: 'MISSING_RATE',
            nodeId: 'n1',
            code: '01.001',
            description: 'Excavation',
            message: 'Item 01.001 is missing a rate.',
          },
        ],
    warnings: [],
  };
}

function workspace(overrides: Partial<BoqWorkspaceResponse> = {}): BoqWorkspaceResponse {
  const draft = version({ id: 'v2', versionNumber: 2, status: 'DRAFT' });
  const approved = version({ id: 'v1', versionNumber: 1, status: 'BASELINED' });

  return {
    projectId: 'p1',
    boq: {
      id: 'b1',
      projectId: 'p1',
      organizationId: 'o1',
      currency: 'USD',
      originalBaselineVersionId: 'v1',
      currentApprovedVersionId: 'v1',
      currentDraftVersionId: 'v2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versions: [draft, approved],
    },
    currency: 'USD',
    draft,
    approved,
    contractBaseline: null,
    versions: [draft, approved],
    readiness: readiness(true),
    revision: null,
    capabilities: {
      canView: true,
      canManage: true,
      canBaseline: true,
      canViewCommercials: true,
    },
    ...overrides,
  };
}

describe('getVersionActions — baseline', () => {
  it('offers baseline on the open draft when it is ready and the user may baseline', () => {
    const actions = getVersionActions(workspace(), 'v2');

    expect(actions.canBaseline).toBe(true);
    expect(actions.blockedReason).toBeNull();
  });

  /**
   * The server refuses an unready version with 400 and `details.blockers`. Offering the
   * button anyway sends the user to be rejected, and the reason lives in a toast rather
   * than next to the rows that need fixing.
   */
  it('withholds baseline when the server says the version is not ready', () => {
    const actions = getVersionActions(workspace({ readiness: readiness(false) }), 'v2');

    expect(actions.canBaseline).toBe(false);
    expect(actions.blockedReason).toBe('NOT_READY');
  });

  /**
   * The BOQ feature had no permission check at all before ADR-016 — a viewer was shown a
   * Baseline button that the API would refuse with 403.
   */
  it('withholds baseline without baseline:boq', () => {
    const base = workspace();
    const actions = getVersionActions(
      { ...base, capabilities: { ...base.capabilities, canBaseline: false } },
      'v2',
    );

    expect(actions.canBaseline).toBe(false);
    expect(actions.blockedReason).toBe('NO_PERMISSION');
  });

  it('offers no version command while looking at a baselined version', () => {
    const actions = getVersionActions(workspace(), 'v1');

    expect(actions.canBaseline).toBe(false);
    expect(actions.canCancelDraft).toBe(false);
    expect(actions.blockedReason).toBeNull();
  });
});

describe('getVersionActions — revisions', () => {
  /** The API refuses a second draft with 409 while one is already open. */
  it('does not offer a revision while a draft is open', () => {
    expect(getVersionActions(workspace(), 'v2').canCreateDraft).toBe(false);
  });

  it('offers a revision once the draft is gone', () => {
    const base = workspace();
    const approved = base.approved!;
    const actions = getVersionActions(
      {
        ...base,
        draft: null,
        boq: { ...base.boq!, currentDraftVersionId: undefined, versions: [approved] },
        versions: [approved],
      },
      'v1',
    );

    expect(actions.canCreateDraft).toBe(true);
  });

  /** Without an approved version there is nothing to copy — the API answers 400. */
  it('does not offer a revision before anything is baselined', () => {
    const base = workspace();
    const draft = base.draft!;
    const actions = getVersionActions(
      {
        ...base,
        approved: null,
        boq: {
          ...base.boq!,
          currentApprovedVersionId: undefined,
          originalBaselineVersionId: undefined,
          versions: [draft],
        },
        versions: [draft],
      },
      'v2',
    );

    expect(actions.canCreateDraft).toBe(false);
  });

  it('needs manage:boq to discard a draft or start a revision', () => {
    const base = workspace();
    const actions = getVersionActions(
      { ...base, capabilities: { ...base.capabilities, canManage: false } },
      'v2',
    );

    expect(actions.canCancelDraft).toBe(false);
    expect(actions.canCreateDraft).toBe(false);
  });
});

describe('getVersionActions — baseline consequence', () => {
  /**
   * The first baseline fixes the original contract BOQ, which is immutable thereafter.
   * A later one supersedes a revision. The confirmation copy differs, so the caller has to
   * be able to tell them apart.
   */
  it('distinguishes the first baseline from a post-award revision', () => {
    const base = workspace();
    const first = getVersionActions(
      {
        ...base,
        boq: { ...base.boq!, originalBaselineVersionId: undefined },
      },
      'v2',
    );

    expect(first.isFirstBaseline).toBe(true);
    expect(first.isPostAwardRevision).toBe(false);

    const later = getVersionActions(base, 'v2');
    expect(later.isFirstBaseline).toBe(false);
    expect(later.isPostAwardRevision).toBe(true);
  });
});

describe('getVersionActions — no BOQ', () => {
  it('offers nothing when the project has no BOQ yet', () => {
    const actions = getVersionActions(
      {
        projectId: 'p1',
        boq: null,
        currency: 'USD',
        draft: null,
        approved: null,
        contractBaseline: null,
        versions: [],
        readiness: null,
        revision: null,
        capabilities: {
          canView: true,
          canManage: true,
          canBaseline: true,
          canViewCommercials: true,
        },
      },
      null,
    );

    expect(actions.canBaseline).toBe(false);
    expect(actions.canCancelDraft).toBe(false);
    expect(actions.canCreateDraft).toBe(false);
  });
});
