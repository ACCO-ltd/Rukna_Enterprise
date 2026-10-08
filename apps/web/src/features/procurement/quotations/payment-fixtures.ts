/** Test fixtures for the payment screens (ADR-045). Not imported by production code. */

import type { PayDraft, QuotationPayment, ReleaseDraft } from './payment-types';

export function paymentFixture(patch: Partial<QuotationPayment> = {}): QuotationPayment {
  return {
    path: 'BUYER_CASH',
    state: 'READY_TO_PAY',
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311', status: 'OPEN' },
    orderedAmount: '1000.00',
    funded: '0.00',
    remainingToFund: '1000.00',
    withBuyer: '0.00',
    advances: [],
    payments: [],
    storeDocuments: [],
    receivingStatus: 'NOT_RECEIVED',
    approval: null,
    allowedActions: [{ action: 'RELEASE_CASH', enabled: true }],
    moneyVisible: true,
    ...patch,
  };
}

export function releaseDraftFixture(patch: Partial<ReleaseDraft> = {}): ReleaseDraft {
  return {
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311', orderedAmount: '1000.00' },
    currencyCode: 'USD',
    remainingToFund: '1000.00',
    recipients: [
      { userId: 'u-ahmed', name: 'Ahmed Ali', isRequestCreator: true },
      { userId: 'u-hodan', name: 'Hodan Nur', isRequestCreator: false },
    ],
    accounts: [
      { bankAccountId: 'ba-cash', name: 'Cash box', glCode: '10900', method: 'CASH', lastUsed: true },
      { bankAccountId: 'ba-evc', name: 'EVC float', glCode: '10950', method: 'MOBILE_MONEY', lastUsed: false },
    ],
    defaultAdvancedAt: '2026-10-08',
    bandHint: null,
    blockers: [],
    ...patch,
  };
}

export function payDraftFixture(patch: Partial<PayDraft> = {}): PayDraft {
  return {
    supplier: { id: 's9', name: 'Bakaara Steel', isVendorMaintainer: false, maintainerName: null },
    shape: 'PREPAY',
    bills: [],
    remainingToFund: '1000.00',
    accounts: [
      { bankAccountId: 'ba-salaam', name: 'Salaam Bank · 10100', underDualControl: true, lastUsed: true },
      { bankAccountId: 'ba-evc', name: 'EVC float', underDualControl: false, lastUsed: false },
    ],
    methods: ['BANK', 'MOBILE_MONEY'],
    defaultPaymentDate: '2026-10-08',
    bandHint: null,
    blockers: [],
    ...patch,
  };
}
