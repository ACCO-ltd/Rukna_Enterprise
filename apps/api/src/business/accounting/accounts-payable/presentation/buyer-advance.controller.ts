import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiParam, ApiQuery, ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { BuyerAdvanceService } from '../application/buyer-advance.service.js';
import { CreateBuyerAdvanceDto } from './dto/create-buyer-advance.dto.js';
import { CreateAdvanceReturnDto } from './dto/create-advance-return.dto.js';
import { CreateEvidenceAllocationDto } from './dto/create-evidence-allocation.dto.js';
import {
  CreateAdvanceApplicationDto,
  ReleaseBuyerAdvanceDto,
  ReverseAdvanceApplicationDto,
  ReverseBuyerAdvanceDto,
} from './dto/award-payment.dto.js';

/**
 * Buyer (staff) cash advances — ADR-045 §2. Every route is a Finance money command or read
 * (`manage:payable`); the buyer never calls these.
 */
@ApiTags('Buyer Advances')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('buyer-advances')
export class BuyerAdvanceController {
  constructor(private readonly buyerAdvanceService: BuyerAdvanceService) {}

  @Get('release-draft')
  @ApiQuery({ name: 'quotationRequestId', required: true })
  @ApiOperation({ summary: 'ADR-045 — prefill for "Release cash" from an award: order, recipients, cash accounts, blockers' })
  releaseDraft(@CurrentUser() identity: RequestIdentity, @Query('quotationRequestId') quotationRequestId: string) {
    return this.buyerAdvanceService.releaseDraft(identity, quotationRequestId);
  }

  @Post('release')
  @ApiOperation({
    summary:
      'ADR-045 — release buyer cash in one tap: create, approve (DoA) and post EVT-AP-007. Idempotent on ' +
      'idempotencyKey; 409 { approvalInstanceId } while waiting for approval — re-drive with the same body.',
  })
  @ApiResponse({ status: 201, description: '{ advance, payment }' })
  release(@CurrentUser() identity: RequestIdentity, @Body() dto: ReleaseBuyerAdvanceDto) {
    return this.buyerAdvanceService.release(identity, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a buyer advance in DRAFT status (posted by POST /:id/post through the same checks)' })
  create(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: CreateBuyerAdvanceDto,
  ) {
    return this.buyerAdvanceService.create(identity, {
      purchaseOrderId: dto.purchaseOrderId,
      recipientUserId: dto.recipientUserId,
      amount: dto.amount,
      currencyCode: dto.currencyCode,
      paymentMethod: dto.paymentMethod,
      disbursementBankAccountId: dto.disbursementBankAccountId,
      reference: dto.reference,
      notes: dto.notes,
      advancedAt: dto.advancedAt,
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'A buyer advance with its applications, returns, journals, outstanding and legacy flag' })
  findById(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
  ) {
    return this.buyerAdvanceService.findById(identity, id);
  }

  @Get()
  @ApiQuery({ name: 'purchaseOrderId', required: false, description: 'Filter advances by purchase order; omit for org-wide' })
  @ApiQuery({ name: 'limit', required: false, description: 'Org-wide cap (default 100, max 500)' })
  @ApiOperation({ summary: 'List buyer advances (one PO, or org-wide newest first) with PO number and supplier' })
  findByPurchaseOrder(
    @CurrentUser() identity: RequestIdentity,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
    return this.buyerAdvanceService.list(identity, {
      purchaseOrderId: purchaseOrderId || undefined,
      limit: n !== undefined && Number.isFinite(n) ? n : undefined,
    });
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({
    summary: 'Release a DRAFT advance: DoA gate + SoD, then EVT-AP-007 (Dr Staff advances / Cr the account) on advancedAt.',
  })
  @ApiResponse({ status: 409, description: 'Already posted, or waiting for approval ({ approvalInstanceId })' })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
  ) {
    return this.buyerAdvanceService.post(identity, id);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted advance (mirror journal on reversalDate) or cancel a DRAFT one — only while nothing is applied or returned' })
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseBuyerAdvanceDto) {
    return this.buyerAdvanceService.reverse(identity, id, { reason: dto.reason, reversalDate: dto.reversalDate ?? '' });
  }

  @Post(':id/returns')
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({ summary: 'Record change returned by the buyer (capped at outstanding) — posts EVT-AP-009 on receivedAt' })
  @ApiResponse({ status: 422, description: 'RETURN_EXCEEDS_OUTSTANDING' })
  createReturn(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CreateAdvanceReturnDto,
  ) {
    return this.buyerAdvanceService.createReturn(identity, id, {
      amount: dto.amount,
      returnMethod: dto.returnMethod,
      destinationBankAccountId: dto.destinationBankAccountId,
      // receivedBy is set server-side from the authenticated identity, not from the client.
      receivedBy: identity.userId,
      receivedAt: dto.receivedAt,
      reference: dto.reference,
      note: dto.note,
    });
  }

  @Post(':id/applications')
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({ summary: 'Apply the advance to a posted bill of its order — EVT-AP-008 Dr AP / Cr Staff advances' })
  createApplication(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CreateAdvanceApplicationDto,
  ) {
    return this.buyerAdvanceService.createApplication(identity, id, { supplierBillId: dto.supplierBillId, amount: dto.amount });
  }

  @Post(':id/applications/:appId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'appId' })
  @ApiOperation({ summary: 'Reverse an application — mirror journal on the application date, bill outstanding restored' })
  reverseApplication(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('appId') appId: string,
    @Body() dto: ReverseAdvanceApplicationDto,
  ) {
    return this.buyerAdvanceService.reverseApplication(identity, id, appId, dto.reason);
  }

  @Post(':id/evidence-allocations')
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({ summary: 'Alias of POST /:id/applications (legacy body { supplierBillId, allocatedAmount })' })
  createEvidenceAllocation(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CreateEvidenceAllocationDto,
  ) {
    return this.buyerAdvanceService.createEvidenceAllocation(identity, id, {
      supplierBillId: dto.supplierBillId,
      allocatedAmount: dto.allocatedAmount,
    });
  }
}
