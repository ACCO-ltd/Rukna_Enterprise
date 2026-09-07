import { describe, expect, it } from 'vitest';

import { applicationStageIndex, milestoneStageIndex } from './current-payment-cycle';

/**
 * The two cycle rails are different journeys, not one journey with stages hidden. Getting the
 * index wrong lights the wrong step, which tells a commercial manager the money is somewhere it
 * is not — so both mappings are pinned at the states that actually differ.
 */
describe('applicationStageIndex', () => {
  it('maps a ready contract to application preparation', () => {
    expect(applicationStageIndex('READY_FOR_APPLICATION')).toBe(1);
  });

  it('treats submitted and awaiting-certification as the same rail position', () => {
    expect(applicationStageIndex('APPLICATION_SUBMITTED')).toBe(2);
    expect(applicationStageIndex('AWAITING_CERTIFICATION')).toBe(2);
  });

  it('keeps partial payment in the collection stage', () => {
    expect(applicationStageIndex('PARTIALLY_PAID')).toBe(5);
  });

  it('lands a settled cycle on the final stage', () => {
    expect(applicationStageIndex('SETTLED')).toBe(6);
  });
});

describe('milestoneStageIndex', () => {
  /**
   * The read model reports one `MILESTONE_SCHEDULE` stage for the whole plan rather than a stage
   * per installment, so the rail sits on "ready to invoice" — the point the focus installment is
   * at and the one the card's action addresses.
   */
  it('parks a live payment schedule on ready-to-invoice', () => {
    expect(milestoneStageIndex('MILESTONE_SCHEDULE')).toBe(2);
  });

  it('starts a contract that is not yet active at the beginning', () => {
    expect(milestoneStageIndex('CONTRACT_DRAFT')).toBe(0);
    expect(milestoneStageIndex('NO_CONTRACT')).toBe(0);
  });

  it('advances through posting and collection', () => {
    expect(milestoneStageIndex('INVOICE_DRAFT')).toBe(3);
    expect(milestoneStageIndex('AWAITING_PAYMENT')).toBe(4);
    expect(milestoneStageIndex('SETTLED')).toBe(5);
  });
});
