import { describe, expect, it } from 'vitest';

import { stageIndex } from './current-payment-cycle';

describe('stageIndex', () => {
  it('maps a ready contract to application preparation', () => {
    expect(stageIndex('READY_FOR_APPLICATION')).toBe(1);
  });

  it('keeps partial payment in the collection stage', () => {
    expect(stageIndex('PARTIALLY_PAID')).toBe(6);
  });
});
