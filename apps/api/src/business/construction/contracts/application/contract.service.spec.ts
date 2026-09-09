import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ContractService } from './contract.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

type Mocks = {
  repo: Record<string, jest.Mock>;
  projectAccess: Record<string, jest.Mock>;
  audit: { record: jest.Mock };
  /** Phase 7A: the record-attachment freeze seam, so execute/discharge can be asserted on. */
  attachments: { freezeFor: jest.Mock };
  service: ContractService;
};

function build(contract: Record<string, unknown> | null): Mocks {
  const repo = {
    findById: jest.fn().mockResolvedValue(contract),
    upsertRetentionTerms: jest.fn().mockResolvedValue({}),
    addAdvanceTerm: jest.fn().mockResolvedValue({ id: 'term-1' }),
    findAdvanceTermOwned: jest.fn(),
    removeAdvanceTerm: jest.fn().mockResolvedValue({ count: 1 }),
    addGuarantee: jest.fn().mockResolvedValue({ id: 'g-1' }),
    findGuaranteeOwned: jest.fn(),
    updateGuarantee: jest.fn().mockResolvedValue({ count: 1 }),
    findGuaranteeById: jest.fn().mockResolvedValue({ id: 'g-1', status: 'DISCHARGED' }),
    addDeliverable: jest.fn().mockResolvedValue({ id: 'd-1' }),
    findDeliverableOwned: jest.fn(),
    completeDeliverable: jest.fn().mockResolvedValue({ count: 1 }),
    findDeliverableById: jest.fn().mockResolvedValue({ id: 'd-1' }),
    // Payment-plan editor (commercial-billing §5 P1 + Q-B ACTIVE re-profile).
    findInvoicedInstallments: jest.fn().mockResolvedValue([]),
    reprofileUninvoicedInstallments: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
  const tenancy = { getClient: () => prisma };

  // Phase 7A: evidence freezes when the contract executes and when a guarantee leaves ACTIVE.
  const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };

  const service = new ContractService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    audit as never,
    attachments as never,
  );
  return { repo, projectAccess, audit, attachments, service };
}

const draft = { id: 'c-1', status: 'DRAFT', retentionTerms: null };
const active = { id: 'c-1', status: 'ACTIVE', retentionTerms: null };

