/**
 * Governance test fixtures for procurement DB specs: an active STATE_TRANSITION binding (ADR-011
 * seam), active SoD rules (ADR-022), approving an instance as a distinct person, and cleanup.
 */
import type { PrismaClient } from '@prisma/client';
import type { WorkflowTransactionType } from '@erp/types';

export async function addTransitionBinding(
  prisma: PrismaClient,
  orgId: string,
  opts: { entityType: string; transactionType: WorkflowTransactionType; fromState: string; toState: string },
) {
  const def = await prisma.workflowDefinition.create({
    data: {
      organizationId: orgId,
      transactionType: opts.transactionType,
      name: `${opts.entityType} gate ${orgId}`,
      isActive: true,
      requiresCeoConfirmation: false,
      steps: { create: [{ stepOrder: 1, roleRequired: 'Procurement Manager', isOptional: false, notifyRoles: [] }] },
    },
  });
  return prisma.workflowTriggerBinding.create({
    data: {
      organizationId: orgId,
      triggerKind: 'STATE_TRANSITION',
      entityType: opts.entityType,
      transactionType: opts.transactionType,
      fromState: opts.fromState,
      toState: opts.toState,
      workflowDefinitionId: def.id,
      priority: 50,
      isActive: true,
    },
  });
}

/** Marks an approval instance APPROVED by `approverId`, as a completed one-step chain would. */
export async function approveInstance(prisma: PrismaClient, instanceId: string, approverId: string) {
  await prisma.approvalAction.create({
    data: { instanceId, stepOrder: 1, action: 'APPROVE', actorId: approverId },
  });
  await prisma.approvalInstance.update({ where: { id: instanceId }, data: { status: 'APPROVED' } });
}

/** Activates the named SoD rule codes for the org under an ACTIVE policy version. */
export async function activateSodRules(prisma: PrismaClient, orgId: string, codes: string[]) {
  const policy = await prisma.workflowPolicyVersion.create({
    data: {
      organizationId: orgId,
      policyKey: `TEST_SOD_${orgId}`,
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2020-01-01'),
    },
  });
  await prisma.segregationOfDutiesRule.createMany({
    data: codes.map((code) => ({
      organizationId: orgId,
      workflowPolicyVersionId: policy.id,
      code,
      description: code,
      isActive: true,
    })),
  });
}

export async function cleanupGovernance(prisma: PrismaClient, orgId: string) {
  await prisma.$executeRaw`DELETE FROM approval_actions WHERE instance_id IN (SELECT ai.id FROM approval_instances ai JOIN workflow_definitions wd ON ai.workflow_definition_id = wd.id WHERE wd.organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM approval_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM workflow_trigger_bindings WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM segregation_of_duties_rules WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_policy_versions WHERE organization_id = ${orgId}`;
}
