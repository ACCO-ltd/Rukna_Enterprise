import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  MilestoneReleaseLine,
  MilestoneWorkPackageLine,
  ProgrammeMilestoneResponse,
  RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgrammeRepository } from '../infrastructure/programme.repository.js';
// The single server-owned money-visibility definition (ADR-029 §8 A-2). Release amounts are contract
// revenue — the commercial (margin) tier — so money-blind roles (PM / Site Engineer) see the % only.
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
// A work package's verified % comes from the progress roll-up's own pure helpers (construction ->
// construction, no module import), so a milestone's readiness can never disagree with the roll-up.
import {
  leafPercentComplete,
  packagePercentComplete,
  progressValueByLeaf,
} from '../../progress/domain/progress-rollup.js';
import { isMilestoneReadyToVerify, isPackageFullyVerified } from '../domain/milestone-readiness.js';
import type { CreateMilestoneDto, VerifyMilestoneDto } from '../presentation/dto/programme.dto.js';

const ZERO = new Decimal(0);

function milestoneAlreadyVerified(): ConflictException {
  return new ConflictException(
    'This milestone is already verified, so the work packages behind it can no longer change.',
  );
}

/**
 * ADR-021 phase 2 — programme delivery milestones. A milestone is a named construction stage with a
 * baseline date; an authorized project member VERIFIES it when the stage is complete, recording the
 * actual date. A verified milestone is the billing evidence a MILESTONE payment installment may
 * reference (ADR-023 CONST-COM-011). Activities, the progress-target curve and version snapshots are
 * later increments.
 */
