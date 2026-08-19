import {
  Controller,
  Get,
  Post,
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
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { IpaService } from '../application/ipa.service.js';
import { CreateIpaDto } from './dto/create-ipa.dto.js';
import { AddIpaItemDto } from './dto/add-ipa-item.dto.js';
import { AddIpaDeductionDto } from './dto/add-ipa-deduction.dto.js';

@ApiTags('IPA')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.ipaView)
@Controller('ipa')
export class IpaController {
  constructor(private readonly ipaService: IpaService) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List interim payment applications' })
  @ApiQuery({ name: 'contractId', required: false, description: 'Filter by contract. Mutually exclusive with projectId.' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project (resolves all contracts for the project). Mutually exclusive with contractId.' })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('contractId') contractId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.ipaService.findAll(identity, contractId, projectId);
  }

  @Get('prefill')
  @ApiOperation({
    summary:
      'ADR-021/023: suggested claim quantities from verified physical progress (firewall-safe — a QS confirms).',
  })
  @ApiQuery({ name: 'contractId', required: true })
  getPrefill(@CurrentUser() identity: RequestIdentity, @Query('contractId') contractId: string) {
    return this.ipaService.getPrefill(identity, contractId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ipaCreate)
  @ApiOperation({ summary: 'Create a new IPA in DRAFT status' })
  @ApiResponse({ status: 201, description: 'IPA created' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateIpaDto) {
    return this.ipaService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get IPA details with items and deductions' })
  @ApiParam({ name: 'id' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.findOne(identity, id);
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  @Post(':id/submit-for-approval')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit IPA for internal approval: DRAFT → PENDING_INTERNAL_APPROVAL' })
  submitForApproval(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.transition(identity, id, 'submit-for-approval');
  }

  @Post(':id/return-for-revision')
  @RequirePermissions(PERMISSIONS.ipaApprove)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return IPA for revision: PENDING_INTERNAL_APPROVAL → RETURNED_FOR_REVISION' })
  returnForRevision(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.transition(identity, id, 'return-for-revision');
  }

  @Post(':id/approve-for-submission')
  @RequirePermissions(PERMISSIONS.ipaApprove)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve IPA for submission: PENDING_INTERNAL_APPROVAL → APPROVED_FOR_SUBMISSION. Assigns application number.' })
  approveForSubmission(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.transition(identity, id, 'approve-for-submission');
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark IPA as submitted to client: APPROVED_FOR_SUBMISSION → SUBMITTED. IPA becomes immutable.' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.transition(identity, id, 'submit');
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel IPA (allowed from DRAFT or RETURNED_FOR_REVISION)' })
  @ApiResponse({ status: 400, description: 'Cannot cancel from current status' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipaService.cancel(identity, id);
  }

  // ─── Items ────────────────────────────────────────────────────────────────────

  @Post(':id/items')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @ApiOperation({ summary: 'Add a BOQ line item to the IPA. Automatically resolves previousEffectiveCertified from last effective IPC.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 400, description: 'IPA is not in a mutable status' })
  addItem(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddIpaItemDto,
  ) {
    return this.ipaService.addItem(identity, id, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an IPA line item (DRAFT or RETURNED_FOR_REVISION only)' })
  removeItem(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.ipaService.removeItem(identity, id, itemId);
  }

  // ─── Deductions ───────────────────────────────────────────────────────────────

  @Post(':id/deductions')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @ApiOperation({ summary: 'Add a deduction line to the IPA (retention, advance recovery, tax)' })
  @ApiParam({ name: 'id' })
  addDeduction(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddIpaDeductionDto,
  ) {
    return this.ipaService.addDeduction(identity, id, dto);
  }

  @Delete(':id/deductions/:deductionId')
  @RequirePermissions(PERMISSIONS.ipaManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an IPA deduction line' })
  removeDeduction(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('deductionId') deductionId: string,
  ) {
    return this.ipaService.removeDeduction(identity, id, deductionId);
  }
}
