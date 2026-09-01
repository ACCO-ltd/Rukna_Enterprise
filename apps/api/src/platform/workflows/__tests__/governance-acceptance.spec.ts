/**
 * ADR-027 non-production ACCO acceptance test (Work Package E, item 7).
 *
 * Proves the full governance loop end-to-end against a real Postgres, in a self-seeded tenant:
 *
 *   1. SEED   — the approved governed SYSTEM roles (CFO + Governance Publisher, via the WP-A
 *               `seedGovernedSystemRoles` seeder) plus the transaction-role holders, and an ACTIVE
 *               ACCO governance policy carrying the SoD rules (reuses the `seedAccoGovernancePolicy`
 *               building block through `seedAccoWorkflows`).
 *   2. AUTHOR — a policy version is taken DRAFT → add matrix rule → submit-review → schedule →
 *               activate through the REAL `WorkflowsService`. Scheduling is done by a DIFFERENT
 *               actor than the submitter, so four-eyes (GOV-ADM-007) is satisfied, and it is
 *               rejected when the submitter tries to publish their own version.
 *   3. GATE   — a real governed transaction (a manual journal DRAFT → SUBMITTED) is driven through
 *               the `CommandGovernanceService` seam. An approval instance is required (submit 409s),
 *               the submitter — holding SYSTEM_ADMINISTRATOR — cannot self-approve (SoD denies), and
 *               an authorized approver completes it, after which the submit proceeds.
 *
 * Deterministic and self-contained: it seeds its own org/roles/users and cleans them up. It talks
 * to the same Postgres the other api integration specs use (see apps/api/src/business/**\/__tests__).
 * In CI that database is provisioned; locally it is the `.env` tenant DB. If no database is
 * reachable the suite fails at `beforeAll` — it is an integration test by design, not a unit mock.
 */

import { PrismaClient } from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';
import { WorkflowTransactionType } from '@erp/types';

import type { TenancyService } from '../../tenancy/tenancy.service.js';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';
import { WorkflowsService } from '../application/workflows.service.js';
import { ApprovalService } from '../application/approval.service.js';
import { CommandGovernanceService } from '../application/command-governance.service.js';
import { WorkflowTriggerResolverService } from '../application/workflow-trigger-resolver.service.js';
import { SegregationOfDutiesService } from '../application/segregation-of-duties.service.js';
import { GovernanceAuthoringConfig } from '../application/governance-authoring.config.js';
import { ManualJournalService } from '../../../business/accounting/manual-journals/application/manual-journal.service.js';
import { AccountingPostingService } from '../../../business/accounting/accounting-core/infrastructure/accounting-posting.service.js';
import { JournalRepository } from '../../../business/accounting/accounting-core/infrastructure/journal.repository.js';
import { DocumentSequenceRepository } from '../../../business/accounting/accounting-core/infrastructure/document-sequence.repository.js';
import { seedGovernedSystemRoles } from '../../../../scripts/governed-roles.js';
import { seedAccoWorkflows } from '../seeders/acco-workflows.seed.js';

const prisma = new PrismaClient();
const tenancy = { getClient: () => prisma } as unknown as TenancyService;

// A GovernanceAuthoringConfig with the ADR-027 authoring flag ON, so the authoring surface is
// exercised (the flag-off path is covered by the dedicated flag specs).
const authoringOn = new GovernanceAuthoringConfig({ get: () => 'true' } as never);

const repo = new WorkflowsPrismaRepository(tenancy);
const workflows = new WorkflowsService(repo, authoringOn);
const sod = new SegregationOfDutiesService(tenancy);
const approvals = new ApprovalService(repo, workflows, sod);
const commandGovernance = new CommandGovernanceService(new WorkflowTriggerResolverService(tenancy), repo);
const manualJournals = new ManualJournalService(
  tenancy,
  new JournalRepository(),
  new DocumentSequenceRepository(),
  new AccountingPostingService(new DocumentSequenceRepository(), new JournalRepository()),
  commandGovernance,
  sod,
);

