import { describe, expect, it } from 'vitest';

import { buildXlsx, columnName, crc32, sheetName } from './xlsx-export';

const decoder = new TextDecoder();

/** Reads the stored (uncompressed) entries of a ZIP built by `buildXlsx`. */
function entries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(view.getUint32(at + 14, true)).toBe(crc32(data));
    out.set(name, decoder.decode(data));
    at += 30 + nameLen + size;
  }
  return out;
}

describe('xlsx export', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('names columns A..Z, AA..', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('cleans and de-duplicates sheet names', () => {
    const taken = new Set<string>();
    expect(sheetName('USD', taken)).toBe('USD');
    expect(sheetName('usd', taken)).toBe('usd (2)');
    expect(sheetName('a/b:c', taken)).toBe('a b c');
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
  });

  it('writes a workbook with one sheet per entry, numbers as numbers, text inert', () => {
    const files = entries(
      buildXlsx([
        { name: 'USD', rows: [['Period', 'Net'], ['Overdue / now', 1200.5], ['=cmd()', null]] },
        { name: 'SOS', rows: [['Period'], ['A & B <c>']] },
      ]),
    );
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="USD" sheetId="1" r:id="rId1"/>');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="SOS" sheetId="2" r:id="rId2"/>');
    const sheet1 = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet1).toContain('<c r="B2"><v>1200.5</v></c>');
    expect(sheet1).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=cmd()</t></is></c>');
    expect(sheet1).not.toContain('r="B3"'); // empty cell omitted
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('A &amp; B &lt;c&gt;');
  });
});
