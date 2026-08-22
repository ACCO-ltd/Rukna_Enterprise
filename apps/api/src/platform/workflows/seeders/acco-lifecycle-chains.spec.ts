import { accoApprovalChains } from './acco-lifecycle-chains.js';
import { ACCO_ROLES } from './acco-value-bands.js';
import { WorkflowTriggerResolverService } from '../application/workflow-trigger-resolver.service.js';

/**
 * ADR-022 CONST-DOA-006..009 — ACCO's fixed lifecycle/control approval chains. This spec pins the
 * chains to the authority matrix and confirms each one resolves through the (amount-less) gate for
 * its transition, using the real chain data rather than fixtures.
 */
describe('ACCO approval chains (ADR-022 CONST-DOA-006..009)', () => {
  const chains = accoApprovalChains();
  const byKey = (key: string) => chains.find((c) => c.key === key)!;

  it('covers exactly the Start, Closeout, BOQ-baseline and DPR chains', () => {
    expect(chains.map((c) => c.key).sort()).toEqual(
      ['BOQ_BASELINE', 'DPR_APPROVAL', 'PROJECT_CLOSEOUT', 'PROJECT_START'].sort(),
    );
    for (const c of chains) expect(c.steps.length).toBeGreaterThan(0);
  });

  it('CONST-DOA-006 Start: DRAFT → ACTIVE, PM → CFO → CEO', () => {
    const c = byKey('PROJECT_START');
    expect([c.entityType, c.fromState, c.toState]).toEqual(['Project', 'DRAFT', 'ACTIVE']);
    expect(c.steps).toEqual([ACCO_ROLES.PROJECT_MANAGER, ACCO_ROLES.CFO, ACCO_ROLES.CEO]);
  });

  it('CONST-DOA-007 Closeout: CLOSEOUT → CLOSED, PM → Finance Officer → CEO', () => {
    const c = byKey('PROJECT_CLOSEOUT');
    expect([c.entityType, c.fromState, c.toState]).toEqual(['Project', 'CLOSEOUT', 'CLOSED']);
    expect(c.steps).toEqual([
      ACCO_ROLES.PROJECT_MANAGER,
      ACCO_ROLES.FINANCE_OFFICER,
      ACCO_ROLES.CEO,
    ]);
  });

  it('CONST-DOA-009 BOQ baseline: BoqVersion DRAFT → BASELINED, preparer ≠ sole approver', () => {
    const c = byKey('BOQ_BASELINE');
    expect([c.entityType, c.fromState, c.toState]).toEqual(['BoqVersion', 'DRAFT', 'BASELINED']);
    // The Construction Director prepares scope+cost, so CFO and CEO must also sign.
    expect(c.steps).toEqual([ACCO_ROLES.CONSTRUCTION_DIRECTOR, ACCO_ROLES.CFO, ACCO_ROLES.CEO]);
  });

  it('CONST-DOA-008 DPR: DailyProgressReport SUBMITTED → APPROVED, PM-only chain', () => {
    const c = byKey('DPR_APPROVAL');
    expect([c.entityType, c.fromState, c.toState]).toEqual([
      'DailyProgressReport',
      'SUBMITTED',
      'APPROVED',
    ]);
    expect(c.steps).toEqual([ACCO_ROLES.PROJECT_MANAGER]);
  });

  describe('each chain resolves through the gate for its own transition', () => {
    function resolverWith(chain: ReturnType<typeof accoApprovalChains>[number]) {
      const binding = {
        id: `bind-${chain.key}`,
        organizationId: 'o1',
        triggerKind: 'STATE_TRANSITION',
        entityType: chain.entityType,
        fromState: chain.fromState,
        toState: chain.toState,
        transactionType: chain.transactionType ?? null,
        workflowDefinitionId: `def-${chain.key}`,
        priority: 20,
        minAmount: null,
        maxAmount: null,
        isActive: true,
        definition: { id: `def-${chain.key}`, name: chain.name },
      };
      const prisma = {
        workflowRequirementPolicy: { findMany: jest.fn().mockResolvedValue([]) },
        workflowTriggerBinding: { findMany: jest.fn().mockResolvedValue([binding]) },
      };
      return new WorkflowTriggerResolverService({ getClient: () => prisma } as never);
    }

    it.each(chains.map((c) => [c.key, c] as const))('%s', async (_key, chain) => {
      const svc = resolverWith(chain);
      const resolved = await svc.resolveForStateTransition(
        'o1',
        chain.entityType,
        chain.fromState ?? '',
        chain.toState,
      );
      expect(resolved?.definition.name).toBe(chain.name);
    });
  });
});
