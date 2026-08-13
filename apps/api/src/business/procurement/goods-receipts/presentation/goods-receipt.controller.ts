import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { GoodsReceiptService } from '../application/goods-receipt.service.js';
import { CreateGoodsReceiptDto, PostGoodsReceiptDto } from './dto/create-goods-receipt.dto.js';

@ApiTags('Procurement — Goods Receipts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/goods-receipts')
export class GoodsReceiptController {
  constructor(private readonly service: GoodsReceiptService) {}

  @Get()
  @ApiOperation({ summary: 'List goods receipts' })
  @ApiQuery({ name: 'purchaseOrderId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.service.findAll(identity, { purchaseOrderId });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.goodsReceiptsCreate)
  @ApiOperation({ summary: 'Create a goods receipt note against an ACTIVE PO revision' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateGoodsReceiptDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get goods receipt with lines and allocations' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/post')
  @RequirePermissions(PERMISSIONS.goodsReceiptsPost)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Post GRN: DRAFT → POSTED. Moves COMMITTED → ACCRUED in commitment ledger.' })
  post(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: PostGoodsReceiptDto) {
    return this.service.post(identity, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.goodsReceiptsCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel a GRN (not allowed after POSTED)' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.cancel(identity, id);
  }

  @Post(':id/approve-exception')
  @RequirePermissions(PERMISSIONS.goodsReceiptExceptionsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supervisor approves over-receipt exception: EXCEPTION_PENDING → DRAFT' })
  approveException(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.approveException(identity, id);
  }
}
