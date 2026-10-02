import { Injectable } from '@nestjs/common';
import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

/**
 * The branded payment-receipt PDF (WhatsApp V1 step 3) — the receipt counterpart of
 * {@link InvoiceDocumentService}, with the same look (accent bar, logo + org identity, uppercase
 * labels, totals block, footer note). See `PaymentReceiptDocumentService` for when it runs: lazily,
 * on first request for a POSTED receipt, then frozen.
 *
 * Written with `React.createElement` rather than JSX for the same reason as the invoice document:
 * `apps/api` has no JSX compiler setup.
 */

const h = React.createElement;

export interface ReceiptDocumentAllocation {
  /** The invoice's number, or a fallback label for an unnumbered one. */
  invoiceNumber: string;
  /** Decimal string, 2dp. */
  amount: string;
}

export interface ReceiptDocumentInput {
  receiptNumber: string;
  receiptDate: Date;
  currencyCode: string;
  /** Decimal strings, 2dp. */
  totalAmount: string;
  /** What the receipt was applied to when it was posted. */
  allocations: ReceiptDocumentAllocation[];
  /** The part of the payment not applied to an invoice at posting (later allocations are not shown). */
  unallocatedAmount: string;
  paymentMethod: string | null;
  /** The receiving bank account, e.g. 'Premier Bank — ACCO Operating'. */
  bankAccountLabel: string | null;
  reference: string | null;
  bankReference: string | null;
  clientName: string;
  clientAddress: string | null;
  org: {
    name: string;
    legalAddress: string | null;
    taxRegistrationNumber: string | null;
    brandColorHex: string | null;
    footerNote: string | null;
    template: 'STANDARD' | 'COMPACT';
    logo: { buffer: Buffer; mimeType: string } | null;
  };
}

