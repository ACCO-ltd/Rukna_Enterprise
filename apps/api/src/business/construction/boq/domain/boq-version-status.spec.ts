import { hasCommittedBoqVersion, isCommittedBoqStatus } from './boq-version-status.js';

describe('committed BOQ version status (ADR-029 §2)', () => {
  it('treats COMMITTED and legacy BASELINED as a frozen scope', () => {
    expect(isCommittedBoqStatus('COMMITTED')).toBe(true);
    expect(isCommittedBoqStatus('BASELINED')).toBe(true);
  });

  it('never treats working, snapshot or retired versions as committed', () => {
    for (const status of ['DRAFT', 'SNAPSHOT', 'SUPERSEDED', 'CANCELLED']) {
      expect(isCommittedBoqStatus(status)).toBe(false);
    }
  });

  it('finds a committed version among a BOQ’s versions', () => {
    expect(hasCommittedBoqVersion([{ status: 'SNAPSHOT' }, { status: 'COMMITTED' }])).toBe(true);
    expect(hasCommittedBoqVersion([{ status: 'DRAFT' }])).toBe(false);
    expect(hasCommittedBoqVersion(undefined)).toBe(false);
  });
});
