import { Injectable } from '@nestjs/common';
import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

/**
 * The branded invoice document (Commercial round-3) — what "Generate invoice" / "Bill this
 * stage" used to promise and never produced. See {@link ClientInvoiceService.getOrGenerateDocument}
 * for when this runs (lazily, on first request for the document, never eagerly at creation).
 *
 * Built with `React.createElement` rather than JSX: `@react-pdf/renderer` is React-based, but
 * `apps/api` has no `jsx` compiler option and none of its build tooling (nest-cli's webpack,
 * ts-jest) is configured for it — adding one to support a single file is a bigger, riskier change
 * than writing this one file without JSX sugar.
 */

const h = React.createElement;

export interface InvoiceDocumentLineItem {
  description: string;
  amount: string;
}

export interface InvoiceDocumentInput {
  invoiceNumber: string | null;
  invoiceDate: Date;
  dueDate: Date;
  currencyCode: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  paymentTerms: string | null;
  clientName: string;
  clientAddress: string | null;
  clientTaxNumber: string | null;
  /** What this invoice is for — the installment name, IPC reference, VO label, etc. */
  lineDescription: string;
  org: {
    name: string;
    legalAddress: string | null;
    taxRegistrationNumber: string | null;
    brandColorHex: string | null;
    invoiceFooterNote: string | null;
    template: 'STANDARD' | 'COMPACT';
    /** Embedded directly as a data URI — see the class doc on why this is read un-gated. */
    logo: { buffer: Buffer; mimeType: string } | null;
  };
}

const DEFAULT_BRAND_COLOR = '#1E40AF';

@Injectable()
export class InvoiceDocumentService {
  async render(input: InvoiceDocumentInput): Promise<Buffer> {
    const element = h(InvoiceDocument, { input });
    return renderToBuffer(element as never);
  }
}

function InvoiceDocument({ input }: { input: InvoiceDocumentInput }) {
  const compact = input.org.template === 'COMPACT';
  const brandColor = HEX_COLOR.test(input.org.brandColorHex ?? '')
    ? (input.org.brandColorHex as string)
    : DEFAULT_BRAND_COLOR;
  const styles = buildStyles(brandColor, compact);

  const money = (value: string) => formatMoney(value, input.currencyCode);
  const vatRatePercent = ratePercent(input.subtotal, input.vatAmount);

  return h(
    Document,
    null,
    h(
      Page,
      { size: 'A4', style: styles.page },
      // Brand accent bar.
      h(View, { style: styles.accentBar }),

      // Header: logo + org identity on the left, "INVOICE" + number on the right.
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
          input.org.taxRegistrationNumber
            ? h(Text, { style: styles.small }, `Tax reg. ${input.org.taxRegistrationNumber}`)
            : null,
        ),
        h(
          View,
          { style: styles.headerRight },
          h(Text, { style: styles.invoiceTitle }, 'INVOICE'),
          h(Text, { style: styles.invoiceNumber }, input.invoiceNumber ?? 'DRAFT'),
        ),
      ),

      // Meta: dates + terms, and Bill To — side by side.
      h(
        View,
        { style: styles.metaRow },
        h(
          View,
          { style: styles.metaBlock },
          h(Text, { style: styles.label }, 'BILL TO'),
          h(Text, { style: styles.metaValueStrong }, input.clientName),
          input.clientAddress ? h(Text, { style: styles.small }, input.clientAddress) : null,
          input.clientTaxNumber
            ? h(Text, { style: styles.small }, `Tax reg. ${input.clientTaxNumber}`)
            : null,
        ),
        h(
          View,
          { style: styles.metaBlockRight },
          metaLine(styles, 'Invoice date', formatDate(input.invoiceDate)),
          metaLine(styles, 'Due date', formatDate(input.dueDate)),
          input.paymentTerms ? metaLine(styles, 'Payment terms', input.paymentTerms) : null,
        ),
      ),

      // Line items — one row today (see InvoiceDocumentInput), formatted as a real table so
      // adding a genuine multi-line breakdown later is a data change, not a layout rewrite.
      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: styles.tableHeaderDescription }, 'Description'),
          h(Text, { style: styles.tableHeaderAmount }, 'Amount'),
        ),
        h(
          View,
          { style: styles.tableRow },
          h(Text, { style: styles.tableDescription }, input.lineDescription),
          h(Text, { style: styles.tableAmount }, money(input.subtotal)),
        ),
      ),

      // Totals.
      h(
        View,
        { style: styles.totalsBlock },
        totalLine(styles, 'Subtotal', money(input.subtotal), false),
        totalLine(
          styles,
          vatRatePercent !== null ? `Sales Tax ${vatRatePercent}%` : 'Sales Tax',
          money(input.vatAmount),
          false,
        ),
        totalLine(styles, 'Total due', money(input.totalAmount), true),
      ),

      !compact && input.org.invoiceFooterNote
        ? h(View, { style: styles.footer }, h(Text, { style: styles.footerText }, input.org.invoiceFooterNote))
        : null,
    ),
  );
}

