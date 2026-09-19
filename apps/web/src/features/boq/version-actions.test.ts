import { describe, expect, it } from 'vitest';
import type { BoqWorkspaceResponse } from '@erp/types';

import { getVersionActions } from './version-actions';

function workspace(overrides: Partial<BoqWorkspaceResponse> = {}): BoqWorkspaceResponse {
  return {
    boq: {
      id: 'boq-1',
      currentDraftVersionId: 'draft-1',
      currentApprovedVersionId: undefined,
    },
    draft: { id: 'draft-1', status: 'DRAFT' },
    capabilities: { canManage: true },
    ...overrides,
  } as unknown as BoqWorkspaceResponse;
}

describe('getVersionActions', () => {
  it('allows the selected working draft to be discarded', () => {
    expect(getVersionActions(workspace(), 'draft-1')).toEqual({
      canCancelDraft: true,
      canCreateDraft: false,
    });
  });

  it('does not expose a manual baseline or commit action', () => {
    expect(getVersionActions(workspace(), 'draft-1')).not.toHaveProperty('canBaseline');
  });

  it('allows a revision only when an approved version exists and no draft is open', () => {
    const state = workspace({
      boq: {
        id: 'boq-1',
        currentApprovedVersionId: 'signed-1',
        currentDraftVersionId: undefined,
      } as BoqWorkspaceResponse['boq'],
      draft: null,
    });

    expect(getVersionActions(state, 'signed-1')).toEqual({
      canCancelDraft: false,
      canCreateDraft: true,
    });
  });
});
