import { DocumentValidity } from '@erp/types';

import { deriveValidity, DEFAULT_EXPIRING_SOON_DAYS } from './document-validity.policy.js';
import {
  documentNumberKey,
  normaliseDocumentNumber,
  normaliseRevisionCode,
  normaliseTitle,
} from './document-number.policy.js';

/**
 * Validity is the one thing on the register that is a *function*, not a column, so these tests are
 * the whole specification of it. Every case fixes "today" explicitly: a validity test that depends
 * on the wall clock passes for a month and then starts failing at midnight for no reason anyone
 * can reproduce.
 */

const TODAY = new Date('2026-09-07T11:30:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('deriveValidity', () => {
  it('reports NO_EXPIRY when there is no expiry date — a drawing never lapses', () => {
    expect(deriveValidity({ validFrom: null, expiresAt: null }, TODAY)).toEqual({
      validity: DocumentValidity.NO_EXPIRY,
      daysUntilExpiry: null,
    });
  });

  it('reports VALID well before expiry, with the days remaining', () => {
    const result = deriveValidity({ validFrom: null, expiresAt: d('2026-12-31') }, TODAY);
    expect(result.validity).toBe(DocumentValidity.VALID);
    expect(result.daysUntilExpiry).toBe(115);
  });

  it('reports EXPIRING_SOON inside the threshold', () => {
    const result = deriveValidity({ validFrom: null, expiresAt: d('2026-09-20') }, TODAY);
    expect(result.validity).toBe(DocumentValidity.EXPIRING_SOON);
    expect(result.daysUntilExpiry).toBe(13);
  });

  it('treats the threshold boundary as still expiring soon, not yet valid-and-quiet', () => {
    const boundary = d('2026-10-07'); // exactly 30 days out
    expect(deriveValidity({ validFrom: null, expiresAt: boundary }, TODAY).validity).toBe(
      DocumentValidity.EXPIRING_SOON,
    );
  });

  it('reports the day after the threshold as VALID', () => {
    expect(
      deriveValidity({ validFrom: null, expiresAt: d('2026-10-08') }, TODAY).validity,
    ).toBe(DocumentValidity.VALID);
  });

  /**
   * The last day of validity is a valid day. A permit that expires today is usable today, and
   * telling the site it has already lapsed would stop work a day early.
   */
  it('is EXPIRING_SOON, not EXPIRED, on the expiry date itself', () => {
    const result = deriveValidity({ validFrom: null, expiresAt: d('2026-09-07') }, TODAY);
    expect(result.validity).toBe(DocumentValidity.EXPIRING_SOON);
    expect(result.daysUntilExpiry).toBe(0);
  });

  it('reports EXPIRED the day after, with a negative day count', () => {
    const result = deriveValidity({ validFrom: null, expiresAt: d('2026-09-06') }, TODAY);
    expect(result.validity).toBe(DocumentValidity.EXPIRED);
    expect(result.daysUntilExpiry).toBe(-1);
  });

  /**
   * `validFrom` exists in the model, so a document whose validity has not started cannot be
   * reported as VALID. This state is not in the original four for exactly that reason — the four
   * forgot the column.
   */
  it('reports NOT_YET_VALID when the window has not opened', () => {
    const result = deriveValidity(
      { validFrom: d('2026-10-01'), expiresAt: d('2027-10-01') },
      TODAY,
    );
    expect(result.validity).toBe(DocumentValidity.NOT_YET_VALID);
    expect(result.daysUntilExpiry).toBe(389);
  });

  it('does not put a not-yet-valid document into the expiring queue', () => {
    // Starts tomorrow, expires in a week: inside the threshold, but no action can clear it yet.
    const result = deriveValidity(
      { validFrom: d('2026-09-08'), expiresAt: d('2026-09-14') },
      TODAY,
    );
    expect(result.validity).toBe(DocumentValidity.NOT_YET_VALID);
  });

  it('counts a window that opened today as open', () => {
    expect(
      deriveValidity({ validFrom: d('2026-09-07'), expiresAt: d('2027-09-07') }, TODAY).validity,
    ).toBe(DocumentValidity.VALID);
  });

  it('honours a caller-supplied threshold rather than the 30-day default', () => {
    expect(
      deriveValidity({ validFrom: null, expiresAt: d('2026-10-20') }, TODAY, 90).validity,
    ).toBe(DocumentValidity.EXPIRING_SOON);
    expect(
      deriveValidity({ validFrom: null, expiresAt: d('2026-10-20') }, TODAY, 7).validity,
    ).toBe(DocumentValidity.VALID);
  });

  /**
   * Dates are stored as `@db.Date` and compared at UTC midnight on both sides. Comparing a date
   * against a timestamp would expire a document at midnight UTC — a day early for Mogadishu.
   */
  it('does not let the time of day change the answer', () => {
    const morning = new Date('2026-09-07T00:00:01Z');
    const night = new Date('2026-09-07T23:59:59Z');
    const input = { validFrom: null, expiresAt: d('2026-09-07') };
    expect(deriveValidity(input, morning)).toEqual(deriveValidity(input, night));
  });

  it('defaults the threshold to 30 days', () => {
    expect(DEFAULT_EXPIRING_SOON_DAYS).toBe(30);
  });
});

describe('document identity', () => {
  it('keeps the number the user typed, and folds case only for the uniqueness key', () => {
    expect(normaliseDocumentNumber(' acco-ob-0012 ')).toBe('acco-ob-0012');
    expect(documentNumberKey(' acco-ob-0012 ')).toBe('ACCO-OB-0012');
  });

  it('collapses inner whitespace so two visually identical numbers cannot both exist', () => {
    expect(documentNumberKey('ACCO  OB   0012')).toBe('ACCO OB 0012');
  });

  /**
   * Punctuation is deliberately NOT stripped: `ACCO-OB-0012` and `ACCO/OB/0012` may be two
   * numbering schemes running in parallel, and collapsing them would refuse a legitimate document.
   */
  it('treats different separators as different numbers', () => {
    expect(documentNumberKey('ACCO-OB-0012')).not.toBe(documentNumberKey('ACCO/OB/0012'));
  });

  it('refuses an empty number, an over-long one, and one with illegal characters', () => {
    expect(() => normaliseDocumentNumber('   ')).toThrow();
    expect(() => normaliseDocumentNumber('A'.repeat(61))).toThrow();
    expect(() => normaliseDocumentNumber('ACCO<script>')).toThrow();
  });

  it('refuses an empty title and trims a real one', () => {
    expect(normaliseTitle('  First Floor  Slab ')).toBe('First Floor Slab');
    expect(() => normaliseTitle('')).toThrow();
  });

  /** Not every document class uses revision codes; a blank one is absent, not an error. */
  it('treats a blank revision code as none', () => {
    expect(normaliseRevisionCode('   ')).toBeNull();
    expect(normaliseRevisionCode(undefined)).toBeNull();
    expect(normaliseRevisionCode('R01')).toBe('R01');
  });
});
