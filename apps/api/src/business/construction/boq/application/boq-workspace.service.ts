import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { BoqNode, BoqVersion } from '@prisma/client';
import {
  PERMISSIONS,
  type BoqCompareResponse,
  type BoqNodeChange,
  type BoqChangeKind,
  type BoqVersionSummary,
  type BoqWorkspaceResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { formatAmount, sumAmounts, toDecimal } from '../domain/boq-money.js';
import { evaluateReadiness } from '../domain/boq-readiness.policy.js';
import { BoqVersioningService } from './boq-versioning.service.js';

/**
 * Read models for the BOQ workspace — the deep query and the version diff.
 *
 * Separate from `BoqTreeService` and `BoqVersioningService` on purpose: those own writes and
 * invariants, this owns presentation-shaped reads. Mixing them is how a query starts
 * enforcing a rule slightly differently from the command next to it.
 */
@Injectable()
export class BoqWorkspaceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
    private readonly versioning: BoqVersioningService,
  ) {}

  /**
   * Everything the workspace screen needs, in one response.
   *
   * The screen previously assembled this from `GET /boq`, `GET /projects/:id`, and one tree
   * fetch per version, then derived pricing completeness and readiness itself — which meant
   * the Baseline button's enabled state was a second, divergent implementation of the rule
   * the server enforces.
   */
  async getWorkspace(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<BoqWorkspaceResponse> {
    const prisma = this.tenancyService.getClient();
    const canViewCommercials = identity.permissions.includes(PERMISSIONS.boqView);
    const capabilities = {
      canView: canViewCommercials,
      canManage: identity.permissions.includes(PERMISSIONS.boqManage),
      canBaseline: identity.permissions.includes(PERMISSIONS.boqBaseline),
      canViewCommercials,
    };

    const boq = await this.repo.findByProject(prisma, projectId);
    if (!boq || boq.organizationId !== identity.activeOrganizationId) {
      // A project with no BOQ is a legitimate starting state, not a failure — the screen
      // renders the "not initialized" case from this.
      return {
        projectId,
        boq: null,
        currency: 'USD',
        draft: null,
        approved: null,
        contractBaseline: null,
        versions: [],
        readiness: null,
        revision: null,
        capabilities,
      };
    }

    // One query for every node across every version, rather than one round trip per version.
    const nodes = await prisma.boqNode.findMany({
      where: { versionId: { in: boq.versions.map((version) => version.id) } },
    });
    const byVersion = new Map<string, BoqNode[]>();
    for (const node of nodes) {
      const bucket = byVersion.get(node.versionId);
      if (bucket) bucket.push(node);
      else byVersion.set(node.versionId, [node]);
    }

    // Every contract references a baselined version (boqVersionId is required), so the
    // most recent one names the Contract Baseline. It may be older than `approved` — a
    // revision can be baselined without the contract moving to it, and conflating the two
    // is how a screen shows a client the wrong contractual scope.
    const contract = await prisma.contract.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { boqVersionId: true },
    });

    const summaries = boq.versions.map((version) =>
      this.summarise(version, byVersion.get(version.id) ?? [], contract?.boqVersionId ?? null),
    );
    const find = (id: string | null) =>
      id ? (summaries.find((summary) => summary.id === id) ?? null) : null;

    const draft = find(boq.currentDraftVersionId);
    const approved = find(boq.currentApprovedVersionId);
    const subject = draft ?? approved;

    const readiness = subject
      ? evaluateReadiness(byVersion.get(subject.id) ?? [], {
          boqCurrency: boq.currency,
          isPostAward: boq.originalBaselineVersionId !== null,
          enforceVariationOrigin: false,
        })
      : null;

    return {
      projectId,
      boq: {
        id: boq.id,
        projectId: boq.projectId,
        organizationId: boq.organizationId,
        currency: boq.currency,
        originalBaselineVersionId: boq.originalBaselineVersionId ?? undefined,
        currentApprovedVersionId: boq.currentApprovedVersionId ?? undefined,
        currentDraftVersionId: boq.currentDraftVersionId ?? undefined,
        createdAt: boq.createdAt.toISOString(),
        updatedAt: boq.updatedAt.toISOString(),
        versions: summaries,
      },
      currency: boq.currency,
      draft: this.redact(draft, canViewCommercials),
      approved: this.redact(approved, canViewCommercials),
      contractBaseline: this.redact(find(contract?.boqVersionId ?? null), canViewCommercials),
      versions: summaries.map((summary) => this.redact(summary, canViewCommercials)!),
      readiness:
        readiness && canViewCommercials
          ? readiness
          : readiness
            ? { ...readiness, totalAmount: null }
            : null,
      revision: this.revisionSummary(draft, byVersion, boq.versions, canViewCommercials),
      capabilities,
    };
  }

  /**
   * Diffs two versions.
   *
   * Matched on `originNodeId`, never on code alone: `copyNodes` writes lineage on every
   * revision, and a code is user-editable — pairing by code would report a renumbered line
   * as one removal plus one addition and lose the rate change inside it.
   */
  async compare(
    identity: RequestIdentity,
    projectId: string,
    leftId: string,
    rightId: string,
  ): Promise<BoqCompareResponse> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.versioning.getBoq(identity, projectId);

    const left = boq.versions.find((version) => version.id === leftId);
    const right = boq.versions.find((version) => version.id === rightId);
    if (!left || !right) throw new NotFoundException('Version does not belong to this BOQ');
    if (leftId === rightId) throw new BadRequestException('Choose two different versions.');

    const [leftNodes, rightNodes] = await Promise.all([
      this.repo.findNodesByVersion(prisma, leftId),
      this.repo.findNodesByVersion(prisma, rightId),
    ]);

    const changes = diffNodes(leftNodes, rightNodes);
    const leftTotal = formatAmount(
      sumAmounts(leftNodes.filter((n) => n.isLeaf).map((n) => toDecimal(n.totalAmount))),
    );
    const rightTotal = formatAmount(
      sumAmounts(rightNodes.filter((n) => n.isLeaf).map((n) => toDecimal(n.totalAmount))),
    );

    return {
      leftVersionId: leftId,
      leftVersionNumber: left.versionNumber,
      rightVersionId: rightId,
      rightVersionNumber: right.versionNumber,
      currency: boq.currency,
      leftTotal,
      rightTotal,
      netDelta: formatAmount(
        subtract(toDecimal(rightTotal), toDecimal(leftTotal)),
      ),
      addedCount: changes.filter((change) => change.kinds.includes('ADDED')).length,
      removedCount: changes.filter((change) => change.kinds.includes('REMOVED')).length,
      changedCount: changes.filter(
        (change) => !change.kinds.includes('ADDED') && !change.kinds.includes('REMOVED'),
      ).length,
      changes,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private summarise(
    version: BoqVersion,
    nodes: BoqNode[],
    contractVersionId: string | null,
  ): BoqVersionSummary {
    const items = nodes.filter((node) => node.isLeaf);
    return {
      id: version.id,
      boqId: version.boqId,
      versionNumber: version.versionNumber,
      status: version.status,
      notes: version.notes ?? undefined,
      derivedFromVersionId: version.derivedFromVersionId ?? undefined,
      preparedBy: version.preparedBy ?? undefined,
      submittedBy: version.submittedBy ?? undefined,
      submittedAt: version.submittedAt?.toISOString(),
      baselinedAt: version.baselinedAt?.toISOString(),
      baselinedBy: version.baselinedBy ?? undefined,
      createdBy: version.createdBy,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
      totalAmount: formatAmount(sumAmounts(items.map((item) => toDecimal(item.totalAmount)))),
      itemCount: items.length,
      isContractBaseline: version.id === contractVersionId,
    };
  }

  /** Financial visibility is a server concern — the value is withheld, not hidden in the UI. */
  private redact(
    summary: BoqVersionSummary | null,
    canViewCommercials: boolean,
  ): BoqVersionSummary | null {
    if (!summary) return null;
    return canViewCommercials ? summary : { ...summary, totalAmount: null };
  }

  private revisionSummary(
    draft: BoqVersionSummary | null,
    byVersion: Map<string, BoqNode[]>,
    versions: BoqVersion[],
    canViewCommercials: boolean,
  ): BoqWorkspaceResponse['revision'] {
    if (!draft?.derivedFromVersionId) return null;
    const basedOn = versions.find((version) => version.id === draft.derivedFromVersionId);
    if (!basedOn) return null;

    const changes = diffNodes(
      byVersion.get(basedOn.id) ?? [],
      byVersion.get(draft.id) ?? [],
    );
    const netDelta = formatAmount(
      sumAmounts(changes.map((change) => toDecimal(change.amountDelta))),
    );

    return {
      basedOnVersionId: basedOn.id,
      basedOnVersionNumber: basedOn.versionNumber,
      changedItemCount: changes.length,
      netDelta: canViewCommercials ? netDelta : null,
    };
  }
}

