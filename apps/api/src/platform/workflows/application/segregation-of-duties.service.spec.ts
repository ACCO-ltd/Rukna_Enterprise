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
    ['SELECT_QUOTATION', 'requesterUserId', 'REQUESTER_CANNOT_SELECT'],
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

  // ── Phase 1b rules with non-standard context shapes ──────────────────────────

  describe('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT (two actions)', () => {
    const code = 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT';

    it.each(['CREATE_PURCHASE_ORDER', 'PROCESS_SUPPLIER_PAYMENT'] as const)(
      'denies when the vendor maintainer performs %s',
      async (action) => {
        const { svc } = build([code]);
        await expect(
          svc.assertAllowed({ ...base, action, vendorMaintainerUserId: 'alice' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('allows a different actor to create the PO', async () => {
      const { svc } = build([code]);
      await expect(
        svc.assertAllowed({ ...base, action: 'CREATE_PURCHASE_ORDER', vendorMaintainerUserId: 'bob' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION (flag-based)', () => {
    const code = 'SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION';

    it('denies a system administrator approving a business transaction', async () => {
      const { svc } = build([code]);
      await expect(
        svc.assertAllowed({ ...base, action: 'APPROVE_BUSINESS_TRANSACTION', isSystemAdministrator: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a non-administrator to approve', async () => {
      const { svc } = build([code]);
      await expect(
        svc.assertAllowed({ ...base, action: 'APPROVE_BUSINESS_TRANSACTION', isSystemAdministrator: false }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('SegregationOfDutiesService — machine-readable denial', () => {
  it('a denial keeps its message and carries the rule code in details.code', async () => {
    const prisma = {
      segregationOfDutiesRule: {
        findMany: jest.fn().mockResolvedValue([{ code: 'PO_CREATOR_CANNOT_RECEIVE_GOODS' }]),
      },
    };
    const svc = new SegregationOfDutiesService({ getClient: () => prisma } as never);
    const error = await svc
      .assertAllowed({
        organizationId: 'o1',
        action: 'RECEIVE_GOODS',
        actorUserId: 'alice',
        purchaseOrderCreatorUserId: 'alice',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(
      "Segregation-of-duties rule 'PO_CREATOR_CANNOT_RECEIVE_GOODS' prohibits this action.",
    );
    expect((error as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ details: { code: 'PO_CREATOR_CANNOT_RECEIVE_GOODS' } }),
    );
  });

  describe('ADR-044 §6 — SELECT_QUOTATION', () => {
    const svc = new SegregationOfDutiesService({} as never);
    const all = new Set([
      'QUOTE_UPLOADER_CANNOT_SELECT',
      'REQUESTER_CANNOT_SELECT',
      'REQUESTER_CANNOT_APPROVE_OWN_REQUEST',
    ]);
    const ctx = { organizationId: 'o1', action: 'SELECT_QUOTATION' as const, actorUserId: 'alice' };

    it('QUOTE_UPLOADER_CANNOT_SELECT fires when the actor is among the evidence uploaders', () => {
      expect(svc.violation(all, { ...ctx, quoteUploaderUserIds: ['bob', 'alice'] })).toBe(
        'QUOTE_UPLOADER_CANNOT_SELECT',
      );
      expect(svc.violation(all, { ...ctx, quoteUploaderUserIds: ['bob'] })).toBeNull();
      expect(svc.violation(all, { ...ctx })).toBeNull();
    });

    it('REQUESTER_CANNOT_SELECT fires for the MR requester (uploader rule wins when both apply)', () => {
      expect(svc.violation(all, { ...ctx, requesterUserId: 'alice' })).toBe('REQUESTER_CANNOT_SELECT');
      expect(
        svc.violation(all, { ...ctx, requesterUserId: 'alice', quoteUploaderUserIds: ['alice'] }),
      ).toBe('QUOTE_UPLOADER_CANNOT_SELECT');
    });

    it('each rule fires only under its own code', () => {
      const uploaderOnly = new Set(['QUOTE_UPLOADER_CANNOT_SELECT']);
      const requesterOnly = new Set(['REQUESTER_CANNOT_SELECT']);
      expect(svc.violation(uploaderOnly, { ...ctx, requesterUserId: 'alice' })).toBeNull();
      expect(svc.violation(requesterOnly, { ...ctx, quoteUploaderUserIds: ['alice'] })).toBeNull();
      // The MR approval rule does not leak into selection, nor selection into other actions.
      expect(
        svc.violation(new Set(['REQUESTER_CANNOT_APPROVE_OWN_REQUEST']), { ...ctx, requesterUserId: 'alice' }),
      ).toBeNull();
      for (const action of ['APPROVE_MATERIAL_REQUEST', 'CREATE_PURCHASE_ORDER', 'APPROVE_BUSINESS_TRANSACTION'] as const) {
        expect(
          svc.violation(new Set(['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']), {
            ...ctx,
            action,
            requesterUserId: 'alice',
            quoteUploaderUserIds: ['alice'],
          }),
        ).toBeNull();
      }
    });
  });

  it('violation() answers without throwing', () => {
    const svc = new SegregationOfDutiesService({} as never);
    const codes = new Set(['PO_CREATOR_CANNOT_RECEIVE_GOODS']);
    const ctx = { organizationId: 'o1', action: 'RECEIVE_GOODS' as const, actorUserId: 'alice' };
    expect(svc.violation(codes, { ...ctx, purchaseOrderCreatorUserId: 'alice' })).toBe(
      'PO_CREATOR_CANNOT_RECEIVE_GOODS',
    );
    expect(svc.violation(codes, { ...ctx, purchaseOrderCreatorUserId: 'bob' })).toBeNull();
    expect(svc.violation(new Set(), { ...ctx, purchaseOrderCreatorUserId: 'alice' })).toBeNull();
  });
});
