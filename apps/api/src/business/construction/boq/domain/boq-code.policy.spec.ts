import { proposeNodeCode } from './boq-code.policy.js';

describe('proposeNodeCode', () => {
  describe('sections', () => {
    it('numbers the first root section 01', () => {
      expect(proposeNodeCode('section', null, [])).toBe('01');
    });

    it('continues the root section sequence', () => {
      expect(proposeNodeCode('section', null, ['01', '02'])).toBe('03');
    });

    it('numbers a sub-section under its parent', () => {
      expect(proposeNodeCode('section', '02', ['02.01'])).toBe('02.02');
    });

    it('does not fill a gap left by a deleted line', () => {
      expect(proposeNodeCode('section', null, ['01', '03'])).toBe('04');
    });

    it('keeps the width the siblings established (001-style)', () => {
      expect(proposeNodeCode('section', null, ['001', '002'])).toBe('003');
    });

    it('ignores non-numeric sibling tails', () => {
      expect(proposeNodeCode('section', '02', ['02.01', '02.A'])).toBe('02.02');
    });
  });

  describe('items', () => {
    it('numbers the first item on a wider segment so it cannot collide with a section', () => {
      expect(proposeNodeCode('item', '02.01', [])).toBe('02.01.001');
    });

    it('continues the item sequence within its section', () => {
      expect(proposeNodeCode('item', '02.01', ['02.01.001', '02.01.002'])).toBe('02.01.003');
    });

    it('numbers a root-level item 001', () => {
      expect(proposeNodeCode('item', null, [])).toBe('001');
    });
  });
});
