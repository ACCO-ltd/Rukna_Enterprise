import { describe, expect, it } from 'vitest';

import { formatUnitPrice } from './format';

describe('formatUnitPrice', () => {
  it('keeps whole cents at 2 decimals and shows up to 4 otherwise', () => {
    expect(formatUnitPrice('22.95', 'USD')).toBe('$22.95');
    expect(formatUnitPrice('5.5666', 'USD')).toBe('$5.5666');
    expect(formatUnitPrice('5.5600', 'USD')).toBe('$5.56');
    expect(formatUnitPrice(null, 'USD')).toBeNull();
  });
});
