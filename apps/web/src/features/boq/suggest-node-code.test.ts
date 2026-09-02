import { describe, expect, it } from 'vitest';

import { suggestNodeCode } from './suggest-node-code';

describe('suggestNodeCode', () => {
  it('numbers the first section at the root', () => {
    expect(suggestNodeCode('section', null, [])).toBe('01');
  });

  it('continues the root sequence', () => {
    expect(suggestNodeCode('section', null, ['01', '02'])).toBe('03');
  });

  it('nests under the parent it was opened from', () => {
    expect(suggestNodeCode('section', '01', ['01.01', '01.02'])).toBe('01.03');
    expect(suggestNodeCode('section', '02.01', ['02.01.01'])).toBe('02.01.02');
  });

  it('numbers items on a wider segment than sections', () => {
    // This is what keeps section 01.01 and the first item under 01 from both being "01.01".
    expect(suggestNodeCode('item', '01', [])).toBe('01.001');
    expect(suggestNodeCode('item', '02.01', ['02.01.001'])).toBe('02.01.002');
  });

  it('ignores nodes that are not under this parent', () => {
    // Section 02's children say nothing about the next code under 01.
    expect(suggestNodeCode('section', '01', ['01.01', '02.01', '02.02'])).toBe('01.02');
  });

  it('counts only root codes when adding at the root', () => {
    expect(suggestNodeCode('section', null, ['01', '01.01', '01.02', '02'])).toBe('03');
  });

  it('keeps the width the siblings already use', () => {
    // A BOQ numbering its sections 001 keeps doing so rather than being reset to 2 digits.
    expect(suggestNodeCode('section', null, ['001', '002'])).toBe('003');
    expect(suggestNodeCode('item', '01', ['01.0001'])).toBe('01.0002');
  });

  it('does not reuse a gap left by a deleted line', () => {
    // Codes are quoted on issued certificates and variations; refilling 02 would point two
    // different lines at one reference across versions.
    expect(suggestNodeCode('section', null, ['01', '03'])).toBe('04');
  });

  it('ignores siblings whose tail is not numeric', () => {
    expect(suggestNodeCode('section', null, ['01', 'PRELIM', '02'])).toBe('03');
  });

  it('still proposes something when every sibling is unparseable', () => {
    expect(suggestNodeCode('section', null, ['PRELIM', 'DAYWORK'])).toBe('01');
  });
});
