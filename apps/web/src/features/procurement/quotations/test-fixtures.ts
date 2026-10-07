/** Test-only builders for quotation read models. */

import type { Quote, QuotationRequestDetail, QuotationRequestRow } from './types';

export function quoteFixture(patch: Partial<Quote> & { id: string; name?: string }): Quote {
  const { name, ...rest } = patch;
  return {
    store: { supplierId: null, name: name ?? `Store ${patch.id}`, registered: false },
    status: 'ACTIVE',
    photos: [
      {
        fileId: `file-${patch.id}`,
        pageNumber: 1,
        capturedAt: '2026-10-07T07:31:00.000Z',
        source: 'CAMERA',
        sha256: 'a'.repeat(64),
        reusedOn: [],
      },
    ],
    enteredTotal: null,
    isLowest: null,
    ...rest,
  };
}

export function detailFixture(patch: Partial<QuotationRequestDetail> = {}): QuotationRequestDetail {
  return {
    id: 'qr1',
    number: 'QR-00041',
    status: 'COLLECTING',
    currencyCode: 'USD',
    urgent: false,
    materialRequest: { id: 'mr1', number: 'MR-00123', title: 'Cement & rebar', requiredByDate: '2026-10-12' },
    project: { id: 'p1', name: 'HQ Mogadishu', code: 'HQ-MOG-26-01' },
    estimateAmount: '2400.00',
    requiredQuoteCount: 3,
    distinctSupplierCount: 0,
    exceptionReason: null,
    returnNote: null,
    sentAt: null,
    waitingWorkingMinutes: null,
    slaTone: 'none',
    awardedQuoteId: null,
    awardedTotal: null,
    paymentPath: null,
    purchaseOrderId: null,
    lines: [
      { id: 'l1', lineNumber: 1, description: 'Cement 42.5', quantity: '50', uom: 'bag', estimatedUnitPrice: '24.00' },
      { id: 'l2', lineNumber: 2, description: 'Rebar 12mm', quantity: '40', uom: 'pc', estimatedUnitPrice: '30.00' },
    ],
    quotes: [],
    supplierMatches: [],
    approval: null,
    allowedActions: [],
    moneyVisible: true,
    ...patch,
  };
}

export function rowFixture(patch: Partial<QuotationRequestRow> & { id: string }): QuotationRequestRow {
  return {
    number: `QR-${patch.id}`,
    mr: { id: `mr-${patch.id}`, number: `MR-${patch.id}`, title: `Request ${patch.id}` },
    project: { id: 'p1', name: 'HQ Mogadishu' },
    status: 'AWAITING_DECISION',
    quoteCount: 3,
    distinctSupplierCount: 3,
    requiredQuoteCount: 3,
    exceptionReason: null,
    urgent: false,
    sentAt: '2026-10-07T07:00:00.000Z',
    waitingWorkingMinutes: 30,
    slaTone: 'none',
    estimateAmount: '2400.00',
    lowestTotal: null,
    awardedTotal: null,
    moneyVisible: true,
    ...patch,
  };
}
