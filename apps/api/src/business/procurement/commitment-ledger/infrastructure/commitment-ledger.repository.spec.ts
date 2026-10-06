import { Decimal } from '@prisma/client/runtime/library';

import { CommitmentLedgerRepository } from './commitment-ledger.repository.js';

/**
 * The project summary is read by the web as decimal strings. A stage with no entries must
 * still serialise as a decimal string ("0"), never the bare number 0.
 */
describe('CommitmentLedgerRepository.summarizeByProject', () => {
  const repo = new CommitmentLedgerRepository();

  function prismaReturning(rows: Array<{ stage: string; _sum: { reportingAmount: Decimal | null } }>) {
    return { commitmentLedgerEntry: { groupBy: jest.fn().mockResolvedValue(rows) } } as never;
  }

  it('answers Decimal zero for stages with no entries', async () => {
    const summary = await repo.summarizeByProject(prismaReturning([]), 'org-1', 'proj-1');

    for (const value of [summary.committed, summary.accrued, summary.actual]) {
      expect(value).toBeInstanceOf(Decimal);
      expect(JSON.parse(JSON.stringify(value))).toBe('0');
    }
  });

  it('answers Decimal zero when a stage sums to null, and the sum otherwise', async () => {
    const summary = await repo.summarizeByProject(
      prismaReturning([
        { stage: 'COMMITTED', _sum: { reportingAmount: new Decimal('1250.50') } },
        { stage: 'ACCRUED', _sum: { reportingAmount: null } },
      ]),
      'org-1',
      'proj-1',
    );

    expect(JSON.stringify(summary)).toBe('{"committed":"1250.5","accrued":"0","actual":"0"}');
  });
});
