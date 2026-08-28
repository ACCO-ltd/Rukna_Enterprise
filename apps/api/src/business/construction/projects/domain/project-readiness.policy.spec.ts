import {
  evaluateReadiness,
  planEnforcement,
  type ReadinessSnapshot,
} from './project-readiness.policy.js';

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

describe('planEnforcement (ADR-019 CONST-PLC-006)', () => {
  it('allows the transition when every condition is satisfied', () => {
    const readiness = evaluateReadiness(readyClientContract, 'start');
    const plan = planEnforcement(readiness, []);
    expect(plan).toMatchObject({
      allowed: true,
      mandatoryBlockers: [],
      requiresWaiver: [],
      appliedWaivers: [],
      invalidOverrides: [],
    });
  });

  it('hard-blocks on an unsatisfied MANDATORY condition — no override can rescue it', () => {
    const readiness = evaluateReadiness({ ...readyClientContract, hasBaselinedBoq: false }, 'start');
    const plan = planEnforcement(readiness, [{ condition: 'BOQ_BASELINED', reason: 'trust me' }]);
    expect(plan.allowed).toBe(false);
    expect(plan.mandatoryBlockers).toContain('BOQ_BASELINED');
    // the override targeted a MANDATORY condition → invalid, never applied
    expect(plan.invalidOverrides).toContain('BOQ_BASELINED');
    expect(plan.appliedWaivers).toEqual([]);
  });

  it('blocks an unsatisfied WAIVABLE condition when no override is supplied', () => {
    const readiness = evaluateReadiness({ ...readyClientContract, activeMemberCount: 1 }, 'start');
    const plan = planEnforcement(readiness, []);
    expect(plan.allowed).toBe(false);
    expect(plan.requiresWaiver).toEqual(['DELIVERY_TEAM']);
  });

  it('applies a valid override to an unsatisfied WAIVABLE condition and allows the transition', () => {
    const readiness = evaluateReadiness({ ...readyClientContract, activeMemberCount: 1 }, 'start');
    const plan = planEnforcement(readiness, [{ condition: 'DELIVERY_TEAM', reason: 'Solo PM for a small job' }]);
    expect(plan.allowed).toBe(true);
    expect(plan.appliedWaivers).toEqual([{ condition: 'DELIVERY_TEAM', reason: 'Solo PM for a small job' }]);
    expect(plan.requiresWaiver).toEqual([]);
  });

  it('treats an empty-reason override as absent (still requires a waiver)', () => {
    const readiness = evaluateReadiness({ ...readyClientContract, activeMemberCount: 1 }, 'start');
    const plan = planEnforcement(readiness, [{ condition: 'DELIVERY_TEAM', reason: '   ' }]);
    expect(plan.allowed).toBe(false);
    expect(plan.requiresWaiver).toEqual(['DELIVERY_TEAM']);
  });

  it('flags an override that targets a satisfied condition as invalid', () => {
    const readiness = evaluateReadiness(readyClientContract, 'start'); // all satisfied
    const plan = planEnforcement(readiness, [{ condition: 'DELIVERY_TEAM', reason: 'unnecessary' }]);
    expect(plan.allowed).toBe(false);
    expect(plan.invalidOverrides).toEqual(['DELIVERY_TEAM']);
  });
});

// ADR-026 CONST-VAR-011 (Route 7A) — project-before-contract: the two named MANDATORY Start
// conditions are apex-waivable, but ONLY under apex authority. Without it they stay hard blockers.
describe('planEnforcement — Route 7A apex waiver of MANDATORY Start conditions (CONST-VAR-011)', () => {
  const noContract: ReadinessSnapshot = { ...readyClientContract, activeContract: null };

  it('non-apex caller CANNOT waive ACTIVE_MAIN_CONTRACT / CONTRACT_START_DATE (stay hard blockers)', () => {
    const readiness = evaluateReadiness(noContract, 'start');
    const plan = planEnforcement(
      readiness,
      [
        { condition: 'ACTIVE_MAIN_CONTRACT', reason: 'client verbally instructed early start' },
        { condition: 'CONTRACT_START_DATE', reason: 'commencement letter pending' },
      ],
      { apexAuthority: false },
    );
    expect(plan.allowed).toBe(false);
    expect(plan.mandatoryBlockers).toEqual(
      expect.arrayContaining(['ACTIVE_MAIN_CONTRACT', 'CONTRACT_START_DATE']),
    );
    // The overrides are rejected as invalid (they target still-MANDATORY conditions), never applied.
    expect(plan.invalidOverrides).toEqual(
      expect.arrayContaining(['ACTIVE_MAIN_CONTRACT', 'CONTRACT_START_DATE']),
    );
    expect(plan.appliedWaivers).toEqual([]);
  });

  it('apex caller MAY waive both named MANDATORY conditions with a reason — transition allowed + audited', () => {
    const readiness = evaluateReadiness(noContract, 'start');
    const plan = planEnforcement(
      readiness,
      [
        { condition: 'ACTIVE_MAIN_CONTRACT', reason: 'CEO-approved at-risk start; contract in signature' },
        { condition: 'CONTRACT_START_DATE', reason: 'CEO-approved at-risk start; commencement letter to follow' },
      ],
      { apexAuthority: true },
    );
    expect(plan.allowed).toBe(true);
    expect(plan.mandatoryBlockers).toEqual([]);
    expect(plan.appliedWaivers).toEqual([
      { condition: 'ACTIVE_MAIN_CONTRACT', reason: 'CEO-approved at-risk start; contract in signature' },
      { condition: 'CONTRACT_START_DATE', reason: 'CEO-approved at-risk start; commencement letter to follow' },
    ]);
    expect(plan.invalidOverrides).toEqual([]);
  });

  it('apex authority does NOT unlock other MANDATORY conditions (e.g. BOQ_BASELINED stays a blocker)', () => {
    const readiness = evaluateReadiness({ ...noContract, hasBaselinedBoq: false }, 'start');
    const plan = planEnforcement(
      readiness,
      [
        { condition: 'ACTIVE_MAIN_CONTRACT', reason: 'apex ok' },
        { condition: 'CONTRACT_START_DATE', reason: 'apex ok' },
        { condition: 'BOQ_BASELINED', reason: 'try to sneak this through' },
      ],
      { apexAuthority: true },
    );
    expect(plan.allowed).toBe(false);
    expect(plan.mandatoryBlockers).toEqual(['BOQ_BASELINED']);
    expect(plan.invalidOverrides).toContain('BOQ_BASELINED');
  });

  it('apex waiver still requires a non-empty reason (no blanket force)', () => {
    const readiness = evaluateReadiness(noContract, 'start');
    const plan = planEnforcement(
      readiness,
      [
        { condition: 'ACTIVE_MAIN_CONTRACT', reason: '   ' },
        { condition: 'CONTRACT_START_DATE', reason: 'ok' },
      ],
      { apexAuthority: true },
    );
    expect(plan.allowed).toBe(false);
    expect(plan.requiresWaiver).toContain('ACTIVE_MAIN_CONTRACT');
  });
});
