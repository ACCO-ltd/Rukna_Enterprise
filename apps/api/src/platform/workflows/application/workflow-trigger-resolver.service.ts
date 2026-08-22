import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { WorkflowTriggerBinding, WorkflowDefinition } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { TenancyService } from '../../tenancy/tenancy.service.js';

export type ResolvedBinding = WorkflowTriggerBinding & { definition: WorkflowDefinition };

/**
 * ADR-022 CONST-DOA-005: does a binding's amount band contain this document's value?
 * An unranged binding (both bounds null) is a catch-all that matches any amount. A ranged
 * binding needs an amount to evaluate — without one it cannot match, so amount-less callers
 * keep the pre-threshold behaviour of only ever resolving catch-all bindings. The band is
 * half-open: minAmount inclusive, maxAmount exclusive.
 */
function bindingMatchesAmount(binding: WorkflowTriggerBinding, amount: Decimal | null): boolean {
  const min = binding.minAmount as Decimal | null;
  const max = binding.maxAmount as Decimal | null;
  if (min === null && max === null) return true;
  if (amount === null) return false;
  if (min !== null && amount.lessThan(min)) return false;
  if (max !== null && amount.greaterThanOrEqualTo(max)) return false;
  return true;
}

@Injectable()
export class WorkflowTriggerResolverService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Resolves the highest-priority active DOCUMENT binding for a given org and transaction type.
   * Returns null when no binding is found — callers treat this as "no DoA required".
   *
   * 4-step priority order (ADR-004 §WF-TRIGGER):
   *  1. org-specific + transactionType
   *  2. org-specific + transactionType = null (catch-all document binding)
   *  3. tenant-default (orgId = null) + transactionType
   *  4. tenant-default + transactionType = null
   */
  async resolveForDocument(
    organizationId: string,
    transactionType: string,
    amount: Decimal | null = null,
  ): Promise<ResolvedBinding | null> {
    const prisma = this.tenancyService.getClient();

    const all = await prisma.workflowTriggerBinding.findMany({
      where: {
        triggerKind: 'DOCUMENT',
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      include: { definition: true },
      orderBy: { priority: 'desc' },
    });
    // ADR-022 CONST-DOA-005: keep only the bindings whose amount band contains this document.
    const candidates = all.filter((b) => bindingMatchesAmount(b, amount));

    const s1 = candidates.find(
      (b) => b.organizationId === organizationId && b.transactionType === transactionType,
    );
    if (s1) return s1 as ResolvedBinding;

    const s2 = candidates.find(
      (b) => b.organizationId === organizationId && b.transactionType === null,
    );
    if (s2) return s2 as ResolvedBinding;

    const s3 = candidates.find(
      (b) => b.organizationId === null && b.transactionType === transactionType,
    );
    if (s3) return s3 as ResolvedBinding;

    const s4 = candidates.find(
      (b) => b.organizationId === null && b.transactionType === null,
    );
    return (s4 as ResolvedBinding) ?? null;
  }

  /**
   * Resolves the highest-priority active STATE_TRANSITION binding for a given org and transition.
   *
   * Step 0: Checks WorkflowRequirementPolicy for this entity/transition.
   *   - NONE:     returns null immediately — no workflow needed.
   *   - REQUIRED: binding must exist; throws if missing.
   *   - OPTIONAL: returns null if no binding (pass-through allowed).
   *
   * 4-step binding priority order:
   *  1. org-specific + fromState + toState (exact transition)
   *  2. org-specific + toState only (fromState = null, matches any source state)
   *  3. tenant-default + fromState + toState
   *  4. tenant-default + toState only
   */
  async resolveForStateTransition(
    organizationId: string,
    entityType: string,
    fromState: string,
    toState: string,
    amount: Decimal | null = null,
  ): Promise<ResolvedBinding | null> {
    const prisma = this.tenancyService.getClient();

    // Step 0: policy check
    const requirement = await this.getRequirement(prisma, organizationId, entityType, fromState, toState);

    if (requirement === 'NONE') {
      return null;
    }

    const all = await prisma.workflowTriggerBinding.findMany({
      where: {
        triggerKind: 'STATE_TRANSITION',
        entityType,
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      include: { definition: true },
      orderBy: { priority: 'desc' },
    });
    // ADR-022 CONST-DOA-005: within each precedence tier below, only bindings whose amount band
    // contains this document's value are eligible. Candidates stay priority-ordered, so the tier
    // `find`s still return the highest-priority match.
    const candidates = all.filter((b) => bindingMatchesAmount(b, amount));

    const s1 = candidates.find(
      (b) =>
        b.organizationId === organizationId &&
        b.fromState === fromState &&
        b.toState === toState,
    );
    if (s1) return s1 as ResolvedBinding;

    const s2 = candidates.find(
      (b) =>
        b.organizationId === organizationId &&
        b.fromState === null &&
        b.toState === toState,
    );
    if (s2) return s2 as ResolvedBinding;

    const s3 = candidates.find(
      (b) =>
        b.organizationId === null &&
        b.fromState === fromState &&
        b.toState === toState,
    );
    if (s3) return s3 as ResolvedBinding;

    const s4 = candidates.find(
      (b) => b.organizationId === null && b.fromState === null && b.toState === toState,
    );

    const binding = (s4 as ResolvedBinding) ?? null;

    if (!binding && requirement === 'REQUIRED') {
      throw new UnprocessableEntityException(
        `Workflow configuration required: no active binding found for ${entityType} ` +
        `transition '${fromState}' → '${toState}'. ` +
        `Activate the workflow binding in system configuration before proceeding.`,
      );
    }

    return binding;
  }

  private async getRequirement(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    entityType: string,
    fromState: string,
    toState: string,
  ): Promise<string> {
    const candidates = await prisma.workflowRequirementPolicy.findMany({
      where: {
        entityType,
        toState,
        AND: [
          { OR: [{ organizationId }, { organizationId: null }] },
          { OR: [{ fromState }, { fromState: null }] },
        ],
      },
    });

    // Priority: org-specific + exact fromState > org-specific + wildcard
    //           > tenant-default + exact > tenant-default + wildcard
    const s1 = candidates.find((p) => p.organizationId === organizationId && p.fromState === fromState);
    if (s1) return s1.requirement;

    const s2 = candidates.find((p) => p.organizationId === organizationId && p.fromState === null);
    if (s2) return s2.requirement;

    const s3 = candidates.find((p) => p.organizationId === null && p.fromState === fromState);
    if (s3) return s3.requirement;

    const s4 = candidates.find((p) => p.organizationId === null && p.fromState === null);
    return s4?.requirement ?? 'OPTIONAL';
  }
}
