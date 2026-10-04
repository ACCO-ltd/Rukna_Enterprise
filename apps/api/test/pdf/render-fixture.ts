/**
 * Renders one of the sample documents (document-pdf.fixtures.ts) with the REAL `@react-pdf`
 * renderer — which Jest cannot load (it is pure ESM; Jest maps it to a stub) — and writes the PDF.
 *
 *   node -r ts-node/register/transpile-only -r ./test/pdf/js-to-ts-resolve.cjs \
 *     test/pdf/render-fixture.ts <fixture-name> <out.pdf>
 *
 * Used by document-pdf.render.spec.ts (in a child process) and to produce previews by hand.
 */
import { writeFileSync } from 'node:fs';

import { InvoiceDocumentService } from '../../src/business/accounting/accounts-receivable/application/invoice-document.service.js';
import { ReceiptDocumentService } from '../../src/business/accounting/accounts-receivable/application/receipt-document.service.js';
import {
  documentFixtures,
  type DocumentFixtureName,
} from '../../src/business/accounting/accounts-receivable/application/document-pdf/document-pdf.fixtures.js';

async function main() {
  const [name, out] = process.argv.slice(2);
  const fixture = documentFixtures[name as DocumentFixtureName];
  if (!fixture || !out) {
    throw new Error(`usage: render-fixture <${Object.keys(documentFixtures).join('|')}> <out.pdf>`);
  }
  const pdf =
    fixture.kind === 'invoice'
      ? await new InvoiceDocumentService().render(fixture.input)
      : await new ReceiptDocumentService().render(fixture.input);
  writeFileSync(out, pdf);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
