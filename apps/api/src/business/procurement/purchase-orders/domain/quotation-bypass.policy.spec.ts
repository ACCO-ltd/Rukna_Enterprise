import { manualOrderBlock } from './quotation-bypass.policy.js';

describe('manual order block (no manual PO for an MR under quotation rounds)', () => {
  const live = { id: 'qr-2', number: 'QR-00002', closedAt: null };
  const closed = { id: 'qr-1', number: 'QR-00001', closedAt: new Date('2026-10-07') };

  it('no round → no block', () => {
    expect(manualOrderBlock([])).toBeNull();
  });

  it('a live round (any non-closed state, incl. awarded with a draft order) → QUOTATION_IN_PROGRESS', () => {
    expect(manualOrderBlock([live])).toEqual({ code: 'QUOTATION_IN_PROGRESS', round: live });
    expect(manualOrderBlock([live, closed])).toEqual({ code: 'QUOTATION_IN_PROGRESS', round: live });
  });

  it('only closed rounds → QUOTATION_ROUND_REQUIRED (remaining quantity needs a new round)', () => {
    expect(manualOrderBlock([closed])).toEqual({ code: 'QUOTATION_ROUND_REQUIRED', round: closed });
  });

  it("the raising round's own order is exempt", () => {
    expect(manualOrderBlock([live, closed], 'qr-2')).toBeNull();
  });
});
