import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards,
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

@ApiTags('Buyer Advances')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('buyer-advances')
export class BuyerAdvanceController {
  constructor(private readonly buyerAdvanceService: BuyerAdvanceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a buyer advance in DRAFT status' })
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
  @ApiOperation({ summary: 'Get a buyer advance with returns, evidence allocations, and computed outstanding balance' })
  findById(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
  ) {
    return this.buyerAdvanceService.findById(identity, id);
  }

  @Get()
  @ApiQuery({ name: 'purchaseOrderId', required: true, description: 'Filter advances by purchase order' })
  @ApiOperation({ summary: 'List buyer advances for a purchase order' })
  findByPurchaseOrder(
    @CurrentUser() identity: RequestIdentity,
    @Query('purchaseOrderId') purchaseOrderId: string,
  ) {
    return this.buyerAdvanceService.findByPurchaseOrder(identity, purchaseOrderId);
  }

  @Post(':id/returns')
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({ summary: 'Record a return of unused advance funds' })
  @ApiResponse({ status: 400, description: 'destinationBankAccountId required for BANK/MOBILE_MONEY return method' })
  @ApiResponse({ status: 404, description: 'Advance or bank account not found' })
  createReturn(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: CreateAdvanceReturnDto,
  ) {
    return this.buyerAdvanceService.createReturn(identity, id, {
      amount: dto.amount,
      returnMethod: dto.returnMethod,
      destinationBankAccountId: dto.destinationBankAccountId,
      receivedBy: dto.receivedBy,
      receivedAt: dto.receivedAt,
      reference: dto.reference,
      note: dto.note,
    });
  }

  @Post(':id/evidence-allocations')
  @ApiParam({ name: 'id', description: 'Buyer advance ID' })
  @ApiOperation({ summary: 'Link a supplier bill as evidence of advance spending' })
  @ApiResponse({ status: 404, description: 'Advance or supplier bill not found in this organization' })
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