const DEFAULT_BRAND_COLOR = '#1E40AF';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class ReceiptDocumentService {
  async render(input: ReceiptDocumentInput): Promise<Buffer> {
    return renderToBuffer(h(ReceiptDocument, { input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function ReceiptDocument({ input }: { input: ReceiptDocumentInput }) {
  const compact = input.org.template === 'COMPACT';
  const brandColor = HEX_COLOR.test(input.org.brandColorHex ?? '') ? (input.org.brandColorHex as string) : DEFAULT_BRAND_COLOR;
  const styles = buildStyles(brandColor, compact);
  const money = (value: string) => formatMoney(value, input.currencyCode);
  const hasUnallocated = Number(input.unallocatedAmount) > 0;

  return h(
    Document,
    null,
    h(
      Page,
      { size: 'A4', style: styles.page },
      h(View, { style: styles.accentBar }),

      // Header: logo + org identity on the left, "PAYMENT RECEIPT" + number on the right.
      h(
        View,
        { style: styles.headerRow },
        h(
          View,
          { style: styles.headerLeft },
          input.org.logo
            ? h(Image, {
                style: styles.logo,
                src: `data:${input.org.logo.mimeType};base64,${input.org.logo.buffer.toString('base64')}`,
              })
            : null,
          h(Text, { style: styles.orgName }, input.org.name),
          input.org.legalAddress ? h(Text, { style: styles.small }, input.org.legalAddress) : null,
          input.org.taxRegistrationNumber ? h(Text, { style: styles.small }, `Tax reg. ${input.org.taxRegistrationNumber}`) : null,
        ),
        h(
          View,
          { style: styles.headerRight },
          h(Text, { style: styles.title }, 'PAYMENT RECEIPT'),
          h(Text, { style: styles.number }, input.receiptNumber),
        ),
      ),

      // Received from, and the receipt's facts.
      h(
        View,
        { style: styles.metaRow },
        h(
          View,
          { style: styles.metaBlock },
          h(Text, { style: styles.label }, 'RECEIVED FROM'),
          h(Text, { style: styles.metaValueStrong }, input.clientName),
          input.clientAddress ? h(Text, { style: styles.small }, input.clientAddress) : null,
        ),
        h(
          View,
          { style: styles.metaBlockRight },
          metaLine(styles, 'Date received', formatDate(input.receiptDate)),
          input.paymentMethod ? metaLine(styles, 'Payment method', humanise(input.paymentMethod)) : null,
          input.bankAccountLabel ? metaLine(styles, 'Received into', input.bankAccountLabel) : null,
          input.reference ? metaLine(styles, 'Reference', input.reference) : null,
          input.bankReference ? metaLine(styles, 'Bank reference', input.bankReference) : null,
        ),
      ),

      // The amount, in figures, prominent.
      h(
        View,
        { style: styles.amountBox },
        h(Text, { style: styles.label }, 'AMOUNT RECEIVED'),
        h(Text, { style: styles.amountValue }, money(input.totalAmount)),
      ),

      // What the payment was applied to.
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: styles.tableHeaderDescription }, 'Applied to'),
          h(Text, { style: styles.tableHeaderAmount }, 'Amount applied'),
        ),
        ...input.allocations.map((allocation, index) =>
          h(
            View,
            { style: styles.tableRow, key: `a${index}` },
            h(Text, { style: styles.tableDescription }, `Invoice ${allocation.invoiceNumber}`),
            h(Text, { style: styles.tableAmount }, money(allocation.amount)),
          ),
        ),
        hasUnallocated || input.allocations.length === 0
          ? h(
              View,
              { style: styles.tableRow, key: 'unallocated' },
              h(Text, { style: styles.tableDescription }, 'Unallocated when the payment was recorded'),
              h(Text, { style: styles.tableAmount }, money(input.unallocatedAmount)),
            )
          : null,
      ),

      h(
        View,
        { style: styles.totalsBlock },
        h(
          View,
          { style: styles.totalLineStrong },
          h(Text, { style: styles.totalLabelStrong }, 'Total received'),
          h(Text, { style: styles.totalValueStrong }, money(input.totalAmount)),
        ),
      ),

      !compact && input.org.footerNote
        ? h(View, { style: styles.footer }, h(Text, { style: styles.footerText }, input.org.footerNote))
        : null,
    ),
  );
}

function metaLine(styles: ReturnType<typeof buildStyles>, label: string, value: string) {
  return h(View, { style: styles.metaLine }, h(Text, { style: styles.label }, label), h(Text, { style: styles.metaValue }, value));
}

/** 'BANK_TRANSFER' → 'Bank transfer'; free text is shown as typed. */
function humanise(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Same date + money formatting as the invoice PDF (invoice-document.service.ts).
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatMoney(value: string, currencyCode: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currencyCode}`;
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currencyCode} ${formatted}`;
}

function buildStyles(brandColor: string, compact: boolean) {
  return StyleSheet.create({
    page: {
      paddingTop: compact ? 24 : 40,
      paddingBottom: compact ? 24 : 40,
      paddingHorizontal: compact ? 32 : 48,
      fontSize: compact ? 9 : 10,
      fontFamily: 'Helvetica',
      color: '#1A1A1A',
    },
    accentBar: { height: 4, backgroundColor: brandColor, marginBottom: compact ? 16 : 24 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: compact ? 16 : 28 },
    headerLeft: { flexDirection: 'column', maxWidth: '60%' },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end' },
    logo: { maxHeight: compact ? 28 : 40, maxWidth: 160, marginBottom: 6, objectFit: 'contain' },
    orgName: { fontSize: compact ? 12 : 14, fontWeight: 700, marginBottom: 2 },
    small: { fontSize: 8.5, color: '#555555', marginBottom: 1 },
    title: { fontSize: compact ? 15 : 18, fontWeight: 700, letterSpacing: 1, color: brandColor },
    number: { fontSize: 9, color: '#555555', marginTop: 2 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: compact ? 14 : 22 },
    metaBlock: { flexDirection: 'column', maxWidth: '50%' },
    metaBlockRight: { flexDirection: 'column', alignItems: 'flex-end', maxWidth: '50%' },
    metaLine: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginBottom: 2 },
    label: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
    metaValue: { fontSize: 9 },
    metaValueStrong: { fontSize: 10.5, fontWeight: 700, marginTop: 2, marginBottom: 2 },
    amountBox: {
      borderLeftWidth: 3,
      borderLeftColor: brandColor,
      backgroundColor: '#F6F7F9',
      paddingVertical: compact ? 8 : 12,
      paddingHorizontal: 12,
      marginBottom: compact ? 14 : 22,
    },
    amountValue: { fontSize: compact ? 16 : 20, fontWeight: 700, marginTop: 4 },
    table: { borderTopWidth: 1, borderTopColor: '#DDDDDD', marginBottom: 8 },
    tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#DDDDDD', paddingVertical: 6 },
    tableHeaderDescription: { flex: 1, fontSize: 8, color: '#888888', textTransform: 'uppercase' },
    tableHeaderAmount: { width: 110, fontSize: 8, color: '#888888', textTransform: 'uppercase', textAlign: 'right' },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEEEEE', paddingVertical: compact ? 6 : 9 },
    tableDescription: { flex: 1, fontSize: compact ? 9 : 10 },
    tableAmount: { width: 110, fontSize: compact ? 9 : 10, textAlign: 'right' },
    totalsBlock: { alignSelf: 'flex-end', width: 220, marginTop: compact ? 8 : 14 },
    totalLineStrong: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: '#DDDDDD',
      paddingTop: 6,
      marginTop: 4,
    },
    totalLabelStrong: { fontSize: 11, fontWeight: 700 },
    totalValueStrong: { fontSize: 11, fontWeight: 700, color: brandColor },
    footer: { marginTop: 32, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEEEEE' },
    footerText: { fontSize: 8.5, color: '#777777' },
  });
}
