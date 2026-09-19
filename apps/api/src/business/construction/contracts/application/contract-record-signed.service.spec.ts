import { Decimal } from '@prisma/client/runtime/library';
import { BillingModel, type RequestIdentity } from '@erp/types';

import { ContractService } from './contract.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

describe('record signed main contract', () => {
  it('creates an ACTIVE contract from the negotiated value and freezes a BOQ snapshot', async () => {
    const created = {
      id: 'contract-1',
      baseContractValue: new Decimal('500000.00'),
      contractValue: new Decimal('500000.00'),
    };
    const tx = {
      client: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Ministry', taxNumber: 'TIN-1' }),
      },
    };
    const prisma = {
      boq: { findFirst: jest.fn().mockResolvedValue({ currency: 'USD' }) },
      $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    };
    const repo = {
      findCurrentOperationalBoqVersion: jest
        .fn()
        .mockResolvedValue({ boqId: 'boq-1', operationalVersionId: 'live-v1' }),
      findProjectCode: jest.fn().mockResolvedValue({ code: 'ACCO-001' }),
      findEffectiveClientContract: jest.fn().mockResolvedValue(null),
      nextContractNumber: jest.fn().mockResolvedValue('ACCO-001-C1'),
      create: jest.fn().mockResolvedValue(created),
      createPaymentInstallments: jest.fn().mockResolvedValue({ count: 1 }),
      findById: jest.fn().mockResolvedValue({ ...created, paymentInstallments: [] }),
    };
    const snapshot = jest.fn().mockResolvedValue('signed-snapshot-1');
    const attachments = {
      attach: jest.fn().mockResolvedValue({}),
      freezeFor: jest.fn().mockResolvedValue(0),
    };
    const service = new ContractService(
      { getClient: () => prisma } as never,
      repo as never,
      { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      attachments as never,
      {
        getReadiness: jest.fn().mockResolvedValue({ ready: true, blockers: [] }),
        createContractSigningSnapshot: snapshot,
      } as never,
    );

    const result = await service.recordSigned(identity, {
      projectId: 'project-1',
      clientId: 'client-1',
      signedDate: '2026-09-19',
      contractValue: '500000.00',
      billingModel: BillingModel.MILESTONE,
      paymentTerms: '30 days',
      paymentPlan: [
        { sortOrder: 0, name: 'Completion', percentage: 1, triggerType: 'MILESTONE' },
      ],
    });

    expect(snapshot).toHaveBeenCalledWith(tx, 'boq-1', 'live-v1', 'user-1');
    expect(repo.create).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: 'ACTIVE',
        boqVersionId: 'signed-snapshot-1',
        baseContractValue: '500000.00',
        contractValue: '500000.00',
        signedDate: new Date('2026-09-19'),
        paymentTerms: '30 days',
      }),
    );
    expect(result).toMatchObject({
      originalContractValue: '500000.00',
      currentContractValue: '500000.00',
      sourceSnapshotMetadata: { description: 'Signed BOQ snapshot' },
    });
  });
});
