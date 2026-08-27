import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { VariationOrderService } from '../application/variation-order.service.js';
import { ExtensionOfTimeService } from '../application/extension-of-time.service.js';
import { GrantExtensionOfTimeDto } from './dto/grant-extension-of-time.dto.js';
import { CreateVariationDto } from './dto/create-variation.dto.js';
import { UpdateVariationDto } from './dto/update-variation.dto.js';
import { AddVariationLineDto, UpdateVariationLineDto } from './dto/variation-line.dto.js';
import {
  ClientApproveVariationDto,
  RejectVariationDto,
  WithdrawVariationDto,
} from './dto/lifecycle.dto.js';

/**
 * ADR-026 (Variations Phase 1) — VariationOrder endpoints.
 *
 * RBAC reuses the contracts module's commercial scheme (no new permission invented): `contractsView`
 * to read, `contractsManage` to create/edit/line-CRUD/submit/withdraw, `contractsApprove` for the
 * two approval transitions and reject. Membership/tenancy is enforced in the service via
 * `projectAccess.assertContract`.
 */
@ApiTags('Variations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.contractsView)
@Controller()
export class VariationsController {
  constructor(
    private readonly service: VariationOrderService,
    private readonly extensionOfTime: ExtensionOfTimeService,
  ) {}

  // ─── Contract-scoped ──────────────────────────────────────────────────────────

  @Get('contracts/:contractId/variations')
  @ApiOperation({ summary: 'List variation orders for a contract (ADR-026)' })
  @ApiParam({ name: 'contractId' })
  list(@CurrentUser() identity: RequestIdentity, @Param('contractId') contractId: string) {
    return this.service.listForContract(identity, contractId);
  }

  @Post('contracts/:contractId/variations')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @ApiOperation({ summary: 'Create a variation order in DRAFT (assigns the next VO-00n reference)' })
  @ApiParam({ name: 'contractId' })
  @ApiResponse({ status: 201, description: 'Variation created' })
  create(
    @CurrentUser() identity: RequestIdentity,
    @Param('contractId') contractId: string,
    @Body() dto: CreateVariationDto,
  ) {
    return this.service.create(identity, contractId, dto);
  }

  // ─── Extension of Time (ADR-026 CONST-VAR-009, Phase 4) ──────────────────────
  //
  // A distinct, explicit, audited command on the Contract that moves the contractual completion date.
  // It NEVER fires automatically on VO approval; citing VOs is justification, not effect. RBAC reuses
  // the same commercial scheme: view to read the history, manage to grant.

  @Get('contracts/:contractId/extension-of-time')
  @ApiOperation({ summary: 'List the extension-of-time history for a contract (newest first)' })
  @ApiParam({ name: 'contractId' })
  listExtensions(
    @CurrentUser() identity: RequestIdentity,
    @Param('contractId') contractId: string,
  ) {
    return this.extensionOfTime.listForContract(identity, contractId);
  }

  @Post('contracts/:contractId/extension-of-time')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @ApiOperation({
    summary:
      'Grant an extension of time: explicitly move the contract completion date (may cite VOs as justification)',
  })
  @ApiParam({ name: 'contractId' })
  @ApiResponse({ status: 201, description: 'Extension recorded; contract expectedEndDate updated' })
  @ApiResponse({ status: 400, description: 'A cited VO does not belong to this contract' })
  @ApiResponse({ status: 409, description: 'Contract is not live (terminal or not yet executed)' })
  grantExtension(
    @CurrentUser() identity: RequestIdentity,
    @Param('contractId') contractId: string,
    @Body() dto: GrantExtensionOfTimeDto,
  ) {
    return this.extensionOfTime.grant(identity, contractId, dto);
  }

  // ─── Single variation ───────────────────────────────────────────────────────

  @Get('variations/:id')
  @ApiOperation({ summary: 'Get a variation order with its lines and derived net price' })
  @ApiParam({ name: 'id' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findOne(identity, id);
  }

  @Patch('variations/:id')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @ApiOperation({ summary: 'Edit a DRAFT variation header (title/description/proposed time impact)' })
  @ApiParam({ name: 'id' })
  updateHeader(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateVariationDto,
  ) {
    return this.service.updateHeader(identity, id, dto);
  }

  // ─── Line CRUD (DRAFT only) ─────────────────────────────────────────────────

  @Post('variations/:id/lines')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @ApiOperation({ summary: 'Add a line to a DRAFT variation (negative quantity = omission)' })
  @ApiParam({ name: 'id' })
  addLine(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddVariationLineDto,
  ) {
    return this.service.addLine(identity, id, dto);
  }

  @Patch('variations/:id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @ApiOperation({ summary: 'Update a line on a DRAFT variation' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'lineId' })
  updateLine(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateVariationLineDto,
  ) {
    return this.service.updateLine(identity, id, lineId, dto);
  }

  @Delete('variations/:id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line from a DRAFT variation' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'lineId' })
  removeLine(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.service.removeLine(identity, id, lineId);
  }

  // ─── Lifecycle transitions ──────────────────────────────────────────────────

  @Post('variations/:id/submit')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit for internal approval: DRAFT → PENDING_INTERNAL (closes editing)' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.submit(identity, id);
  }

  @Post('variations/:id/internal-approve')
  @RequirePermissions(PERMISSIONS.contractsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Internal DOA approval: PENDING_INTERNAL → INTERNAL_APPROVED (governance-gated on |net price|; figures freeze)',
  })
  @ApiResponse({ status: 409, description: 'Gated: workflow approval required (approvalInstanceId in details)' })
  internalApprove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.internalApprove(identity, id);
  }

  @Post('variations/:id/client-approve')
  @RequirePermissions(PERMISSIONS.contractsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record client + contractual approval: INTERNAL_APPROVED → CLIENT_APPROVED (counts toward governing value)',
  })
  clientApprove(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ClientApproveVariationDto,
  ) {
    return this.service.clientApprove(identity, id, dto);
  }

  @Post('variations/:id/reject')
  @RequirePermissions(PERMISSIONS.contractsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a variation (any pre-client state → REJECTED; reason required)' })
  reject(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: RejectVariationDto,
  ) {
    return this.service.reject(identity, id, dto);
  }

  @Post('variations/:id/withdraw')
  @RequirePermissions(PERMISSIONS.contractsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a variation before a decision (→ WITHDRAWN)' })
  withdraw(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: WithdrawVariationDto,
  ) {
    return this.service.withdraw(identity, id, dto);
  }
}
