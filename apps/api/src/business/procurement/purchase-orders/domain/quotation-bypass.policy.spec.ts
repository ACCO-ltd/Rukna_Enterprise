import { quotationBlocksManualOrder } from './quotation-bypass.policy.js';

describe('quotation bypass policy (no manual PO while a quotation round is live)', () => {
  const req = (status: string, purchaseOrderStatus: string | null = null) => ({ id: 'qr-1', status, purchaseOrderStatus });

  it.each(['COLLECTING', 'AWAITING_DECISION', 'RETURNED', 'AWARD_PENDING_APPROVAL'])('%s blocks', (status) => {
    expect(quotationBlocksManualOrder(req(status))).toBe(true);
  });

  it('AWARDED blocks until its order is raised (none linked or the linked one cancelled)', () => {
    expect(quotationBlocksManualOrder(req('AWARDED'))).toBe(true);
    expect(quotationBlocksManualOrder(req('AWARDED', 'CANCELLED'))).toBe(true);
    expect(quotationBlocksManualOrder(req('AWARDED', 'DRAFT'))).toBe(false);
    expect(quotationBlocksManualOrder(req('AWARDED', 'OPEN'))).toBe(false);
  });

  it('no request, a cancelled one, or the raising request itself does not block', () => {
    expect(quotationBlocksManualOrder(null)).toBe(false);
    expect(quotationBlocksManualOrder(req('CANCELLED'))).toBe(false);
    expect(quotationBlocksManualOrder(req('AWARDED'), 'qr-1')).toBe(false);
    expect(quotationBlocksManualOrder(req('COLLECTING'), 'qr-other')).toBe(true);
  });
});
