import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { BoqNode, BoqVersion } from '@prisma/client';
import {
  PERMISSIONS,
  type BoqChangeAction,
  type BoqCompareResponse,
  type BoqCompareToSignedChange,
  type BoqCompareToSignedChangeClass,
  type BoqCompareToSignedResponse,
  type BoqLifeStage,
  type BoqMoneyBand,
  type BoqNodeChange,
  type BoqChangeKind,
  type BoqTimelineEntry,
  type BoqTimelineResponse,
  type BoqVersionSummary,
  type BoqWorkspaceResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { formatAmount, sumAmounts, toDecimal } from '../domain/boq-money.js';
import { evaluateReadiness } from '../domain/boq-readiness.policy.js';
import {
  inContractBillableTotal,
  contingencyRemaining,
  separateChargeTotal,
} from '../domain/boq-contract-value.policy.js';
import { resolveBoqVisibility, canEditBoq } from '../domain/boq-visibility.policy.js';
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
    // ADR-029 §8 A-2 — money visibility is TWO tiers resolved by the single shared helper, not the
    // old `has(view:boq)` boolean. `canViewCost` gates rate/amount/line-budget fields (all this old
    // read model exposes); `canViewMargin` gates contract-value/contingency/margin (surfaced in the
    // R10 read model). Both are published in `capabilities` so the frontend renders per tier.
    const { canViewCost, canViewMargin } = resolveBoqVisibility(identity);
    const capabilities = {
      canView: identity.permissions.includes(PERMISSIONS.boqView),
      canManage: identity.permissions.includes(PERMISSIONS.boqManage),
      canBaseline: identity.permissions.includes(PERMISSIONS.boqBaseline),
      canEdit: canEditBoq(identity),
      canViewCost,
      canViewMargin,
      // Deprecated mirror of the cost tier — kept for one release so pre-tier clients keep working.
      canViewCommercials: canViewCost,
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
        // No BOQ yet → no money band and nothing signed to compare against.
        moneyBand: null,
        compareToSignedAvailable: false,
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
    // R-1 — the contract-sourced money figures (base & current value) are read from the Contract
    // table directly through the tenant Prisma client, exactly as the contract-baseline lookup below
    // already does. This is a direct tenant-scoped read, NOT a foreign repo or a service call, so
    // BoqModule gains no dependency on Contract/Commercial and the read stays cycle-free (the reverse
    // direction — Commercial→BOQ — is what goes through the BOQ read port).
    const contract = await prisma.contract.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { boqVersionId: true, contractValue: true, baseContractValue: true },
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

    // R-1 — the life-stage + tier-gated money band, all assembled here so the frontend renders it
    // rather than re-summing. The operational version is `currentVersionId` (fall back to the legacy
    // draft pointer for a BOQ initialized before R2 backfilled it), matching `commit`/`appendVariationNodes`.
    const operationalVersionId = boq.currentVersionId ?? boq.currentDraftVersionId ?? null;
    const operationalVersion = operationalVersionId
      ? boq.versions.find((version) => version.id === operationalVersionId) ?? null
      : null;
    const operationalNodes = operationalVersionId
      ? byVersion.get(operationalVersionId) ?? []
      : [];
    const snapshotNodes = boq.committedSnapshotVersionId
      ? byVersion.get(boq.committedSnapshotVersionId) ?? []
      : [];

    const moneyBand = this.buildMoneyBand(
      boq.currency,
      operationalVersion,
      operationalNodes,
      snapshotNodes,
      contract,
      canViewCost,
      canViewMargin,
    );

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
      draft: this.redact(draft, canViewCost),
      approved: this.redact(approved, canViewCost),
      contractBaseline: this.redact(find(contract?.boqVersionId ?? null), canViewCost),
      versions: summaries.map((summary) => this.redact(summary, canViewCost)!),
      readiness:
        readiness && canViewCost
          ? readiness
          : readiness
            ? { ...readiness, totalAmount: null }
            : null,
      revision: this.revisionSummary(draft, byVersion, boq.versions, canViewCost),
      moneyBand,
      // R-2 — there is something to compare against exactly when an as-committed snapshot exists.
      compareToSignedAvailable: boq.committedSnapshotVersionId !== null,
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

  /**
   * R-2 — compare-to-signed. The meaningful BOQ diff under the in-place model: the live operational
   * version against the frozen as-committed SNAPSHOT (`Boq.committedSnapshotVersionId`, the "what we
   * signed" record). REPLACES the old peer-version compare.
   *
   * Reuses the existing `diffNodes` (paired on lineage), then classifies each change as
   * money-neutral (description/code/reorder, a reallocation that held the in-contract total) or
   * value-changing (added/removed in-contract scope, a rate/qty move that shifted the in-contract
   * total). The value-changing judgement is made against the NET in-contract delta: when the whole
   * diff nets to zero on the in-contract total (a contingency reallocation, or absorbed scope funded
   * net-zero), the amount-moving lines are a reallocation and read money-neutral; when the net is
   * non-zero, those lines are value-changing.
   *
   * Returns gracefully (`available: false`, empty changes) when nothing has been committed yet — the
   * screen renders "nothing signed to compare against", never an error. Totals are `canViewCost`-gated.
   */
  async compareToSigned(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<BoqCompareToSignedResponse> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.versioning.getBoq(identity, projectId);
    const { canViewCost } = resolveBoqVisibility(identity);

    const signedVersionId = boq.committedSnapshotVersionId ?? null;
    const liveVersionId = boq.currentVersionId ?? boq.currentDraftVersionId ?? null;

    // Nothing committed yet, or no operational version to compare: an empty, non-error result.
    if (!signedVersionId || !liveVersionId) {
      return {
        available: false,
        currency: boq.currency,
        signedVersionId,
        liveVersionId,
        signedInContractTotal: null,
        liveInContractTotal: null,
        inContractDelta: null,
        moneyNeutralCount: 0,
        valueChangingCount: 0,
        changes: [],
      };
    }

    const [signedNodes, liveNodes] = await Promise.all([
      this.repo.findNodesByVersion(prisma, signedVersionId),
      this.repo.findNodesByVersion(prisma, liveVersionId),
    ]);

    // The signed snapshot is the LEFT (as-was), the live version the RIGHT (as-is) — so an ADDED
    // change is scope added since signing and a REMOVED change is scope taken out.
    const rawChanges = diffNodes(signedNodes, liveNodes);

    // The net move of the in-contract billable total between signed and live. When it is zero, any
    // amount-moving change is part of a reallocation (money-neutral); when non-zero, amount movers
    // are value-changing.
    const signedInContract = inContractBillableTotal(signedNodes);
    const liveInContract = inContractBillableTotal(liveNodes);
    const inContractDelta = subtract(liveInContract, signedInContract);
    const inContractMoved = inContractDelta !== null && !inContractDelta.isZero();

    const changes: BoqCompareToSignedChange[] = rawChanges.map((change) => ({
      ...change,
      changeClass: classifyChange(change, inContractMoved),
    }));

    return {
      available: true,
      currency: boq.currency,
      signedVersionId,
      liveVersionId,
      signedInContractTotal: canViewCost ? formatAmount(signedInContract) : null,
      liveInContractTotal: canViewCost ? formatAmount(liveInContract) : null,
      inContractDelta: canViewCost ? formatAmount(inContractDelta) : null,
      moneyNeutralCount: changes.filter((c) => c.changeClass === 'MONEY_NEUTRAL').length,
      valueChangingCount: changes.filter((c) => c.changeClass === 'VALUE_CHANGING').length,
      changes: changes.map((change) => this.redactChange(change, canViewCost)),
    };
  }

  /**
   * R-3 — the BOQ timeline: the notable events of the one living BOQ, newest-first. Three sources,
   * merged and sorted by timestamp:
   *
   *  - the COMMIT — the operational version's `baselinedAt` stamp (reused as the commit stamp by
   *    `commit`), rendered "Committed to contract";
   *  - each variation-adopt SNAPSHOT — the `BoqVersionStatus.SNAPSHOT` rows, whose `notes` name the
   *    variation and whose `createdAt`/`createdBy` are the adopt;
   *  - notable per-line `BoqChangeEvent`s on the operational version.
   *
   * Every entry carries a tier-gated amount: a change event surfaces its line amount delta
   * (`canViewCost`); commit/variation entries carry no line amount in this iteration (the tie-out is
   * read via compare-to-signed / the money band), so their amount is null. All actor ids are resolved
   * to names in one query.
   */
  async timeline(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<BoqTimelineResponse> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.versioning.getBoq(identity, projectId);
    const { canViewCost } = resolveBoqVisibility(identity);

    const operationalVersionId = boq.currentVersionId ?? boq.currentDraftVersionId ?? null;

    const entries: BoqTimelineEntry[] = [];

    // 1 — the commit. The operational version's `baselinedAt` is the commit stamp (`commit` writes it).
    const operationalVersion = operationalVersionId
      ? boq.versions.find((version) => version.id === operationalVersionId) ?? null
      : null;
    if (
      operationalVersion &&
      operationalVersion.status === 'COMMITTED' &&
      operationalVersion.baselinedAt
    ) {
      entries.push({
        id: `commit:${operationalVersion.id}`,
        kind: 'COMMITTED',
        label: 'Committed to contract',
        versionId: operationalVersion.id,
        actorUserId: operationalVersion.baselinedBy ?? null,
        actorName: null,
        occurredAt: operationalVersion.baselinedAt.toISOString(),
        amount: null,
      });
    }

    // 2 — each variation-adopt snapshot. Every SNAPSHOT row EXCEPT the as-committed one (which is the
    // commit itself, already represented above) is a variation adopt; its notes name the variation.
    for (const version of boq.versions) {
      if (version.status !== 'SNAPSHOT') continue;
      // The first snapshot is the as-committed record; skip it here (the commit entry covers it).
      const isCommitSnapshot = version.notes?.startsWith('As-committed snapshot of version');
      if (isCommitSnapshot) continue;
      entries.push({
        id: `snapshot:${version.id}`,
        kind: 'VARIATION_SNAPSHOT',
        label: version.notes ?? 'Variation adopted',
        versionId: version.id,
        actorUserId: version.createdBy ?? null,
        actorName: null,
        occurredAt: version.createdAt.toISOString(),
        amount: null,
      });
    }

    // 3 — notable per-line change events on the operational version.
    if (operationalVersionId) {
      const events = await this.repo.findHistory(prisma, operationalVersionId, {
        take: 100,
        skip: 0,
      });
      for (const event of events) {
        // A line amount delta is derivable only for a value edit that carries both old/new on an
        // amount field; otherwise the entry has no amount. Gated by `canViewCost`.
        const amount =
          canViewCost && event.field === 'totalAmount' && event.newValue !== null
            ? formatAmount(subtract(toDecimal(event.newValue), toDecimal(event.oldValue)))
            : null;
        entries.push({
          id: `event:${event.id}`,
          kind: 'CHANGE_EVENT',
          label: event.detail ?? changeEventLabel(event.action, event.code),
          versionId: event.versionId,
          actorUserId: event.actorUserId,
          actorName: null,
          occurredAt: event.createdAt.toISOString(),
          amount,
        });
      }
    }

    // Newest-first, then resolve every actor id to a name in one query.
    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const actorIds = [
      ...new Set(entries.map((entry) => entry.actorUserId).filter((id): id is string => id !== null)),
    ];
    const names = await this.repo.findActorNames(prisma, actorIds);
    for (const entry of entries) {
      entry.actorName = entry.actorUserId ? names.get(entry.actorUserId) ?? null : null;
    }

    return { projectId, entries };
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
    canViewCost: boolean,
  ): BoqVersionSummary | null {
    if (!summary) return null;
    return canViewCost ? summary : { ...summary, totalAmount: null };
  }

  /**
   * Withholds the rate/amount fields of a compare change from a caller without the cost tier — the
   * same server-side redaction the version totals get (§8 A-2). The structural facts (which node,
   * what kinds, quantity) stay; only the money is nulled. `changeClass` is a structural
   * money-neutral-vs-value fact, not a figure, so it is NOT withheld.
   */
  private redactChange(
    change: BoqCompareToSignedChange,
    canViewCost: boolean,
  ): BoqCompareToSignedChange {
    if (canViewCost) return change;
    return {
      ...change,
      oldUnitRate: null,
      newUnitRate: null,
      oldAmount: null,
      newAmount: null,
      amountDelta: null,
      amountDeltaPercent: null,
    };
  }

  /**
   * R-1 — the money band, assembled once server-side and tier-gated by the SINGLE
   * `resolveBoqVisibility` result (`canViewCost` / `canViewMargin` are passed in).
   *
   * Every figure reuses a shared policy — nothing is re-summed here:
   *  - `inContractTotal` / `separateChargeTotal` come from `inContractBillableTotal` /
   *    `separateChargeTotal` over the operational nodes (cost tier).
   *  - `contingencyRemaining` from `contingencyRemaining` over the operational nodes; the
   *    `contingencyReserve` is the same function over the FROZEN snapshot nodes (the original
   *    allowance), falling back to the operational figure pre-commit when there is no snapshot
   *    (they are equal until the first draw). Margin tier.
   *  - `baseContractValue` / `contractValue` come straight from the Contract row (margin tier);
   *    `totalClientRevenue = contractValue + Σ separate charges`, the same definition the
   *    Commercial read model uses — separate charges feed revenue, never the contract value.
   *
   * A figure whose tier the caller does not meet is null (omitted server-side); a figure that does
   * not exist yet (no contract, no contingency line) is likewise null.
   */
  private buildMoneyBand(
    currency: string,
    operationalVersion: BoqVersion | null,
    operationalNodes: BoqNode[],
    snapshotNodes: BoqNode[],
    contract: { contractValue: unknown; baseContractValue: unknown } | null,
    canViewCost: boolean,
    canViewMargin: boolean,
  ): BoqMoneyBand {
    // Life-stage is structural — never gated. WORKING while the operational version is a pre-commit
    // DRAFT; COMMITTED once it has been committed. A missing operational version reads WORKING (an
    // uninitialized/first-draft BOQ has not been committed).
    const lifeStage: BoqLifeStage =
      operationalVersion?.status === 'COMMITTED' ? 'COMMITTED' : 'WORKING';

    const inContract = formatAmount(inContractBillableTotal(operationalNodes));
    const separateCharge = formatAmount(separateChargeTotal(operationalNodes));

    // Reserve = the frozen original allowance (snapshot); remaining = the live allowance. Pre-commit
    // there is no snapshot, so the reserve mirrors the live figure (they are equal until a draw).
    const remaining = formatAmount(contingencyRemaining(operationalNodes));
    const reserve = snapshotNodes.length
      ? formatAmount(contingencyRemaining(snapshotNodes))
      : remaining;

    const baseContractValue =
      contract?.baseContractValue != null
        ? formatAmount(toDecimal(contract.baseContractValue as never))
        : null;
    const contractValue =
      contract?.contractValue != null
        ? formatAmount(toDecimal(contract.contractValue as never))
        : null;

    // Total client revenue = current contract value + Σ separate charges. Only meaningful once there
    // is a current value to add to; null when there is no contract. Uses the separate-charge total
    // even when the caller lacks the cost tier — the figure itself is a margin-tier figure.
    const contractValueDecimal =
      contract?.contractValue != null ? toDecimal(contract.contractValue as never) : null;
    const separateChargeDecimal = separateChargeTotal(operationalNodes);
    const totalClientRevenue =
      contractValueDecimal === null
        ? null
        : formatAmount(contractValueDecimal.plus(separateChargeDecimal ?? toDecimal('0')!));

    return {
      lifeStage,
      currency,
      // Cost tier.
      inContractTotal: canViewCost ? inContract : null,
      separateChargeTotal: canViewCost ? separateCharge : null,
      // Margin tier.
      baseContractValue: canViewMargin ? baseContractValue : null,
      contractValue: canViewMargin ? contractValue : null,
      contingencyReserve: canViewMargin ? reserve : null,
      contingencyRemaining: canViewMargin ? remaining : null,
      totalClientRevenue: canViewMargin ? totalClientRevenue : null,
    };
  }

  private revisionSummary(
    draft: BoqVersionSummary | null,
    byVersion: Map<string, BoqNode[]>,
    versions: BoqVersion[],
    canViewCost: boolean,
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
      netDelta: canViewCost ? netDelta : null,
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
 * R-2 — classifies one compare-to-signed change as money-neutral vs value-changing.
 *
 * A change is VALUE_CHANGING when it moved the in-contract billable total:
 *  - added or removed scope (`ADDED` / `REMOVED`), OR
 *  - an amount move (`AMOUNT_CHANGED`, which a rate/qty change produces) AND the whole diff nets to a
 *    NON-zero in-contract delta (`inContractMoved`). When the net is zero the amount move is part of a
 *    reallocation (contingency → work, or absorbed scope funded net-zero) and reads MONEY_NEUTRAL.
 *
 * Everything else — a pure description/code/reorder edit, or an amount move that netted to zero — is
 * MONEY_NEUTRAL: the document changed, what the client owes did not.
 */
export function classifyChange(
  change: BoqNodeChange,
  inContractMoved: boolean,
): BoqCompareToSignedChangeClass {
  if (change.kinds.includes('ADDED') || change.kinds.includes('REMOVED')) {
    return 'VALUE_CHANGING';
  }
  if (change.kinds.includes('AMOUNT_CHANGED') && inContractMoved) {
    return 'VALUE_CHANGING';
  }
  return 'MONEY_NEUTRAL';
}

/** A human label for a change event that carries no `detail` (e.g. a value edit). */
function changeEventLabel(action: BoqChangeAction, code: string | null): string {
  const target = code ? ` ${code}` : '';
  switch (action) {
    case 'CREATE':
      return `Added${target}`;
    case 'UPDATE':
      return `Updated${target}`;
    case 'DELETE':
      return `Deleted${target}`;
    case 'MOVE':
      return `Moved${target}`;
    case 'IMPORT':
      return 'Imported items';
    default:
      return `Changed${target}`;
  }
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
