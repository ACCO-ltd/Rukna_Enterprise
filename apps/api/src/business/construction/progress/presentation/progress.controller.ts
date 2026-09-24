import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, UseGuards, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiProduces } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgressService } from '../application/progress.service.js';
import { ProgrammeBaselineService } from '../application/programme-baseline.service.js';
import { MasterSchedulePdfService } from '../application/master-schedule-pdf.service.js';
import {
  CreateDprDto,
  AddMeasurementDto,
  AttachEvidenceDto,
  ReturnDprDto,
  ReopenDprDto,
  CreateWorkPackageDto,
  SaveDeliveryPlanDto,
  UpdateWorkPackageDto,
  AllocateBoqNodeDto,
  ApplyScheduleTemplateDto,
  SetProgressTargetsDto,
  RebaselineProgrammeDto,
  CreateProgrammeActivityDto,
  UpdateProgrammeActivityDto,
  CaptureProgressSnapshotDto,
  PatchDprContextDto,
  AddDprLabourRowDto,
  AddDprEquipmentRowDto,
  AddDprObservationDto,
} from './dto/progress.dto.js';

// ADR-021 Progress MVP: daily progress reports + measurements + evidence, and verified progress.
// ADR-022 CONST-DOA-008 DPR permission split:
//   record:progress — SE (and PM) can CREATE a DPR, add measurements/evidence, and SUBMIT it.
//   approve:progress — PM can APPROVE, RETURN or REOPEN a DPR.
//   manage:project — programme setup (work packages, baseline, targets, activities, snapshots).
// Project membership is enforced per-call in the service via projectAccess.assertMember.
@ApiTags('Progress')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller()
export class ProgressController {
  constructor(
    private readonly service: ProgressService,
    private readonly baseline: ProgrammeBaselineService,
    private readonly masterSchedulePdf: MasterSchedulePdfService,
  ) {}

  @Post('projects/:projectId/progress/reports')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Create a daily progress report (DRAFT)' })
  createDpr(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDprDto,
  ) {
    return this.service.createDpr(identity, projectId, dto);
  }

