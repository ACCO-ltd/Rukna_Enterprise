import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApprovalPolicyComparison,
  ApprovalPolicyRuleChange,
  ApprovalPolicyRuleFieldChange,
  ApprovalPolicyRuleSnapshot,
  ApprovalPolicySodDiff,
  ApprovalPolicyVersionHistory,
  ApprovalPolicyVersionSummary,
} from '@erp/types';
import { WorkflowTransactionType } from '@erp/types';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';
import { isApprovedPolicyTransaction, isSupportedPolicyTransition } from './policy-transition-registry.js';
import { GovernanceAuthoringConfig } from './governance-authoring.config.js';

type PolicyRuleConfiguration = { requiredRole?: unknown; minAmount?: unknown; maxAmount?: unknown; fromState?: unknown; toState?: unknown };
type DraftValidationIssue = { code: string; message: string; ruleId?: string; severity: 'ERROR' | 'WARNING' };

function configurationOf(value: unknown): PolicyRuleConfiguration {
  return value && typeof value === 'object' ? value as PolicyRuleConfiguration : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return optionalString(value) ?? null;
}

// SoD-rule codes are suffixed `_V<n>` when a version is cloned (see repository.clonePolicyToDraft),
// so the same control carries a different code per version. Strip the suffix to compare the same
// control across two versions.
function canonicalSodCode(code: string): string {
  return code.replace(/_V\d+$/, '');
}

