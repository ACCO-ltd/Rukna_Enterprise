import { proposeNodeCode } from './boq-code.policy.js';

describe('proposeNodeCode', () => {
  describe('sections', () => {
    it('numbers the first root section 1', () => {
      expect(proposeNodeCode('section', null, [])).toBe('1');
    });

    it('numbers the first sub-section 1.1', () => {
      expect(proposeNodeCode('section', '1', [])).toBe('1.1');
    });

    it('continues a natural-number sequence', () => {
      expect(proposeNodeCode('section', null, ['1', '2'])).toBe('3');
    });

    it('continues a zero-padded sequence when siblings already use that width', () => {
      expect(proposeNodeCode('section', null, ['01', '02'])).toBe('03');
    });

    it('numbers a sub-section under its parent', () => {
      expect(proposeNodeCode('section', '02', ['02.01'])).toBe('02.02');
    });

    it('does not fill a gap left by a deleted line', () => {
      expect(proposeNodeCode('section', null, ['1', '3'])).toBe('4');
    });

    it('keeps the width the siblings established (001-style)', () => {
      expect(proposeNodeCode('section', null, ['001', '002'])).toBe('003');
    });

    it('ignores non-numeric sibling tails', () => {
      expect(proposeNodeCode('section', '02', ['02.01', '02.A'])).toBe('02.02');
    });
  });

  describe('items', () => {
    it('numbers the first item under a fresh section as 1.1.1', () => {
      expect(proposeNodeCode('item', '1.1', [])).toBe('1.1.1');
    });

    it('continues the item sequence within its section', () => {
      expect(proposeNodeCode('item', '1.1', ['1.1.1', '1.1.2'])).toBe('1.1.3');
    });

    it('numbers a root-level item 1', () => {
      expect(proposeNodeCode('item', null, [])).toBe('1');
    });

    it('continues a zero-padded item sequence when siblings already use that width', () => {
      expect(proposeNodeCode('item', '02.01', ['02.01.001', '02.01.002'])).toBe('02.01.003');
    });
  });
});
