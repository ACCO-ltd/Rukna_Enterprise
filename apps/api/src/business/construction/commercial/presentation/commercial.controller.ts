import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { CommercialService } from '../application/commercial.service.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';
import { BillStageDto } from './dto/bill-stage.dto.js';

@ApiTags('Commercial')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.contractsView)
@ProjectScoped('projectId')
@Controller('projects/:projectId/commercial')
export class CommercialController {
  constructor(
    private readonly commercialService: CommercialService,
    private readonly commercialBillingService: CommercialBillingService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Permission-aware commercial summary for a project (ADR-017 §B2)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getSummary(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getSummary(identity, projectId);
  }

  @Get('applications')
  @ApiOperation({
    summary: 'Consolidated IPA → IPC → invoice → settlement chain for a project (ADR-017 §B3)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getApplications(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getApplications(identity, projectId);
  }

  @Get('billing')
  @ApiOperation({
    summary:
      "The project's billing position, invoices, receipts and ageing — invoice-total basis",
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getBilling(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getBilling(identity, projectId);
  }

  @Get('current-cycle')
  @ApiOperation({ summary: 'Authoritative current commercial cycle and next action' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  getCurrentCycle(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.commercialService.getCurrentCycle(identity, projectId);
  }

  // ─── ADR-030 CONST-COM-028 (Commercial redesign P1): variation billing ────────────

  @Get('billing-packages')
  @ApiOperation({
    summary: 'ADR-030 S-VB-7: Billing Packages for a contract (milestone invoice + VO lines grouped)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({ name: 'contractId', description: 'Contract ID' })
  getBillingPackages(
    @CurrentUser() identity: RequestIdentity,
    @Query('contractId') contractId: string,
  ) {
    return this.commercialBillingService.getBillingPackages(identity, contractId);
  }

  @Post('bill-stage')
  @HttpCode(HttpStatus.OK)
  // A WRITE that raises AR invoices: require the invoice-generation permission in addition to the
  // class-level commercial-view gate (getAllAndOverride takes the method value, so both are listed).
  @RequirePermissions(PERMISSIONS.contractsView, PERMISSIONS.receivablesManage)
  @ApiOperation({
    summary:
      'ADR-030 S-VB-5: bill a milestone stage — milestone invoice + one invoice per included variation',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 400, description: 'Omission against an already-invoiced stage (credit note required)' })
  @ApiResponse({ status: 404, description: 'Installment not found' })
  billStage(@CurrentUser() identity: RequestIdentity, @Body() dto: BillStageDto) {
    return this.commercialBillingService.billStage(identity, dto);
  }
}