function metaLine(styles: ReturnType<typeof buildStyles>, label: string, value: string) {
  return h(
    View,
    { style: styles.metaLine },
    h(Text, { style: styles.label }, label),
    h(Text, { style: styles.metaValue }, value),
  );
}

function totalLine(
  styles: ReturnType<typeof buildStyles>,
  label: string,
  value: string,
  emphasis: boolean,
) {
  return h(
    View,
    { style: emphasis ? styles.totalLineStrong : styles.totalLine },
    h(Text, { style: emphasis ? styles.totalLabelStrong : styles.totalLabel }, label),
    h(Text, { style: emphasis ? styles.totalValueStrong : styles.totalValue }, value),
  );
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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
    headerLeft: { flexDirection: 'column', maxWidth: '65%' },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end' },
    logo: { maxHeight: compact ? 28 : 40, maxWidth: 160, marginBottom: 6, objectFit: 'contain' },
    orgName: { fontSize: compact ? 12 : 14, fontWeight: 700, marginBottom: 2 },
    small: { fontSize: 8.5, color: '#555555', marginBottom: 1 },
    invoiceTitle: { fontSize: compact ? 16 : 20, fontWeight: 700, letterSpacing: 1, color: brandColor },
    invoiceNumber: { fontSize: 9, color: '#555555', marginTop: 2 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: compact ? 14 : 24 },
    metaBlock: { flexDirection: 'column', maxWidth: '55%' },
    metaBlockRight: { flexDirection: 'column', alignItems: 'flex-end' },
    metaLine: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginBottom: 2 },
    label: { fontSize: 8, color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
    metaValue: { fontSize: 9 },
    metaValueStrong: { fontSize: 10.5, fontWeight: 700, marginTop: 2, marginBottom: 2 },
    table: { borderTopWidth: 1, borderTopColor: '#DDDDDD', marginBottom: 8 },
    tableHeaderRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#DDDDDD',
      paddingVertical: 6,
    },
    tableHeaderDescription: { flex: 1, fontSize: 8, color: '#888888', textTransform: 'uppercase' },
    tableHeaderAmount: {
      width: 100,
      fontSize: 8,
      color: '#888888',
      textTransform: 'uppercase',
      textAlign: 'right',
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#EEEEEE',
      paddingVertical: compact ? 6 : 10,
    },
    tableDescription: { flex: 1, fontSize: compact ? 9 : 10 },
    tableAmount: { width: 100, fontSize: compact ? 9 : 10, textAlign: 'right' },
    totalsBlock: { alignSelf: 'flex-end', width: 220, marginTop: compact ? 8 : 14 },
    totalLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    totalLabel: { fontSize: 9, color: '#555555' },
    totalValue: { fontSize: 9 },
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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    date,
  );
}

function formatMoney(value: string, currencyCode: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currencyCode}`;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencyCode} ${formatted}`;
}

/** VAT rate as a whole/1dp percent for the label ("Sales Tax 5%"), or null when it can't be derived. */
function ratePercent(subtotal: string, vatAmount: string): string | null {
  const base = Number(subtotal);
  const tax = Number(vatAmount);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(tax)) return null;
  const pct = (tax / base) * 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}
