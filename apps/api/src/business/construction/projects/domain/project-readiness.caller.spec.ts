import {
  READINESS_DEPENDENCIES,
  evaluateCaller,
  evaluateReadiness,
  planEnforcement,
  teamFormedAt,
  type ReadinessSnapshot,
} from './project-readiness.policy.js';

/**
 * ADR-019 amendment 2026-09-28 — the three additive readiness fields: `blockedBy`,
 * `satisfiedAt`, and the per-caller `caller` block.
 */

const d = (iso: string) => new Date(iso);

const ready: ReadinessSnapshot = {
  status: 'DRAFT',
  commercialModel: 'CLIENT_CONTRACT',
  startDate: d('2026-02-01'),
  expectedEndDate: d('2027-08-31'),
  clientId: 'client-1',
  clientStatus: 'ACTIVE',
  activeContract: { status: 'ACTIVE', startDate: d('2026-02-01') },
  hasBaselinedBoq: true,
  activeMemberCount: 2,
};

const byCode = (snapshot: ReadinessSnapshot) =>
  new Map(evaluateReadiness(snapshot, 'start').conditions.map((c) => [c.code, c]));

describe('readiness dependencies (blockedBy)', () => {
  it('declares only the genuine data dependency: the start date waits for the executed contract', () => {
    const conditions = byCode(ready);
    expect(conditions.get('CONTRACT_START_DATE')?.blockedBy).toEqual(['ACTIVE_MAIN_CONTRACT']);
    for (const code of [
      'CLIENT_ACTIVE',
      'ACTIVE_MAIN_CONTRACT',
      'BOQ_BASELINED',
      'PROGRAMME_DATES',
      'DELIVERY_TEAM',
    ]) {
      expect(conditions.get(code)?.blockedBy).toEqual([]);
    }
  });

  it('never makes the contract wait for a baselined BOQ (ADR-032 records it without one)', () => {
    expect(READINESS_DEPENDENCIES['ACTIVE_MAIN_CONTRACT'] ?? []).not.toContain('BOQ_BASELINED');
    const conditions = byCode({ ...ready, hasBaselinedBoq: false, activeContract: null });
    expect(conditions.get('ACTIVE_MAIN_CONTRACT')?.blockedBy).toEqual([]);
  });

  it('only names codes present in the same response (INTERNAL_CAPITAL has no contract steps)', () => {
    const result = evaluateReadiness({ ...ready, commercialModel: 'INTERNAL_CAPITAL' }, 'start');
    const codes = new Set(result.conditions.map((c) => c.code));
    for (const c of result.conditions) {
      for (const dep of c.blockedBy) expect(codes.has(dep)).toBe(true);
    }
  });
});

describe('satisfiedAt', () => {
  const evidence = {
    boqCommittedAt: d('2026-03-01T08:00:00Z'),
    contractActivatedAt: d('2026-04-01T09:00:00Z'),
    contractStartDateSetAt: d('2026-04-01T09:00:00Z'),
    memberships: [
      { joinedAt: d('2026-01-01T00:00:00Z'), removedAt: null },
      { joinedAt: d('2026-05-01T00:00:00Z'), removedAt: null },
    ],
  };

  it('reports the trustworthy time for each satisfied condition, and null where there is none', () => {
    const conditions = byCode({ ...ready, evidence });
    expect(conditions.get('BOQ_BASELINED')?.satisfiedAt).toBe('2026-03-01T08:00:00.000Z');
    expect(conditions.get('ACTIVE_MAIN_CONTRACT')?.satisfiedAt).toBe('2026-04-01T09:00:00.000Z');
    expect(conditions.get('CONTRACT_START_DATE')?.satisfiedAt).toBe('2026-04-01T09:00:00.000Z');
    expect(conditions.get('DELIVERY_TEAM')?.satisfiedAt).toBe('2026-05-01T00:00:00.000Z');
    // No honest source for these two — never a guessed time.
    expect(conditions.get('CLIENT_ACTIVE')?.satisfiedAt).toBeNull();
    expect(conditions.get('PROGRAMME_DATES')?.satisfiedAt).toBeNull();
  });

  it('is null for an unsatisfied condition even when evidence carries a time', () => {
    const conditions = byCode({ ...ready, hasBaselinedBoq: false, evidence });
    expect(conditions.get('BOQ_BASELINED')).toMatchObject({ satisfied: false, satisfiedAt: null });
  });

  it('is null everywhere without evidence (the policy never invents a time)', () => {
    for (const c of evaluateReadiness(ready, 'start').conditions) expect(c.satisfiedAt).toBeNull();
  });
});

