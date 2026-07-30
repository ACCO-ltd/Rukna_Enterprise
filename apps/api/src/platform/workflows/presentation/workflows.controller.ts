import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WorkflowsService } from '../application/workflows.service.js';
import { ApprovalService } from '../application/approval.service.js';
import { WorkflowTransactionType } from '@erp/types';

@Controller('workflows')
@UseGuards(AuthGuard('jwt'))
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly approvalService: ApprovalService,
  ) {}

  @Get('definition/:transactionType')
  getDefinition(
    @Param('transactionType') transactionType: WorkflowTransactionType,
    @Body('organizationId') organizationId: string,
  ) {
    return this.workflowsService.getDefinitionForTransaction(organizationId, transactionType);
  }

  @Get('instance/:instanceId/step')
  getCurrentStep(@Param('instanceId') instanceId: string) {
    return this.approvalService.getCurrentStep(instanceId);
  }

  @Post('instance/:instanceId/approve')
  approve(
    @Param('instanceId') instanceId: string,
    @Body() body: { actorId: string; notes?: string },
  ) {
    return this.approvalService.approve(instanceId, body.actorId, body.notes);
  }

  @Post('instance/:instanceId/reject')
  reject(
    @Param('instanceId') instanceId: string,
    @Body() body: { actorId: string; notes?: string },
  ) {
    return this.approvalService.reject(instanceId, body.actorId, body.notes);
  }
}
