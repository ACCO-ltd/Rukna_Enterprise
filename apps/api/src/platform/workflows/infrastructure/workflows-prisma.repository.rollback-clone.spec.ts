import { WorkflowsPrismaRepository } from './workflows-prisma.repository.js';

/**
 * ADR-027 rollback = clone-an-old-version. This proves the audit-evidence contract of
 * `clonePolicyToDraft` at the repository layer:
 *   - a new DRAFT is created at version+1 of the source's policyKey,
 *   - every source rule is copied with status PENDING (never carried over as ACTIVE),
 *   - every SoD rule is copied INACTIVE with the versioned `_V<n>` code suffix,
 *   - an APPROVAL_POLICY_ROLLBACK_CLONED audit log is written, and
 *   - a matching outbox event is written with a non-empty idempotency key.
 */
describe('WorkflowsPrismaRepository.clonePolicyToDraft', () => {
  function build() {
    const source = {
      id: 'src-1',
      organizationId: 'org-1',
      policyKey: 'ACCO_GOVERNANCE',
      version: 1,
      amountBasis: 'UNSPECIFIED',
      notes: 'original',
      rules: [
        { ruleKey: 'PO_CFO', transactionType: 'PURCHASE_ORDER', entityType: null, status: 'ACTIVE', priority: 1, configuration: { requiredRole: 'CFO' } },
        { ruleKey: 'PO_CEO', transactionType: 'PURCHASE_ORDER', entityType: null, status: 'PENDING', priority: 2, configuration: { requiredRole: 'CEO' } },
      ],
      segregationDutiesRules: [
        { code: 'SOD_A', description: 'a', isActive: true },
        { code: 'SOD_B', description: 'b', isActive: false },
      ],
    };

    const created: Record<string, unknown[]> = { auditLog: [], auditOutboxEvent: [] };
    let policyCreateArg: { data: Record<string, unknown> } | undefined;

    const tx = {
      workflowPolicyVersion: {
        findFirst: jest
          .fn()
          // 1st call: load the source with rules + SoD rules.
          .mockResolvedValueOnce(source)
          // 2nd call: latest version for the key (used to compute version+1).
          .mockResolvedValueOnce({ version: 1 }),
        create: jest.fn().mockImplementation((arg: { data: Record<string, unknown> }) => {
          policyCreateArg = arg;
          return { id: 'clone-1', version: arg.data.version, status: arg.data.status };
        }),
      },
      auditLog: { create: jest.fn().mockImplementation((arg: { data: Record<string, unknown> }) => { created.auditLog.push(arg.data); return { id: 'audit-1' }; }) },
      auditOutboxEvent: { create: jest.fn().mockImplementation((arg: { data: Record<string, unknown> }) => { created.auditOutboxEvent.push(arg.data); return { id: 'outbox-1' }; }) },
    };

    const prisma = { $transaction: jest.fn(async (cb: (client: unknown) => unknown) => cb(tx)) };
    const tenancyService = { getClient: () => prisma } as never;
    const repo = new WorkflowsPrismaRepository(tenancyService);
    return { repo, tx, created, getPolicyCreateArg: () => policyCreateArg };
  }

  it('creates a DRAFT at version+1 copying rules PENDING and SoD rules inactive with the versioned code', async () => {
    const { repo, getPolicyCreateArg } = build();

    const result = await repo.clonePolicyToDraft('org-1', 'src-1', 'actor-1', 'roll back to v1');
    expect(result).toMatchObject({ id: 'clone-1', version: 2, status: 'DRAFT' });

    const data = getPolicyCreateArg()!.data as {
      policyKey: string; version: number; status: string;
      rules: { create: { status: string; ruleKey: string }[] };
      segregationDutiesRules: { create: { code: string; isActive: boolean }[] };
    };
    expect(data.policyKey).toBe('ACCO_GOVERNANCE');
    expect(data.version).toBe(2);
    expect(data.status).toBe('DRAFT');
    // Every copied rule is PENDING regardless of the source status.
    expect(data.rules.create.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
    // SoD rules copied inactive with the _V2 suffix.
    expect(data.segregationDutiesRules.create).toEqual([
      { organizationId: 'org-1', code: 'SOD_A_V2', description: 'a', isActive: false },
      { organizationId: 'org-1', code: 'SOD_B_V2', description: 'b', isActive: false },
    ]);
  });

  it('writes the APPROVAL_POLICY_ROLLBACK_CLONED audit log and outbox event with an idempotency key', async () => {
    const { repo, created } = build();

    await repo.clonePolicyToDraft('org-1', 'src-1', 'actor-1', 'roll back to v1');

    expect(created.auditLog).toHaveLength(1);
    expect(created.auditLog[0]).toMatchObject({
      userId: 'actor-1', orgId: 'org-1', action: 'APPROVAL_POLICY_ROLLBACK_CLONED',
      resource: 'workflow-policy', resourceId: 'clone-1', reason: 'roll back to v1',
    });

    expect(created.auditOutboxEvent).toHaveLength(1);
    const outbox = created.auditOutboxEvent[0] as { eventType: string; idempotencyKey: string; auditLogId: string };
    expect(outbox.eventType).toBe('APPROVAL_POLICY_ROLLBACK_CLONED');
    expect(outbox.auditLogId).toBe('audit-1');
    expect(typeof outbox.idempotencyKey).toBe('string');
    expect(outbox.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('returns null (→ 404 at the service) when the source version does not exist', async () => {
    const { repo, tx } = build();
    tx.workflowPolicyVersion.findFirst.mockReset().mockResolvedValueOnce(null);
    await expect(repo.clonePolicyToDraft('org-1', 'missing', 'actor-1', 'x')).resolves.toBeNull();
  });
});
