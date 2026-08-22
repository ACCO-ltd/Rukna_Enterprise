import { ForbiddenException } from '@nestjs/common';

import { SegregationOfDutiesService, type SodAction } from './segregation-of-duties.service.js';

/**
 * ADR-022 CONST-DOA-003 — the SoD brain. Feature services supply the actors; this service owns
 * every "must be different people" rule. Each rule fires only when (a) its code is active for the
 * org on the effective date and (b) the acting user is the same person as the prior party.
 */
describe('SegregationOfDutiesService', () => {
  function build(activeCodes: string[]) {
    const findMany = jest.fn().mockResolvedValue(activeCodes.map((code) => ({ code })));
    const prisma = { segregationOfDutiesRule: { findMany } };
    const tenancy = { getClient: () => prisma } as never;
    return { svc: new SegregationOfDutiesService(tenancy), findMany };
  }

  const base = { organizationId: 'o1', actorUserId: 'alice' } as const;

  // [action, context field carrying the prior party, rule code]
  const rules: Array<[SodAction, string, string]> = [
    ['APPROVE_MATERIAL_REQUEST', 'requesterUserId', 'REQUESTER_CANNOT_APPROVE_OWN_REQUEST'],
    ['RECEIVE_GOODS', 'purchaseOrderCreatorUserId', 'PO_CREATOR_CANNOT_RECEIVE_GOODS'],
    ['APPROVE_SUPPLIER_BILL', 'goodsReceiverUserId', 'GOODS_RECEIVER_CANNOT_APPROVE_BILL'],
    [
      'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT',
      'supplierBillApproverUserId',
      'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT',
    ],
    ['APPROVE_MANUAL_JOURNAL', 'journalPreparerUserId', 'JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL'],
  ];

  describe.each(rules)('%s (%s)', (action, field, code) => {
    it('denies when the actor is the same person as the prior party and the rule is active', async () => {
      const { svc } = build([code]);
      await expect(
        svc.assertAllowed({ ...base, action, [field]: 'alice' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows when a different person acts', async () => {
      const { svc } = build([code]);
      await expect(
        svc.assertAllowed({ ...base, action, [field]: 'bob' }),
      ).resolves.toBeUndefined();
    });

    it('allows when the prior party is unknown (undefined)', async () => {
      const { svc } = build([code]);
      await expect(svc.assertAllowed({ ...base, action })).resolves.toBeUndefined();
    });

    it('allows when the rule is not active, even for the same person', async () => {
      const { svc } = build([]); // no active codes
      await expect(
        svc.assertAllowed({ ...base, action, [field]: 'alice' }),
      ).resolves.toBeUndefined();
    });
  });

  it('scopes the active-rule lookup to the org, active rules, and the effective-dated policy version', async () => {
    const { svc, findMany } = build([]);
    const at = new Date('2026-09-01T00:00:00.000Z');
    await svc.assertAllowed({ ...base, action: 'RECEIVE_GOODS', at });

    const where = findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe('o1');
    expect(where.isActive).toBe(true);
    expect(where.policyVersion.status).toBe('ACTIVE');
    expect(where.policyVersion.effectiveFrom).toEqual({ lte: at });
  });

  it('does not cross-fire: an active rule for one action never blocks a different action', async () => {
    // PO_CREATOR rule active, but the actor is approving a material request they also raised.
    const { svc } = build(['PO_CREATOR_CANNOT_RECEIVE_GOODS']);
    await expect(
      svc.assertAllowed({
        ...base,
        action: 'APPROVE_MATERIAL_REQUEST',
        requesterUserId: 'alice',
      }),
    ).resolves.toBeUndefined();
  });
});
