import { Injectable } from '@nestjs/common';
import { describeReference } from '../domain/supplier-payment-rules.js';
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';

import {
  brandView,
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  footerColumns,
  formatDate,
  formatMoney,
  h,
  infoColumns,
  pageNumbers,
  splitLines,
  topBar,
  totalsBlock,
  type FooterContactsInput,
  type KeyValue,
} from '../../accounts-receivable/application/document-pdf/pdf-kit.js';

/**
 * Step 4 — the branded remittance advice for a posted supplier payment: what was paid, from which
 * bank, and which of the supplier's bills it settles. Same minimal layout as the invoice and the
 * receipt (shared kit), so every document the company sends looks like the same company's.
 */

export interface RemittanceBill {
  /** Our bill number, with the supplier's own invoice number (what the supplier recognises). */
  reference: string;
  /** Decimal string, 2dp. */
  amount: string;
}

export interface RemittanceDocumentInput {
  paymentNumber: string;
  paymentDate: Date;
  currencyCode: string;
  totalAmount: string;
  bills: RemittanceBill[];
  /** Paid in advance, against no bill. */
  unallocatedAmount: string;
  paymentMethod: string;
  bankAccountLabel: string | null;
  bankReference: string | null;
  supplierName: string;
  supplierAddress: string | null;
  org: {
    name: string;
    legalAddress: string | null;
    taxRegistrationNumber: string | null;
    brandColorHex: string | null;
    template: 'STANDARD' | 'COMPACT';
    logo: { buffer: Buffer; mimeType: string } | null;
    tagline?: string | null;
  };
  footer?: FooterContactsInput | null;
}

export const REMITTANCE_TEMPLATE_VERSION = 'remittance-template-v1-minimal';

@Injectable()
export class RemittanceDocumentService {
  async render(input: RemittanceDocumentInput): Promise<Buffer> {
    return renderToBuffer(RemittanceDocument({ input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function RemittanceDocument({ input }: { input: RemittanceDocumentInput }) {
  const brand = brandView(input.org);
  const s = buildKitStyles(brand.palette, brand.compact);
  const money = (value: string) => formatMoney(value, input.currencyCode);

  const meta: KeyValue[] = [
    { label: 'Payment No.', value: input.paymentNumber },
    { label: 'Payment Date', value: formatDate(input.paymentDate) },
  ];
  const facts = [
    input.bankAccountLabel ? `Paid from ${input.bankAccountLabel}` : null,
    input.bankReference ? describeReference(input.paymentMethod, input.bankReference) : null,
  ].filter((line): line is string => line !== null);

  const rows = [
    ...input.bills.map((bill) => ({ description: bill.reference, amount: money(bill.amount) })),
    ...(Number(input.unallocatedAmount) > 0 || input.bills.length === 0
      ? [{ description: 'Paid in advance (not yet applied to a bill)', amount: money(input.unallocatedAmount) }]
      : []),
  ];

  return h(
    Document,
    {
      title: `Remittance advice ${input.paymentNumber}`,
      author: input.org.name,
      creator: REMITTANCE_TEMPLATE_VERSION,
      producer: REMITTANCE_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: s.page },
      topBar(s),
      documentHeader(s, brand, 'REMITTANCE ADVICE', meta),
      divider(s),
      infoColumns(
        s,
        { label: 'Paid To', name: input.supplierName, lines: splitLines(input.supplierAddress) },
        { label: 'Payment', name: humanise(input.paymentMethod), lines: facts },
      ),
      h(
        View,
        { style: s.table },
        h(
          View,
          { style: s.thRow, fixed: true },
          h(Text, { style: [s.cell, s.th, { flex: 1 }] }, 'Your Invoice'),
          h(Text, { style: [s.cell, s.th, s.ruledCell, { width: 150, textAlign: 'right' }] }, 'Amount Paid'),
        ),
        ...rows.map((row, i) =>
          h(
            View,
            { style: i === rows.length - 1 ? s.trLast : s.tr, wrap: false, key: `b${i}` },
            h(Text, { style: [s.cell, s.td, { flex: 1 }] }, row.description),
            h(Text, { style: [s.cell, s.td, s.ruledCell, { width: 150, textAlign: 'right' }] }, row.amount),
          ),
        ),
      ),
      totalsBlock(s, [], { label: 'Total Paid', value: money(input.totalAmount) }),
      documentFooter(s, brand, footerColumns(input.footer, input.org.legalAddress)),
      pageNumbers(s),
    ),
  );
}

/** 'BANK_TRANSFER' → 'Bank transfer'; free text is shown as typed. */
function humanise(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
