import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgressService } from '../application/progress.service.js';
import {
  CreateDprDto,
  AddMeasurementDto,
  AttachEvidenceDto,
  ReturnDprDto,
  ReopenDprDto,
  CreateWorkPackageDto,
  AllocateBoqNodeDto,
  SetProgressTargetsDto,
  CreateProgrammeActivityDto,
  UpdateProgrammeActivityDto,
  CaptureProgressSnapshotDto,
} from './dto/progress.dto.js';

// ADR-021 Progress MVP: daily progress reports + measurements + evidence, and verified progress.
// Capability gate mirrors the rest of construction (view:project to read, manage:project to
// write); project membership is enforced per-call in the service via projectAccess.assertMember.
// ADR-022 will refine the write chain (Site Engineer submits, PM approves).
@ApiTags('Progress')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller()
export class ProgressController {
  constructor(private readonly service: ProgressService) {}

  @Post('projects/:projectId/progress/reports')
  @RequirePermissions(PERMISSIONS.projectsManage)
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
  @ApiOperation({ summary: 'Weighted project physical % (work-package roll-up)' })
  rollup(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.getRollup(identity, projectId);
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
  @RequirePermissions(PERMISSIONS.projectsManage)
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
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Attach an uploaded evidence file (photo / measurement sheet)' })
  attachEvidence(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: AttachEvidenceDto,
  ) {
    return this.service.attachEvidence(identity, dprId, dto.platformFileId);
  }

  @Post('progress/reports/:dprId/submit')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Submit the report for approval' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.submit(identity, dprId);
  }

  @Post('progress/reports/:dprId/approve')
  @RequirePermissions(PERMISSIONS.projectsManage)
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Approve the report — its measurements become verified progress' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.approve(identity, dprId);
  }

  @Post('progress/reports/:dprId/return')
  @RequirePermissions(PERMISSIONS.projectsManage)
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
  @RequirePermissions(PERMISSIONS.projectsManage)
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
