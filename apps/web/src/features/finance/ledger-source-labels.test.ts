import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import finance from '../../../messages/en/finance.json';

/**
 * Every journal source the ledger can show has a label. A new `SourceDocType` (BUYER_ADVANCE and
 * CREDIT_NOTE arrived without one) otherwise renders a raw enum and logs a missing-message error
 * on every ledger row. Read from the Prisma schema so the next new type fails here, not on screen.
 */
describe('ledger source labels', () => {
  it('cover every SourceDocType in the schema', () => {
    const schema = readFileSync(resolve(__dirname, '../../../../api/prisma/schema.prisma'), 'utf8');
    const block = /enum SourceDocType \{([^}]*)\}/.exec(schema)?.[1] ?? '';
    const types = block
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);
    expect(types.length).toBeGreaterThan(5);
    const labels = finance.ledger.source as Record<string, string>;
    expect(types.filter((type) => !labels[type])).toEqual([]);
  });
});
