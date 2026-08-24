import { evaluateReadiness, type ReadinessSnapshot } from './project-readiness.policy.js';

// A CLIENT_CONTRACT project that is fully ready to start.
const readyClientContract: ReadinessSnapshot = {
  status: 'DRAFT',
  commercialModel: 'CLIENT_CONTRACT',
  startDate: new Date('2026-02-01'),
  expectedEndDate: new Date('2027-08-31'),
  clientId: 'client-1',
  clientStatus: 'ACTIVE',
  activeContract: { status: 'ACTIVE', startDate: new Date('2026-02-01') },
  hasBaselinedBoq: true,
  activeMemberCount: 2,
};

function conditionByCode(snapshot: ReadinessSnapshot) {
  const result = evaluateReadiness(snapshot, 'start');
  return { result, byCode: new Map(result.conditions.map((c) => [c.code, c])) };
}

describe('ProjectReadinessPolicy (ADR-019 CONST-PLC-005/009)', () => {
  it('start: a fully-prepared CLIENT_CONTRACT project is ready with all conditions satisfied', () => {
    const { result } = conditionByCode(readyClientContract);
    expect(result.command).toBe('start');
    expect(result.targetStatus).toBe('ACTIVE');
    expect(result.ready).toBe(true);
    expect(result.conditions.every((c) => c.satisfied)).toBe(true);
    expect(result.conditions.map((c) => c.code)).toEqual([
      'CLIENT_ACTIVE',
      'ACTIVE_MAIN_CONTRACT',
      'CONTRACT_START_DATE',
      'BOQ_BASELINED',
      'PROGRAMME_DATES',
      'DELIVERY_TEAM',
    ]);
    expect(result.deferred).toEqual([]);
  });

  it('start: an inactive client fails the MANDATORY CLIENT_ACTIVE condition and blocks readiness', () => {
    const { result, byCode } = conditionByCode({ ...readyClientContract, clientStatus: 'INACTIVE' });
    expect(byCode.get('CLIENT_ACTIVE')).toMatchObject({ severity: 'MANDATORY', satisfied: false });
    expect(result.ready).toBe(false);
  });

  it('start: a missing client (no clientId) fails CLIENT_ACTIVE', () => {
    const { byCode } = conditionByCode({ ...readyClientContract, clientId: null, clientStatus: null });
    expect(byCode.get('CLIENT_ACTIVE')?.satisfied).toBe(false);
  });

  it('start: a non-ACTIVE main contract fails ACTIVE_MAIN_CONTRACT', () => {
    const { byCode } = conditionByCode({
      ...readyClientContract,
      activeContract: { status: 'PENDING_SIGNATURE', startDate: new Date('2026-02-01') },
    });
    expect(byCode.get('ACTIVE_MAIN_CONTRACT')).toMatchObject({ severity: 'MANDATORY', satisfied: false });
    // CONTRACT_START_DATE is still satisfied — conditions are independent (CONST-PLC-006).
    expect(byCode.get('CONTRACT_START_DATE')?.satisfied).toBe(true);
  });

  it('start: no contract at all fails both ACTIVE_MAIN_CONTRACT and CONTRACT_START_DATE', () => {
    const { byCode } = conditionByCode({ ...readyClientContract, activeContract: null });
    expect(byCode.get('ACTIVE_MAIN_CONTRACT')?.satisfied).toBe(false);
    expect(byCode.get('CONTRACT_START_DATE')?.satisfied).toBe(false);
  });

  it('start: an un-baselined BOQ fails the MANDATORY BOQ_BASELINED condition', () => {
    const { byCode } = conditionByCode({ ...readyClientContract, hasBaselinedBoq: false });
    expect(byCode.get('BOQ_BASELINED')).toMatchObject({ severity: 'MANDATORY', satisfied: false });
  });

  it('start: missing programme dates / lone member fail the WAIVABLE conditions (and block ready in B1)', () => {
    const { result, byCode } = conditionByCode({
      ...readyClientContract,
      startDate: null,
      activeMemberCount: 1,
    });
    expect(byCode.get('PROGRAMME_DATES')).toMatchObject({ severity: 'WAIVABLE', satisfied: false });
    expect(byCode.get('DELIVERY_TEAM')).toMatchObject({ severity: 'WAIVABLE', satisfied: false });
    // The read contract reports the truth; a WAIVABLE-unsatisfied still makes ready=false.
    expect(result.ready).toBe(false);
  });

  it('start: INTERNAL_CAPITAL omits the contract conditions and defers INTERNAL_AUTHORIZATION', () => {
    const result = evaluateReadiness(
      {
        ...readyClientContract,
        commercialModel: 'INTERNAL_CAPITAL',
        clientId: null,
        clientStatus: null,
        activeContract: null,
      },
      'start',
    );
    expect(result.conditions.map((c) => c.code)).toEqual(['BOQ_BASELINED', 'PROGRAMME_DATES', 'DELIVERY_TEAM']);
    expect(result.deferred).toContain('INTERNAL_AUTHORIZATION');
    expect(result.ready).toBe(true); // all present-day conditions satisfied
  });

  it('close: has no queryable gate yet — ready with the future conditions listed as deferred', () => {
    const result = evaluateReadiness(readyClientContract, 'close');
    expect(result.targetStatus).toBe('CLOSED');
    expect(result.conditions).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.deferred).toEqual(
      expect.arrayContaining(['FINAL_ACCOUNT_SETTLED', 'RETENTION_RELEASED']),
    );
  });

  it('practical-completion and closeout also return ready with a deferred note', () => {
    expect(evaluateReadiness(readyClientContract, 'practical-completion')).toMatchObject({
      ready: true,
      deferred: ['CONTRACT_PC_CERTIFICATE'],
    });
    expect(evaluateReadiness(readyClientContract, 'closeout')).toMatchObject({
      ready: true,
      deferred: ['FINAL_ACCOUNT_AGREED'],
    });
  });

  it('cancel: is an exit — ready with no conditions and nothing deferred', () => {
    const result = evaluateReadiness(readyClientContract, 'cancel');
    expect(result).toMatchObject({ targetStatus: 'CANCELLED', ready: true, conditions: [], deferred: [] });
  });
});