const suffix = `gov${randomUUID().slice(0, 12)}`;
const orgId = `acc-test-org-${suffix}`;

// Actors. The submitter of the authored policy is distinct from its publisher (four-eyes). The
// journal preparer also holds SYSTEM_ADMINISTRATOR so its self-approval is denied by SoD; the
// finance approver holds only the chain's role. Ids are the seeded User primary keys, because a
// governance write records the actor in `audit_logs.user_id`, which has a FK to `users`.
const AUTHOR = `${orgId}-author`;
const PUBLISHER = `${orgId}-publisher`;
const PREPARER = `${orgId}-preparer`;
const APPROVER = `${orgId}-approver`;

const identity = (userId: string, roles: string[] = []): RequestIdentity =>
  ({ userId, activeOrganizationId: orgId, tenantSlug: `t-${suffix}`, roles, permissions: ['*'] });

let expenseAccountId: string;
let revenueAccountId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: orgId, name: `Gov Test ${suffix}`, slug: `gov-${suffix}`, status: 'ACTIVE' } });

  // Users (author, publisher, preparer, approver). The id IS the actor id used everywhere below.
  for (const [index, userId] of [AUTHOR, PUBLISHER, PREPARER, APPROVER].entries()) {
    await prisma.user.create({
      data: { id: userId, email: `u${index}-${suffix}@example.com`, passwordHash: 'x', firstName: `User${index}`, lastName: 'Test', organizationId: orgId },
    });
  }

  // 1a. Governed SYSTEM roles (CFO + Governance Publisher) via the WP-A seeder.
  await seedGovernedSystemRoles(prisma, orgId);

  // 1b. The roles the authored rule and the journal approval chain reference. PROCUREMENT_MANAGER
  //     is the matrix approver for PO DRAFT→SUBMITTED; FINANCE_OFFICER approves the journal;
  //     SYSTEM_ADMINISTRATOR is held by the preparer to exercise the SoD self-approval block.
  for (const name of ['PROCUREMENT_MANAGER', 'FINANCE_OFFICER', 'SYSTEM_ADMINISTRATOR']) {
    await prisma.role.create({ data: { name, kind: 'SYSTEM', organizationId: orgId } });
  }

  // 1c. The full ACCO governance config, including the ACTIVE ACCO_GOVERNANCE policy whose SoD
  //     rules (JOURNAL_PREPARER_CANNOT_APPROVE_JOURNAL, SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_TRANSACTION)
  //     are active — this is what makes the self-approval denial real, not mocked.
  await seedAccoWorkflows(prisma, orgId);

  // GL accounts for the manual journal (balanced two-line entry).
  const mkAccount = async (code: string, normalBalance: 'DEBIT' | 'CREDIT', accountClass: string, accountSubtype: string) => {
    const account = await prisma.account.create({ data: { id: `${orgId}-${code}`, organizationId: orgId, code, normalBalance: normalBalance as never, createdBy: PREPARER } });
    await prisma.accountVersion.create({ data: { accountId: account.id, versionNumber: 1, name: `${code} Account`, accountClass: accountClass as never, accountSubtype: accountSubtype as never, isPostingAllowed: true, effectiveFrom: new Date('2025-01-01'), effectiveTo: null, changedBy: PREPARER } });
    return account.id;
  };
  expenseAccountId = await mkAccount('EXP-GOV', 'DEBIT', 'EXPENSE', 'ADMINISTRATIVE_EXPENSE');
  revenueAccountId = await mkAccount('REV-GOV', 'CREDIT', 'INCOME', 'PROJECT_REVENUE');
}, 60_000);