describe('teamFormedAt', () => {
  it('is the join that took the team past one member', () => {
    expect(
      teamFormedAt([
        { joinedAt: d('2026-01-01'), removedAt: null },
        { joinedAt: d('2026-02-01'), removedAt: null },
        { joinedAt: d('2026-03-01'), removedAt: null },
      ]),
    ).toEqual(d('2026-02-01'));
  });

  it('restarts after the team fell back to one member', () => {
    expect(
      teamFormedAt([
        { joinedAt: d('2026-01-01'), removedAt: null },
        { joinedAt: d('2026-02-01'), removedAt: d('2026-02-10') },
        { joinedAt: d('2026-04-01'), removedAt: null },
      ]),
    ).toEqual(d('2026-04-01'));
  });

  it('keeps the original time when the team never dropped below two', () => {
    expect(
      teamFormedAt([
        { joinedAt: d('2026-01-01'), removedAt: null },
        { joinedAt: d('2026-02-01'), removedAt: d('2026-03-10') },
        { joinedAt: d('2026-03-01'), removedAt: null },
      ]),
    ).toEqual(d('2026-02-01'));
  });

  it('is null when the team is not formed now', () => {
    expect(teamFormedAt([{ joinedAt: d('2026-01-01'), removedAt: null }])).toBeNull();
    expect(
      teamFormedAt([
        { joinedAt: d('2026-01-01'), removedAt: null },
        { joinedAt: d('2026-02-01'), removedAt: d('2026-02-05') },
      ]),
    ).toBeNull();
  });
});

describe('caller (per-caller start validity)', () => {
  const noContract: ReadinessSnapshot = { ...ready, activeContract: null };

  it('a ready project: a manager can run it, nothing to waive', () => {
    expect(evaluateReadiness(ready, 'start', { mayRun: true, apexAuthority: false }).caller).toEqual({
      canRun: true,
      waivableConditions: [],
    });
  });

  it('never runnable without the permission, however ready', () => {
    expect(evaluateReadiness(ready, 'start', { mayRun: false, apexAuthority: true }).caller.canRun).toBe(
      false,
    );
    // Fail-closed default when no caller is given.
    expect(evaluateReadiness(ready, 'start').caller.canRun).toBe(false);
  });

  it('an open WAIVABLE condition is waivable by any manager and does not block', () => {
    const caller = evaluateReadiness({ ...ready, activeMemberCount: 1 }, 'start', {
      mayRun: true,
      apexAuthority: false,
    }).caller;
    expect(caller).toEqual({ canRun: true, waivableConditions: ['DELIVERY_TEAM'] });
  });

  it('the contract conditions block a normal manager', () => {
    const caller = evaluateReadiness(noContract, 'start', { mayRun: true, apexAuthority: false }).caller;
    expect(caller).toEqual({ canRun: false, waivableConditions: [] });
  });

  it('apex authority (Route 7A) makes exactly the two contract conditions waivable', () => {
    const caller = evaluateReadiness(noContract, 'start', { mayRun: true, apexAuthority: true }).caller;
    expect(caller.canRun).toBe(true);
    expect(caller.waivableConditions.sort()).toEqual(['ACTIVE_MAIN_CONTRACT', 'CONTRACT_START_DATE']);
  });

  it('apex authority does not unlock any other MANDATORY condition', () => {
    const caller = evaluateReadiness({ ...noContract, hasBaselinedBoq: false }, 'start', {
      mayRun: true,
      apexAuthority: true,
    }).caller;
    expect(caller.canRun).toBe(false);
    expect(caller.waivableConditions).not.toContain('BOQ_BASELINED');
  });

  it('agrees with planEnforcement: waiving every listed condition is exactly what the command accepts', () => {
    const snapshots: ReadinessSnapshot[] = [
      ready,
      noContract,
      { ...ready, activeMemberCount: 1, startDate: null },
      { ...noContract, hasBaselinedBoq: false },
      { ...ready, clientStatus: 'INACTIVE' },
    ];
    for (const snapshot of snapshots) {
      for (const apexAuthority of [false, true]) {
        const readiness = evaluateReadiness(snapshot, 'start', { mayRun: true, apexAuthority });
        const plan = planEnforcement(
          readiness,
          readiness.caller.waivableConditions.map((condition) => ({ condition, reason: 'why' })),
          { apexAuthority },
        );
        expect(readiness.caller.canRun).toBe(plan.allowed);
      }
    }
  });

  it('commands without conditions are runnable by a manager', () => {
    expect(
      evaluateCaller([], { mayRun: true, apexAuthority: false }),
    ).toEqual({ canRun: true, waivableConditions: [] });
    expect(evaluateReadiness(ready, 'close', { mayRun: true, apexAuthority: false }).caller.canRun).toBe(
      true,
    );
  });
});
