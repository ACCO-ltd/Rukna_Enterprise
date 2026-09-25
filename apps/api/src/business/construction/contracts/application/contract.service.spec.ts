import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
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
    // Lifecycle writes (activate/reopen/cancel/terminate/update) all go through repo.update.
    update: jest.fn().mockImplementation((_tx, id, data) => ({ id, ...data })),
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
    // ADR-029 V-2 — the variation current-value raise seam.
    findValueForRaise: jest.fn(),
    raiseCurrentContractValue: jest.fn().mockResolvedValue({}),
    findActiveClientContracts: jest.fn().mockResolvedValue([]),
  };
  const projectAccess = {
    assertContract: jest.fn().mockResolvedValue(undefined),
    assertMember: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
  const tenancy = { getClient: () => prisma };

  // Phase 7A: evidence freezes when the contract executes and when a guarantee leaves ACTIVE.
  const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };
  // ADR-029 R3/R6 — the BOQ read port used by the tie-out and the variation raise.
  const boqVersioning = { getInContractTotal: jest.fn().mockResolvedValue('750000.00') };

  const service = new ContractService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    audit as never,
    attachments as never,
    boqVersioning as never,
  );
  return { repo, projectAccess, audit, attachments, service };
}

describe('active client contract resolution for BOQ extra work', () => {
  it('returns the one ACTIVE client contract without exposing selection to the browser', async () => {
    const { service, repo } = build(null);
    repo.findActiveClientContracts.mockResolvedValue([
      { id: 'contract-1', contractNumber: 'ACCO-P1-C1' },
    ]);
    await expect(service.resolveActiveClientContract(identity, 'project-1')).resolves.toEqual({
      id: 'contract-1',
      contractNumber: 'ACCO-P1-C1',
    });
  });

  it('blocks when the signed main contract has not been activated', async () => {
    const { service } = build(null);
    await expect(service.resolveActiveClientContract(identity, 'project-1')).rejects.toThrow(
      'Record and activate the main contract',
    );
  });

  it('fails closed when invalid data contains multiple ACTIVE client contracts', async () => {
    const { service, repo } = build(null);
    repo.findActiveClientContracts.mockResolvedValue([
      { id: 'contract-1', contractNumber: 'ACCO-P1-C1' },
      { id: 'contract-2', contractNumber: 'ACCO-P1-C2' },
    ]);
    await expect(service.resolveActiveClientContract(identity, 'project-1')).rejects.toThrow(
      'more than one active client contract',
    );
  });
});

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

  it('blocks the contract header edit that would carry signedDate on an ACTIVE contract, but recordSignedDate is allowed', async () => {
    const { service, repo } = build(active);

    // CONTRACT_HEADER (update()) stays DRAFT-only — signedDate is never smuggled through it.
    await expect(
      service.update(identity, 'c-1', { contractNumber: 'ACCO-P1-C1' } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    // SIGNED_DATE is the explicit operational exception — allowed on ACTIVE.
    await service.recordSignedDate(identity, 'c-1', '2026-09-17');
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      expect.objectContaining({ signedDate: new Date('2026-09-17') }),
    );
  });

  it('blocks recordSignedDate once the contract is terminal', async () => {
    const closed = { id: 'c-1', status: 'CLOSED', retentionTerms: null };
    const { service, repo } = build(closed);
    await expect(service.recordSignedDate(identity, 'c-1', '2026-09-17')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('collapsed lifecycle — activate / reopen (ACCO signs on paper)', () => {
  const draftWithClient = {
    id: 'c-1',
    status: 'DRAFT',
    retentionTerms: null,
    client: { name: 'Rukna Client Co', taxNumber: 'TAX-123' },
  };

  it('activate (DRAFT → ACTIVE) freezes the client snapshots and freezes the evidence', async () => {
    const { service, repo, audit, attachments } = build(draftWithClient);

    await service.transition(identity, 'c-1', 'activate');

    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      expect.objectContaining({
        status: 'ACTIVE',
        clientNameSnapshot: 'Rukna Client Co',
        clientTaxSnapshot: 'TAX-123',
      }),
    );
    expect(attachments.freezeFor).toHaveBeenCalledWith('CONTRACT', 'c-1', expect.any(String));
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CONTRACT_ACTIVATE' }),
    );
  });

  // ADR-023 CONST-COM-012 — activation must not let a MILESTONE contract go live with a payment
  // schedule that does not reconcile to 100%, including the previously-open gap of zero
  // installments (a schedule never populated via create() or replacePaymentPlan()).
  describe('ADR-023 CONST-COM-012 — activation payment-plan reconciliation', () => {
    function milestoneDraft(installments: Array<{ percentage: string; triggerType?: string }>) {
      return {
        id: 'c-1',
        status: 'DRAFT',
        billingModel: 'MILESTONE',
        retentionTerms: null,
        client: { name: 'Rukna Client Co', taxNumber: 'TAX-123' },
        paymentInstallments: installments.map((installment, index) => ({
          sortOrder: index,
          name: `Stage ${index + 1}`,
          percentage: new Decimal(installment.percentage),
          triggerType: installment.triggerType ?? 'MILESTONE',
          dueOffsetDays: null,
          dueDate: null,
        })),
      };
    }

    it('rejects activate for a MILESTONE contract with no payment schedule at all', async () => {
      const { service, repo } = build(milestoneDraft([]));
      await expect(service.transition(identity, 'c-1', 'activate')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects activate for a MILESTONE contract whose schedule does not total 100%', async () => {
      const { service, repo } = build(
        milestoneDraft([{ percentage: '0.4' }, { percentage: '0.3' }]), // 70%
      );
      await expect(service.transition(identity, 'c-1', 'activate')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('allows activate for a MILESTONE contract whose schedule reconciles to 100%', async () => {
      const { service, repo } = build(
        milestoneDraft([{ percentage: '0.4' }, { percentage: '0.3' }, { percentage: '0.3' }]),
      );
      await service.transition(identity, 'c-1', 'activate');
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        'c-1',
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });

    it('does not check the payment schedule for a non-MILESTONE (e.g. MEASURED_IPC) contract', async () => {
      const { service, repo } = build({
        id: 'c-1',
        status: 'DRAFT',
        billingModel: 'MEASURED_IPC',
        retentionTerms: null,
        client: { name: 'Rukna Client Co', taxNumber: 'TAX-123' },
        paymentInstallments: [],
      });
      await service.transition(identity, 'c-1', 'activate');
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        'c-1',
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });
  });

  it('rejects activate on a contract that is not DRAFT', async () => {
    const { service, repo, attachments } = build(active);
    await expect(service.transition(identity, 'c-1', 'activate')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.update).not.toHaveBeenCalled();
    expect(attachments.freezeFor).not.toHaveBeenCalled();
  });

  it('the retired submit / approve-review / execute commands are no longer accepted', async () => {
    for (const command of ['submit', 'approve-review', 'execute']) {
      const { service, repo } = build(draftWithClient);
      await expect(service.transition(identity, 'c-1', command)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    }
  });

  it('reopen (ACTIVE → DRAFT) clears the client snapshots, audits, and does NOT re-freeze evidence', async () => {
    const { service, repo, audit, attachments } = build(active);

    await service.reopen(identity, 'c-1', 'paperwork changed before signature');

    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      expect.objectContaining({
        status: 'DRAFT',
        clientNameSnapshot: null,
        clientTaxSnapshot: null,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'CONTRACT_REOPENED', reason: 'paperwork changed before signature' }),
    );
    // Reopen must not thaw or re-freeze the evidence — the files platform has no thaw path.
    expect(attachments.freezeFor).not.toHaveBeenCalled();
  });

  it('rejects reopen on a contract that is not ACTIVE', async () => {
    const { service, repo } = build(draft);
    await expect(
      service.reopen(identity, 'c-1', 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('cancel is allowed only from DRAFT — the retired pre-live states no longer reach it', async () => {
    const fromDraft = build(draft);
    await fromDraft.service.cancel(identity, 'c-1', 'client withdrew');
    expect(fromDraft.repo.update).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      expect.objectContaining({ status: 'CANCELLED' }),
    );

    for (const status of ['UNDER_REVIEW', 'PENDING_SIGNATURE', 'ACTIVE']) {
      const other = build({ id: 'c-1', status, retentionTerms: null });
      await expect(other.service.cancel(identity, 'c-1', 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(other.repo.update).not.toHaveBeenCalled();
    }
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
      // Slice-1A: the new resolver that finds the current operational version regardless of status.
      findCurrentOperationalBoqVersion: jest
        .fn()
        .mockResolvedValue({ boqId: 'boq-1', operationalVersionId: 'bv-1' }),
      findProjectCode: jest.fn().mockResolvedValue({ code: 'ACCO-WBR-26-0065' }),
      nextContractNumber: jest.fn().mockResolvedValue('ACCO-WBR-26-0065-C1'),
    };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      boqVersion: { findFirst: jest.fn().mockResolvedValue({ status: 'BASELINED', boqId: 'boq-1' }) },
      $transaction: (fn: (tx: unknown) => unknown) => fn({}),
    };
    const tenancy = { getClient: () => prisma };
    const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };
    // ADR-029 T-1/T-4 — create() ties the contract out to the priced scope. The mock returns a tie-out
    // equal to base.contractValue so these payment-plan tests exercise the plan path, not the tie-out gate.
    const boqVersioning = {
      getInContractTotal: jest.fn().mockResolvedValue('1000000.00'),
      createContractSigningSnapshot: jest.fn().mockResolvedValue('bv-snap-1'),
    };
    const service = new ContractService(
      tenancy as never,
      repo as never,
      projectAccess as never,
      audit as never,
      attachments as never,
      boqVersioning as never,
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

// ADR-029 §3 / Slice-1A — BOQ↔Contract tie-out + three-layer contract value (R3, GitHub #193).
// Pure-logic assertions; all deps mocked, $transaction runs the callback inline.
describe('R3 — tie-out & three-layer contract value (T-1..T-4)', () => {
  // Slice-1A: `currentBoq` models what the server resolves for a CLIENT_CONTRACT — the current
  // operational version (DRAFT or COMMITTED). No committed BOQ is required.
  function buildForCreate(
    opts: {
      currentBoq?: { boqId: string; operationalVersionId: string } | null;
      tieOutTotal?: string | null;
    } = {},
  ) {
    const defaultBoq = { boqId: 'boq-1', operationalVersionId: 'bv-1' };
    const repo = {
      findByNumber: jest.fn().mockResolvedValue(null),
      findEffectiveClientContract: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      createPaymentInstallments: jest.fn().mockResolvedValue({ count: 0 }),
      findCurrentOperationalBoqVersion: jest
        .fn()
        .mockResolvedValue(opts.currentBoq === undefined ? defaultBoq : opts.currentBoq),
      findProjectCode: jest.fn().mockResolvedValue({ code: 'ACCO-WBR-26-0065' }),
      nextContractNumber: jest.fn().mockResolvedValue('ACCO-WBR-26-0065-C1'),
    };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      boqVersion: { findFirst: jest.fn().mockResolvedValue({ status: 'COMMITTED', boqId: 'boq-1' }) },
      $transaction: (fn: (tx: unknown) => unknown) => fn({}),
    };
    const tenancy = { getClient: () => prisma };
    const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };
    const boqVersioning = {
      getInContractTotal: jest
        .fn()
        .mockResolvedValue(opts.tieOutTotal === undefined ? '750000.00' : opts.tieOutTotal),
      createContractSigningSnapshot: jest.fn().mockResolvedValue('bv-snap-1'),
    };
    const service = new ContractService(
      tenancy as never,
      repo as never,
      projectAccess as never,
      audit as never,
      attachments as never,
      boqVersioning as never,
    );
    return { repo, attachments, boqVersioning, prisma, service };
  }

  // Base for the full-payload path: a caller still POSTing boqVersionId + contractValue. The
  // server resolves to the same operational version id, so a matching supplied id is honoured.
  const base = {
    projectId: 'p-1',
    clientId: 'cl-1',
    boqVersionId: 'bv-1',
    contractNumber: 'ACCO-1',
    currency: 'USD',
  };

  it('T-1/T-4: derives base = current = the shared in-contract tie-out total', async () => {
    const { service, repo, boqVersioning } = buildForCreate({ tieOutTotal: '750000.00' });
    await service.create(identity, { ...base, contractValue: '750000.00' } as never);
    expect(boqVersioning.getInContractTotal).toHaveBeenCalledWith(identity, 'p-1', 'bv-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseContractValue: '750000.00', contractValue: '750000.00' }),
    );
  });

  it('T-4: a contractValue below the tie-out is rejected 400 TIEOUT_MISMATCH with the delta', async () => {
    const { service, repo } = buildForCreate({ tieOutTotal: '750000.00' });
    const err = await service
      .create(identity, { ...base, contractValue: '700000.00' } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as {
      code: string;
      details: { tieOutTotal: string; suppliedContractValue: string; delta: string };
    };
    expect(response.code).toBe('TIEOUT_MISMATCH');
    expect(response.details).toMatchObject({
      tieOutTotal: '750000.00',
      suppliedContractValue: '700000.00',
      delta: '-50000.00',
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('T-4: a contractValue above the tie-out is rejected with a positive delta', async () => {
    const { service } = buildForCreate({ tieOutTotal: '750000.00' });
    const err = await service
      .create(identity, { ...base, contractValue: '800000.00' } as never)
      .catch((e) => e);
    const response = (err as BadRequestException).getResponse() as { details: { delta: string } };
    expect(response.details.delta).toBe('50000.00');
  });

  it('contract anchors to a signing SNAPSHOT, not the operational version directly', async () => {
    const { service, repo, boqVersioning } = buildForCreate({ tieOutTotal: '750000.00' });
    await service.create(identity, { ...base, contractValue: '750000.00' } as never);
    expect(boqVersioning.createContractSigningSnapshot).toHaveBeenCalledWith(
      expect.anything(), 'boq-1', 'bv-1', identity.userId,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boqVersionId: 'bv-snap-1' }),
    );
  });

  it('rejects when the referenced BOQ version has no priced in-contract scope (tie-out null)', async () => {
    const { service, repo } = buildForCreate({ tieOutTotal: null });
    await expect(
      service.create(identity, { ...base, contractValue: '750000.00' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ADR-030 CONST-COM-020/021/022 / Slice-1A — contract-create simplification (S-CC-1..4). The
// minimal form posts only client + dates; the server finds the current operational BOQ version
// (no committed BOQ required), derives the value, and mints the number.
describe('C1 — contract-create simplification (S-CC-1..4)', () => {
  function buildForCreate(
    opts: {
      currentBoq?: { boqId: string; operationalVersionId: string } | null;
      tieOutTotal?: string | null;
      projectCode?: string;
    } = {},
  ) {
    const defaultBoq = { boqId: 'boq-1', operationalVersionId: 'bv-1' };
    const repo = {
      findByNumber: jest.fn().mockResolvedValue(null),
      findEffectiveClientContract: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      createPaymentInstallments: jest.fn().mockResolvedValue({ count: 0 }),
      findCurrentOperationalBoqVersion: jest
        .fn()
        .mockResolvedValue(opts.currentBoq === undefined ? defaultBoq : opts.currentBoq),
      findProjectCode: jest
        .fn()
        .mockResolvedValue({ code: opts.projectCode ?? 'ACCO-WBR-26-0065' }),
      // Mirrors the atomic sequence: n=1 on the first mint. The DB-backed spec proves concurrency.
      nextContractNumber: jest
        .fn()
        .mockImplementation((_tx: unknown, _projectId: string, code: string) =>
          Promise.resolve(`${code}-C1`),
        ),
    };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      boqVersion: { findFirst: jest.fn().mockResolvedValue({ status: 'COMMITTED', boqId: 'boq-1' }) },
      $transaction: (fn: (tx: unknown) => unknown) => fn({}),
    };
    const tenancy = { getClient: () => prisma };
    const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };
    const boqVersioning = {
      getInContractTotal: jest
        .fn()
        .mockResolvedValue(opts.tieOutTotal === undefined ? '750000.00' : opts.tieOutTotal),
      createContractSigningSnapshot: jest.fn().mockResolvedValue('bv-snap-1'),
    };
    const service = new ContractService(
      tenancy as never,
      repo as never,
      projectAccess as never,
      audit as never,
      attachments as never,
      boqVersioning as never,
    );
    return { repo, audit, boqVersioning, service };
  }

  const minimal = { projectId: 'p-1', clientId: 'cl-1', currency: 'USD', startDate: '2026-01-15' };

  it('S-CC-1: minimal payload (no boq/value/number) → base==current==tie-out, anchored to snapshot', async () => {
    const { service, repo, boqVersioning } = buildForCreate({ tieOutTotal: '750000.00' });
    await service.create(identity, minimal as never);

    // Operational version found and tied out against; contract anchors to the signing snapshot.
    expect(repo.findCurrentOperationalBoqVersion).toHaveBeenCalledWith(expect.anything(), 'p-1');
    expect(boqVersioning.getInContractTotal).toHaveBeenCalledWith(identity, 'p-1', 'bv-1');
    expect(boqVersioning.createContractSigningSnapshot).toHaveBeenCalledWith(
      expect.anything(), 'boq-1', 'bv-1', identity.userId,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        boqVersionId: 'bv-snap-1',
        baseContractValue: '750000.00',
        contractValue: '750000.00',
      }),
    );
  });

  it('S-CC-3: an omitted number is minted `{projectCode}-C{n}` from the atomic sequence', async () => {
    const { service, repo } = buildForCreate({ projectCode: 'ACCO-WBR-26-0065' });
    await service.create(identity, minimal as never);

    expect(repo.nextContractNumber).toHaveBeenCalledWith(
      expect.anything(),
      'p-1',
      'ACCO-WBR-26-0065',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contractNumber: 'ACCO-WBR-26-0065-C1' }),
    );
    // No duplicate check when the number is auto-generated.
    expect(repo.findByNumber).not.toHaveBeenCalled();
  });

  it('S-CC-2: no BOQ initialized for the project → NotFoundException, no row, tie-out never computed', async () => {
    const { service, repo, boqVersioning } = buildForCreate({ currentBoq: null });
    const err = await service.create(identity, minimal as never).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(boqVersioning.getInContractTotal).not.toHaveBeenCalled();
    expect(repo.nextContractNumber).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('S-CC-4: billingModel defaults to MILESTONE when omitted', async () => {
    const { service, repo } = buildForCreate();
    await service.create(identity, minimal as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ billingModel: 'MILESTONE' }),
    );
  });

  it('a supplied contractValue that differs from the tie-out still 400s TIEOUT_MISMATCH', async () => {
    const { service, repo } = buildForCreate({ tieOutTotal: '750000.00' });
    const err = await service
      .create(identity, { ...minimal, contractValue: '700000.00' } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'TIEOUT_MISMATCH' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('non-breaking: the old full payload (boqVersionId+value+number) still succeeds and honours the number', async () => {
    const { service, repo } = buildForCreate({ tieOutTotal: '750000.00' });
    await service.create(identity, {
      ...minimal,
      boqVersionId: 'bv-1',
      contractValue: '750000.00',
      contractNumber: 'ACCO-LEGACY-1',
    } as never);

    // Supplied number is checked for duplicates and used verbatim; the sequence is NOT consulted.
    expect(repo.findByNumber).toHaveBeenCalledWith(expect.anything(), 'org-1', 'ACCO-LEGACY-1');
    expect(repo.nextContractNumber).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contractNumber: 'ACCO-LEGACY-1', contractValue: '750000.00' }),
    );
  });

  it('a supplied boqVersionId that does not match the current operational version is rejected (BOQ_VERSION_MISMATCH)', async () => {
    const { service, repo } = buildForCreate({
      currentBoq: { boqId: 'boq-1', operationalVersionId: 'bv-committed' },
    });
    const err = await service
      .create(identity, { ...minimal, boqVersionId: 'bv-stale' } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'BOQ_VERSION_MISMATCH' });
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ADR-029 V-2 / T-2 / T-3 — the variation current-value raise seam the adopt command drives.
describe('V-2 — raiseCurrentValueForVariation (current rises by net, base frozen)', () => {
  it('raises current by the VO net and leaves the frozen base untouched', async () => {
    const { service, repo, audit } = build(null);
    repo.findValueForRaise.mockResolvedValue({
      id: 'c-1',
      projectId: 'p-1',
      contractValue: new Decimal('1000000'),
      baseContractValue: new Decimal('1000000'),
      currency: 'USD',
    });

    const res = await service.raiseCurrentValueForVariation({} as never, identity, 'c-1', {
      id: 'vo-1',
      reference: 'VO-001',
      netDelta: new Decimal('900'),
    });

    expect(repo.raiseCurrentContractValue).toHaveBeenCalledWith({}, 'c-1', '1000900.00');
    expect(res).toMatchObject({
      previousContractValue: '1000000.00',
      newContractValue: '1000900.00',
      baseContractValue: '1000000.00',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'CONTRACT_VALUE_RAISED_BY_VARIATION',
        before: { contractValue: '1000000.00' },
        after: expect.objectContaining({ contractValue: '1000900.00', netDelta: '900.00' }),
      }),
    );
  });

  it('accumulates: a second adopt raises from the already-raised current, base still frozen', async () => {
    const { service, repo } = build(null);
    repo.findValueForRaise.mockResolvedValue({
      id: 'c-1',
      projectId: 'p-1',
      contractValue: new Decimal('1000900'),
      baseContractValue: new Decimal('1000000'),
      currency: 'USD',
    });

    const res = await service.raiseCurrentValueForVariation({} as never, identity, 'c-1', {
      id: 'vo-2',
      reference: 'VO-002',
      netDelta: new Decimal('2000'),
    });

    expect(repo.raiseCurrentContractValue).toHaveBeenCalledWith({}, 'c-1', '1002900.00');
    expect(res.baseContractValue).toBe('1000000.00');
  });

  it('404s when the contract is not found (org-scoped)', async () => {
    const { service, repo } = build(null);
    repo.findValueForRaise.mockResolvedValue(null);
    await expect(
      service.raiseCurrentValueForVariation({} as never, identity, 'missing', {
        id: 'vo-1',
        reference: 'VO-001',
        netDelta: new Decimal('900'),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.raiseCurrentContractValue).not.toHaveBeenCalled();
  });
});
