import type { CommercialInvoiceDocumentResponse } from '@erp/types';

/** Test fixture: a draft stage invoice as `GET …/commercial/invoices/:id` returns it. */
export function makeInvoiceDocument(
  overrides: Partial<CommercialInvoiceDocumentResponse> = {},
): CommercialInvoiceDocumentResponse {
  return {
    id: 'inv-1',
    projectId: 'p1',
    invoiceNumber: null,
    documentStatus: 'DRAFT',
    postingStatus: 'NOT_POSTED',
    settlementStatus: 'DRAFT',
    lifecycle: 'DRAFT',
    issuer: {
      name: 'ACCO Ltd',
      legalAddress: 'Olow Tower, Mogadishu',
      taxRegistrationNumber: 'TIN-778',
      logoUrl: null,
      footerNote: 'Thank you for your business.',
    },
    billTo: { name: 'Hormuud Holdings', address: 'KM4, Mogadishu' },
    invoiceDate: null,
    dueDate: null,
    paymentTermsDays: 30,
    projectCode: 'ACC-MOG-26-001',
    contractNumber: 'ACC-MOG-26-001-C1',
    currency: 'USD',
    lines: [
      { description: 'Stage 2 — Structure complete', detail: '30% of the contract', amount: '150000.00' },
      { description: 'VO-03 Extra parking level', detail: null, amount: '12000.00' },
    ],
    subtotal: '162000.00',
    taxLabel: 'Sales tax 5%',
    taxAmount: '8100.00',
    total: '170100.00',
    balanceDue: '170100.00',
    source: { kind: 'INSTALLMENT', label: 'Structure complete', id: 'inst-2' },
    journalEntryId: null,
    deliveries: [],
    createdAt: '2026-09-20T08:00:00.000Z',
    createdBy: 'Amina Yusuf',
    financialsVisible: true,
    capabilities: {
      canIssue: true,
      canSend: false,
      canRecordPayment: false,
      canEditDraft: true,
      canDeleteDraft: true,
      canIssueCreditNote: false,
      canDownloadPdf: true,
    },
    ...overrides,
  };
}
