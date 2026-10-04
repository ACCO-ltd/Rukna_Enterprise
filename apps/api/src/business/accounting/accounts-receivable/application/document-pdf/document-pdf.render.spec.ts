/**
 * The REAL rendered PDFs. Jest maps `@react-pdf/renderer` (pure ESM) to a stub, so the samples are
 * rendered in a child Node process (test/pdf/render-fixture.ts, ts-node) and their text is read
 * back here: labels and values must appear, in reading order, and a long invoice must paginate with
 * the table header repeated and the totals block kept whole on the last page.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const API_ROOT = resolve(__dirname, '../../../../../..');
let dir: string;
/** WinAnsi bytes → text: Latin-1, plus the 0x80–0x9F punctuation the documents use. */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”',
  0x95: '•', 0x96: '–', 0x97: '—',
};
const winAnsi = {
  decode: (bytes: Buffer) => Array.from(bytes, (b) => WIN_ANSI_HIGH[b] ?? String.fromCharCode(b)).join(''),
};

function render(fixture: string): Buffer {
  const out = join(dir, `${fixture}.pdf`);
  execFileSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-r', './test/pdf/js-to-ts-resolve.cjs', 'test/pdf/render-fixture.ts', fixture, out],
    { cwd: API_ROOT, stdio: 'pipe', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
  );
  return readFileSync(out);
}

/**
 * Text of each page, in drawing order: every TJ/Tj string of every (Flate) content stream, decoded
 * as the standard-14 fonts' WinAnsi bytes. Enough for the Helvetica documents these are.
 */
function pagesText(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const pages: string[] = [];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    if (!content.includes('BT')) continue;
    const runs: string[] = [];
    const tjRe = /\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
    let tj: RegExpExecArray | null;
    while ((tj = tjRe.exec(content))) {
      const body = tj[1] ?? `<${tj[2]}>`;
      const hexes = body.match(/<([0-9a-fA-F]*)>/g) ?? [];
      runs.push(hexes.map((h) => winAnsi.decode(Buffer.from(h.slice(1, -1), 'hex'))).join(''));
    }
    // Text is drawn run by run (a word group per run), so runs join without separators.
    pages.push(runs.join(''));
  }
  return pages;
}

function expectInOrder(text: string, items: string[]) {
  let from = 0;
  for (const item of items) {
    const at = text.indexOf(item, from);
    if (at < 0) throw new Error(`"${item}" not found after position ${from}`);
    from = at + item.length;
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'invoice-pdf-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('invoice PDF (real renderer)', () => {
  it('a short invoice is one A4 page with every section in reading order', () => {
    const pdf = render('invoice-short');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/); // A4
    expect(pdf.toString('latin1')).toContain('invoice-template-v2');
    const pages = pagesText(pdf);
    expect(pages).toHaveLength(1);
    expectInOrder(pages[0], [
      'Example Construction Ltd',
      'Tax Reg. TIN-100200300',
      'INVOICE',
      'Invoice No.',
      'INV-000123',
      'Payment Terms',
      'Net 30 days',
      'BILL TO',
      'Hodan Real Estate Ltd',
      'Mogadishu, Somalia',
      'Tax Reg. ',
      'PROJECT',
      'ACC-BN-26-004',
      'AMOUNT DUE',
      'USD 123,750.00',
      'DESCRIPTION',
      'UNIT PRICE (USD)',
      'AMOUNT (USD)',
      'Stage 2 of 4 ',
      '30% of the contract value of USD 412,500.00',
      'Subtotal',
      'Sales Tax 0%',
      'Total Due',
      'Bank Account Details',
      'Bank',
      'Account number',
      'Salaam Bank',
      '33020045871',
      'Dahabshiil Bank',
      'Premier Bank',
      '0102 0033 4410',
      'My Bank',
      '7700 5512 09',
      'Reference: ',
      'INV-000123',
      'Notes',
      'Please quote the invoice number in your payment.',
      'AUTHORIZED SIGNATURE',
      'Ahmed Ali',
      'Finance Manager',
      'Thank you for your business.',
      'Example Construction Ltd · Mogadishu, Somalia',
    ]);
  }, 60_000);

  it('a variation invoice carries the VO line and the tax rate', () => {
    const [page] = pagesText(render('invoice-variation-tax'));
    expectInOrder(page, ['VO-03 Additional shop fronts', 'Client-approved variation', 'Sales Tax 5%', 'USD 920.00', 'USD 19,320.00']);
  }, 60_000);

  it('a 40-line invoice paginates: header repeated per page, totals whole on the last page', () => {
    const pages = pagesText(render('invoice-40-lines'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) {
      expect(page).toContain('DESCRIPTION');
      expect(page).toContain('Thank you for your business.');
    }
    pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} of ${pages.length}`));
    const all = pages.join('\n');
    for (let n = 1; n <= 40; n += 1) expect(all).toContain(`Line item ${n} `);
    const last = pages[pages.length - 1];
    expectInOrder(last, ['Line item 40 ', 'Subtotal', 'Total Due', 'Bank Account Details', 'AUTHORIZED SIGNATURE']);
    expect(pages.slice(0, -1).join('\n')).not.toContain('Total Due');
  }, 60_000);
});

describe('receipt PDF (real renderer)', () => {
  it('shares the brand header and footer and keeps the receipt content', () => {
    const pages = pagesText(render('receipt'));
    expect(pages).toHaveLength(1);
    expectInOrder(pages[0], [
      'Example Construction Ltd',
      'Tax Reg. TIN-100200300',
      'RECEIPT',
      'Receipt No.',
      'RCP-000017',
      'RECEIVED FROM',
      'Hodan Real Estate Ltd',
      'Bank transfer',
      'AMOUNT RECEIVED',
      'USD 50,000.00',
      'APPLIED TO',
      'Invoice INV-000121',
      'USD 30,000.00',
      'Unallocated when the payment was recorded',
      'Total received',
      'Thank you for your payment.',
      'Example Construction Ltd · Mogadishu, Somalia',
    ]);
  }, 60_000);
});
