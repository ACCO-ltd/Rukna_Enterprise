/**
 * Receipt PDF (WhatsApp V1 step 3). Under Jest `@react-pdf/renderer` is the CJS stub
 * (test/mocks/react-pdf-renderer.stub.ts), so these assert on the document's element tree — what
 * the PDF says — and that render() produces a buffer. The real renderer was exercised by hand.
 */
import { ReceiptDocument, ReceiptDocumentService, type ReceiptDocumentInput } from './receipt-document.service';

const sample = (over: Partial<ReceiptDocumentInput> = {}): ReceiptDocumentInput => ({
  receiptNumber: 'RCP-000017',
  receiptDate: new Date('2026-10-02T00:00:00Z'),
  currencyCode: 'USD',
  totalAmount: '5000.00',
  allocations: [
    { invoiceNumber: 'INV-000041', amount: '3000.00' },
    { invoiceNumber: 'INV-000042', amount: '1500.00' },
  ],
  unallocatedAmount: '500.00',
  paymentMethod: 'BANK_TRANSFER',
  bankAccountLabel: 'Premier Bank — ACCO Operating',
  reference: 'Stage 2',
  bankReference: 'TRX-1',
  clientName: 'Hodan Construction Ltd',
  clientAddress: 'KM4, Mogadishu',
  org: {
    name: 'ACCO Ltd',
    legalAddress: 'Mogadishu',
    taxRegistrationNumber: 'TIN-1',
    brandColorHex: '#0F766E',
    footerNote: 'Thank you.',
    template: 'STANDARD',
    logo: null,
  },
  ...over,
});

/** Every string in the element tree, in order. */
function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? texts(props.children) : [];
}

describe('ReceiptDocumentService', () => {
  it('renders a buffer', async () => {
    const pdf = await new ReceiptDocumentService().render(sample());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('carries the org, receipt number, client, amount, method, bank, references and footer', () => {
    const all = texts(ReceiptDocument({ input: sample() }));
    expect(all).toEqual(
      expect.arrayContaining([
        'ACCO Ltd',
        'Tax reg. TIN-1',
        'PAYMENT RECEIPT',
        'RCP-000017',
        'Hodan Construction Ltd',
        'KM4, Mogadishu',
        'Oct 2, 2026',
        'Bank transfer',
        'Premier Bank — ACCO Operating',
        'Stage 2',
        'TRX-1',
        'USD 5,000.00',
        'Thank you.',
      ]),
    );
  });

  it('lists each invoice it was applied to, plus the amount held on account', () => {
    const all = texts(ReceiptDocument({ input: sample() }));
    expect(all).toEqual(
      expect.arrayContaining(['Invoice INV-000041', 'USD 3,000.00', 'Invoice INV-000042', 'USD 1,500.00', 'USD 500.00']),
    );
    expect(all.some((t) => t.startsWith('Held on account'))).toBe(true);
  });

  it('a fully-applied receipt has no held-on-account row; an unapplied one shows only that row', () => {
    const full = texts(
      ReceiptDocument({ input: sample({ allocations: [{ invoiceNumber: 'INV-1', amount: '5000.00' }], unallocatedAmount: '0.00' }) }),
    );
    expect(full.some((t) => t.startsWith('Held on account'))).toBe(false);

    const none = texts(ReceiptDocument({ input: sample({ allocations: [], unallocatedAmount: '5000.00' }) }));
    expect(none.filter((t) => t.startsWith('Invoice '))).toHaveLength(0);
    expect(none.some((t) => t.startsWith('Held on account'))).toBe(true);
  });

  it('omits optional facts that are absent and keeps free-text payment methods as typed', () => {
    const all = texts(
      ReceiptDocument({
        input: sample({ paymentMethod: 'EVC Plus', bankAccountLabel: null, reference: null, bankReference: null, clientAddress: null }),
      }),
    );
    expect(all).toContain('EVC Plus');
    expect(all).not.toContain('Received into');
    expect(all).not.toContain('Reference');
  });
});
