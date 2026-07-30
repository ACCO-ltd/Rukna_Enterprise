import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { WorkflowsService } from '../application/workflows.service.js';
import { ApprovalService } from '../application/approval.service.js';
import { WorkflowTransactionType } from '@erp/types';

@ApiTags('Workflows')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly approvalService: ApprovalService,
  ) {}

  @Get('definition/:transactionType')
  @ApiOperation({ summary: 'Get the workflow definition for a transaction type' })
  @ApiParam({
    name: 'transactionType',
    enum: WorkflowTransactionType,
    description: 'The transaction type to retrieve the workflow definition for',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['organizationId'],
      properties: { organizationId: { type: 'string', description: 'Organization CUID' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Workflow definition with approval steps' })
  getDefinition(
    @Param('transactionType') transactionType: WorkflowTransactionType,
    @Body('organizationId') organizationId: string,
  ) {
    return this.workflowsService.getDefinitionForTransaction(organizationId, transactionType);
  }

  @Get('instance/:instanceId/step')
  @ApiOperation({ summary: 'Get the current pending approval step for a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiResponse({ status: 200, description: 'Current approval step' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  getCurrentStep(@Param('instanceId') instanceId: string) {
    return this.approvalService.getCurrentStep(instanceId);
  }

  @Post('instance/:instanceId/approve')
  @ApiOperation({ summary: 'Approve the current step of a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['actorId'],
      properties: {
        actorId: { type: 'string', description: 'User CUID of the approver' },
        notes: { type: 'string', description: 'Optional approval notes' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Step approved' })
  @ApiResponse({ status: 403, description: 'Actor is not authorized to approve this step' })
  approve(
    @Param('instanceId') instanceId: string,
    @Body() body: { actorId: string; notes?: string },
  ) {
    return this.approvalService.approve(instanceId, body.actorId, body.notes);
  }

  @Post('instance/:instanceId/reject')
  @ApiOperation({ summary: 'Reject the current step of a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['actorId'],
      properties: {
        actorId: { type: 'string', description: 'User CUID of the rejector' },
        notes: { type: 'string', description: 'Optional rejection reason' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Step rejected' })
  @ApiResponse({ status: 403, description: 'Actor is not authorized to reject this step' })
  reject(
    @Param('instanceId') instanceId: string,
    @Body() body: { actorId: string; notes?: string },
  ) {
    return this.approvalService.reject(instanceId, body.actorId, body.notes);
  }
}