describe('A2 — lifecycle enforcement (CONST-COM-001)', () => {
  it('blocks retention-term changes on an ACTIVE contract with 409', async () => {
    const { service, repo } = build(active);
    await expect(
      service.setRetentionTerms(identity, 'c-1', {
        retentionRate: '0.1',
        retentionCap: '0.05',
        retentionSplitOnPc: '0.5',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.upsertRetentionTerms).not.toHaveBeenCalled();
  });

  it('allows retention-term changes on a DRAFT contract and audits them', async () => {
    const { service, repo, audit } = build(draft);
    await service.setRetentionTerms(identity, 'c-1', {
      retentionRate: '0.1',
      retentionCap: '0.05',
      retentionSplitOnPc: '0.5',
    } as never);
    expect(repo.upsertRetentionTerms).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CONTRACT_RETENTION_TERMS_SET' }),
    );
  });

  it('blocks adding a guarantee on an ACTIVE contract but allows a status update', async () => {
    const activeContract = build(active);
    await expect(
      activeContract.service.addGuarantee(identity, 'c-1', {
        guaranteeType: 'PERFORMANCE',
        amount: '1000',
        currency: 'USD',
        issuer: 'Bank',
        beneficiary: 'ACCO',
        issueDate: '2026-01-01',
        expiryDate: '2027-01-01',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    // Operational status change is the explicit exception — allowed on ACTIVE.
    activeContract.repo.findGuaranteeOwned.mockResolvedValue({
      id: 'g-1',
      status: 'ACTIVE',
      notes: null,
    });
    await activeContract.service.updateGuarantee(identity, 'c-1', 'g-1', {
      status: 'DISCHARGED',
    } as never);
    expect(activeContract.repo.updateGuarantee).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      'g-1',
      expect.objectContaining({ status: 'DISCHARGED' }),
    );
  });
});

describe('A1 — parent-scoped child mutation security (CONST-COM-002)', () => {
  it('rejects updating a guarantee that does not belong to the contract (404, no write)', async () => {
    const { service, repo } = build(draft);
    repo.findGuaranteeOwned.mockResolvedValue(null); // child belongs to another contract/tenant
    await expect(
      service.updateGuarantee(identity, 'c-1', 'foreign-guarantee', { notes: 'x' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateGuarantee).not.toHaveBeenCalled();
  });

  it('rejects removing an advance term that does not belong to the contract', async () => {
    const { service, repo } = build(draft);
    repo.findAdvanceTermOwned.mockResolvedValue(null);
    await expect(
      service.removeAdvanceTerm(identity, 'c-1', 'foreign-term'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.removeAdvanceTerm).not.toHaveBeenCalled();
  });

  it('rejects completing a deliverable that does not belong to the contract', async () => {
    const { service, repo } = build(active);
    repo.findDeliverableOwned.mockResolvedValue(null);
    await expect(
      service.completeDeliverable(identity, 'c-1', 'foreign-deliverable'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.completeDeliverable).not.toHaveBeenCalled();
  });

  it('scopes the delete by contractId when the term is validly owned', async () => {
    const { service, repo, audit } = build(draft);
    repo.findAdvanceTermOwned.mockResolvedValue({
      id: 'term-1',
      advanceType: 'MOBILIZATION',
      amount: null,
      recoveryRate: '0.1',
    });
    await service.removeAdvanceTerm(identity, 'c-1', 'term-1');
    expect(repo.removeAdvanceTerm).toHaveBeenCalledWith(expect.anything(), 'c-1', 'term-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CONTRACT_ADVANCE_TERM_REMOVED' }),
    );
  });
});

// A child under a contract owned by another organization must be unreachable. requireContract
// resolves the parent via repo.findById(organizationId, id); an org it does not scope to comes
// back null, so the parent gate throws NotFound BEFORE any child is read, changed, removed, or
// completed. build(null) models exactly that org-scoped miss.
describe('Cross-tenant / organization isolation (CONST-COM-002)', () => {
  const foreignOrgContract = null;

  it('cannot set retention terms through a contract owned by another organization', async () => {
    const { service, repo } = build(foreignOrgContract);
    await expect(
      service.setRetentionTerms(identity, 'contract-in-org-2', {
        retentionRate: '0.1',
        retentionCap: '0.05',
        retentionSplitOnPc: '0.5',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.upsertRetentionTerms).not.toHaveBeenCalled();
  });

  it('cannot add or remove an advance term through a foreign-organization contract', async () => {
    const add = build(foreignOrgContract);
    await expect(
      add.service.addAdvanceTerm(identity, 'contract-in-org-2', {
        advanceType: 'MOBILIZATION',
        recoveryRate: '0.1',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(add.repo.addAdvanceTerm).not.toHaveBeenCalled();

    const remove = build(foreignOrgContract);
    await expect(
      remove.service.removeAdvanceTerm(identity, 'contract-in-org-2', 'term-in-org-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // The parent gate blocks first — the child lookup is never even reached.
    expect(remove.repo.findAdvanceTermOwned).not.toHaveBeenCalled();
    expect(remove.repo.removeAdvanceTerm).not.toHaveBeenCalled();
  });

  it('cannot add or change a guarantee through a foreign-organization contract', async () => {
    const add = build(foreignOrgContract);
    await expect(
      add.service.addGuarantee(identity, 'contract-in-org-2', {
        guaranteeType: 'PERFORMANCE',
        amount: '1000',
        currency: 'USD',
        issuer: 'Bank',
        beneficiary: 'ACCO',
        issueDate: '2026-01-01',
        expiryDate: '2027-01-01',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(add.repo.addGuarantee).not.toHaveBeenCalled();

    const update = build(foreignOrgContract);
    await expect(
      update.service.updateGuarantee(identity, 'contract-in-org-2', 'guarantee-in-org-2', {
        status: 'DISCHARGED',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update.repo.findGuaranteeOwned).not.toHaveBeenCalled();
    expect(update.repo.updateGuarantee).not.toHaveBeenCalled();
  });

  it('cannot add or complete a deliverable through a foreign-organization contract', async () => {
    const add = build(foreignOrgContract);
    await expect(
      add.service.addDeliverable(identity, 'contract-in-org-2', { name: 'Deliverable' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(add.repo.addDeliverable).not.toHaveBeenCalled();

    const complete = build(foreignOrgContract);
    await expect(
      complete.service.completeDeliverable(identity, 'contract-in-org-2', 'deliverable-in-org-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(complete.repo.findDeliverableOwned).not.toHaveBeenCalled();
    expect(complete.repo.completeDeliverable).not.toHaveBeenCalled();
  });

  it('honours the project-access gate: a rejected assertContract blocks any child mutation', async () => {
    const { service, projectAccess, repo } = build(active);
    projectAccess.assertContract.mockRejectedValue(new NotFoundException('Contract not found'));
    await expect(
      service.updateGuarantee(identity, 'c-1', 'g-1', { status: 'DISCHARGED' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findGuaranteeOwned).not.toHaveBeenCalled();
    expect(repo.updateGuarantee).not.toHaveBeenCalled();
  });
});

// Same organization, but the child lives under a DIFFERENT contract. The scoped finder keys on
// { id: childId, contractId }, so it returns null → 404, and we prove the lookup carried the
// caller-supplied contractId (never the child's own parent).
describe('Same-organization wrong-parent contract id (CONST-COM-002)', () => {
  const contractA = { id: 'contract-A', status: 'ACTIVE', retentionTerms: null };
  const draftA = { id: 'contract-A', status: 'DRAFT', retentionTerms: null };

  it('removeAdvanceTerm: a term of contract-B requested via contract-A fails, scoped by A', async () => {
    const { service, repo } = build(draftA);
    repo.findAdvanceTermOwned.mockResolvedValue(null);
    await expect(
      service.removeAdvanceTerm(identity, 'contract-A', 'term-of-contract-B'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findAdvanceTermOwned).toHaveBeenCalledWith(
      expect.anything(),
      'contract-A',
      'term-of-contract-B',
    );
    expect(repo.removeAdvanceTerm).not.toHaveBeenCalled();
  });

  it('updateGuarantee: a guarantee of contract-B requested via contract-A fails, scoped by A', async () => {
    const { service, repo } = build(contractA);
    repo.findGuaranteeOwned.mockResolvedValue(null);
    await expect(
      service.updateGuarantee(identity, 'contract-A', 'guarantee-of-contract-B', {
        status: 'DISCHARGED',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findGuaranteeOwned).toHaveBeenCalledWith(
      expect.anything(),
      'contract-A',
      'guarantee-of-contract-B',
    );
    expect(repo.updateGuarantee).not.toHaveBeenCalled();
  });

  it('completeDeliverable: a deliverable of contract-B requested via contract-A fails, scoped by A', async () => {
    const { service, repo } = build(contractA);
    repo.findDeliverableOwned.mockResolvedValue(null);
    await expect(
      service.completeDeliverable(identity, 'contract-A', 'deliverable-of-contract-B'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findDeliverableOwned).toHaveBeenCalledWith(
      expect.anything(),
      'contract-A',
      'deliverable-of-contract-B',
    );
    expect(repo.completeDeliverable).not.toHaveBeenCalled();
  });
});

describe('ADR-023 — payment schedule on contract create (CONST-COM-012)', () => {
  function buildForCreate() {
    const repo = {
      findByNumber: jest.fn().mockResolvedValue(null),
      findEffectiveClientContract: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      createPaymentInstallments: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      boqVersion: { findFirst: jest.fn().mockResolvedValue({ status: 'BASELINED' }) },
      $transaction: (fn: (tx: unknown) => unknown) => fn({}),
    };
    const tenancy = { getClient: () => prisma };
    const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };
    const service = new ContractService(
      tenancy as never,
      repo as never,
      projectAccess as never,
      audit as never,
      attachments as never,
    );
    return { repo, attachments, service };
  }

  const base = {
    projectId: 'p-1',
    clientId: 'cl-1',
    boqVersionId: 'bv-1',
    contractNumber: 'ACCO-1',
    contractValue: '1000000.00',
    currency: 'USD',
  };

  // ACCO's default template: Advance 40% / Structure 30% / Partition&Plastering 20% / Install&Paint 10%.
  const accoPlan = [
    { sortOrder: 0, name: 'Advance', percentage: 0.4, triggerType: 'ADVANCE' as const },
    { sortOrder: 1, name: 'Structure', percentage: 0.3, triggerType: 'MILESTONE' as const },
    { sortOrder: 2, name: 'Partition & Plastering', percentage: 0.2, triggerType: 'MILESTONE' as const },
    { sortOrder: 3, name: 'Installation & Paint', percentage: 0.1, triggerType: 'MILESTONE' as const },
  ];

  it('writes the installments when the plan totals 100% (MILESTONE contract)', async () => {
    const { service, repo } = buildForCreate();
    await service.create(identity, {
      ...base,
      billingModel: 'MILESTONE',
      paymentPlan: accoPlan,
    } as never);
    expect(repo.create).toHaveBeenCalled();
    expect(repo.createPaymentInstallments).toHaveBeenCalledWith(expect.anything(), 'c-1', accoPlan);
  });

  it('rejects a plan that does not total 100% and writes nothing', async () => {
    const { service, repo } = buildForCreate();
    await expect(
      service.create(identity, {
        ...base,
        billingModel: 'MILESTONE',
        paymentPlan: accoPlan.slice(0, 3), // 40 + 30 + 20 = 90%
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createPaymentInstallments).not.toHaveBeenCalled();
  });

  it('rejects a payment plan on a certified-progress (MEASURED_IPC) contract', async () => {
    const { service, repo } = buildForCreate();
    await expect(
      service.create(identity, {
        ...base,
        billingModel: 'MEASURED_IPC',
        paymentPlan: accoPlan,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createPaymentInstallments).not.toHaveBeenCalled();
  });
});

describe('commercial-billing §5 P1 + Q-B — payment-plan editor (DRAFT replace / ACTIVE re-profile)', () => {
  const draftMilestone = { id: 'c-1', status: 'DRAFT', billingModel: 'MILESTONE', retentionTerms: null };
  const activeMilestone = { id: 'c-1', status: 'ACTIVE', billingModel: 'MILESTONE', retentionTerms: null };
  const draftMeasured = { id: 'c-1', status: 'DRAFT', billingModel: 'MEASURED_IPC', retentionTerms: null };
  const closedMilestone = { id: 'c-1', status: 'CLOSED', billingModel: 'MILESTONE', retentionTerms: null };

  // Advance 40 / Structure 35 / Finish 25 = 100%.
  const newPlan = [
    { sortOrder: 0, name: 'Advance', percentage: 0.4, triggerType: 'ADVANCE' as const },
    { sortOrder: 1, name: 'Structure', percentage: 0.35, triggerType: 'MILESTONE' as const },
    { sortOrder: 2, name: 'Finish', percentage: 0.25, triggerType: 'MILESTONE' as const },
  ];

  // ── DRAFT: unchanged full-replace behaviour ────────────────────────────────────────────────
  it('DRAFT: replaces the whole plan and audits it as a REPLACE', async () => {
    const { service, repo, audit } = build(draftMilestone);
    await service.replacePaymentPlan(identity, 'c-1', { installments: newPlan } as never);

    // No invoiced installments on a DRAFT contract → the submitted set IS the whole plan.
    expect(repo.findInvoicedInstallments).toHaveBeenCalledWith(expect.anything(), 'c-1');
    expect(repo.reprofileUninvoicedInstallments).toHaveBeenCalledWith(expect.anything(), 'c-1', newPlan);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CONTRACT_PAYMENT_PLAN_REPLACED', action: 'REPLACE' }),
    );
  });

  it('DRAFT: rejects a plan that does not total 100% and writes nothing', async () => {
    const { service, repo } = build(draftMilestone);
    await expect(
      service.replacePaymentPlan(identity, 'c-1', { installments: newPlan.slice(0, 2) } as never), // 75%
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reprofileUninvoicedInstallments).not.toHaveBeenCalled();
  });

  // ── ACTIVE: previously-409 path is now allowed, invoiced stages frozen ──────────────────────
  it('ACTIVE: re-profiles the un-invoiced tail when invoiced% + submitted% = 100 and audits a REPROFILE', async () => {
    const { service, repo, audit } = build(activeMilestone);
    // 40% + 30% already invoiced → frozen 70%; the editable tail must total 30%.
    repo.findInvoicedInstallments.mockResolvedValue([
      { id: 'inv-1', percentage: 0.4 },
      { id: 'inv-2', percentage: 0.3 },
    ]);
    const tail = [
      { sortOrder: 2, name: 'Second fix', percentage: 0.2, triggerType: 'MILESTONE' as const },
      { sortOrder: 3, name: 'Handover', percentage: 0.1, triggerType: 'MILESTONE' as const },
    ];

    await service.replacePaymentPlan(identity, 'c-1', { installments: tail } as never);

    expect(repo.reprofileUninvoicedInstallments).toHaveBeenCalledWith(expect.anything(), 'c-1', tail);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'CONTRACT_PAYMENT_PLAN_REPROFILED',
        action: 'REPROFILE',
        after: expect.objectContaining({
          status: 'ACTIVE',
          frozenInvoicedCount: 2,
          frozenInvoicedPercentage: expect.closeTo(0.7, 5),
        }),
      }),
    );
  });

  it('ACTIVE: rejects when the submitted tail ≠ 100 − invoiced and writes nothing', async () => {
    const { service, repo } = build(activeMilestone);
    repo.findInvoicedInstallments.mockResolvedValue([
      { id: 'inv-1', percentage: 0.4 },
      { id: 'inv-2', percentage: 0.3 },
    ]);
    // Frozen 70% needs an editable 30%, but this tail totals 40% → 110% overall.
    const tooMuch = [
      { sortOrder: 2, name: 'Second fix', percentage: 0.25, triggerType: 'MILESTONE' as const },
      { sortOrder: 3, name: 'Handover', percentage: 0.15, triggerType: 'MILESTONE' as const },
    ];
    await expect(
      service.replacePaymentPlan(identity, 'c-1', { installments: tooMuch } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reprofileUninvoicedInstallments).not.toHaveBeenCalled();
  });

  it('ACTIVE: preserves the invoiced installments — never deletes or alters them', async () => {
    const { service, repo } = build(activeMilestone);
    repo.findInvoicedInstallments.mockResolvedValue([
      { id: 'inv-1', percentage: 0.4 },
      { id: 'inv-2', percentage: 0.3 },
    ]);
    const tail = [
      { sortOrder: 2, name: 'Finish', percentage: 0.3, triggerType: 'MILESTONE' as const },
    ];
    await service.replacePaymentPlan(identity, 'c-1', { installments: tail } as never);

    // The service delegates the "delete only un-invoiced, keep invoiced" swap to the repo. The
    // frozen set is passed to reprofile ONLY as the new un-invoiced rows — the invoiced ids are
    // never handed to any delete/replace path.
    expect(repo.reprofileUninvoicedInstallments).toHaveBeenCalledTimes(1);
    expect(repo.reprofileUninvoicedInstallments).toHaveBeenCalledWith(expect.anything(), 'c-1', tail);
    const [, , submitted] = repo.reprofileUninvoicedInstallments.mock.calls[0];
    expect(submitted).toEqual(tail);
    expect(submitted).not.toContainEqual(expect.objectContaining({ id: 'inv-1' }));
    expect(submitted).not.toContainEqual(expect.objectContaining({ id: 'inv-2' }));
  });

  // ── Guards ─────────────────────────────────────────────────────────────────────────────────
  it('rejects editing a CLOSED contract with a 409 and the use-a-Variation message', async () => {
    const { service, repo } = build(closedMilestone);
    await expect(
      service.replacePaymentPlan(identity, 'c-1', { installments: newPlan } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findInvoicedInstallments).not.toHaveBeenCalled();
    expect(repo.reprofileUninvoicedInstallments).not.toHaveBeenCalled();
  });

  it('rejects editing a non-MILESTONE (MEASURED_IPC) contract', async () => {
    const { service, repo } = build(draftMeasured);
    await expect(
      service.replacePaymentPlan(identity, 'c-1', { installments: newPlan } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reprofileUninvoicedInstallments).not.toHaveBeenCalled();
  });

  it('cannot edit a plan through a foreign-organization contract (parent gate blocks first)', async () => {
    const { service, repo } = build(null);
    await expect(
      service.replacePaymentPlan(identity, 'contract-in-org-2', { installments: newPlan } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findInvoicedInstallments).not.toHaveBeenCalled();
    expect(repo.reprofileUninvoicedInstallments).not.toHaveBeenCalled();
  });
});