function subtract(
  right: ReturnType<typeof toDecimal>,
  left: ReturnType<typeof toDecimal>,
): ReturnType<typeof toDecimal> {
  if (right === null && left === null) return null;
  return (right ?? toDecimal('0')!).minus(left ?? toDecimal('0')!);
}

/**
 * Pairs nodes across two versions and classifies what changed.
 *
 * Pairing key: the right node's `originNodeId` when it points into the left version,
 * otherwise the code. The fallback matters when comparing two versions that are not
 * parent-and-child — sibling revisions share an ancestor, not each other's ids.
 */
export function diffNodes(leftNodes: BoqNode[], rightNodes: BoqNode[]): BoqNodeChange[] {
  const leftById = new Map(leftNodes.map((node) => [node.id, node]));
  const leftByCode = new Map(leftNodes.map((node) => [node.code, node]));
  const matchedLeft = new Set<string>();
  const changes: BoqNodeChange[] = [];

  for (const right of rightNodes) {
    const left =
      (right.originNodeId ? leftById.get(right.originNodeId) : undefined) ??
      leftByCode.get(right.code);

    if (!left) {
      changes.push(describe(null, right, ['ADDED']));
      continue;
    }

    matchedLeft.add(left.id);
    const kinds: BoqChangeKind[] = [];
    if (left.description !== right.description) kinds.push('DESCRIPTION_CHANGED');
    if (!sameDecimal(left.quantity, right.quantity)) kinds.push('QUANTITY_CHANGED');
    if (!sameDecimal(left.unitRate, right.unitRate)) kinds.push('RATE_CHANGED');
    if (!sameDecimal(left.totalAmount, right.totalAmount)) kinds.push('AMOUNT_CHANGED');
    if (left.parentId !== right.parentId || left.depth !== right.depth) kinds.push('MOVED');
    if (right.sourceType === 'VARIATION' && left.sourceType !== 'VARIATION') {
      kinds.push('VARIATION_ORIGINATED');
    }

    if (kinds.length > 0) changes.push(describe(left, right, kinds));
  }

  for (const left of leftNodes) {
    if (!matchedLeft.has(left.id)) changes.push(describe(left, null, ['REMOVED']));
  }

  return changes;
}

