import { Injectable } from '@nestjs/common';
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';

import {
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  h,
  infoColumns,
  pageNumbers,
  topBar,
  totalsBlock,
  type KitStyles,
} from './document-pdf/pdf-kit.js';
import {
  INVOICE_TEMPLATE_VERSION,
  buildInvoiceViewModel,
  type InvoiceDocumentInput,
  type InvoiceViewModel,
} from './document-pdf/invoice-view-model.js';

export type {
  InvoiceDocumentInput,
  InvoiceDocumentLine,
  InvoicePaymentAccount,
  InvoiceSignatory,
} from './document-pdf/invoice-view-model.js';

/**
 * The client invoice PDF (A4) in the owner's minimal layout: brand bar, logo + tagline + address
 * and the INVOICE facts, Bill To | Project, the line table, totals with the Total Due box, the
 * optional Bank Account Details and Notes (off unless the settings turn them on), the signature
 * and the footer contact strip. See {@link ClientInvoiceService.getOrGenerateDocument} for when it
 * runs: lazily, on first request, then stored and IMMUTABLE — a layout change only reaches
 * documents generated after it shipped.
 *
 * What each section shows is decided by {@link buildInvoiceViewModel}; this file only lays it out.
 * The header, info band, totals and footer are shared with the receipt (document-pdf/pdf-kit.ts).
 */
@Injectable()
export class InvoiceDocumentService {
  async render(input: InvoiceDocumentInput): Promise<Buffer> {
    return renderToBuffer(InvoiceDocument({ input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function InvoiceDocument({ input }: { input: InvoiceDocumentInput }) {
  const vm = buildInvoiceViewModel(input);
  const s = buildKitStyles(vm.brand.palette, vm.brand.compact);

  return h(
    Document,
    {
      title: `Invoice ${input.invoiceNumber ?? 'draft'}`,
      author: vm.brand.orgName,
      creator: INVOICE_TEMPLATE_VERSION,
      producer: INVOICE_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: s.page },
      topBar(s),
      documentHeader(s, vm.brand, vm.title, vm.meta),
      divider(s),
      infoColumns(s, vm.billTo, vm.project),
      lineTable(s, vm),
      h(
        // Totals, the optional sections and the signature stay together rather than splitting.
        View,
        { wrap: false },
        totalsBlock(s, vm.totals, vm.total),
        optionalSections(s, vm),
        signature(s, vm),
      ),
      documentFooter(s, vm.brand, vm.footer),
      pageNumbers(s),
    ),
  );
}

const COL = { index: 26, qty: 40, money: 96 };

function lineTable(s: KitStyles, vm: InvoiceViewModel) {
  const cols = vm.columns;
  return h(
    View,
    { style: s.table },
    // `fixed` repeats the header row on every page the table continues onto.
    h(
      View,
      { style: s.thRow, fixed: true },
      h(Text, { style: [s.cell, s.th, { width: COL.index }] }, cols.index),
      h(Text, { style: [s.cell, s.th, { flex: 1 }] }, cols.description),
      h(Text, { style: [s.cell, s.th, { width: COL.qty, textAlign: 'right' }] }, cols.quantity),
      h(Text, { style: [s.cell, s.th, { width: COL.money + 10, textAlign: 'right' }] }, cols.unitPrice),
      h(Text, { style: [s.cell, s.th, s.ruledCell, { width: COL.money, textAlign: 'right' }] }, cols.amount),
    ),
    ...vm.lines.map((line, i) =>
      h(
        View,
        { style: i === vm.lines.length - 1 ? s.trLast : s.tr, wrap: false, key: `l${i}` },
        h(Text, { style: [s.cell, s.td, { width: COL.index, color: '#6B7280' }] }, line.index),
        h(
          View,
          { style: [s.cell, { flex: 1 }] },
          h(Text, { style: s.lineTitle }, line.title),
          line.detail ? h(Text, { style: s.lineDetail }, line.detail) : null,
        ),
        h(Text, { style: [s.cell, s.td, { width: COL.qty, textAlign: 'right' }] }, line.quantity),
        h(Text, { style: [s.cell, s.td, { width: COL.money + 10, textAlign: 'right' }] }, line.unitPrice),
        h(
          Text,
          { style: [s.cell, s.td, s.ruledCell, { width: COL.money, textAlign: 'right', fontFamily: 'Helvetica-Bold' }] },
          line.amount,
        ),
      ),
    ),
  );
}

/** Bank Account Details and Notes — minimal: a small heading and plain rows, no cards. */
function optionalSections(s: KitStyles, vm: InvoiceViewModel) {
  if (!vm.payment && vm.notes.length === 0) return null;
  const muted = { fontSize: 8.5, color: '#6B7280' };
  const strong = { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#14213D' };
  return h(
    View,
    { style: { flexDirection: 'row', marginBottom: 6 } },
    vm.payment
      ? h(
          View,
          { style: { flex: 1, paddingRight: 20 } },
          h(Text, { style: s.sectionTitle }, vm.payment.title),
          ...vm.payment.rows.map((row, i) =>
            h(
              View,
              { style: { flexDirection: 'row', marginBottom: 2 }, key: `b${i}` },
              h(Text, { style: [muted, { width: 110 }] }, row.bank),
              h(Text, { style: strong }, row.accountNumber),
            ),
          ),
          h(
            View,
            { style: { flexDirection: 'row', marginTop: 3 } },
            h(Text, { style: [muted, { width: 110 }] }, vm.payment.reference.label),
            h(Text, { style: strong }, vm.payment.reference.value),
          ),
        )
      : null,
    vm.notes.length > 0
      ? h(
          View,
          { style: { flex: 1 } },
          h(Text, { style: s.sectionTitle }, 'Notes'),
          ...vm.notes.map((note, i) =>
            h(
              View,
              { style: { flexDirection: 'row', marginBottom: 2 }, key: `n${i}` },
              h(Text, { style: [muted, { width: 12 }] }, `${i + 1}.`),
              h(Text, { style: [muted, { flex: 1 }] }, note),
            ),
          ),
        )
      : null,
  );
}

/** Line, then name, title, company and date — or the blank line alone when no signatory is set. */
function signature(s: KitStyles, vm: InvoiceViewModel) {
  const sig = vm.signature;
  return h(
    View,
    { style: s.signature },
    h(View, { style: s.signatureLine }),
    sig.name ? h(Text, { style: s.signatureName }, sig.name) : null,
    sig.name && sig.title ? h(Text, { style: s.signatureMeta }, sig.title) : null,
    sig.name ? h(Text, { style: s.signatureMeta }, sig.company) : null,
    sig.name ? h(Text, { style: s.signatureMeta }, sig.date) : null,
  );
}
