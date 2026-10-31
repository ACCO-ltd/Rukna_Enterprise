import { decimal, parseReaderAnswer, readerPrompt, UnreadableAnswerError } from './reading';

describe('photo reader answer (Step 7)', () => {
  it('asks for one JSON object, with the kind in the prompt', () => {
    expect(readerPrompt('DELIVERY_NOTE')).toContain('delivery note');
    expect(readerPrompt('QUOTE')).toContain('"lines"');
  });

  it('reads JSON wrapped in prose and fences, keeping only known fields', () => {
    const r = parseReaderAnswer('Here you go:\n```json\n{"supplierName":"Horn Cement","date":"2026-10-05","currency":"usd","total":"1,050.00","taxAmount":50,"extra":"x",' +
      '"lines":[{"description":"Cement 50kg","quantity":"20","unit":"bag","unitPrice":"50","amount":"1000"}]}\n```');
    expect(r).toMatchObject({ supplierName: 'Horn Cement', date: '2026-10-05', currency: 'USD', total: '1050.00', warnings: [] });
    expect(r.lines).toEqual([{ description: 'Cement 50kg', quantity: '20', unit: 'bag', unitPrice: '50', amount: '1000' }]);
    expect(r).not.toHaveProperty('extra');
  });

  it('turns unreadable values into null, never a guess', () => {
    const r = parseReaderAnswer('{"date":"05/10/2026","total":"about 300","currency":"dollars","lines":[{"description":"Sand","quantity":"three"}]}');
    expect(r).toMatchObject({ date: null, total: null, currency: null });
    expect(r.lines[0]).toMatchObject({ description: 'Sand', quantity: null });
  });

  it('flags a total that disagrees with its lines, without correcting it', () => {
    const r = parseReaderAnswer('{"total":900,"lines":[{"description":"A","quantity":2,"unitPrice":100,"amount":250},{"description":"B","amount":600}]}');
    expect(r.total).toBe('900');
    expect(r.warnings).toEqual(['The total does not equal the sum of the lines.', 'Line 1: quantity × price does not equal its amount.']);
  });

  it('refuses an answer with no JSON in it', () => {
    expect(() => parseReaderAnswer('I cannot read this image.')).toThrow(UnreadableAnswerError);
    expect(decimal('$1 200.50')).toBe('1200.50');
  });
});
