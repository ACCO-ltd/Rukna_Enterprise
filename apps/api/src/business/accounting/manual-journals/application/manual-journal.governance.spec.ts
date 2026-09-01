/**
 * JD1 — Manual journals must not fabricate approvals.
 *
 * Governance OFF (no active binding): DRAFT → SUBMITTED → POSTED with
 *   approvedBy = null, approvedAt = null, and NO approval audit event.
 * Governance ON  (a binding resolves): submit is gated (409, approval instance opened);
 *   posting is blocked until a real approval completes; approvedBy/approvedAt come only
 *   from a genuine approve() decision.
 *
 * Pure unit tests: prisma, the posting port and the CommandGovernanceService seam are all
 * mocked — no DB. The seam is consumed read-only exactly as AP consumes it.
 */
import { ConflictException } from '@nestjs/common';
import { ManualJournalService } from './manual-journal.service.js';

const identity = { userId: 'u-preparer', activeOrganizationId: 'o1' } as never;
const approver = { userId: 'u-approver', activeOrganizationId: 'o1' } as never;

/**
 * Builds a ManualJournalService with fully mocked collaborators.
 * @param gate  what the governance seam returns for gateStateTransition.
 * @param journalOverrides  fields merged into the journal record findFirst returns.
 */
function build(
  gate: null | { gated: true; approvalInstanceId: string },
  journalOverrides: Record<string, unknown> = {},
) {
  const journalRow = {
    id: 'j1',
    organizationId: 'o1',
    status: 'SUBMITTED',
    createdBy: 'u-preparer',
    accountingDate: new Date('2025-03-10'),
    documentDate: new Date('2025-03-10'),
    description: 'test',
    currencyCode: 'USD',
    journalCategory: 'GENERAL',
    entryPurpose: 'NORMAL',
    approvedBy: null,
    lines: [
      { accountId: 'a-dr', debitAmount: 100, creditAmount: 0, description: null },
      { accountId: 'a-cr', debitAmount: 0, creditAmount: 100, description: null },
    ],
    ...journalOverrides,
  };

  const tx = {
    accountVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
    journalEntry: { update: jest.fn().mockResolvedValue({ id: 'j1', status: 'POSTED' }) },
  };

  const prisma = {
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(journalRow),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'j1', ...(data as object) })),
    },
    journalLine: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { debitAmount: 100 } }),
    },
    $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };

  const tenancy = { getClient: () => prisma } as never;
  const journalRepo = {} as never;
  const sequenceRepo = { ensureSequence: jest.fn() } as never;
  const postingPort = {
    post: jest.fn().mockResolvedValue({ journalEntryId: 'je-1', journalNumber: 'JE-1' }),
  };
  const commandGovernance = { gateStateTransition: jest.fn().mockResolvedValue(gate) };
  const sod = { assertAllowed: jest.fn().mockResolvedValue(undefined) };

  const svc = new ManualJournalService(
    tenancy,
    journalRepo,
    sequenceRepo,
    postingPort as never,
    commandGovernance as never,
    sod as never,
  );

  return { svc, prisma, tx, postingPort, commandGovernance, sod };
}

describe('ManualJournalService — no fabricated approvals (JD1)', () => {
  describe('governance OFF (gate returns null)', () => {
    it('submit moves DRAFT → SUBMITTED and writes NO approval metadata', async () => {
      const { svc, prisma, commandGovernance } = build(null, { status: 'DRAFT' });

      await svc.submit(identity, 'j1');

      // The seam was consulted for the DRAFT→SUBMITTED transition.
      expect(commandGovernance.gateStateTransition).toHaveBeenCalledWith(
        identity,
        'ManualJournal',
        'DRAFT',
        'SUBMITTED',
        'j1',
        expect.anything(),
      );
      const update = prisma.journalEntry.update.mock.calls[0][0];
      expect(update.data.status).toBe('SUBMITTED');
      // No fabricated approval fields.
      expect(update.data).not.toHaveProperty('approvedBy');
      expect(update.data).not.toHaveProperty('approvedAt');
    });

    it('post from SUBMITTED passes approvedBy = undefined (null) to the posting port', async () => {
      const { svc, postingPort } = build(null, { status: 'SUBMITTED', approvedBy: null });

      await svc.post(identity, 'j1');

      expect(postingPort.post).toHaveBeenCalledTimes(1);
      const command = postingPort.post.mock.calls[0][0];
      expect(command.approvedBy).toBeUndefined();
    });

    it('post from SUBMITTED never records an APPROVED state or approver on the journal', async () => {
      const { svc, tx } = build(null, { status: 'SUBMITTED', approvedBy: null });

      await svc.post(identity, 'j1');

      // The only journal update at post time flips it to POSTED — it must not stamp approver.
      const postedUpdate = tx.journalEntry.update.mock.calls[0][0];
      expect(postedUpdate.data.status).toBe('POSTED');
      expect(postedUpdate.data).not.toHaveProperty('approvedBy');
      expect(postedUpdate.data).not.toHaveProperty('approvedAt');
    });
  });

  describe('governance ON (gate returns an approval instance)', () => {
    it('submit is blocked with 409 and does NOT transition to SUBMITTED', async () => {
      const { svc, prisma } = build(
        { gated: true, approvalInstanceId: 'ai-1' },
        { status: 'DRAFT' },
      );

      await expect(svc.submit(identity, 'j1')).rejects.toBeInstanceOf(ConflictException);
      // No state change while approval is pending.
      expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    });

    it('a real approve() decision records the genuine approver, which post() then forwards', async () => {
      // approve() records the REAL approver (different actor; SoD allowed).
      const approveHarness = build(null, { status: 'SUBMITTED', createdBy: 'u-preparer', approvedBy: null });
      await approveHarness.svc.approve(approver, { journalId: 'j1', approved: true });
      const approveUpdate = approveHarness.prisma.journalEntry.update.mock.calls[0][0];
      expect(approveUpdate.data.status).toBe('APPROVED');
      expect(approveUpdate.data.approvedBy).toBe('u-approver');
      expect(approveUpdate.data.approvedAt).toBeInstanceOf(Date);
      expect(approveHarness.sod.assertAllowed).toHaveBeenCalledTimes(1);

      // post() forwards the genuine approver to the posting engine.
      const postHarness = build(null, { status: 'APPROVED', approvedBy: 'u-approver' });
      await postHarness.svc.post(identity, 'j1');
      const command = postHarness.postingPort.post.mock.calls[0][0];
      expect(command.approvedBy).toBe('u-approver');
    });

    it('self-approval is blocked by SoD (preparer cannot approve own journal)', async () => {
      const { svc, sod } = build(null, { status: 'SUBMITTED', createdBy: 'u-preparer', approvedBy: null });
      sod.assertAllowed.mockRejectedValueOnce(new Error('SoD: preparer cannot approve'));

      await expect(
        svc.approve(identity, { journalId: 'j1', approved: true }),
      ).rejects.toThrow(/SoD/);
    });
  });

  it('rejection records rejecter and does not fabricate an approver', async () => {
    const { svc, prisma, sod } = build(null, { status: 'SUBMITTED', approvedBy: null });

    await svc.approve(approver, { journalId: 'j1', approved: false, rejectionReason: 'bad' });

    const update = prisma.journalEntry.update.mock.calls[0][0];
    expect(update.data.status).toBe('REJECTED');
    expect(update.data.rejectedBy).toBe('u-approver');
    expect(update.data).not.toHaveProperty('approvedBy');
    // SoD not evaluated on rejection.
    expect(sod.assertAllowed).not.toHaveBeenCalled();
  });
});
