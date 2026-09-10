import { randomUUID } from 'crypto';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BoqNode, Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository, BoqWithVersions } from '../infrastructure/boq-prisma.repository.js';
import {
  evaluateReadiness,
  type BoqBaselineReadiness,
} from '../domain/boq-readiness.policy.js';
import {
  inContractBillableTotal,
  contingencyRemaining,
  separateChargeTotal,
} from '../domain/boq-contract-value.policy.js';
import { formatAmount, type DecimalString } from '../domain/boq-money.js';

/**
 * CONST-BOQ-001 enforcement switch — see `ReadinessContext.enforceVariationOrigin`.
 *
 * Off until the Variations module exists. Turning it on before there is a way to raise a
 * Change Order would block every post-award revision with no route to satisfying the rule.
 */
const ENFORCE_VARIATION_ORIGIN = false;

@Injectable()
export class BoqVersioningService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
    private readonly commandGovernance: CommandGovernanceService,
  ) {}

  async getBoq(identity: RequestIdentity, projectId: string): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    return this.requireBoq(prisma, projectId, identity.activeOrganizationId);
  }

  /** CONST-BOQ-016. The same evaluation `baseline` enforces. */
  async getReadiness(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqBaselineReadiness> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);
    if (!boq.versions.some((version) => version.id === versionId)) {
      throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
    }

    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return evaluateReadiness(nodes, {
      boqCurrency: boq.currency,
      isPostAward: boq.originalBaselineVersionId !== null,
      enforceVariationOrigin: ENFORCE_VARIATION_ORIGIN,
    });
  }

  /**
   * Creates the BOQ for a project (one-time, idempotent on duplicate call).
   * Returns existing BOQ if already initialized.
   */
  async initialize(identity: RequestIdentity, projectId: string): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();

    const existing = await this.repo.findByProject(prisma, projectId);
    if (existing) {
      if (existing.organizationId !== identity.activeOrganizationId) throw new ForbiddenException();
      return existing;
    }

    // CONST-BOQ-013 — the BOQ's unit of account is fixed at initialization from the
    // project. It is not per node and not chosen per line.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { currency: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const boq = await this.repo.createBoq(prisma, {
      projectId,
      organizationId: identity.activeOrganizationId,
      currency: project.currency || 'USD',
    });

    const firstVersion = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: 1,
      status: 'DRAFT',
      createdBy: identity.userId,
      preparedBy: identity.userId,
    });

    // ADR-029 L-1 — the one long-lived operational version. `currentVersionId` is the pointer
    // R2+ reads (DRAFT pre-commit, COMMITTED after); `currentDraftVersionId` is kept in step for
    // the read models the old pointers still feed until R3 retires them.
    await this.repo.updateBoq(prisma, boq.id, {
      currentDraftVersionId: firstVersion.id,
      currentVersionId: firstVersion.id,
    });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Creates a new DRAFT version copied from the current approved version.
   * All nodes are duplicated with new IDs; originNodeId tracks lineage.
   */
  async createDraftFromApproved(
    identity: RequestIdentity,
    projectId: string,
    notes?: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (!boq.currentApprovedVersionId) {
      throw new BadRequestException('No approved version exists to create a draft from.');
    }
    if (boq.currentDraftVersionId) {
      throw new ConflictException(
        'A draft version already exists. Baseline or cancel it before creating a new draft.',
      );
    }

    // Get all approved nodes, sorted depth-first (parents before children).
    const approvedNodes = await this.repo.findNodesByVersion(prisma, boq.currentApprovedVersionId);

    const nextVersionNumber = (await this.repo.maxVersionNumber(prisma, boq.id)) + 1;

    const newVersion = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: nextVersionNumber,
      status: 'DRAFT',
      notes,
      createdBy: identity.userId,
      preparedBy: identity.userId,
      // ADR-004 specified this and it never shipped, so a revision could not say which
      // baseline it was copied from — the one fact a reviewer needs first.
      derivedFromVersionId: boq.currentApprovedVersionId,
    });

    if (approvedNodes.length > 0) {
      await this.copyNodes(prisma, boq.id, newVersion.id, approvedNodes);
    }

    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: newVersion.id });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Baselines the current draft version:
   *  - DRAFT → BASELINED
   *  - Previous approved version → SUPERSEDED
   *  - Sets originalBaselineVersionId (immutable once set)
   *  - Clears currentDraftVersionId
   */
  async baseline(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (boq.currentDraftVersionId !== versionId) {
      throw new BadRequestException('Only the current draft version can be baselined.');
    }

    const version = await this.repo.findVersion(prisma, versionId);
    if (!version || version.status !== 'DRAFT') {
      throw new BadRequestException('Version is not in DRAFT status.');
    }

    // CONST-BOQ-016 — the same evaluation the readiness endpoint returns. The screen shows
    // the blockers; this refuses the command. Neither can drift from the other.
    const readiness = evaluateReadiness(
      await this.repo.findNodesByVersion(prisma, versionId),
      {
        boqCurrency: boq.currency,
        isPostAward: boq.originalBaselineVersionId !== null,
        enforceVariationOrigin: ENFORCE_VARIATION_ORIGIN,
      },
    );
    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'This BOQ version is not ready to be baselined.',
        details: { blockers: readiness.blockers },
      });
    }

    // CONST-BOQ-018 / ADR-011 — baselining is the transition a contract is signed against,
    // so it goes through the same gate as PO submission and AP approval. With no binding
    // configured this resolves to null and baselining proceeds exactly as before; adding a
    // binding turns on four-eyes approval without touching this code.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'BoqVersion',
        'DRAFT',
        'BASELINED',
        versionId,
      ),
      'Baselining this BOQ version requires workflow approval.',
    );

    // Supersede the previously approved version.
    if (boq.currentApprovedVersionId) {
      await this.repo.updateVersion(prisma, boq.currentApprovedVersionId, {
        status: 'SUPERSEDED',
      });
    }

    await this.repo.updateVersion(prisma, versionId, {
      status: 'BASELINED',
      baselinedAt: new Date(),
      baselinedBy: identity.userId,
    });

    await this.repo.updateBoq(prisma, boq.id, {
      currentDraftVersionId: null,
      currentApprovedVersionId: versionId,
      // originalBaselineVersionId is immutable once set (preserves original contract baseline).
      ...(boq.originalBaselineVersionId ? {} : { originalBaselineVersionId: versionId }),
    });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Commit to contract — ADR-029 §2 L-1..L-4, CONST-BOQ-027.
   *
   * Fixes the contract value on the one operational version. `DRAFT → COMMITTED` in place (stable
   * ids — L-6), and a frozen `SNAPSHOT` *copy* of the whole tree is written as the as-committed
   * legal record (new ids; nothing operational references it). `Boq.currentVersionId` keeps
   * pointing at the operational version and `Boq.committedSnapshotVersionId` at the snapshot.
   *
   * This is the successor to `baseline` under the in-place model. It does NOT touch the Contract
   * module or `Contract.baseContractValue` — R3 reads the tie-out via `getInContractTotal`.
   */
  async commit(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    // L-1 — the operational version is the one `currentVersionId` names (fall back to the legacy
    // draft pointer for a BOQ initialized before R2 backfilled it).
    const operationalVersionId = boq.currentVersionId ?? boq.currentDraftVersionId;
    if (operationalVersionId !== versionId) {
      throw new BadRequestException('Only the operational BOQ version can be committed to contract.');
    }

    const version = await this.repo.findVersion(prisma, versionId);
    if (!version || version.status !== 'DRAFT') {
      throw new BadRequestException('This BOQ is not in a pre-commit DRAFT state.');
    }

    // L-3 — the SAME readiness the `readiness` query renders and `baseline` enforced. Baseline-Ready
    // already requires every leaf to be pricing-complete (missing unit/quantity/rate are blockers),
    // so this one evaluation covers both preconditions.
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    const readiness = evaluateReadiness(nodes, {
      boqCurrency: boq.currency,
      isPostAward: boq.originalBaselineVersionId !== null,
      enforceVariationOrigin: ENFORCE_VARIATION_ORIGIN,
    });
    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'This BOQ is not ready to be committed to contract.',
        details: { blockers: readiness.blockers },
      });
    }

    // L-2 / ADR-011 — commit is the governed transition a contract is signed against, on the same
    // seam `baseline` used. With no binding configured this resolves to null and commit proceeds;
    // a binding turns on four-eyes (preparer ≠ approver) without touching this code. Gated → 409.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'BoqVersion',
        'DRAFT',
        'COMMITTED',
        versionId,
      ),
      'Committing this BOQ to contract requires workflow approval.',
    );

    // L-4 — one transaction: flip the operational version to COMMITTED (in place, ids intact) and
    // write the frozen SNAPSHOT copy, then repoint the BOQ.
    await prisma.$transaction(async (tx) => {
      await this.repo.updateVersion(tx as never, versionId, {
        status: 'COMMITTED',
        // Reuse the baseline attribution columns as the commit stamp (who/when).
        baselinedAt: new Date(),
        baselinedBy: identity.userId,
      });

      const snapshotNumber = (await this.repo.maxVersionNumber(tx as never, boq.id)) + 1;
      const snapshot = await this.repo.createVersion(tx as never, {
        boqId: boq.id,
        versionNumber: snapshotNumber,
        status: 'SNAPSHOT',
        notes: `As-committed snapshot of version ${version.versionNumber}`,
        createdBy: identity.userId,
        preparedBy: identity.userId,
        derivedFromVersionId: versionId,
      });
      if (nodes.length > 0) {
        await this.copyNodes(tx as never, boq.id, snapshot.id, nodes);
      }

      await this.repo.updateBoq(tx as never, boq.id, {
        currentVersionId: versionId,
        committedSnapshotVersionId: snapshot.id,
        // Keep the legacy read-model pointers coherent until R3 retires them: the operational
        // version is now the approved one, and there is no open pre-commit draft.
        currentDraftVersionId: null,
        currentApprovedVersionId: versionId,
        ...(boq.originalBaselineVersionId ? {} : { originalBaselineVersionId: versionId }),
      });
    });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * BOQ read port (spec I-1 / T-1) — the in-contract billable total of a version, the figure R3's
   * contract tie-out (`Contract.baseContractValue`) is checked against. Reuses the one shared
   * `inContractBillableTotal` policy so the contract can never tie out to a different rule than the
   * one the commit snapshot was frozen under. Serialized as a decimal string (CONST-BOQ-014).
   */
  async getInContractTotal(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<DecimalString | null> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);
    if (!boq.versions.some((candidate) => candidate.id === versionId)) {
      throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
    }
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return formatAmount(inContractBillableTotal(nodes));
  }

  /**
   * BOQ read port (spec C-2) — contingency remaining on a version, derived from the live CONTINGENCY
   * leaf amounts, never stored. Reuses the one shared `contingencyRemaining` policy so the figure
   * the workspace shows and the figure a draw checks against can never diverge. Serialized as a
   * decimal string (CONST-BOQ-014); null when the version carries no contingency line.
   *
   * This is the read port, NOT the workspace read-model shaping — assembling the money band is R10.
   */
  async getContingencyRemaining(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<DecimalString | null> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);
    if (!boq.versions.some((candidate) => candidate.id === versionId)) {
      throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
    }
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return formatAmount(contingencyRemaining(nodes));
  }

  /**
   * BOQ read port (spec T-5 / R-4, CONST-BOQ-030/033) — the separate-charge total on a version:
   * `Σ leaf.totalAmount over commercialTreatment = SEPARATE_CHARGE leaves`. This is the Σ term the
   * Commercial read model adds to the current contract value to derive `totalClientRevenue`
   * (`totalClientRevenue = currentContractValue + Σ separate charges`); it NEVER moves the contract
   * value (CONST-BOQ-030).
   *
   * Reuses the one shared `separateChargeTotal` policy — the exact complement of the SEPARATE_CHARGE
   * exclusion in `inContractBillableTotal`, so the figure that leaves the in-contract tie-out is the
   * same figure that enters total client revenue; one leaf can never be double-counted or dropped.
   * Serialized as a decimal string (CONST-BOQ-014); null when the version carries no separate charge.
   *
   * The exact sibling of `getContingencyRemaining` / `getInContractTotal`: this is the read port, NOT
   * the workspace read-model shaping (that is R10). Financial-visibility redaction is the caller's
   * (Commercial `mayViewFinancials`), matching how `getInContractTotal` leaves gating to the caller.
   */
  async getSeparateChargeTotal(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<DecimalString | null> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);
    if (!boq.versions.some((candidate) => candidate.id === versionId)) {
      throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
    }
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return formatAmount(separateChargeTotal(nodes));
  }

  /**
   * ADR-029 V-1/V-2 (CONST-BOQ-032) — materialise a client-approved on-contract VariationOrder's
   * scope into the BOQ as VARIATION-tagged leaves, APPENDED IN PLACE on the operational COMMITTED
   * version (stable ids — L-6), and cut a fresh frozen SNAPSHOT copy of the enlarged tree.
   *
   * This is the redesign successor to the old ADR-016 deep-copy-fork path. Instead of forking a DRAFT
   * revision (which minted new ids downstream could not reach — the flaw §0 records), it:
   *
   *   1. resolves the ONE operational version (`currentVersionId`) and requires it COMMITTED — a
   *      variation can only be adopted into a BOQ that has been committed to contract;
   *   2. appends the VO's lines as new leaf nodes under a generated `VO-<ref>` section, each written
   *      `sourceType = VARIATION`, `commercialTreatment = IN_CONTRACT`, `sourceChangeOrderId = <vo id>`
   *      (the provenance FK). Omissions are signed-negative VARIATION leaves (Option (a)): the VO
   *      line's own signed quantity/rate/amount are carried verbatim, so a credit line lands as a
   *      negative `totalAmount`. This legitimately RAISES the in-contract total, so it is written on
   *      the R2 `allowContractValueChange` seam — the sanctioned value-raising path the L-5 pin allows;
   *   3. cuts a new SNAPSHOT copy (the R2 commit-snapshot mechanism, `copyNodes`) of the whole enlarged
   *      operational tree and repoints `committedSnapshotVersionId` — the as-signed legal record after
   *      the variation (CONST-BOQ-027). The prior snapshot stays as a SNAPSHOT row (history).
   *
   * The BOQ's single-currency rule is preserved (every leaf carries the BOQ currency). It does NOT
   * touch `Contract.contractValue` — that raise is the Contract-side seam the adopt command drives in
   * the SAME transaction (V-2). It does NOT change the milestone `%` schedule (that derives from the
   * frozen `baseContractValue` — R3/T-6).
   *
   * Runs inside the caller's transaction (`tx`) so the VO applied-marker, the value raise, these node
   * writes, and the snapshot commit together. Returns the operational version id the leaves landed on,
   * the new snapshot id, and the leaf count.
   */
  async appendVariationNodes(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    projectId: string,
    variation: {
      id: string;
      reference: string;
      lines: Array<{ description: string; quantity: Prisma.Decimal; unitRate: Prisma.Decimal; amount: Prisma.Decimal; sortOrder: number }>;
    },
  ): Promise<{ versionId: string; snapshotVersionId: string; nodeCount: number }> {
    const boq = await this.requireBoq(tx as never, projectId, identity.activeOrganizationId);

    // L-1 — the one operational version (fall back to the legacy draft pointer for a BOQ initialized
    // before R2 backfilled `currentVersionId`).
    const operationalVersionId = boq.currentVersionId ?? boq.currentDraftVersionId;
    if (!operationalVersionId) {
      throw new BadRequestException(
        'This project has no operational BOQ version to append a variation to.',
      );
    }
    const version = await this.repo.findVersion(tx as never, operationalVersionId);
    if (!version || version.status !== 'COMMITTED') {
      // A variation is a post-commit act: it raises a contract value that only exists once the BOQ has
      // been committed. Appending to a pre-commit DRAFT would raise nothing there is to raise.
      throw new BadRequestException(
        'A variation can only be adopted into a BOQ that has been committed to contract.',
      );
    }

    // Idempotency (belt-and-braces beside the VO marker): the VO's leaves must not already exist on
    // the operational version. The caller also guards on the VO's boqAppliedAt (→ 409).
    const existing = await this.repo.countNodesForVariation(
      tx as never,
      operationalVersionId,
      variation.id,
    );
    if (existing > 0) {
      throw new ConflictException(
        `Variation ${variation.reference} is already present on this BOQ.`,
      );
    }

    // Generate a section code that does not collide with any code already in the version.
    const usedCodes = await this.repo.findCodesInVersion(tx as never, operationalVersionId);
    const sectionCode = this.nextFreeCode(`VO-${variation.reference}`, usedCodes);
    usedCodes.add(sectionCode);

    const rootSiblingCount = await this.repo.countSiblings(tx as never, operationalVersionId, null);
    const sectionId = randomUUID();
    await this.repo.createNode(tx as never, {
      id: sectionId,
      boqId: boq.id,
      versionId: operationalVersionId,
      parentId: null,
      path: sectionId,
      depth: 0,
      sortOrder: rootSiblingCount,
      code: sectionCode,
      description: `Variation ${variation.reference}`,
      isLeaf: false,
      // The section itself carries the VO provenance too, so the whole group traces to the VO. A
      // section holds no amount, so it is inherently pin-neutral (it never contributes to the total).
      sourceType: 'VARIATION',
      commercialTreatment: 'IN_CONTRACT',
      sourceChangeOrderId: variation.id,
    });

    let order = 0;
    for (const line of variation.lines) {
      const leafId = randomUUID();
      const leafCode = this.nextFreeCode(`${sectionCode}.${String(order + 1).padStart(3, '0')}`, usedCodes);
      usedCodes.add(leafCode);
      await this.repo.createNode(tx as never, {
        id: leafId,
        boqId: boq.id,
        versionId: operationalVersionId,
        parentId: sectionId,
        path: `${sectionId}/${leafId}`,
        depth: 1,
        sortOrder: order,
        code: leafCode,
        description: line.description,
        isLeaf: true,
        unit: null,
        // Signed VO line values carried verbatim — an omission is a negative amount (Option (a)).
        quantity: line.quantity,
        unitRate: line.unitRate,
        currency: boq.currency,
        totalAmount: line.amount,
        // V-1 — on-contract variation scope: counts toward the in-contract total (IN_CONTRACT), which
        // is exactly the raise the R2 pin sanctions through the variation command.
        sourceType: 'VARIATION',
        commercialTreatment: 'IN_CONTRACT',
        sourceChangeOrderId: variation.id,
      });
      order += 1;
    }

    // V-2 — the as-signed legal record after the variation: a fresh frozen SNAPSHOT copy of the whole
    // enlarged operational tree (the R2 commit-snapshot mechanism). The prior snapshot stays a SNAPSHOT
    // row (history — CONST-BOQ-027); `committedSnapshotVersionId` now points at this one.
    const enlargedNodes = await this.repo.findNodesByVersion(tx as never, operationalVersionId);
    const snapshotNumber = (await this.repo.maxVersionNumber(tx as never, boq.id)) + 1;
    const snapshot = await this.repo.createVersion(tx as never, {
      boqId: boq.id,
      versionNumber: snapshotNumber,
      status: 'SNAPSHOT',
      notes: `As-committed snapshot after variation ${variation.reference}`,
      createdBy: identity.userId,
      preparedBy: identity.userId,
      derivedFromVersionId: operationalVersionId,
    });
    if (enlargedNodes.length > 0) {
      await this.copyNodes(tx as never, boq.id, snapshot.id, enlargedNodes);
    }
    await this.repo.updateBoq(tx as never, boq.id, { committedSnapshotVersionId: snapshot.id });

    return {
      versionId: operationalVersionId,
      snapshotVersionId: snapshot.id,
      nodeCount: variation.lines.length,
    };
  }

  /**
   * Cancels the current draft version without affecting the approved version.
   */
  async cancelDraft(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (boq.currentDraftVersionId !== versionId) {
      throw new BadRequestException('Only the current draft version can be cancelled.');
    }

    const version = await this.repo.findVersion(prisma, versionId);
    if (!version || version.status !== 'DRAFT') {
      throw new BadRequestException('Version is not in DRAFT status.');
    }

    await this.repo.updateVersion(prisma, versionId, { status: 'CANCELLED' });
    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: null });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /** A code derived from `base` that is not already present in `used` (CONST-BOQ-015 uniqueness). */
  private nextFreeCode(base: string, used: ReadonlySet<string>): string {
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private async requireBoq(
    prisma: ReturnType<TenancyService['getClient']>,
    projectId: string,
    organizationId: string,
  ) {
    const boq = await this.repo.findByProject(prisma, projectId);
    if (!boq) throw new NotFoundException(`No BOQ found for project ${projectId}`);
    if (boq.organizationId !== organizationId) throw new ForbiddenException();
    return boq;
  }

  /**
   * Copies nodes from a source version into a new version.
   * Generates new IDs for every node; builds new materialized paths from the ID map.
   */
  private async copyNodes(
    prisma: ReturnType<TenancyService['getClient']>,
    boqId: string,
    newVersionId: string,
    sourceNodes: BoqNode[],
  ): Promise<void> {
    // Pass 1: assign new IDs to every source node.
    const idMap = new Map<string, string>();
    for (const node of sourceNodes) {
      idMap.set(node.id, randomUUID());
    }

    // Pass 2: rebuild parentId and materialized path using the new IDs.
    const copies: Prisma.BoqNodeCreateManyInput[] = sourceNodes.map((node) => {
      const newId = idMap.get(node.id)!;
      const newParentId = node.parentId ? (idMap.get(node.parentId) ?? null) : null;

      // Path segments are node IDs — replace each with the corresponding new ID.
      const newPath = node.path
        .split('/')
        .map((segment) => idMap.get(segment) ?? segment)
        .join('/');

      return {
        id: newId,
        boqId,
        versionId: newVersionId,
        parentId: newParentId,
        path: newPath,
        depth: node.depth,
        sortOrder: node.sortOrder,
        code: node.code,
        description: node.description,
        unit: node.unit ?? undefined,
        quantity: node.quantity ?? undefined,
        unitRate: node.unitRate ?? undefined,
        currency: node.currency ?? undefined,
        totalAmount: node.totalAmount ?? undefined,
        isLeaf: node.isLeaf,
        // A revision is a copy of the approved scope, so it must carry the contractual
        // properties of every line. These four were dropped, silently resetting each item
        // to QUANTITY / UNIT_RATE / BASELINE — which would have changed how an inherited
        // lump-sum item is measured for payment the moment the revision was baselined.
        measurementMethod: node.measurementMethod,
        pricingBasis: node.pricingBasis,
        sourceType: node.sourceType,
        sourceChangeOrderId: node.sourceChangeOrderId ?? undefined,
        // ADR-029 — a snapshot is the frozen legal record, so the tie-out must copy exactly.
        // Dropping these would reset a CONTINGENCY / SEPARATE_CHARGE line to WORK / IN_CONTRACT
        // and silently change the in-contract total the copy reports — the same class of defect
        // that once dropped measurementMethod/pricingBasis above.
        nodeRole: node.nodeRole,
        commercialTreatment: node.commercialTreatment,
        isActive: node.isActive,
        originNodeId: node.id,
      };
    });

    await this.repo.createManyNodes(prisma, copies as never);
  }
}
