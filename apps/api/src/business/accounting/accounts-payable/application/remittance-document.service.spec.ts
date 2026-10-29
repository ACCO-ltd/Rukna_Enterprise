/**
 * Step 4 — remittance advice PDF. As for the receipt, Jest's `@react-pdf/renderer` is a stub, so
 * these assert on the element tree (what the PDF says) and that render() returns a buffer.
 */
import { RemittanceDocument, RemittanceDocumentService, type RemittanceDocumentInput } from './remittance-document.service';

const sample = (over: Partial<RemittanceDocumentInput> = {}): RemittanceDocumentInput => ({
  paymentNumber: 'PAY-000031',
  paymentDate: new Date('2026-10-20T00:00:00Z'),
  currencyCode: 'USD',
  totalAmount: '2500.00',
  bills: [
    { reference: 'SC-778 (our BILL-000012)', amount: '1800.00' },
    { reference: 'SC-781', amount: '500.00' },
  ],
  unallocatedAmount: '200.00',
  paymentMethod: 'BANK_TRANSFER',
  bankAccountLabel: 'Premier Bank — Operating',
  bankReference: 'TT-99',
  supplierName: 'Cement Supplies Co',
  supplierAddress: 'Industrial Road',
  org: { name: 'Example Builders', legalAddress: 'Main Street', taxRegistrationNumber: 'TIN-9', brandColorHex: null, template: 'STANDARD', logo: null },
  footer: null,
  ...over,
});

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? texts(props.children) : [];
}

describe('RemittanceDocumentService (Step 4)', () => {
  it('renders a buffer', async () => {
    const pdf = await new RemittanceDocumentService().render(sample());
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('says who was paid, from which bank, for which of their invoices, and the total', () => {
    const all = texts(RemittanceDocument({ input: sample() }));
    expect(all).toEqual(
      expect.arrayContaining([
        'Example Builders',
        'REMITTANCE ADVICE',
        'PAY-000031',
        'Cement Supplies Co',
        'Bank transfer',
        'Paid from Premier Bank — Operating',
        'Bank reference: TT-99',
        'SC-778 (our BILL-000012)',
        'SC-781',
        'Paid in advance (not yet applied to a bill)',
        'Total Paid',
      ]),
    );
  });

  it('shows no advance line when the payment is fully applied', () => {
    const all = texts(RemittanceDocument({ input: sample({ unallocatedAmount: '0.00' }) }));
    expect(all).not.toContain('Paid in advance (not yet applied to a bill)');
  });
});
