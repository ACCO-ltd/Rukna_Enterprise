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
  it('the minimal invoice is one A4 page with the mock sections in reading order', () => {
    const pdf = render('invoice-minimal');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/); // A4
    expect(pdf.toString('latin1')).toContain('invoice-template-v3-minimal');
    const pages = pagesText(pdf);
    expect(pages).toHaveLength(1);
    expectInOrder(pages[0], [
      'ACCO Ltd',
      'CONSTRUCTION & DEVELOPMENT',
      'Olow Tower, Maka Al-Mukarama Road',
      'Tax Reg. 100045678',
      'INVOICE',
      'Invoice No.',
      'INV-000003',
      'Invoice Date',
      'Oct 4, 2026',
      'Due Date',
      'Nov 3, 2026',
      'Payment Terms',
      'Net 30 days',
      'Bill To',
      'Ahmed Shirie',
      'Mogadishu, Somalia',
      'Tax Reg. 254708023039',
      'Project',
      'ACCO-DHL-26-0012',
      'ABC, Dharkeynley, KM4, Mogadishu',
      'Description',
      'Unit Price (USD)',
      'Amount (USD)',
      'Stage 1 of 4 – Advance (mobilisation)',
      '40% of the contract value of USD 20,000.00',
      '8,000.00',
      'Subtotal',
      'Sales Tax (5%)',
      'USD 400.00',
      'Total Due',
      'USD 8,400.00',
      'Ahmed Abdi Hassan',
      'CEO',
      '+252 61 234 5678',
      '+252 90 123 4567',
      'info@acco.com',
      'www.acco.com',
    ]);
    // Not in the mock: no amount-due box, no section headings in capitals, no thank-you line,
    // and the optional sections are off by default.
    for (const absent of ['AMOUNT DUE', 'AUTHORIZED SIGNATURE', 'Thank you', 'Bank Account Details', 'Notes']) {
      expect(pages[0]).not.toContain(absent);
    }
  }, 60_000);

  it('switched on, the bank details and notes print between the totals and the signature', () => {
    const [page] = pagesText(render('invoice-bank-notes'));
    expectInOrder(page, [
      'Total Due',
      'Bank Account Details',
      'Salaam Bank',
      '33020045871',
      'My Bank',
      'Reference',
      'INV-000003',
      'Notes',
      'Please quote the invoice number in your payment.',
      'Ahmed Abdi Hassan',
    ]);
  }, 60_000);

  it('a 40-line invoice paginates: header repeated per page, totals whole on the last page', () => {
    const pages = pagesText(render('invoice-40-lines'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) {
      expect(page).toContain('Description');
      expect(page).toContain('info@acco.com');
    }
    pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} of ${pages.length}`));
    const all = pages.join('\n');
    for (let n = 1; n <= 40; n += 1) expect(all).toContain(`Line item ${n} `);
    const last = pages[pages.length - 1];
    expectInOrder(last, ['Line item 40 ', 'Subtotal', 'Total Due', 'Ahmed Abdi Hassan']);
    expect(pages.slice(0, -1).join('\n')).not.toContain('Total Due');
  }, 60_000);
});

describe('receipt PDF (real renderer)', () => {
  it('wears the same minimal kit and keeps the receipt content', () => {
    const pages = pagesText(render('receipt'));
    expect(pages).toHaveLength(1);
    expectInOrder(pages[0], [
      'ACCO Ltd',
      'CONSTRUCTION & DEVELOPMENT',
      'Tax Reg. 100045678',
      'RECEIPT',
      'Receipt No.',
      'RCP-000017',
      'Received From',
      'Ahmed Shirie',
      'Payment',
      'Bank transfer',
      'Applied To',
      'Invoice INV-000121',
      'USD 30,000.00',
      'Unallocated when the payment was recorded',
      'Total Received',
      'USD 50,000.00',
      '+252 61 234 5678',
      'info@acco.com',
    ]);
  }, 60_000);
});