afterAll(async () => {
  // FK-safe teardown of everything this suite created.
  await prisma.$executeRaw`DELETE FROM approval_actions WHERE instance_id IN (SELECT id FROM approval_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId}))`;
  await prisma.$executeRaw`DELETE FROM approval_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM workflow_trigger_bindings WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_steps WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM workflow_conditions WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_policy_rules WHERE workflow_policy_version_id IN (SELECT id FROM workflow_policy_versions WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM segregation_of_duties_rules WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_policy_versions WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`UPDATE journal_entries SET status = 'DRAFT' WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM journal_entries WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM document_number_sequences WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM account_versions WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM accounts WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE org_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM roles WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM users WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  await prisma.$disconnect();
}, 60_000);

// ── Part 1: the WP-A governed roles seed produced the approved publish-authority holders ──────────
it('seeds CFO and Governance Publisher SYSTEM roles that hold publish:workflow', async () => {
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, name: { in: ['CFO', 'GOVERNANCE_PUBLISHER'] } },
    include: { rolePermissions: { include: { permission: true } } },
  });
  expect(roles.map((r) => r.name).sort()).toEqual(['CFO', 'GOVERNANCE_PUBLISHER']);
  for (const role of roles) {
    expect(role.kind).toBe('SYSTEM');
    const keys = role.rolePermissions.map((rp) => `${rp.permission.action}:${rp.permission.resource}`);
    expect(keys).toContain('publish:workflow');
  }
});

// ── Part 2: author a policy version through the real service path with four-eyes ──────────────────
it('authors a policy version DRAFT → add rule → submit-review → schedule (four-eyes) → activate', async () => {
  const draft = await workflows.createPolicyDraft(orgId, { policyKey: `ACCEPTANCE_${suffix}`, notes: 'acceptance test policy' });
  expect(draft.status).toBe('DRAFT');

  // A closed-schema rule that IS in the approved ACCO matrix (Purchase order DRAFT → SUBMITTED,
  // Procurement Manager). The role must resolve in this org (seeded above).
  await workflows.addRuleToDraft(orgId, draft.id, {
    ruleKey: 'PO_PROC_MANAGER',
    transactionType: WorkflowTransactionType.PURCHASE_ORDER,
    requiredRole: 'PROCUREMENT_MANAGER',
    priority: 1,
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
  });

  await workflows.submitForReview(orgId, draft.id, AUTHOR, 'ready for review');
  const inReview = await workflows.getPolicyWithRules(orgId, draft.id);
  expect(inReview.status).toBe('IN_REVIEW');

  // Four-eyes: the submitter cannot schedule (publish) their own version.
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await expect(workflows.schedulePolicy(orgId, draft.id, AUTHOR, 'self publish', future)).rejects.toBeInstanceOf(ConflictException);

  // A different actor (publisher) schedules for a due (past) effective date, then activates.
  const due = new Date(Date.now() - 1_000);
  // schedule requires a FUTURE date, so schedule for the future then activate with a due date.
  await workflows.schedulePolicy(orgId, draft.id, PUBLISHER, 'go live', future);
  const scheduled = await workflows.getPolicyWithRules(orgId, draft.id);
  expect(scheduled.status).toBe('SCHEDULED');
  expect(scheduled.submittedByUserId).toBe(AUTHOR);
  expect(scheduled.reviewedByUserId).toBe(PUBLISHER);

  await workflows.activatePolicy(orgId, draft.id, PUBLISHER, 'activate now', due);
  const active = await workflows.getPolicyWithRules(orgId, draft.id);
  expect(active.status).toBe('ACTIVE');

  // The lifecycle transitions wrote transactional audit + outbox evidence (GOV-ADM-008).
  const outbox = await prisma.auditOutboxEvent.findMany({ where: { organizationId: orgId, aggregateId: draft.id }, orderBy: { occurredAt: 'asc' } });
  expect(outbox.map((e) => e.eventType)).toEqual(expect.arrayContaining(['APPROVAL_POLICY_IN_REVIEW', 'APPROVAL_POLICY_SCHEDULED', 'APPROVAL_POLICY_ACTIVE']));
  // Every governance write pairs an audit log with an outbox event carrying an idempotency key.
  for (const event of outbox) expect(event.idempotencyKey).toBeTruthy();
});