@Injectable()
export class ProgrammeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProgrammeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createMilestone(identity: RequestIdentity, projectId: string, dto: CreateMilestoneDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const workPackageIds = dto.workPackageIds
      ? await this.linkableWorkPackageIds(identity, projectId, dto.workPackageIds)
      : [];
    // The links are created nested in the same insert, so the milestone and its packages land
    // together or not at all.
    return this.repo.createMilestone(this.tenancy.getClient(), {
      organizationId: identity.activeOrganizationId,
      projectId,
      code: dto.code,
      name: dto.name,
      baselineDate: new Date(dto.baselineDate),
      forecastDate: dto.forecastDate ? new Date(dto.forecastDate) : null,
      sortOrder: dto.sortOrder ?? 0,
      createdBy: identity.userId,
      ...(workPackageIds.length > 0
        ? {
            workPackageLinks: {
              create: workPackageIds.map((workPackageId) => ({
                workPackageId,
                createdBy: identity.userId,
              })),
            },
          }
        : {}),
    });
  }

  async listMilestones(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProgrammeMilestoneResponse[]> {
    await this.projectAccess.assertMember(identity, projectId);
    const milestones = await this.repo.findMilestones(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
    );
    return this.toResponses(identity, projectId, milestones);
  }

  /**
   * ADR-021 amendment (2026-09-28): replace the set of work packages that make up a milestone's
   * stage (an empty list clears it). Every package must belong to the same project and be
   * measurable. A VERIFIED milestone is settled billing evidence, so its set is frozen (409).
   * Returns the milestone's read model with the recomputed readiness.
   */
  async setMilestoneWorkPackages(
    identity: RequestIdentity,
    projectId: string,
    milestoneId: string,
    workPackageIds: string[],
  ): Promise<ProgrammeMilestoneResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const milestone = await this.repo.findMilestoneById(
      prisma,
      identity.activeOrganizationId,
      milestoneId,
    );
    if (!milestone || milestone.projectId !== projectId) {
      throw new NotFoundException(`Milestone ${milestoneId} not found on this project`);
    }
    if (milestone.status === 'VERIFIED') throw milestoneAlreadyVerified();

    const ids = await this.linkableWorkPackageIds(identity, projectId, workPackageIds);
    await prisma.$transaction(async (tx) => {
      // Re-check under a row lock: a verify that committed after the read above must win, and a
      // verify that arrives now waits for this swap to commit. Either way the set of packages
      // behind a VERIFIED milestone never changes.
      const status = await this.repo.lockMilestoneStatus(tx as never, milestoneId);
      if (status === null) {
        throw new NotFoundException(`Milestone ${milestoneId} not found on this project`);
      }
      if (status === 'VERIFIED') throw milestoneAlreadyVerified();
      await this.repo.replaceMilestoneWorkPackages(tx as never, milestoneId, ids, identity.userId);
    });

    const rows = await this.repo.findMilestones(
      prisma,
      identity.activeOrganizationId,
      projectId,
      milestoneId,
    );
    const [response] = await this.toResponses(identity, projectId, rows);
    if (!response) throw new NotFoundException(`Milestone ${milestoneId} not found on this project`);
    return response;
  }

  /** Verify a milestone — the stage is complete. Only a PLANNED milestone can be verified. */
  async verifyMilestone(identity: RequestIdentity, milestoneId: string, dto: VerifyMilestoneDto) {
    const prisma = this.tenancy.getClient();
    const milestone = await this.repo.findMilestoneById(
      prisma,
      identity.activeOrganizationId,
      milestoneId,
    );
    if (!milestone) throw new NotFoundException(`Milestone ${milestoneId} not found`);
    await this.projectAccess.assertMember(identity, milestone.projectId);
    if (milestone.status !== 'PLANNED') {
      throw new BadRequestException(`Only a PLANNED milestone can be verified (is ${milestone.status}).`);
    }
    return this.repo.verifyMilestone(prisma, milestoneId, new Date(dto.actualDate), identity.userId);
  }

  /**
   * De-duplicate and validate a requested package set: every id must name a work package on THIS
   * project (a foreign or unknown id is refused, never silently dropped), and none may be a
   * schedule-only phase — it has no measurable scope, so it could never show 100% verified and
   * would hold the milestone "not ready" forever.
   */
  private async linkableWorkPackageIds(
    identity: RequestIdentity,
    projectId: string,
    workPackageIds: string[],
  ): Promise<string[]> {
    const ids = [...new Set(workPackageIds)];
    if (ids.length === 0) return ids;
    const found = await this.repo.findWorkPackagesForProject(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
      ids,
    );
    if (found.length !== ids.length) {
      throw new BadRequestException('Every linked work package must belong to this project.');
    }
    const scheduleOnly = found.filter((wp) => wp.scheduleOnly).map((wp) => wp.code);
    if (scheduleOnly.length > 0) {
      throw new BadRequestException(
        `${scheduleOnly.join(', ')} ${scheduleOnly.length === 1 ? 'is a schedule-only phase' : 'are schedule-only phases'} ` +
          'with no measurable scope, so it cannot show a milestone is ready. Link measurable work packages only.',
      );
    }
    return ids;
  }

  /** Shape stored rows into the wire read model: money visibility + linked-package readiness. */
  private async toResponses(
    identity: RequestIdentity,
    projectId: string,
    rows: StoredMilestoneWithReleases[],
  ): Promise<ProgrammeMilestoneResponse[]> {
    const { canViewMargin } = resolveBoqVisibility(identity);
    const packages = rows.flatMap((m) => m.workPackageLinks.map((link) => link.workPackage));
    const progressByPackage = await this.packageProgress(identity, projectId, packages);
    return rows.map((m) => toMilestoneResponse(m, canViewMargin, progressByPackage));
  }

  /**
   * Per package, two figures from one batched read:
   *  - `percentComplete` (display): the whole-number verified % computed exactly as the progress
   *    roll-up computes it — per-leaf verified ÷ quantity from APPROVED reports
   *    (`leafPercentComplete`), value-weighted with CONTINGENCY dropped (`progressValueByLeaf`,
   *    `packagePercentComplete`);
   *  - `fullyVerified` (readiness): every work leaf has verified ≥ quantity on EXACT decimals
   *    (`isPackageFullyVerified`) — never the rounded %, which reads 100 at 199.1 of 200.
   * A schedule-only package has no measurable scope: 0% and never fully verified.
   */
  private async packageProgress(
    identity: RequestIdentity,
    projectId: string,
    packages: StoredLinkedWorkPackage[],
  ): Promise<Map<string, PackageProgress>> {
    const measurable = packages.filter((wp) => !wp.scheduleOnly);
    const leafIds = [...new Set(measurable.flatMap((wp) => wp.boqLinks.map((b) => b.boqNodeId)))];
    const { leaves, verified } = await this.repo.findLeafProgressInputs(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
      leafIds,
    );

    const verifiedByLeaf = new Map<string, Decimal>(
      verified.map((v) => [v.boqNodeId, new Decimal(v._sum.quantity?.toString() ?? '0')] as const),
    );
    const percentByLeaf = new Map<string, number>();
    for (const leaf of leaves) {
      const quantity = new Decimal(leaf.quantity?.toString() ?? '0');
      percentByLeaf.set(
        leaf.id,
        leafPercentComplete(verifiedByLeaf.get(leaf.id) ?? ZERO, quantity) ?? 0,
      );
    }
    const valueByLeaf = progressValueByLeaf(leaves);
    const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf] as const));

    const result = new Map<string, PackageProgress>();
    for (const wp of packages) {
      if (wp.scheduleOnly) {
        result.set(wp.id, { percentComplete: 0, fullyVerified: false });
        continue;
      }
      const leafIds = wp.boqLinks.map((b) => b.boqNodeId);
      result.set(wp.id, {
        percentComplete: packagePercentComplete(leafIds, percentByLeaf, valueByLeaf),
        fullyVerified: isPackageFullyVerified(
          leafIds.map((id) => {
            const stored = leafById.get(id);
            return {
              // A leaf not found on this project's BOQ counts as not done.
              quantity: stored?.quantity ? new Decimal(stored.quantity.toString()) : null,
              nodeRole: stored?.nodeRole ?? 'WORK',
              verified: verifiedByLeaf.get(id) ?? ZERO,
            };
          }),
        ),
      });
    }
    return result;
  }
}

