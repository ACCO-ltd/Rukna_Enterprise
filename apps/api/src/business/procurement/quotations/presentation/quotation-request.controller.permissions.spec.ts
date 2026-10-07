import { PERMISSIONS } from '@erp/types';

import {
  REQUIRED_ANY_PERMISSION_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { QuotationRequestController } from './quotation-request.controller.js';

/**
 * ADR-044 §12 — each endpoint's gate. A method's list REPLACES the class list (PermissionsGuard
 * getAllAndOverride), so every handler restates view:procurement.
 */
const P = PERMISSIONS;
const collect = [P.procurementView, P.quotationsCollect];
const award = [P.procurementView, P.quotationsAward];
const either = { all: [P.procurementView], any: [P.quotationsCollect, P.quotationsAward] };

const EXPECTED: Record<string, { all: string[]; any?: string[] }> = {
  list: either,
  detail: either,
  open: { all: collect },
  addQuote: { all: collect },
  addPage: { all: collect },
  withdrawQuote: { all: collect },
  send: { all: collect },
  reopen: { all: collect },
  enterTotal: { all: award },
  rejectQuote: { all: award },
  askAnother: { all: award },
  award: { all: award },
  withdrawAward: { all: award },
  requestRedecision: either,
  orderDraft: { all: [...collect, P.purchaseOrdersCreate] },
  raiseOrder: { all: [...collect, P.purchaseOrdersCreate] },
  cancel: either,
};

describe('QuotationRequestController permissions', () => {
  it('covers every handler', () => {
    const handlers = Object.getOwnPropertyNames(QuotationRequestController.prototype).filter((n) => n !== 'constructor');
    expect(handlers.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s', (handler, expected) => {
    const fn = (QuotationRequestController.prototype as unknown as Record<string, object>)[handler];
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toEqual(expected.all);
    expect(Reflect.getMetadata(REQUIRED_ANY_PERMISSION_KEY, fn)).toEqual(expected.any);
  });

  it('class gate is view:procurement', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, QuotationRequestController)).toEqual([P.procurementView]);
  });
});
