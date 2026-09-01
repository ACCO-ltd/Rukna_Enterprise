import { Controller, Delete, Get, Patch, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { WorkflowsService } from '../application/workflows.service.js';
import { ApprovalService } from '../application/approval.service.js';
import { WorkflowTransactionType } from '@erp/types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { CreatePolicyDraftDto } from './dto/create-policy-draft.dto.js';
import { AddPolicyRuleDto } from './dto/add-policy-rule.dto.js';
import { SimulatePolicyDto } from './dto/simulate-policy.dto.js';
import { ActivatePolicyDto, PolicyReasonDto, SchedulePolicyDto } from './dto/policy-lifecycle.dto.js';
import { ReorderPolicyRulesDto } from './dto/reorder-policy-rules.dto.js';
import { ManagePolicySodDto } from './dto/manage-policy-sod.dto.js';

@ApiTags('Workflows')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.workflowsView)
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly approvalService: ApprovalService,
  ) {}

  @Get('bindings')
  @ApiOperation({ summary: 'List the governance trigger bindings the organization is subject to' })
  @ApiResponse({
    status: 200,
    description:
      'Trigger bindings (org-specific + tenant defaults) with the definition each routes to. ' +
      'Read-only: shows what is wired and what is active.',
  })
  listBindings(@CurrentUser() identity: RequestIdentity) {
    return this.workflowsService.listBindings(identity.activeOrganizationId);
  }

  @Get('policies')
  @ApiOperation({ summary: 'List governed approval-policy versions for the active organization' })
  @ApiResponse({ status: 200, description: 'Policy versions with status, effective dates, and rule counts' })
  listPolicies(@CurrentUser() identity: RequestIdentity) {
    return this.workflowsService.listPolicyVersions(identity.activeOrganizationId);
  }

  // Static/specific policy segments are declared BEFORE `policies/:id` so `compare` and `by-key`
  // are not captured as an :id.
  @Get('policies/compare')
  @ApiOperation({ summary: 'Diff two versions of the same policy (backs comparison + rollback preview)' })
  @ApiResponse({ status: 200, description: 'Rule- and SoD-level differences between the base and target versions' })
  comparePolicyVersions(
    @CurrentUser() identity: RequestIdentity,
    @Query('base') base: string,
    @Query('target') target: string,
  ) {
    return this.workflowsService.comparePolicyVersions(identity.activeOrganizationId, base, target);
  }

  @Get('policies/by-key/:policyKey/versions')
  @ApiOperation({ summary: 'List every version of a single policy key (version-history view)' })
  @ApiParam({ name: 'policyKey', description: 'The stable policy key' })
  @ApiResponse({ status: 200, description: 'All versions, newest first, with status, effective dates, and rule counts' })
  policyVersionsByKey(@CurrentUser() identity: RequestIdentity, @Param('policyKey') policyKey: string) {
    return this.workflowsService.listPolicyVersionsByKey(identity.activeOrganizationId, policyKey);
  }

  @Get('policies/:id')
  policyDetail(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) { return this.workflowsService.getPolicyWithRules(identity.activeOrganizationId, id); }

  @Get('policies/:id/history')
  policyHistory(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) { return this.workflowsService.getPolicyHistory(identity.activeOrganizationId, id); }

  @Post('policies/:id/clone')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  clonePolicy(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: PolicyReasonDto) { return this.workflowsService.clonePolicyToDraft(identity.activeOrganizationId, id, identity.userId, dto.reason); }

  @Get('policies/:id/sod-rules')
  policySodRules(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) { return this.workflowsService.listPolicySodRules(identity.activeOrganizationId, id); }

  @Post('policies/:id/sod-rules')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  upsertDraftPolicySodRule(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ManagePolicySodDto) { return this.workflowsService.upsertDraftPolicySodRule(identity.activeOrganizationId, id, identity.userId, dto); }

  @Post('policies')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Create an inactive approval-policy draft version' })
  @ApiResponse({ status: 201, description: 'Draft created; it cannot route transactions until separately validated and published' })
  createPolicyDraft(@CurrentUser() identity: RequestIdentity, @Body() dto: CreatePolicyDraftDto) {
    return this.workflowsService.createPolicyDraft(identity.activeOrganizationId, dto);
  }

  @Post('policies/:id/rules')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Add a closed-schema, pending rule to a policy draft' })
  addRuleToDraft(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: AddPolicyRuleDto) {
    return this.workflowsService.addRuleToDraft(identity.activeOrganizationId, id, dto);
  }

  @Patch('policies/:id/rules/:ruleId')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  updateDraftRule(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('ruleId') ruleId: string, @Body() dto: AddPolicyRuleDto) { return this.workflowsService.updateDraftRule(identity.activeOrganizationId, id, ruleId, identity.userId, { requiredRole: dto.requiredRole, priority: dto.priority ?? 0, minAmount: dto.minAmount, maxAmount: dto.maxAmount, fromState: dto.fromState, toState: dto.toState }); }

  @Delete('policies/:id/rules/:ruleId')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  deleteDraftRule(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Param('ruleId') ruleId: string) { return this.workflowsService.deleteDraftRule(identity.activeOrganizationId, id, ruleId, identity.userId); }

  @Post('policies/:id/rules/reorder')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  reorderDraftRules(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReorderPolicyRulesDto) { return this.workflowsService.reorderDraftRules(identity.activeOrganizationId, id, identity.userId, dto.ruleIds); }

  @Post('policies/:id/validate')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Validate a draft policy without changing its state' })
  validateDraft(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.workflowsService.validateDraft(identity.activeOrganizationId, id);
  }

  @Post('policies/:id/simulate')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Preview a draft policy decision without creating an approval instance' })
  simulateDraft(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: SimulatePolicyDto) {
    return this.workflowsService.simulateDraft(identity.activeOrganizationId, id, dto);
  }

  @Post('policies/:id/submit-review')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  submitForReview(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: PolicyReasonDto) {
    return this.workflowsService.submitForReview(identity.activeOrganizationId, id, identity.userId, dto.reason);
  }

  @Post('policies/:id/schedule')
  @RequirePermissions(PERMISSIONS.workflowsPublish)
  schedulePolicy(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: SchedulePolicyDto) {
    return this.workflowsService.schedulePolicy(identity.activeOrganizationId, id, identity.userId, dto.reason, new Date(dto.effectiveFrom));
  }

  @Post('policies/:id/activate')
  @RequirePermissions(PERMISSIONS.workflowsPublish)
  activatePolicy(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ActivatePolicyDto) {
    return this.workflowsService.activatePolicy(identity.activeOrganizationId, id, identity.userId, dto.reason, dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined);
  }

  @Post('policies/:id/retire')
  @RequirePermissions(PERMISSIONS.workflowsPublish)
  retirePolicy(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: PolicyReasonDto) {
    return this.workflowsService.retirePolicy(identity.activeOrganizationId, id, identity.userId, dto.reason);
  }

  @Get('definition/:transactionType')
  @ApiOperation({ summary: 'Get the workflow definition for a transaction type' })
  @ApiParam({
    name: 'transactionType',
    enum: WorkflowTransactionType,
    description: 'The transaction type to retrieve the workflow definition for',
  })
  @ApiResponse({ status: 200, description: 'Workflow definition with approval steps' })
  getDefinition(
    @CurrentUser() identity: RequestIdentity,
    @Param('transactionType') transactionType: WorkflowTransactionType,
  ) {
    return this.workflowsService.getDefinitionForTransaction(identity.activeOrganizationId, transactionType);
  }

  @Get('instance/:instanceId/step')
  @ApiOperation({ summary: 'Get the current pending approval step for a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiResponse({ status: 200, description: 'Current approval step' })
  @ApiResponse({ status: 404, description: 'Instance not found' })
  getCurrentStep(
    @CurrentUser() identity: RequestIdentity,
    @Param('instanceId') instanceId: string,
  ) {
    return this.approvalService.getCurrentStep(instanceId, identity.activeOrganizationId);
  }

  @Post('instance/:instanceId/approve')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Approve the current step of a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { notes: { type: 'string', description: 'Optional approval notes' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Step approved' })
  @ApiResponse({ status: 403, description: 'Actor is not authorized to approve this step' })
  approve(
    @CurrentUser() identity: RequestIdentity,
    @Param('instanceId') instanceId: string,
    @Body() body: { notes?: string },
  ) {
    return this.approvalService.approve(instanceId, identity.userId, identity.roles, identity.activeOrganizationId, body.notes);
  }

  @Post('instance/:instanceId/reject')
  @RequirePermissions(PERMISSIONS.workflowsManage)
  @ApiOperation({ summary: 'Reject the current step of a workflow instance' })
  @ApiParam({ name: 'instanceId', description: 'Workflow instance CUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { notes: { type: 'string', description: 'Optional rejection reason' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Step rejected' })
  @ApiResponse({ status: 403, description: 'Actor is not authorized to reject this step' })
  reject(
    @CurrentUser() identity: RequestIdentity,
    @Param('instanceId') instanceId: string,
    @Body() body: { notes?: string },
  ) {
    return this.approvalService.reject(instanceId, identity.userId, identity.roles, identity.activeOrganizationId, body.notes);
  }
}
