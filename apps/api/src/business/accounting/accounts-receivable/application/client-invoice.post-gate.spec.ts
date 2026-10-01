import { BadRequestException } from '@nestjs/common';

import { ClientInvoiceService } from './client-invoice.service.js';
import { fakeTaxCodes } from '../../__tests__/helpers/fake-tax-codes.js';

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
      fakeTaxCodes() as never,
    );
    return { service, postingPort };
  }
  const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

  it('refuses to post the invoice of a work stage with no milestone linked', async () => {
    const { service, postingPort } = build({ name: 'Structure', contract: { status: 'ACTIVE' }, triggerType: 'MILESTONE', programmeMilestoneId: null, programmeMilestone: null });
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingPort.post).not.toHaveBeenCalled();
  });

  it('refuses while the linked milestone is not verified', async () => {
    const { service } = build({ name: 'Structure', contract: { status: 'ACTIVE' }, triggerType: 'MILESTONE', programmeMilestoneId: 'm1', programmeMilestone: { status: 'PLANNED' } });
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.toThrow(/not yet verified/);
  });

  it('posts an advance invoice after practical completion (contract final account pending)', async () => {
    const { service, postingPort } = build({ name: 'Advance (mobilisation)', contract: { status: 'FINAL_ACCOUNT_PENDING' }, triggerType: 'ADVANCE' });
    // Past the gate: the next step (account resolution) is not wired in this unit, so it fails later —
    // but never with the evidence-gate refusal.
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.not.toThrow(/advance: it can be billed once/);
    expect(postingPort.post).not.toHaveBeenCalled();
  });

  it('refuses to post an advance invoice on a contract that was never executed', async () => {
    const { service } = build({ name: 'Advance (mobilisation)', contract: { status: 'DRAFT' }, triggerType: 'ADVANCE' });
    await expect(service.post(identity, { invoiceId: 'inv1' } as never)).rejects.toThrow(/advance: it can be billed once/);
  });
});