// ── Part 3: drive a real governed transaction and prove the gate + SoD + authorized completion ────
it('gates a manual journal submission, blocks submitter self-approval (SoD), and lets an authorized approver complete it', async () => {
  // Activate a ManualJournal DRAFT → SUBMITTED binding routed to a one-step FINANCE_OFFICER chain.
  const definition = await prisma.workflowDefinition.create({
    data: {
      organizationId: orgId,
      transactionType: WorkflowTransactionType.MANUAL_JOURNAL,
      name: `MJ Governance ${suffix}`,
      isActive: true,
      requiresCeoConfirmation: false,
      steps: { create: [{ stepOrder: 1, roleRequired: 'FINANCE_OFFICER', isOptional: false, notifyRoles: [] }] },
    },
  });
  await prisma.workflowTriggerBinding.create({
    data: {
      organizationId: orgId,
      triggerKind: 'STATE_TRANSITION',
      entityType: 'ManualJournal',
      transactionType: WorkflowTransactionType.MANUAL_JOURNAL,
      fromState: 'DRAFT',
      toState: 'SUBMITTED',
      workflowDefinitionId: definition.id,
      priority: 50,
      isActive: true,
    },
  });

  // Preparer creates a balanced draft journal.
  const draft = await manualJournals.create(identity(PREPARER, ['FINANCE_OFFICER', 'SYSTEM_ADMINISTRATOR']), {
    accountingDate: '2025-01-15',
    description: 'Acceptance governed journal',
    currencyCode: 'USD',
    lines: [
      { accountId: expenseAccountId, debitAmount: 500 },
      { accountId: revenueAccountId, creditAmount: 500 },
    ],
  });
  expect(draft.status).toBe('DRAFT');

  // 3a. Submitting requires approval: the seam opens an instance and 409s with its id.
  let approvalInstanceId: string | undefined;
  await expect(
    manualJournals.submit(identity(PREPARER, ['FINANCE_OFFICER', 'SYSTEM_ADMINISTRATOR']), draft.id).catch((error: unknown) => {
      approvalInstanceId = (error as { response?: { details?: { approvalInstanceId?: string } } })?.response?.details?.approvalInstanceId;
      throw error;
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(approvalInstanceId).toBeTruthy();

  // The journal has NOT advanced — it stays DRAFT until a real approval completes.
  const stillDraft = await prisma.journalEntry.findUnique({ where: { id: draft.id } });
  expect(stillDraft?.status).toBe('DRAFT');

  const instance = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId! } });
  expect(instance.status).toBe('PENDING');
  expect(instance.transactionId).toBe(draft.id);

  // 3b. SoD: the preparer (a SYSTEM_ADMINISTRATOR) cannot self-approve the business transaction.
  await expect(
    approvals.approve(approvalInstanceId!, PREPARER, ['FINANCE_OFFICER', 'SYSTEM_ADMINISTRATOR'], orgId),
  ).rejects.toBeInstanceOf(ForbiddenException);

  // The instance is untouched by the denied attempt.
  const afterDenied = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId! } });
  expect(afterDenied.status).toBe('PENDING');

  // 3c. An authorized approver (holds FINANCE_OFFICER, not sysadmin) completes the approval.
  await approvals.approve(approvalInstanceId!, APPROVER, ['FINANCE_OFFICER'], orgId, 'approved');
  expect(await approvals.isFullyApproved(approvalInstanceId!)).toBe(true);

  // 3d. Re-submitting now consumes the approved instance and the transition proceeds.
  const submitted = await manualJournals.submit(identity(PREPARER, ['FINANCE_OFFICER', 'SYSTEM_ADMINISTRATOR']), draft.id);
  expect(submitted.status).toBe('SUBMITTED');

  const consumed = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId! } });
  expect(consumed.status).toBe('CANCELLED'); // markInstanceConsumed uses CANCELLED as the terminal "consumed" state
});
