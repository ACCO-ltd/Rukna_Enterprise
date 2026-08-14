import { describe, expect, it } from 'vitest';
import type {
  BoqBaselineReadinessResponse,
  BoqReadinessBlocker,
  BoqVersionSummary,
  BoqWorkspaceResponse,
} from '@erp/types';

import { resolveNextStep } from './boq-next-step';

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

function blocker(overrides: Partial<BoqReadinessBlocker>): BoqReadinessBlocker {
  return {
    kind: 'MISSING_RATE',
    nodeId: 'n1',
    code: '01.001',
    description: 'Excavation',
    message: 'Item 01.001 is missing a rate.',
    ...overrides,
  };
}

function readiness(
  overrides: Partial<BoqBaselineReadinessResponse> = {},
): BoqBaselineReadinessResponse {
  return {
    ready: true,
    sectionCount: 2,
    itemCount: 4,
    pricedItemCount: 4,
    incompleteItemCount: 0,
    duplicateCodeCount: 0,
    totalAmount: '1000.00',
    currency: 'USD',
    blockers: [],
    warnings: [],
    ...overrides,
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
    readiness: readiness(),
    revision: null,
    capabilities: { canView: true, canManage: true, canBaseline: true, canViewCommercials: true },
    ...overrides,
  };
}

describe('resolveNextStep — the screen always offers something to do', () => {
  /**
   * The regression this module exists to prevent. The first implementation styled
   * "Submit for baseline" as the primary and disabled it whenever the draft was not ready,
   * so the one element drawing the eye was the one element that could not be pressed.
   */
  it('never returns an empty step for a manager, in any draft state', () => {
    const states: BoqWorkspaceResponse[] = [
      workspace({ boq: null, draft: null, approved: null, versions: [] }),
      workspace({ readiness: readiness({ ready: false, itemCount: 0, pricedItemCount: 0 }) }),
      workspace({
        readiness: readiness({
          ready: false,
          incompleteItemCount: 1,
          blockers: [blocker({})],
        }),
      }),
      workspace({
        readiness: readiness({
          ready: false,
          blockers: [blocker({ kind: 'DUPLICATE_CODE' })],
        }),
      }),
      workspace(),
    ];

    for (const state of states) {
      const step = resolveNextStep(state, state.draft?.id ?? null);
      expect(step.kind).not.toBe('VIEW_ONLY');
      expect(step.tone).not.toBe('none');
    }
  });

  it('offers to create the BOQ when there is none', () => {
    const step = resolveNextStep(
      workspace({ boq: null, draft: null, approved: null, versions: [] }),
      null,
    );

    expect(step).toEqual({ kind: 'INITIALIZE', tone: 'primary' });
  });

  it('offers to add items to an empty draft', () => {
    const step = resolveNextStep(
      workspace({ readiness: readiness({ ready: false, itemCount: 0, pricedItemCount: 0 }) }),
      'v2',
    );

    expect(step.kind).toBe('ADD_ITEMS');
    expect(step.tone).toBe('primary');
  });
});