function sameDecimal(a: unknown, b: unknown): boolean {
  const left = toDecimal(a as never);
  const right = toDecimal(b as never);
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function describe(
  left: BoqNode | null,
  right: BoqNode | null,
  kinds: BoqChangeKind[],
): BoqNodeChange {
  const subject = right ?? left!;
  const oldAmount = toDecimal(left?.totalAmount);
  const newAmount = toDecimal(right?.totalAmount);
  const delta = subtract(newAmount, oldAmount);

  return {
    kinds,
    leftNodeId: left?.id ?? null,
    rightNodeId: right?.id ?? null,
    code: subject.code,
    description: subject.description,
    isLeaf: subject.isLeaf,
    oldQuantity: left ? formatDecimal(left.quantity, 3) : null,
    newQuantity: right ? formatDecimal(right.quantity, 3) : null,
    oldUnitRate: left ? formatDecimal(left.unitRate, 2) : null,
    newUnitRate: right ? formatDecimal(right.unitRate, 2) : null,
    oldAmount: formatAmount(oldAmount),
    newAmount: formatAmount(newAmount),
    amountDelta: formatAmount(delta),
    // Undefined against a zero or absent base — "+∞%" is not information.
    amountDeltaPercent:
      oldAmount && !oldAmount.isZero() && delta
        ? delta.div(oldAmount).mul(100).toFixed(2)
        : null,
  };
}

function formatDecimal(value: unknown, scale: number): string | null {
  const decimal = toDecimal(value as never);
  return decimal === null ? null : decimal.toFixed(scale);
}
