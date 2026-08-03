import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { ContractService } from '../application/contract.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { CancelContractDto } from './dto/cancel-contract.dto.js';
import { TerminateContractDto } from './dto/terminate-contract.dto.js';
import { AddAdvanceTermDto } from './dto/add-advance-term.dto.js';
import { AddGuaranteeDto } from './dto/add-guarantee.dto.js';
import { UpdateGuaranteeDto } from './dto/update-guarantee.dto.js';
import { AddMilestoneDto } from './dto/add-milestone.dto.js';
import { AddRetentionTermsDto } from './dto/add-retention-terms.dto.js';

@ApiTags('Contracts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractService: ContractService) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List contracts for the authenticated organization' })
  @ApiQuery({ name: 'projectId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('projectId') projectId?: string,
  ) {
    return this.contractService.findAll(identity, projectId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new contract in DRAFT status' })
  @ApiResponse({ status: 201, description: 'Contract created' })
  @ApiResponse({ status: 409, description: 'Contract number already exists' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateContractDto) {
    return this.contractService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contract details with all sub-entities' })
  @ApiParam({ name: 'id' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.contractService.findOne(identity, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contract (DRAFT status only)' })
  @ApiParam({ name: 'id' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contractService.update(identity, id, dto);
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit contract for review: DRAFT → UNDER_REVIEW' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.contractService.transition(identity, id, 'submit');
  }

  @Post(':id/approve-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve review: UNDER_REVIEW → PENDING_SIGNATURE' })
  approveReview(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.contractService.transition(identity, id, 'approve-review');
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark contract as executed: PENDING_SIGNATURE → ACTIVE. Freezes client name and tax snapshots.' })
  execute(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.contractService.transition(identity, id, 'execute');
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close contract: FINAL_ACCOUNT_PENDING → CLOSED' })
  close(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.contractService.transition(identity, id, 'close');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel contract (allowed from DRAFT, UNDER_REVIEW, PENDING_SIGNATURE)' })
  @ApiResponse({ status: 400, description: 'Cannot cancel from current status' })
  cancel(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CancelContractDto,
  ) {
    return this.contractService.cancel(identity, id, dto.reason);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate contract: ACTIVE → TERMINATED' })
  @ApiResponse({ status: 400, description: 'Only ACTIVE contracts can be terminated' })
  terminate(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: TerminateContractDto,
  ) {
    return this.contractService.terminate(identity, id, dto.reason);
  }

  // ─── Retention terms ──────────────────────────────────────────────────────────

  @Post(':id/retention-terms')
  @ApiOperation({ summary: 'Set or replace retention terms for the contract' })
  @ApiParam({ name: 'id' })
  setRetentionTerms(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddRetentionTermsDto,
  ) {
    return this.contractService.setRetentionTerms(identity, id, dto);
  }

  // ─── Advance terms ────────────────────────────────────────────────────────────

  @Post(':id/advance-terms')
  @ApiOperation({ summary: 'Add an advance term to the contract' })
  @ApiParam({ name: 'id' })
  addAdvanceTerm(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddAdvanceTermDto,
  ) {
    return this.contractService.addAdvanceTerm(identity, id, dto);
  }

  @Delete(':id/advance-terms/:termId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an advance term' })
  removeAdvanceTerm(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('termId') termId: string,
  ) {
    return this.contractService.removeAdvanceTerm(identity, id, termId);
  }

  // ─── Guarantees ───────────────────────────────────────────────────────────────

  @Post(':id/guarantees')
  @ApiOperation({ summary: 'Add a guarantee (e.g. performance bond, advance guarantee)' })
  @ApiParam({ name: 'id' })
  addGuarantee(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddGuaranteeDto,
  ) {
    return this.contractService.addGuarantee(identity, id, dto);
  }

  @Patch(':id/guarantees/:guaranteeId')
  @ApiOperation({ summary: 'Update guarantee status or notes' })
  updateGuarantee(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('guaranteeId') guaranteeId: string,
    @Body() dto: UpdateGuaranteeDto,
  ) {
    return this.contractService.updateGuarantee(identity, id, guaranteeId, dto);
  }

  // ─── Milestones ───────────────────────────────────────────────────────────────

  @Post(':id/milestones')
  @ApiOperation({ summary: 'Add a contract milestone' })
  @ApiParam({ name: 'id' })
  addMilestone(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddMilestoneDto,
  ) {
    return this.contractService.addMilestone(identity, id, dto);
  }

  @Post(':id/milestones/:milestoneId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a contract milestone as complete' })
  completeMilestone(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.contractService.completeMilestone(identity, id, milestoneId);
  }
}