function sortByRuleKey<T extends { ruleKey: string }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly repo: WorkflowsPrismaRepository,
    // ADR-027 rollout: the authoring surface ships behind a platform feature flag (default OFF).
    // Every write path below asserts it; reads do not.
    private readonly authoring: GovernanceAuthoringConfig,
  ) {}

  async getDefinitionForTransaction(organizationId: string, transactionType: WorkflowTransactionType) {
    const definition = await this.repo.findDefinitionByType(organizationId, transactionType);
    if (!definition) {
      throw new NotFoundException(
        `No active workflow definition for transaction type: ${transactionType}`,
      );
    }
    return definition;
  }

  async getStepsForDefinition(definitionId: string) {
    const definition = await this.repo.findDefinitionById(definitionId);
    if (!definition) throw new NotFoundException(`Workflow definition not found: ${definitionId}`);
    return definition.steps;
  }

  /**
   * The governance configuration an organization is subject to: every trigger binding (its own
   * plus tenant-defaults) with the definition it routes to. Read-only — activation stays a
   * deliberate act, not a UI toggle, until ACCO confirms the policy (ADR-007).
   */
  async listBindings(organizationId: string) {
    return this.repo.findBindingsForOrg(organizationId);
  }

  async listPolicyVersions(organizationId: string) {
    const policies = await this.repo.findPolicyVersionsForOrg(organizationId);
    return policies.map((policy) => ({
      id: policy.id,
      policyKey: policy.policyKey,
      version: policy.version,
      status: policy.status,
      effectiveFrom: policy.effectiveFrom,
      effectiveTo: policy.effectiveTo,
      amountBasis: policy.amountBasis,
      notes: policy.notes,
      ruleCount: policy._count.rules,
      updatedAt: policy.updatedAt,
    }));
  }

  /**
   * Every version of a single policyKey for the org (item 3 read model backing the version-history
   * view). Ordered newest version first by the repository.
   */
  async listPolicyVersionsByKey(organizationId: string, policyKey: string): Promise<ApprovalPolicyVersionHistory> {
    const key = policyKey.trim();
    const versions = await this.repo.findPolicyVersionsByKey(organizationId, key);
    if (versions.length === 0) throw new NotFoundException(`No policy versions found for key "${key}"`);
    return { policyKey: key, versions: versions.map((version) => this.toVersionSummary(version)) };
  }

  /**
   * Rule- and SoD-level diff of two versions of the SAME policyKey (item 3). Backs the
   * version-comparison view and the rollback preview: to preview a rollback, compare the current
   * active version as `base` against the version being rolled back to as `target`.
   */
  async comparePolicyVersions(organizationId: string, baseId: string, targetId: string): Promise<ApprovalPolicyComparison> {
    if (baseId === targetId) throw new BadRequestException('Provide two different policy versions to compare');
    const loaded = await this.repo.findPolicyVersionsForComparison(organizationId, [baseId, targetId]);
    const base = loaded.find((version) => version.id === baseId);
    const target = loaded.find((version) => version.id === targetId);
    if (!base || !target) throw new NotFoundException('One or both policy versions were not found');
    if (base.policyKey !== target.policyKey) {
      throw new BadRequestException('Only versions of the same policy can be compared');
    }

    const baseRules = new Map(base.rules.map((rule) => [rule.ruleKey, this.toRuleSnapshot(rule)]));
    const targetRules = new Map(target.rules.map((rule) => [rule.ruleKey, this.toRuleSnapshot(rule)]));

    const added: ApprovalPolicyRuleSnapshot[] = [];
    const removed: ApprovalPolicyRuleSnapshot[] = [];
    const changed: ApprovalPolicyRuleChange[] = [];

    for (const [ruleKey, targetSnapshot] of targetRules) {
      const baseSnapshot = baseRules.get(ruleKey);
      if (!baseSnapshot) { added.push(targetSnapshot); continue; }
      const changes = this.diffRuleSnapshots(baseSnapshot, targetSnapshot);
      if (changes.length > 0) changed.push({ ruleKey, changes });
    }
    for (const [ruleKey, baseSnapshot] of baseRules) {
      if (!targetRules.has(ruleKey)) removed.push(baseSnapshot);
    }

    return {
      policyKey: base.policyKey,
      base: this.toVersionSummary(base),
      target: this.toVersionSummary(target),
      rules: {
        added: sortByRuleKey(added),
        removed: sortByRuleKey(removed),
        changed: [...changed].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey)),
      },
      sodRules: this.diffSodRules(base.segregationDutiesRules, target.segregationDutiesRules),
    };
  }

  private toVersionSummary(version: {
    id: string; policyKey: string; version: number; status: string;
    effectiveFrom: Date | null; effectiveTo: Date | null; createdAt: Date; updatedAt: Date;
    _count: { rules: number };
  }): ApprovalPolicyVersionSummary {
    return {
      id: version.id,
      policyKey: version.policyKey,
      version: version.version,
      status: version.status as ApprovalPolicyVersionSummary['status'],
      ruleCount: version._count.rules,
      effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
      effectiveTo: version.effectiveTo?.toISOString() ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    };
  }

  private toRuleSnapshot(rule: { ruleKey: string; transactionType: string | null; priority: number; configuration: unknown }): ApprovalPolicyRuleSnapshot {
    const config = configurationOf(rule.configuration);
    return {
      ruleKey: rule.ruleKey,
      transactionType: rule.transactionType ?? null,
      priority: rule.priority,
      requiredRole: nullableString(config.requiredRole),
      minAmount: nullableString(config.minAmount),
      maxAmount: nullableString(config.maxAmount),
      fromState: nullableString(config.fromState),
      toState: nullableString(config.toState),
    };
  }

  private diffRuleSnapshots(base: ApprovalPolicyRuleSnapshot, target: ApprovalPolicyRuleSnapshot): ApprovalPolicyRuleFieldChange[] {
    const fields: ApprovalPolicyRuleFieldChange['field'][] = ['transactionType', 'priority', 'requiredRole', 'minAmount', 'maxAmount', 'fromState', 'toState'];
    const changes: ApprovalPolicyRuleFieldChange[] = [];
    for (const field of fields) {
      if (base[field] !== target[field]) changes.push({ field, base: base[field], target: target[field] });
    }
    return changes;
  }

  private diffSodRules(
    baseRules: { code: string; description: string; isActive: boolean }[],
    targetRules: { code: string; description: string; isActive: boolean }[],
  ): ApprovalPolicySodDiff[] {
    const baseByCode = new Map(baseRules.map((rule) => [canonicalSodCode(rule.code), { description: rule.description, isActive: rule.isActive }]));
    const targetByCode = new Map(targetRules.map((rule) => [canonicalSodCode(rule.code), { description: rule.description, isActive: rule.isActive }]));
    const codes = [...new Set([...baseByCode.keys(), ...targetByCode.keys()])].sort();
    const diffs: ApprovalPolicySodDiff[] = [];
    for (const code of codes) {
      const base = baseByCode.get(code) ?? null;
      const target = targetByCode.get(code) ?? null;
      if (base && target && base.description === target.description && base.isActive === target.isActive) continue;
      diffs.push({ code, base, target });
    }
    return diffs;
  }

  async createPolicyDraft(organizationId: string, dto: { policyKey: string; notes?: string }) {
    this.authoring.assertEnabled();
    try {
      return await this.repo.createPolicyDraft(
        organizationId,
        dto.policyKey.trim(),
        dto.notes?.trim(),
      );
    } catch (error) {
      // Concurrent draft creation is resolved by the DB's (organization, key, version) constraint.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('A policy version was created concurrently; retry the request');
      }
      throw error;
    }
  }

  async addRuleToDraft(
    organizationId: string,
    policyId: string,
    dto: { ruleKey: string; transactionType: WorkflowTransactionType; requiredRole: string; priority?: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string },
  ) {
    this.authoring.assertEnabled();
    if (!isApprovedPolicyTransaction(dto.transactionType) || !isSupportedPolicyTransition(dto.transactionType, dto.fromState, dto.toState)) {
      throw new BadRequestException('This transaction and lifecycle transition are not approved for ACCO policy authoring');
    }
    const result = await this.repo.addRuleToDraft(organizationId, policyId, {
      ruleKey: dto.ruleKey.trim(), transactionType: dto.transactionType,
      requiredRole: dto.requiredRole.trim(), priority: dto.priority ?? 0,
      minAmount: dto.minAmount, maxAmount: dto.maxAmount, fromState: dto.fromState, toState: dto.toState,
    });
    if (result === null) throw new NotFoundException('Draft policy not found');
    if (result === 'ROLE_NOT_FOUND') throw new ConflictException('The required role is not available in this organization');
    return result;
  }

  async updateDraftRule(organizationId: string, policyId: string, ruleId: string, actorUserId: string, dto: { requiredRole: string; priority: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }) {
    this.authoring.assertEnabled();
    const draft = await this.repo.findDraftWithRules(organizationId, policyId);
    const rule = draft?.rules.find((candidate) => candidate.id === ruleId);
    if (!rule?.transactionType || !isApprovedPolicyTransaction(rule.transactionType as WorkflowTransactionType) || !isSupportedPolicyTransition(rule.transactionType as WorkflowTransactionType, dto.fromState, dto.toState)) {
      throw new BadRequestException('This transaction and lifecycle transition are not approved for ACCO policy authoring');
    }
    const result = await this.repo.updateDraftRule(organizationId, policyId, ruleId, actorUserId, dto);
    if (!result) throw new ConflictException('Rules can only be changed in the current draft');
    return result;
  }

  async deleteDraftRule(organizationId: string, policyId: string, ruleId: string, actorUserId: string) {
    this.authoring.assertEnabled();
    if (!await this.repo.deleteDraftRule(organizationId, policyId, ruleId, actorUserId)) throw new ConflictException('Rules can only be deleted from the current draft');
  }

  async reorderDraftRules(organizationId: string, policyId: string, actorUserId: string, ruleIds: string[]) {
    this.authoring.assertEnabled();
    if (!await this.repo.reorderDraftRules(organizationId, policyId, ruleIds, actorUserId)) throw new ConflictException('The order must contain every rule in the current draft exactly once');
  }

  async validateDraft(organizationId: string, policyId: string) {
    const draft = await this.repo.findDraftWithRules(organizationId, policyId);
    if (!draft) throw new NotFoundException('Draft policy not found');
    const issues: DraftValidationIssue[] = [];
    if (draft.rules.length === 0) {
      issues.push({ code: 'EMPTY_CHAIN', message: 'A policy draft requires at least one approval rule', severity: 'ERROR' });
    }
    const requiredRoles = draft.rules.map((rule) => optionalString(configurationOf(rule.configuration).requiredRole)).filter((role): role is string => Boolean(role));
    const availableRoles = new Set(await this.repo.findRoleNames(organizationId, [...new Set(requiredRoles)]));
    const seen = new Set<string>();
    for (const rule of draft.rules) {
      const config = configurationOf(rule.configuration);
      const requiredRole = optionalString(config.requiredRole);
      if (!requiredRole || !availableRoles.has(requiredRole)) issues.push({ code: 'MISSING_ROLE', message: `The required role ${requiredRole ?? 'is not configured'} is unavailable`, ruleId: rule.id, severity: 'ERROR' });
      if (requiredRole === 'SYSTEM_ADMINISTRATOR') issues.push({ code: 'SOD_CONFLICT', message: 'System Administrator cannot be an approval role for a business transaction', ruleId: rule.id, severity: 'ERROR' });
      const identity = `${rule.transactionType ?? 'NONE'}:${rule.priority}`;
      if (seen.has(identity)) {
        issues.push({ code: 'DUPLICATE_PRIORITY', message: 'Two rules share the same transaction type and priority', ruleId: rule.id, severity: 'ERROR' });
      }
      seen.add(identity);
      const fromState = optionalString(config.fromState); const toState = optionalString(config.toState);
      if (!rule.transactionType || !isSupportedPolicyTransition(rule.transactionType as WorkflowTransactionType, fromState, toState)) issues.push({ code: 'INVALID_LIFECYCLE', message: 'The transaction type and lifecycle transition are not a supported combination', ruleId: rule.id, severity: 'ERROR' });
      const minimum = optionalString(config.minAmount); const maximum = optionalString(config.maxAmount);
      if (minimum && maximum && Number(minimum) >= Number(maximum)) issues.push({ code: 'INVALID_AMOUNT_BAND', message: 'The minimum amount must be below the maximum amount', ruleId: rule.id, severity: 'ERROR' });
    }
    for (let i = 0; i < draft.rules.length; i += 1) for (let j = i + 1; j < draft.rules.length; j += 1) {
      const a = draft.rules[i]; const b = draft.rules[j]; const ac = configurationOf(a.configuration); const bc = configurationOf(b.configuration);
      if (a.transactionType !== b.transactionType || optionalString(ac.fromState) !== optionalString(bc.fromState) || optionalString(ac.toState) !== optionalString(bc.toState)) continue;
      const amin = Number(optionalString(ac.minAmount) ?? '-Infinity'); const amax = Number(optionalString(ac.maxAmount) ?? 'Infinity');
      const bmin = Number(optionalString(bc.minAmount) ?? '-Infinity'); const bmax = Number(optionalString(bc.maxAmount) ?? 'Infinity');
      if (amin < bmax && bmin < amax) issues.push({ code: 'OVERLAPPING_AMOUNT_BAND', message: 'This rule overlaps another amount band for the same transaction and transition', ruleId: b.id, severity: 'ERROR' });
    }
    return { valid: issues.length === 0, issues, ruleCount: draft.rules.length };
  }

  async simulateDraft(organizationId: string, policyId: string, input: { transactionType: WorkflowTransactionType; amount?: string; fromState?: string; toState?: string }) {
    const draft = await this.repo.findDraftWithRules(organizationId, policyId);
    if (!draft) throw new NotFoundException('Draft policy not found');
    const amount = input.amount === undefined ? undefined : Number(input.amount);
    const evaluations = draft.rules.map((rule) => {
      const reasons: string[] = [];
      if (rule.transactionType !== input.transactionType) reasons.push('Transaction type does not match');
      const config = configurationOf(rule.configuration); const min = optionalString(config.minAmount); const max = optionalString(config.maxAmount);
      if (amount !== undefined && min && amount < Number(min)) reasons.push(`Amount is below ${min}`);
      if (amount !== undefined && max && amount >= Number(max)) reasons.push(`Amount is at or above ${max}`);
      const from = optionalString(config.fromState); const to = optionalString(config.toState);
      if (from && from !== input.fromState) reasons.push(`From state must be ${from}`);
      if (to && to !== input.toState) reasons.push(`To state must be ${to}`);
      return { rule, reasons };
    });
    const matches = evaluations.filter((evaluation) => evaluation.reasons.length === 0).map(({ rule }) => ({ ruleId: rule.id, ruleKey: rule.ruleKey, priority: rule.priority, requiredRole: optionalString(configurationOf(rule.configuration).requiredRole) ?? null })).sort((a, b) => a.priority - b.priority || a.ruleKey.localeCompare(b.ruleKey));
    const ambiguous = matches.some((match, index) => index > 0 && match.priority === matches[index - 1].priority);
    return { policy: { id: draft.id, policyKey: draft.policyKey, version: draft.version }, input, matched: matches.length > 0, ambiguous, roleChain: matches, rejectedRules: evaluations.filter((evaluation) => evaluation.reasons.length > 0).map(({ rule, reasons }) => ({ ruleId: rule.id, ruleKey: rule.ruleKey, reasons })), notice: 'Simulation only. No approval instance or transaction was created.' };
  }

  async submitForReview(organizationId: string, policyId: string, actorUserId: string, reason: string) {
    this.authoring.assertEnabled();
    const validation = await this.validateDraft(organizationId, policyId);
    if (!validation.valid) throw new BadRequestException({ message: 'Draft validation failed', issues: validation.issues });
    const policy = await this.repo.transitionPolicy(organizationId, policyId, actorUserId, 'DRAFT', 'IN_REVIEW', reason);
    if (!policy) throw new ConflictException('Only a valid draft can be submitted for review');
    return policy;
  }

  async schedulePolicy(organizationId: string, policyId: string, actorUserId: string, reason: string, effectiveFrom: Date) {
    this.authoring.assertEnabled();
    const current = await this.repo.findPolicyWithRules(organizationId, policyId);
    if (!current) throw new NotFoundException('Policy not found');
    if (current.submittedByUserId === actorUserId) throw new ConflictException('The policy submitter cannot publish the same version');
    if (effectiveFrom <= new Date()) throw new BadRequestException('The scheduled effective date must be in the future');
    const policy = await this.repo.transitionPolicy(organizationId, policyId, actorUserId, 'IN_REVIEW', 'SCHEDULED', reason, effectiveFrom);
    if (!policy) throw new ConflictException('Only a policy in review can be scheduled');
    return policy;
  }

  async activatePolicy(organizationId: string, policyId: string, actorUserId: string, reason: string, effectiveFrom?: Date) {
    this.authoring.assertEnabled();
    const current = await this.repo.findPolicyWithRules(organizationId, policyId);
    if (!current) throw new NotFoundException('Policy not found');
    const date = effectiveFrom ?? current.effectiveFrom;
    if (!date || date > new Date()) throw new BadRequestException('A due effective date is required before activation');
    const policy = await this.repo.transitionPolicy(organizationId, policyId, actorUserId, 'SCHEDULED', 'ACTIVE', reason, date);
    if (!policy) throw new ConflictException('Only a due scheduled policy can be activated');
    return policy;
  }

  async retirePolicy(organizationId: string, policyId: string, actorUserId: string, reason: string) {
    this.authoring.assertEnabled();
    const policy = await this.repo.transitionPolicy(organizationId, policyId, actorUserId, 'ACTIVE', 'RETIRED', reason);
    if (!policy) throw new ConflictException('Only an active policy can be retired');
    return policy;
  }

  async getPolicyWithRules(organizationId: string, policyId: string) {
    const policy = await this.repo.findPolicyWithRules(organizationId, policyId);
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  async getPolicyHistory(organizationId: string, policyId: string) { return this.repo.findPolicyHistory(organizationId, policyId); }

  async listPolicySodRules(organizationId: string, policyId: string) { if (!await this.repo.findPolicyWithRules(organizationId, policyId)) throw new NotFoundException('Policy not found'); return this.repo.listPolicySodRules(organizationId, policyId); }
  async upsertDraftPolicySodRule(organizationId: string, policyId: string, actorUserId: string, dto: { code: string; description: string; isActive: boolean }) { this.authoring.assertEnabled(); const rule = await this.repo.upsertDraftPolicySodRule(organizationId, policyId, actorUserId, dto); if (!rule) throw new ConflictException('SoD rules can only be changed in a draft policy'); return rule; }

  async clonePolicyToDraft(organizationId: string, policyId: string, actorUserId: string, reason: string) {
    this.authoring.assertEnabled();
    const policy = await this.repo.clonePolicyToDraft(organizationId, policyId, actorUserId, reason);
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }
}
