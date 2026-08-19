import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { ProgressService } from '../application/progress.service.js';
import {
  CreateDprDto,
  AddMeasurementDto,
  AttachEvidenceDto,
  ReturnDprDto,
  CreateWorkPackageDto,
  AllocateBoqNodeDto,
} from './dto/progress.dto.js';

// ADR-021 Progress MVP: daily progress reports + measurements + evidence, and verified progress.
@ApiTags('Progress')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class ProgressController {
  constructor(private readonly service: ProgressService) {}

  @Post('projects/:projectId/progress/reports')
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

  @Post('projects/:projectId/work-packages')
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
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Submit the report for approval' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.submit(identity, dprId);
  }

  @Post('progress/reports/:dprId/approve')
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Approve the report — its measurements become verified progress' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('dprId') dprId: string) {
    return this.service.approve(identity, dprId);
  }

  @Post('progress/reports/:dprId/return')
  @ApiParam({ name: 'dprId' })
  @ApiOperation({ summary: 'Return a submitted report for revision' })
  returnForRevision(
    @CurrentUser() identity: RequestIdentity,
    @Param('dprId') dprId: string,
    @Body() dto: ReturnDprDto,
  ) {
    return this.service.returnForRevision(identity, dprId, dto.reason);
  }
}
