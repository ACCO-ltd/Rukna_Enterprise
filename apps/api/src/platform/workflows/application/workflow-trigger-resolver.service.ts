import { Injectable } from '@nestjs/common';
import { WorkflowTriggerBinding, WorkflowDefinition } from '@prisma/client';

import { TenancyService } from '../../tenancy/tenancy.service.js';

export type ResolvedBinding = WorkflowTriggerBinding & { definition: WorkflowDefinition };

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
  ): Promise<ResolvedBinding | null> {
    const prisma = this.tenancyService.getClient();

    const candidates = await prisma.workflowTriggerBinding.findMany({
      where: {
        triggerKind: 'DOCUMENT',
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      include: { definition: true },
      orderBy: { priority: 'desc' },
    });

    // Step 1: org-specific + exact transactionType
    const s1 = candidates.find(
      (b) => b.organizationId === organizationId && b.transactionType === transactionType,
    );
    if (s1) return s1 as ResolvedBinding;

    // Step 2: org-specific + catch-all document binding
    const s2 = candidates.find(
      (b) => b.organizationId === organizationId && b.transactionType === null,
    );
    if (s2) return s2 as ResolvedBinding;

    // Step 3: tenant-default + exact transactionType
    const s3 = candidates.find(
      (b) => b.organizationId === null && b.transactionType === transactionType,
    );
    if (s3) return s3 as ResolvedBinding;

    // Step 4: tenant-default + catch-all
    const s4 = candidates.find(
      (b) => b.organizationId === null && b.transactionType === null,
    );
    return (s4 as ResolvedBinding) ?? null;
  }

  /**
   * Resolves the highest-priority active STATE_TRANSITION binding for a given org and transition.
   * Returns null when no binding is found — callers treat this as "no DoA required".
   *
   * 4-step priority order:
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
  ): Promise<ResolvedBinding | null> {
    const prisma = this.tenancyService.getClient();

    const candidates = await prisma.workflowTriggerBinding.findMany({
      where: {
        triggerKind: 'STATE_TRANSITION',
        entityType,
        isActive: true,
        OR: [{ organizationId }, { organizationId: null }],
      },
      include: { definition: true },
      orderBy: { priority: 'desc' },
    });

    // Step 1: org-specific + exact fromState + toState
    const s1 = candidates.find(
      (b) =>
        b.organizationId === organizationId &&
        b.fromState === fromState &&
        b.toState === toState,
    );
    if (s1) return s1 as ResolvedBinding;

    // Step 2: org-specific + toState only (any source state)
    const s2 = candidates.find(
      (b) =>
        b.organizationId === organizationId &&
        b.fromState === null &&
        b.toState === toState,
    );
    if (s2) return s2 as ResolvedBinding;

    // Step 3: tenant-default + exact fromState + toState
    const s3 = candidates.find(
      (b) =>
        b.organizationId === null &&
        b.fromState === fromState &&
        b.toState === toState,
    );
    if (s3) return s3 as ResolvedBinding;

    // Step 4: tenant-default + toState only
    const s4 = candidates.find(
      (b) => b.organizationId === null && b.fromState === null && b.toState === toState,
    );
    return (s4 as ResolvedBinding) ?? null;
  }
}