  @Get('projects/:projectId/progress/reports')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'List the project daily reports' })
  listDprs(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.listDprs(identity, projectId);
  }

  @Get('projects/:projectId/progress')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Verified physical progress per BOQ leaf (approved DPRs only)' })
  progress(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getProjectProgress(identity, projectId);
  }

  @Get('projects/:projectId/progress/rollup')
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'asOf', required: false, description: 'Evaluate per-phase scheduleStatus as of this date (default today)' })
  @ApiOperation({ summary: 'Weighted project physical % (work-package roll-up) + per-phase schedule reads' })
  rollup(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.service.getRollup(identity, projectId, asOf);
  }

  @Get('projects/:projectId/progress/signal')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Physical-vs-financial early warning (built % vs cost consumed %)' })
  signal(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getPhysicalFinancialSignal(identity, projectId);
  }

  @Get('projects/:projectId/progress/collection-signal')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Collection-vs-progress early warning (collected % vs built %)' })
  collectionSignal(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getCollectionProgressSignal(identity, projectId);
  }

  // ── ADR-021 CONST-PROG-011: planned baseline + schedule variance ──────────────

  @Get('projects/:projectId/programme/targets')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'The approved planned-progress target curve (monthly milestones)' })
  targets(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getTargets(identity, projectId);
  }

  @Put('projects/:projectId/programme/targets')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Set/replace the planned-progress target curve (non-decreasing, 0–100)' })
  setTargets(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: SetProgressTargetsDto,
  ) {
    return this.service.setTargets(identity, projectId, dto.targets);
  }

  @Get('projects/:projectId/programme/schedule-variance')
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'asOf', required: false, description: 'Evaluate planned-vs-verified as of this date (default today)' })
  @ApiOperation({ summary: 'Planned-vs-verified schedule variance (behind/ahead of schedule)' })
  scheduleVariance(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.service.getScheduleVariance(identity, projectId, asOf);
  }

  // ── Master Schedule P3 (ADR-029): frozen, versioned programme baseline ─────────

  @Get('projects/:projectId/programme/baseline')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'The governing (APPROVED) programme baseline with its frozen curve, or null if none',
  })
  getBaseline(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.baseline.getGoverning(identity, projectId);
  }

  @Post('projects/:projectId/programme/baseline/approve')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Approve the INITIAL programme baseline (v1) — freeze the live target curve. 409 if an ' +
      'approved baseline already exists (re-baseline instead); 400 if the curve is empty.',
  })
  approveBaseline(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.baseline.approve(identity, projectId);
  }

  @Post('projects/:projectId/programme/baseline/rebaseline')
  @RequirePermissions(PERMISSIONS.projectsApprove)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Re-baseline (v>=2, senior) — supersede the approved baseline and freeze a new version from ' +
      'the current curve. Requires a Variation belonging to this project as justification (Q-4).',
  })
  rebaseline(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: RebaselineProgrammeDto,
  ) {
    return this.baseline.rebaseline(identity, projectId, dto);
  }

  // ── Master Schedule P4 (ADR-029): the branded, server-generated PDF report ─────

  @Get('projects/:projectId/programme/master-schedule.pdf')
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'asOf', required: false, description: 'Report "as of" date (default today) — drives per-phase status, the header, and the filename' })
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary:
      'Generate the branded Master Schedule PDF (header + activity table + plan-vs-actual S-curve + ' +
      'milestones/releases). Streams application/pdf as an attachment.',
  })
  async masterSchedulePdfReport(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('asOf') asOf?: string,
  ): Promise<StreamableFile> {
    // First binary/streaming route on the API. There is no global response interceptor/serializer that
    // wraps the body (the only APP_INTERCEPTOR, AuditInterceptor, short-circuits GET/HEAD/OPTIONS), so
    // returning a StreamableFile streams the raw PDF; NestJS applies the Content-Type / -Disposition /
    // -Length from the options below (no raw @Res needed).
    const { buffer, filename } = await this.masterSchedulePdf.generate(identity, projectId, asOf);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }

  // ── Master Schedule P1-d (ADR-029): the guided schedule builder ────────────────

  @Post('projects/:projectId/programme/apply-schedule-template')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Seed the project phases from a schedule template (one transaction). 409 if the project ' +
      'already has any work packages.',
  })
  applyScheduleTemplate(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: ApplyScheduleTemplateDto,
  ) {
    return this.service.applyScheduleTemplate(identity, projectId, dto.templateKey);
  }

  @Post('projects/:projectId/programme/suggest-weights')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Suggest each work package weight from its assigned BOQ value (read-only; the WP PATCH persists ' +
      'a chosen weight).',
  })
  suggestWeights(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.service.suggestWeights(identity, projectId);
  }

  // ── Round-2 Progress-over-time (BE-1): snapshots + curve + period comparison ───

  @Post('projects/:projectId/progress/snapshots')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Capture an immutable progress snapshot (source=MANUAL) freezing the live physical/verified/' +
      'cost readings for a period-end date (defaults to today). 409 if the period already has one.',
  })
  captureSnapshot(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CaptureProgressSnapshotDto,
  ) {
    return this.service.captureSnapshot(identity, projectId, dto.periodEndDate);
  }

  @Get('projects/:projectId/progress/curve')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'Planned-vs-actual progress S-curve + schedule status (provisional Option-C baseline)',
  })
  curve(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getCurve(identity, projectId);
  }

  @Get('projects/:projectId/progress/period-comparison')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'Overall period-over-period progress comparison from the two most-recent snapshots',
  })
  periodComparison(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getPeriodComparison(identity, projectId);
  }

  // ── ADR-021 CONST-PROG-005: programme activities ──────────────────────────────

  @Get('projects/:projectId/programme/activities')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'List programme activities for a project (across its work packages)' })
  activities(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.listActivities(identity, projectId);
  }

  @Post('work-packages/:workPackageId/activities')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'workPackageId' })
  @ApiOperation({ summary: 'Add a programme activity (dates / duration / milestone) under a work package' })
  createActivity(
    @CurrentUser() identity: RequestIdentity,
    @Param('workPackageId') workPackageId: string,
    @Body() dto: CreateProgrammeActivityDto,
  ) {
    return this.service.createActivity(identity, workPackageId, dto);
  }

  @Patch('programme/activities/:activityId')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'activityId' })
  @ApiOperation({ summary: 'Update a programme activity' })
  updateActivity(
    @CurrentUser() identity: RequestIdentity,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateProgrammeActivityDto,
  ) {
    return this.service.updateActivity(identity, activityId, dto);
  }

  @Delete('programme/activities/:activityId')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'activityId' })
  @ApiOperation({ summary: 'Delete a programme activity' })
  deleteActivity(@CurrentUser() identity: RequestIdentity, @Param('activityId') activityId: string) {
    return this.service.deleteActivity(identity, activityId);
  }

  @Post('projects/:projectId/work-packages')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Create a work package (control unit with a progress weight)' })
  createWorkPackage(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkPackageDto,
  ) {
    return this.service.createWorkPackage(identity, projectId, dto);
  }

  @Get('projects/:projectId/work-packages')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'List the project work packages' })
  listWorkPackages(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.listWorkPackages(identity, projectId);
  }

  @Post('projects/:projectId/work-packages/delivery-plan')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary:
      'Save a reviewed Delivery Plan: create every package and its BOQ-leaf allocations together, ' +
      'all-or-nothing. Nothing is persisted if any package in the batch fails validation.',
  })
  saveDeliveryPlan(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: SaveDeliveryPlanDto,
  ) {
    return this.service.saveDeliveryPlan(identity, projectId, dto);
  }

  @Patch('work-packages/:workPackageId')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'workPackageId' })
  @ApiOperation({
    summary:
      'Update a work package incl. its master-schedule window (planned dates / duration / forecast / ' +
      'schedule-only). % complete and actual dates are derived, never set here.',
  })
  updateWorkPackage(
    @CurrentUser() identity: RequestIdentity,
    @Param('workPackageId') workPackageId: string,
    @Body() dto: UpdateWorkPackageDto,
  ) {
    return this.service.updateWorkPackage(identity, workPackageId, dto);
  }

  @Post('work-packages/:workPackageId/boq-nodes')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'workPackageId' })
  @ApiOperation({ summary: 'Allocate a BOQ leaf to a work package' })
  allocateBoqNode(
    @CurrentUser() identity: RequestIdentity,
    @Param('workPackageId') workPackageId: string,
    @Body() dto: AllocateBoqNodeDto,
  ) {
    return this.service.allocateBoqNode(identity, workPackageId, dto.boqNodeId);
  }

  @Get('progress/reports/:dprId')
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Get a daily report with its measurements + evidence' })
  getDpr(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.getDpr(identity, dprId);
  }

  @Post('progress/reports/:dprId/measurements')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Add a measured quantity against a BOQ leaf (DRAFT report only)' })
  addMeasurement(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AddMeasurementDto,
  ) {
    return this.service.addMeasurement(identity, dprId, dto);
  }

  @Post('progress/reports/:dprId/evidence')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Attach an uploaded evidence file (photo / measurement sheet)' })
  attachEvidence(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AttachEvidenceDto,
  ) {
    return this.service.attachEvidence(identity, dprId, dto.platformFileId);
  }

  // ── Phase 3: structured DPR row endpoints (Sections A / C / D) ───────────────

  @Patch('progress/reports/:dprId/context')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Patch context fields (Section A + tomorrow plan) on an editable DPR' })
  patchDprContext(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: PatchDprContextDto,
  ) {
    return this.service.patchDprContext(identity, dprId, dto);
  }

  @Post('progress/reports/:dprId/labour')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Add a labour row to an editable DPR (Section C)' })
  addLabourRow(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AddDprLabourRowDto,
  ) {
    return this.service.addLabourRow(identity, dprId, dto);
  }

  @Delete('progress/reports/:dprId/labour/:rowId')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'dprId' })
  @ApiParam({ name: 'rowId' })
  @ApiOperation({ summary: 'Remove a labour row from an editable DPR' })
  removeLabourRow(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Param('rowId') rowId: string,
  ) {
    return this.service.removeLabourRow(identity, dprId, rowId);
  }

  @Post('progress/reports/:dprId/equipment')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Add an equipment row to an editable DPR (Section C)' })
  addEquipmentRow(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AddDprEquipmentRowDto,
  ) {
    return this.service.addEquipmentRow(identity, dprId, dto);
  }

  @Delete('progress/reports/:dprId/equipment/:rowId')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'dprId' })
  @ApiParam({ name: 'rowId' })
  @ApiOperation({ summary: 'Remove an equipment row from an editable DPR' })
  removeEquipmentRow(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Param('rowId') rowId: string,
  ) {
    return this.service.removeEquipmentRow(identity, dprId, rowId);
  }

  @Post('progress/reports/:dprId/observations')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Add a site observation to an editable DPR (Section D: ISSUE/DELAY/SAFETY)' })
  addObservation(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AddDprObservationDto,
  ) {
    return this.service.addObservation(identity, dprId, dto);
  }

  @Delete('progress/reports/:dprId/observations/:obsId')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'dprId' })
  @ApiParam({ name: 'obsId' })
  @ApiOperation({ summary: 'Remove a site observation from an editable DPR' })
  removeObservation(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Param('obsId') obsId: string,
  ) {
    return this.service.removeObservation(identity, dprId, obsId);
  }

  // ── End Phase 3 ─────────────────────────────────────────────────────────────

  @Post('progress/reports/:dprId/submit')
  @RequirePermissions(PERMISSIONS.progressRecord)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Submit the report for approval' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.submit(identity, dprId);
  }

  @Post('progress/reports/:dprId/approve')
  @RequirePermissions(PERMISSIONS.progressApprove)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Approve the report — its measurements become verified progress' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.approve(identity, dprId);
  }

  @Post('progress/reports/:dprId/return')
  @RequirePermissions(PERMISSIONS.progressApprove)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Return a submitted report for revision' })
  returnForRevision(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: ReturnDprDto,
  ) {
    return this.service.returnForRevision(identity, dprId, dto.reason);
  }

  @Post('progress/reports/:dprId/reopen')
  @RequirePermissions(PERMISSIONS.progressApprove)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({
    summary: 'Reopen an APPROVED report for a controlled correction (ADR-021 CONST-PROG-010). ' +
      'Its verified progress drops out of the roll-up until it is corrected and re-approved.',
  })
  reopen(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: ReopenDprDto,
  ) {
    return this.service.reopen(identity, dprId, dto.reason);
  }
}
