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
    template: 'STANDARD',
    logo: null,
    tagline: 'Construction & Development',
  },
  footer: { address: 'Olow Tower\nMogadishu, Somalia', phones: ['+252 61 234 5678'], email: 'info@acco.com', website: null },
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

  it('carries the org, tagline, receipt number, client, amount, method, bank, references and footer contacts', () => {
    const all = texts(ReceiptDocument({ input: sample() }));
    expect(all).toEqual(
      expect.arrayContaining([
        'ACCO Ltd',
        'Tax Reg. TIN-1',
        'RECEIPT',
        'RCP-000017',
        'Hodan Construction Ltd',
        'KM4, Mogadishu',
        'Oct 2, 2026',
        'Bank transfer',
        'Received into Premier Bank — ACCO Operating',
        'Reference: Stage 2',
        'Bank reference: TRX-1',
        'USD 5,000.00',
        'CONSTRUCTION & DEVELOPMENT',
        'Olow Tower',
        '+252 61 234 5678',
        'info@acco.com',
      ]),
    );
  });

  it('lists each invoice it was applied to, plus the amount unallocated at posting', () => {
    const all = texts(ReceiptDocument({ input: sample() }));
    expect(all).toEqual(
      expect.arrayContaining(['Invoice INV-000041', 'USD 3,000.00', 'Invoice INV-000042', 'USD 1,500.00', 'USD 500.00']),
    );
    expect(all.some((t) => t.startsWith('Unallocated when the payment was recorded'))).toBe(true);
  });

  it('a fully-applied receipt has no unallocated row; an unapplied one shows only that row', () => {
    const full = texts(
      ReceiptDocument({ input: sample({ allocations: [{ invoiceNumber: 'INV-1', amount: '5000.00' }], unallocatedAmount: '0.00' }) }),
    );
    expect(full.some((t) => t.startsWith('Unallocated when the payment was recorded'))).toBe(false);

    const none = texts(ReceiptDocument({ input: sample({ allocations: [], unallocatedAmount: '5000.00' }) }));
    expect(none.filter((t) => t.startsWith('Invoice '))).toHaveLength(0);
    expect(none.some((t) => t.startsWith('Unallocated when the payment was recorded'))).toBe(true);
  });

  it('without a payment method, leads the Payment column with the first fact, never "Payment" twice', () => {
    const all = texts(ReceiptDocument({ input: sample({ paymentMethod: null }) }));
    expect(all.filter((t) => t === 'Payment')).toHaveLength(1);
    expect(all).toContain('Received into Premier Bank — ACCO Operating');
    const bare = texts(
      ReceiptDocument({
        input: sample({ paymentMethod: null, bankAccountLabel: null, reference: null, bankReference: null }),
      }),
    );
    expect(bare).not.toContain('Payment');
  });

  it('omits optional facts that are absent and keeps free-text payment methods as typed', () => {
    const all = texts(
      ReceiptDocument({
        input: sample({ paymentMethod: 'EVC Plus', bankAccountLabel: null, reference: null, bankReference: null, clientAddress: null }),
      }),
    );
    expect(all).toContain('EVC Plus');
    expect(all.some((t) => t.startsWith('Received into'))).toBe(false);
    expect(all.some((t) => t.startsWith('Reference'))).toBe(false);
  });
});