// ─── Read-model mapping (Master Schedule P2) ────────────────────────────────────────
//
// Shape a stored milestone (with its included release installments) into the wire response. Only the
// fields the release projection needs are read; the input type is structural so the mapper stays
// decoupled from the generated Prisma payload type.

/** One included installment as selected by ProgrammeRepository.findMilestones. */
interface IncludedReleaseInstallment {
  id: string;
  name: string;
  percentage: Decimal;
  triggerType: MilestoneReleaseLine['triggerType'];
  contract: { contractValue: Decimal; currency: string };
  clientInvoice: { id: string } | null;
}

/** A linked package's display % and whether it is fully verified on exact quantities. */
interface PackageProgress {
  percentComplete: number;
  fullyVerified: boolean;
}

/** One linked work package as selected by ProgrammeRepository.findMilestones. */
interface StoredLinkedWorkPackage {
  id: string;
  code: string;
  name: string;
  scheduleOnly: boolean;
  boqLinks: { boqNodeId: string }[];
}

/** A stored milestone row with its included installments (structural, from the repo select). */
interface StoredMilestoneWithReleases {
  id: string;
  projectId: string;
  code: string;
  name: string;
  status: ProgrammeMilestoneResponse['status'];
  baselineDate: Date;
  forecastDate: Date | null;
  actualDate: Date | null;
  sortOrder: number;
  contractDeliverableId: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  installments: IncludedReleaseInstallment[];
  workPackageLinks: { workPackage: StoredLinkedWorkPackage }[];
}

/** A `@db.Date` column as an ISO calendar date (YYYY-MM-DD); a timestamp as full ISO. Null passes through. */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Derive one release line. `amount` = contractValue × percentage, fixed to 2 decimals with Decimal —
 * identical rounding to the commercial payment schedule (buildPaymentSchedule). `invoiced` reflects
 * whether a ClientInvoice was generated from this installment (the 1:1 clientInvoice relation exists).
 * `amount` is null when the caller may not see commercial money; the percentage stays.
 */
function toReleaseLine(inst: IncludedReleaseInstallment, moneyVisible: boolean): MilestoneReleaseLine {
  const amount = new Decimal(inst.contract.contractValue.toString()).mul(
    new Decimal(inst.percentage.toString()),
  );
  return {
    installmentId: inst.id,
    name: inst.name,
    percentage: inst.percentage.toString(),
    triggerType: inst.triggerType,
    amount: moneyVisible ? amount.toFixed(2) : null,
    currency: inst.contract.currency,
    invoiced: inst.clientInvoice !== null,
  };
}

function toMilestoneResponse(
  m: StoredMilestoneWithReleases,
  moneyVisible: boolean,
  progressByPackage: ReadonlyMap<string, PackageProgress>,
): ProgrammeMilestoneResponse {
  const workPackages: MilestoneWorkPackageLine[] = m.workPackageLinks.map(({ workPackage }) => ({
    id: workPackage.id,
    code: workPackage.code,
    name: workPackage.name,
    percentComplete: progressByPackage.get(workPackage.id)?.percentComplete ?? 0,
  }));
  return {
    id: m.id,
    projectId: m.projectId,
    code: m.code,
    name: m.name,
    status: m.status,
    baselineDate: m.baselineDate.toISOString().slice(0, 10),
    forecastDate: isoDate(m.forecastDate),
    actualDate: isoDate(m.actualDate),
    sortOrder: m.sortOrder,
    contractDeliverableId: m.contractDeliverableId,
    verifiedBy: m.verifiedBy,
    verifiedAt: m.verifiedAt ? m.verifiedAt.toISOString() : null,
    // Installments are already ordered by (sortOrder, name) in the repo query.
    releases: m.installments.map((inst) => toReleaseLine(inst, moneyVisible)),
    workPackages,
    // Readiness reads the exact per-package verdict, never the rounded display %.
    readyToVerify: isMilestoneReadyToVerify(
      m.status,
      m.workPackageLinks.map(({ workPackage }) => ({
        fullyVerified: progressByPackage.get(workPackage.id)?.fullyVerified ?? false,
      })),
    ),
  };
}
