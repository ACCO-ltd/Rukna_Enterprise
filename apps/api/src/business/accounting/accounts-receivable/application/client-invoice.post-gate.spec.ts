import { BadRequestException } from '@nestjs/common';

import { ClientInvoiceService } from './client-invoice.service.js';

/**
 * Strict CONST-COM-011 at posting: a stage invoice drafted before the rule, or whose milestone
 * was unlinked since, must not reach the ledger without site-verified evidence.
 */
describe('ClientInvoiceService.post — milestone evidence gate', () => {
  function build(stage: unknown) {
    const repo = {
      findById: jest.fn().mockResolvedValue({
        id: 'inv1',
        documentStatus: 'APPROVED',
        postingStatus: 'NOT_POSTED',
        sourceInstallmentId: 'inst1',
      }),
      findInstallmentForBilling: jest.fn().mockResolvedValue(stage),
    };
    const postingPort = { post: jest.fn() };
    const service = new ClientInvoiceService(
      { getClient: () => ({}) } as never,
      repo as never,
      {} as never,
      {} as never,
      postingPort as never,
      {} as never,
      {} as never,
    );
    return { service, postingPort };
  }
  const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

  it('refuses to post the invoice of a work stage with no milestone linked', async () => {
    const { service, postingPort } = build({ name: 'Structure', triggerType: 'MILESTONE', programmeMilestoneId: null, programmeMilestone: null });
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingPort.post).not.toHaveBeenCalled();
  });

  it('refuses while the linked milestone is not verified', async () => {
    const { service } = build({ name: 'Structure', triggerType: 'MILESTONE', programmeMilestoneId: 'm1', programmeMilestone: { status: 'PLANNED' } });
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.toThrow(/not yet verified/);
  });
});
