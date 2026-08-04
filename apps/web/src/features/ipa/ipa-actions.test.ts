import { IpaStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  getIpaActions,
  ipaCommandNeedsConfirmation,
  isRegressiveCommand,
  isStuckAfterReturn,
} from './ipa-actions';
import type { Ipa } from './types';

function ipa(status: IpaStatus): Ipa {
  return {
    id: 'a1',
    contractId: 'c1',
    organizationId: 'org1',
    applicationNumber: null,
    applicationRef: null,
    status,
    periodFrom: null,
    periodTo: null,
    submittedAt: null,
    submittedBy: null,
    exchangeRateCurrency: null,
    exchangeRateBase: null,
    exchangeRateValue: null,
    exchangeRateDate: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('getIpaActions — commands', () => {
  it('offers submit-for-approval from DRAFT', () => {
    expect(getIpaActions(ipa(IpaStatus.DRAFT)).commands).toEqual(['submit-for-approval']);
  });

  // The branch. Every other aggregate in the platform has at most one forward step; an
  // application awaiting internal approval can go forward OR back to its author.
  it('offers both approve and return while awaiting internal approval', () => {
    expect(getIpaActions(ipa(IpaStatus.PENDING_INTERNAL_APPROVAL)).commands).toEqual([
      'approve-for-submission',
      'return-for-revision',
    ]);
  });

  // The dead end, and the reason this file is verified against the API rather than read
  // off the status names. `submit-for-approval` accepts DRAFT and nothing else, so an
  // application returned for revision can be corrected but never resubmitted — the server
  // answers 400. Raised as C14.
  it('offers no forward command after a return for revision', () => {
    expect(getIpaActions(ipa(IpaStatus.RETURNED_FOR_REVISION)).commands).toEqual([]);
  });

  it('flags the returned state as stuck, since its lines are still editable', () => {
    const actions = getIpaActions(ipa(IpaStatus.RETURNED_FOR_REVISION));
    expect(isStuckAfterReturn(IpaStatus.RETURNED_FOR_REVISION)).toBe(true);
    expect(actions.canEditLines).toBe(true);
    expect(actions.canCancel).toBe(true);
  });

  it('does not flag any other status as stuck', () => {
    for (const status of Object.values(IpaStatus)) {
      if (status === IpaStatus.RETURNED_FOR_REVISION) continue;
      expect(isStuckAfterReturn(status)).toBe(false);
    }
  });

  it('offers submit once approved', () => {
    expect(getIpaActions(ipa(IpaStatus.APPROVED_FOR_SUBMISSION)).commands).toEqual(['submit']);
  });

  it.each([IpaStatus.SUBMITTED, IpaStatus.CANCELLED])(
    'offers nothing from the terminal state %s',
    (status) => {
      expect(getIpaActions(ipa(status)).commands).toEqual([]);
    },
  );
});

describe('getIpaActions — editing lines', () => {
  // NOT the same as "not yet submitted": an application awaiting approval is frozen, and
  // only a return-for-revision reopens it.
  it.each([IpaStatus.DRAFT, IpaStatus.RETURNED_FOR_REVISION])(
    'allows editing lines while %s',
    (status) => {
      expect(getIpaActions(ipa(status)).canEditLines).toBe(true);
    },
  );

  it.each([
    IpaStatus.PENDING_INTERNAL_APPROVAL,
    IpaStatus.APPROVED_FOR_SUBMISSION,
    IpaStatus.SUBMITTED,
    IpaStatus.CANCELLED,
  ])('freezes lines while %s', (status) => {
    expect(getIpaActions(ipa(status)).canEditLines).toBe(false);
  });

  it('freezes lines while awaiting approval even though the claim is not yet submitted', () => {
    const actions = getIpaActions(ipa(IpaStatus.PENDING_INTERNAL_APPROVAL));
    expect(actions.canEditLines).toBe(false);
    expect(actions.isFinal).toBe(false);
  });
});

describe('getIpaActions — cancel and finality', () => {
  it.each([IpaStatus.DRAFT, IpaStatus.RETURNED_FOR_REVISION])('allows cancel from %s', (status) => {
    expect(getIpaActions(ipa(status)).canCancel).toBe(true);
  });

  it.each([
    IpaStatus.PENDING_INTERNAL_APPROVAL,
    IpaStatus.APPROVED_FOR_SUBMISSION,
    IpaStatus.SUBMITTED,
  ])('does not allow cancel from %s', (status) => {
    expect(getIpaActions(ipa(status)).canCancel).toBe(false);
  });

  it.each([IpaStatus.SUBMITTED, IpaStatus.CANCELLED])('reports %s as final', (status) => {
    expect(getIpaActions(ipa(status)).isFinal).toBe(true);
  });

  it('never offers a command on a final application', () => {
    for (const status of [IpaStatus.SUBMITTED, IpaStatus.CANCELLED]) {
      const actions = getIpaActions(ipa(status));
      expect(actions.commands).toEqual([]);
      expect(actions.canEditLines).toBe(false);
      expect(actions.canCancel).toBe(false);
    }
  });
});

describe('confirmation and tone', () => {
  // SUBMITTED is immutable with no command back; returning sends someone else's work back.
  it('confirms submit and return-for-revision', () => {
    expect(ipaCommandNeedsConfirmation('submit')).toBe(true);
    expect(ipaCommandNeedsConfirmation('return-for-revision')).toBe(true);
  });

  it('does not confirm the routine forward steps', () => {
    expect(ipaCommandNeedsConfirmation('submit-for-approval')).toBe(false);
    expect(ipaCommandNeedsConfirmation('approve-for-submission')).toBe(false);
  });

  it('marks only return-for-revision as moving against the flow', () => {
    expect(isRegressiveCommand('return-for-revision')).toBe(true);
    expect(isRegressiveCommand('approve-for-submission')).toBe(false);
    expect(isRegressiveCommand('submit')).toBe(false);
  });
});
