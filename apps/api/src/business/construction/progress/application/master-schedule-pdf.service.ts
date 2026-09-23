import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgressRepository } from '../infrastructure/progress.repository.js';
import { ProgressService } from './progress.service.js';
import { ProgrammeBaselineService } from './programme-baseline.service.js';
import { ProgrammeService } from '../../programme/application/programme.service.js';
import { isoDate } from '../domain/progress-curve.js';
import {
  composeMasterScheduleReportModel,
  type MasterScheduleReportModel,
  type ProjectHeaderInput,
} from './master-schedule-report.model.js';
import { renderMasterSchedulePdf } from './master-schedule-pdf.renderer.js';

/** The rendered PDF plus the bits the controller needs for the Content-Disposition filename. */
export interface MasterSchedulePdfResult {
  buffer: Buffer;
  projectCode: string;
  asOf: string;
  /** A safe, ready-to-use attachment filename: master-schedule-<code>-<asOf>.pdf. */
  filename: string;
}

/**
 * Master Schedule P4 (ADR-029) — composes the branded PDF from the EXISTING read models and renders
 * it in-process (react-pdf, no headless browser). It writes no new aggregated DB query: it fans out to
 * `ProgressService.getRollup` (phase schedule table), `ProgressService.getCurve` (S-curve point arrays
 * + baselineSource), `ProgrammeBaselineService.getGoverning` (frozen baseline — may be null),
 * `ProgrammeService.listMilestones` (milestones + payment-stage releases) and the project/org header
 * read, then hands them to the pure composer and the renderer.
 *
 * Authorization is enforced here (`projectAccess.assertMember`) as well as inside every delegated
 * read; membership is the single project-scoped gate. Generation is synchronous — no job queue.
 */
@Injectable()
export class MasterSchedulePdfService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProgressRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly progress: ProgressService,
    private readonly baseline: ProgrammeBaselineService,
    private readonly programme: ProgrammeService,
  ) {}

  /** Compose the render-ready report model (pure composition of the read models). Public for tests. */
  async composeModel(
    identity: RequestIdentity,
    projectId: string,
    asOf: string,
  ): Promise<MasterScheduleReportModel> {
    await this.projectAccess.assertMember(identity, projectId);

    const header = await this.loadProjectHeader(identity, projectId);
    // Fan out to the existing read models. getRollup/getCurve/listMilestones each re-assert membership
    // (cheap, tenant-scoped) — the model is a projection over their outputs, not a new query.
    const [rollup, curve, baseline, milestones] = await Promise.all([
      this.progress.getRollup(identity, projectId, asOf),
      this.progress.getCurve(identity, projectId),
      this.baseline.getGoverning(identity, projectId),
      this.programme.listMilestones(identity, projectId),
    ]);

    return composeMasterScheduleReportModel({
      header,
      rollup,
      curve,
      baseline, // may be null → the composer degrades to a provisional status line
      milestones,
      asOf,
    });
  }

  /**
   * Generate the Master Schedule PDF for a project. `asOf` defaults to today (used for the per-phase
   * schedule status, the header "as of" line, and the filename). Returns the raw buffer + filename
   * bits; the controller wraps it in a StreamableFile.
   */
  async generate(
    identity: RequestIdentity,
    projectId: string,
    asOf?: string,
  ): Promise<MasterSchedulePdfResult> {
    const at = asOf ? isoDate(new Date(asOf)) : isoDate(new Date());
    const model = await this.composeModel(identity, projectId, at);
    const buffer = await renderMasterSchedulePdf(model);
    return {
      buffer,
      projectCode: model.header.projectCode,
      asOf: at,
      filename: `master-schedule-${sanitizeForFilename(model.header.projectCode)}-${at}.pdf`,
    };
  }

  private async loadProjectHeader(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectHeaderInput> {
    const prisma = this.tenancy.getClient();
    const row = await this.repo.findProjectHeader(prisma, identity.activeOrganizationId, projectId);
    // assertMember already 404s a foreign/absent project, but guard the read result too.
    if (!row) throw new NotFoundException(`Project ${projectId} not found`);
    return {
      projectCode: row.code,
      projectName: row.name,
      // Prefer the linked Client's name; fall back to the free-text clientName; else null.
      clientName: row.client?.name ?? row.clientName ?? null,
      projectStartDate: row.startDate ? isoDate(row.startDate) : null,
      projectExpectedEndDate: row.expectedEndDate ? isoDate(row.expectedEndDate) : null,
      organizationName: row.organization.name,
      organizationLogoUrl: row.organization.logoUrl,
    };
  }
}

/** Strip characters that would break a Content-Disposition filename or a filesystem. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
