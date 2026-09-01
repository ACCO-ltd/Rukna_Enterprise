import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../tenancy/tenancy.service.js';
import { WorkflowTransactionType } from '@erp/types';
import { randomUUID } from 'node:crypto';

@Injectable()
export class WorkflowsPrismaRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findDefinitionByType(organizationId: string, transactionType: WorkflowTransactionType) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowDefinition.findFirst({
      where: { organizationId, transactionType, isActive: true },
      include: { conditions: true, steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  async findDefinitionById(id: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowDefinition.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  /**
   * Every trigger binding visible to an organization — its own plus the tenant-defaults
   * (organizationId = null) — with the definition (and its steps) each one routes to. This is
   * the read model behind the governance-configuration view: what is wired, and what is active.
   */
  async findBindingsForOrg(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowTriggerBinding.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
      orderBy: [{ entityType: 'asc' }, { priority: 'desc' }],
    });
  }

  /** Governance-policy inventory for the administration workspace. */
  async findPolicyVersionsForOrg(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowPolicyVersion.findMany({
      where: { organizationId },
      include: { _count: { select: { rules: true } } },
      orderBy: [{ policyKey: 'asc' }, { version: 'desc' }],
    });
  }

  async createPolicyDraft(organizationId: string, policyKey: string, notes?: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const latest = await tx.workflowPolicyVersion.findFirst({
        where: { organizationId, policyKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.workflowPolicyVersion.create({
        data: {
          organizationId,
          policyKey,
          version: (latest?.version ?? 0) + 1,
          status: 'DRAFT',
          ...(notes ? { notes } : {}),
        },
        include: { _count: { select: { rules: true } } },
      });
    });
  }

  async addRuleToDraft(
    organizationId: string,
    policyId: string,
    data: { ruleKey: string; transactionType: WorkflowTransactionType; requiredRole: string; priority: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string },
  ) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const policy = await tx.workflowPolicyVersion.findFirst({
        where: { id: policyId, organizationId, status: 'DRAFT' }, select: { id: true },
      });
      if (!policy) return null;
      const role = await tx.role.findFirst({
        where: { organizationId, name: data.requiredRole }, select: { id: true },
      });
      if (!role) return 'ROLE_NOT_FOUND' as const;
      return tx.workflowPolicyRule.create({
        data: {
          workflowPolicyVersionId: policy.id,
          ruleKey: data.ruleKey,
          transactionType: data.transactionType,
          priority: data.priority,
          status: 'PENDING',
          configuration: { requiredRole: data.requiredRole, minAmount: data.minAmount ?? null, maxAmount: data.maxAmount ?? null, fromState: data.fromState ?? null, toState: data.toState ?? null },
        },
      });
    });
  }

  async findDraftWithRules(organizationId: string, policyId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowPolicyVersion.findFirst({
      where: { id: policyId, organizationId, status: 'DRAFT' },
      include: { rules: { orderBy: [{ priority: 'asc' }, { ruleKey: 'asc' }] } },
    });
  }

  async updateDraftRule(organizationId: string, policyId: string, ruleId: string, actorUserId: string, data: { requiredRole: string; priority: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const rule = await tx.workflowPolicyRule.findFirst({ where: { id: ruleId, workflowPolicyVersionId: policyId, policyVersion: { organizationId, status: 'DRAFT' } } });
      if (!rule) return null;
      const updated = await tx.workflowPolicyRule.update({ where: { id: ruleId }, data: { priority: data.priority, configuration: { ...(rule.configuration as object), requiredRole: data.requiredRole, minAmount: data.minAmount ?? null, maxAmount: data.maxAmount ?? null, fromState: data.fromState ?? null, toState: data.toState ?? null } } });
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: 'APPROVAL_POLICY_RULE_UPDATED', resource: 'workflow-policy-rule', resourceId: ruleId, before: { priority: rule.priority }, after: { priority: data.priority }, sourceCommand: 'workflow-policy.rule.update' } });
      await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy-rule', aggregateId: ruleId, eventType: 'APPROVAL_POLICY_RULE_UPDATED', idempotencyKey: randomUUID(), payload: { policyId, ruleId } } });
      return updated;
    });
  }

  async deleteDraftRule(organizationId: string, policyId: string, ruleId: string, actorUserId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const rule = await tx.workflowPolicyRule.findFirst({ where: { id: ruleId, workflowPolicyVersionId: policyId, policyVersion: { organizationId, status: 'DRAFT' } } });
      if (!rule) return false;
      await tx.workflowPolicyRule.delete({ where: { id: ruleId } });
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: 'APPROVAL_POLICY_RULE_DELETED', resource: 'workflow-policy-rule', resourceId: ruleId, before: { ruleKey: rule.ruleKey }, sourceCommand: 'workflow-policy.rule.delete' } });
      await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy-rule', aggregateId: ruleId, eventType: 'APPROVAL_POLICY_RULE_DELETED', idempotencyKey: randomUUID(), payload: { policyId, ruleId } } });
      return true;
    });
  }

  async reorderDraftRules(organizationId: string, policyId: string, ruleIds: string[], actorUserId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const rules = await tx.workflowPolicyRule.findMany({ where: { workflowPolicyVersionId: policyId, policyVersion: { organizationId, status: 'DRAFT' } }, select: { id: true } });
      if (rules.length !== ruleIds.length || new Set(ruleIds).size !== ruleIds.length || !ruleIds.every((id) => rules.some((rule) => rule.id === id))) return false;
      await Promise.all(ruleIds.map((id, index) => tx.workflowPolicyRule.update({ where: { id }, data: { priority: index + 1 } })));
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: 'APPROVAL_POLICY_RULES_REORDERED', resource: 'workflow-policy', resourceId: policyId, after: { ruleIds }, sourceCommand: 'workflow-policy.rules.reorder' } });
      await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy', aggregateId: policyId, eventType: 'APPROVAL_POLICY_RULES_REORDERED', idempotencyKey: randomUUID(), payload: { policyId, ruleIds } } });
      return true;
    });
  }

  async findRoleNames(organizationId: string, names: string[]) {
    const prisma = this.tenancyService.getClient();
    if (names.length === 0) return [];
    const roles = await prisma.role.findMany({ where: { organizationId, name: { in: names } }, select: { name: true } });
    return roles.map((role) => role.name);
  }

  async findPolicyWithRules(organizationId: string, policyId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowPolicyVersion.findFirst({ where: { id: policyId, organizationId }, include: { rules: { orderBy: [{ priority: 'asc' }, { ruleKey: 'asc' }] } } });
  }

  async findPolicyHistory(organizationId: string, policyId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.auditLog.findMany({ where: { orgId: organizationId, resourceId: policyId, resource: { in: ['workflow-policy', 'workflow-policy-rule'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, action: true, reason: true, createdAt: true, userId: true, after: true } });
  }

  async listPolicySodRules(organizationId: string, policyId: string) { const prisma = this.tenancyService.getClient(); return prisma.segregationOfDutiesRule.findMany({ where: { organizationId, workflowPolicyVersionId: policyId }, orderBy: { code: 'asc' } }); }

  async upsertDraftPolicySodRule(organizationId: string, policyId: string, actorUserId: string, data: { code: string; description: string; isActive: boolean }) {
    const prisma = this.tenancyService.getClient(); return prisma.$transaction(async (tx) => {
      const policy = await tx.workflowPolicyVersion.findFirst({ where: { id: policyId, organizationId, status: 'DRAFT' }, select: { id: true } }); if (!policy) return null;
      const rule = await tx.segregationOfDutiesRule.upsert({ where: { organizationId_code: { organizationId, code: data.code } }, create: { organizationId, workflowPolicyVersionId: policyId, ...data }, update: { description: data.description, isActive: data.isActive, workflowPolicyVersionId: policyId } });
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: 'APPROVAL_POLICY_SOD_CONFIGURED', resource: 'workflow-policy', resourceId: policyId, after: { code: data.code, isActive: data.isActive }, sourceCommand: 'workflow-policy.sod.upsert' } }); await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy', aggregateId: policyId, eventType: 'APPROVAL_POLICY_SOD_CONFIGURED', idempotencyKey: randomUUID(), payload: { policyId, code: data.code } }); return rule;
    }); }

  async clonePolicyToDraft(organizationId: string, policyId: string, actorUserId: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const source = await tx.workflowPolicyVersion.findFirst({ where: { id: policyId, organizationId }, include: { rules: true, segregationDutiesRules: true } });
      if (!source) return null;
      const latest = await tx.workflowPolicyVersion.findFirst({ where: { organizationId, policyKey: source.policyKey }, orderBy: { version: 'desc' }, select: { version: true } });
      const cloned = await tx.workflowPolicyVersion.create({ data: { organizationId, policyKey: source.policyKey, version: (latest?.version ?? source.version) + 1, status: 'DRAFT', amountBasis: source.amountBasis, notes: source.notes, rules: { create: source.rules.map((rule) => ({ ruleKey: rule.ruleKey, transactionType: rule.transactionType, entityType: rule.entityType, status: 'PENDING', priority: rule.priority, configuration: rule.configuration })) }, segregationDutiesRules: { create: source.segregationDutiesRules.map((rule) => ({ organizationId, code: `${rule.code}_V${(latest?.version ?? source.version) + 1}`, description: rule.description, isActive: false })) } } });
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: 'APPROVAL_POLICY_ROLLBACK_CLONED', resource: 'workflow-policy', resourceId: cloned.id, before: { sourcePolicyId: source.id }, after: { version: cloned.version }, reason, sourceCommand: 'workflow-policy.clone' } });
      await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy', aggregateId: cloned.id, eventType: 'APPROVAL_POLICY_ROLLBACK_CLONED', idempotencyKey: randomUUID(), payload: { sourcePolicyId: source.id, policyId: cloned.id } } });
      return cloned;
    });
  }

  async transitionPolicy(organizationId: string, policyId: string, actorUserId: string, from: string, to: string, reason: string, effectiveFrom?: Date) {
    const prisma = this.tenancyService.getClient();
    return prisma.$transaction(async (tx) => {
      const current = await tx.workflowPolicyVersion.findFirst({ where: { id: policyId, organizationId, status: from as never } });
      if (!current) return null;
      const now = new Date();
      const policy = await tx.workflowPolicyVersion.update({ where: { id: policyId }, data: {
        status: to as never,
        ...(to === 'IN_REVIEW' ? { submittedByUserId: actorUserId, submittedAt: now } : {}),
        ...(to === 'SCHEDULED' || to === 'ACTIVE' ? { reviewedByUserId: actorUserId, reviewedAt: now, reviewNotes: reason, approvedAt: now, ...(effectiveFrom ? { effectiveFrom } : {}) } : {}),
        ...(to === 'RETIRED' ? { effectiveTo: now, reviewNotes: reason } : {}),
      } });
      const audit = await tx.auditLog.create({ data: { userId: actorUserId, orgId: organizationId, action: `APPROVAL_POLICY_${to}`, resource: 'workflow-policy', resourceId: policyId, before: { status: from }, after: { status: to, effectiveFrom: policy.effectiveFrom?.toISOString() ?? null }, reason, sourceCommand: `workflow-policy.${to.toLowerCase()}` } });
      await tx.auditOutboxEvent.create({ data: { organizationId, auditLogId: audit.id, aggregateType: 'workflow-policy', aggregateId: policyId, eventType: `APPROVAL_POLICY_${to}`, idempotencyKey: randomUUID(), payload: { policyId, from, to, reason } } });
      return policy;
    });
  }

  async createInstance(data: {
    workflowDefinitionId: string;
    transactionType: WorkflowTransactionType | null;
    transactionId: string;
    initiatedBy: string;
    // ADR-007/022: immutable snapshot of why this chain was selected — the evaluated amount and
    // the binding whose band matched. Absent for amount-less (unranged) gates.
    evaluatedAmount?: Decimal | null;
    matchedPolicyId?: string | null;
    conditionSnapshot?: Prisma.InputJsonValue;
  }) {
    const prisma = this.tenancyService.getClient();
    const { conditionSnapshot, ...rest } = data;
    return prisma.approvalInstance.create({
      data: {
        ...rest,
        currentStepOrder: 1,
        ...(conditionSnapshot !== undefined ? { conditionSnapshot } : {}),
      },
    });
  }

  /** Most recent approval instance for a given transaction (loop-back lookup, ADR-015). */
  async findLatestInstanceForTransaction(
    transactionType: WorkflowTransactionType | null,
    transactionId: string,
  ) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.findFirst({
      where: { transactionId, transactionType },
      orderBy: { initiatedAt: 'desc' },
    });
  }

  /**
   * Marks an approval instance as consumed once its entity transition has been driven
   * through (ADR-015). There is no dedicated CONSUMED enum value yet — that needs a
   * Prisma client regen — so CANCELLED is the terminal "closed" state. The approver audit
   * trail lives in ApprovalAction rows, which are left intact.
   */
  async markInstanceConsumed(id: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.update({
      where: { id },
      data: { status: 'CANCELLED' as never },
    });
  }

  async findInstanceById(id: string, organizationId?: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.findFirst({
      where: { id, ...(organizationId ? { definition: { organizationId } } : {}) },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } }, actions: true },
    });
  }

  async updateInstanceStep(id: string, nextStepOrder: number, status: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.update({
      where: { id },
      data: { currentStepOrder: nextStepOrder, status: status as never },
    });
  }

  async recordAction(data: {
    instanceId: string;
    stepOrder: number;
    action: string;
    actorId: string;
    notes?: string;
  }) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalAction.create({ data: data as never });
  }
}