describe('resolveNextStep — fixes come before transitions', () => {
  it('sends the user to price items, in amber, with the rows to fix', () => {
    const step = resolveNextStep(
      workspace({
        readiness: readiness({
          ready: false,
          incompleteItemCount: 2,
          blockers: [
            blocker({ nodeId: 'n1', code: '01.001' }),
            blocker({ nodeId: 'n2', code: '01.002', kind: 'MISSING_UNIT' }),
          ],
        }),
      }),
      'v2',
    );

    expect(step.kind).toBe('PRICE_ITEMS');
    // Amber, not blue: this is work standing in the way, not a forward transition.
    expect(step.tone).toBe('attention');
    expect(step.count).toBe(2);
    expect(step.targetNodeIds).toEqual(['n1', 'n2']);
  });

  /**
   * The server reports one blocker per missing field, so a single row with no unit,
   * quantity or rate produces three. "Price 3 items" for one row would be a lie, and the
   * count is the label.
   */
  it('counts rows, not blockers, when one row is missing several fields', () => {
    const step = resolveNextStep(
      workspace({
        readiness: readiness({
          ready: false,
          blockers: [
            blocker({ nodeId: 'n1', kind: 'MISSING_UNIT' }),
            blocker({ nodeId: 'n1', kind: 'MISSING_QUANTITY' }),
            blocker({ nodeId: 'n1', kind: 'MISSING_RATE' }),
          ],
        }),
      }),
      'v2',
    );

    expect(step.count).toBe(1);
    expect(step.targetNodeIds).toEqual(['n1']);
  });

  /** Pricing is the common case; being sent to a duplicate code first would be noise. */
  it('prioritises pricing over structural problems', () => {
    const step = resolveNextStep(
      workspace({
        readiness: readiness({
          ready: false,
          blockers: [
            blocker({ nodeId: 'n9', kind: 'DUPLICATE_CODE' }),
            blocker({ nodeId: 'n1', kind: 'MISSING_RATE' }),
          ],
        }),
      }),
      'v2',
    );

    expect(step.kind).toBe('PRICE_ITEMS');
    expect(step.targetNodeIds).toEqual(['n1']);
  });

  it('falls through to structural blockers once everything is priced', () => {
    const step = resolveNextStep(
      workspace({
        readiness: readiness({
          ready: false,
          duplicateCodeCount: 1,
          blockers: [blocker({ nodeId: 'n9', code: '02.001', kind: 'DUPLICATE_CODE' })],
        }),
      }),
      'v2',
    );

    expect(step.kind).toBe('FIX_BLOCKERS');
    expect(step.tone).toBe('attention');
    expect(step.targetNodeIds).toEqual(['n9']);
  });
});

describe('resolveNextStep — transitions', () => {
  it('offers the baseline once the server says the version is ready', () => {
    const step = resolveNextStep(workspace(), 'v2');

    expect(step.kind).toBe('SUBMIT_BASELINE');
    expect(step.tone).toBe('primary');
  });

  it('offers a revision while looking at a baselined version with no draft open', () => {
    const base = workspace();
    const approved = base.approved!;
    const step = resolveNextStep(
      {
        ...base,
        draft: null,
        boq: { ...base.boq!, currentDraftVersionId: undefined, versions: [approved] },
        versions: [approved],
        readiness: null,
      },
      'v1',
    );

    expect(step.kind).toBe('START_REVISION');
    expect(step.tone).toBe('primary');
  });

  /** A second draft is a 409, so offering one would send the user to an error. */
  it('offers nothing on a historical version while a draft is already open', () => {
    const step = resolveNextStep(workspace(), 'v1');

    expect(step.kind).toBe('VIEW_ONLY');
    expect(step.tone).toBe('none');
  });
});

describe('resolveNextStep — permissions', () => {
  it('offers nothing to a read-only viewer', () => {
    const base = workspace();
    const step = resolveNextStep(
      {
        ...base,
        capabilities: { ...base.capabilities, canManage: false, canBaseline: false },
      },
      'v2',
    );

    expect(step).toEqual({ kind: 'VIEW_ONLY', tone: 'none' });
  });

  /** Ready, but this user cannot baseline — offering it would send them to a 403. */
  it('offers nothing to an editor who may not baseline a ready draft', () => {
    const base = workspace();
    const step = resolveNextStep(
      { ...base, capabilities: { ...base.capabilities, canBaseline: false } },
      'v2',
    );

    expect(step.kind).toBe('VIEW_ONLY');
  });

  it('still sends an editor who may not baseline to the work that needs doing', () => {
    const base = workspace();
    const step = resolveNextStep(
      {
        ...base,
        capabilities: { ...base.capabilities, canBaseline: false },
        readiness: readiness({ ready: false, blockers: [blocker({})] }),
      },
      'v2',
    );

    expect(step.kind).toBe('PRICE_ITEMS');
  });
});
