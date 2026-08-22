import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { ReceiptExceptionService } from '../application/receipt-exception.service.js';
import { RequestReceiptExceptionDto, RejectReceiptExceptionDto } from './dto/receipt-exception.dto.js';

/**
 * ADR-022 CONST-DOA-004 — the documented exception that lets a PO creator receive against their own
 * order: request → independent supervisor verifies → CFO approves. Distinct from the over-receipt
 * (quantity) exception on the GRN itself.
 */
@ApiTags('Goods Receipt Exceptions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/receipt-exceptions')
export class ReceiptExceptionController {
  constructor(private readonly service: ReceiptExceptionService) {}

  @Get()
  @ApiQuery({ name: 'purchaseOrderId', required: true })
  @ApiOperation({ summary: 'List receipt exceptions for a purchase order' })
  list(@CurrentUser() identity: RequestIdentity, @Query('purchaseOrderId') purchaseOrderId: string) {
    return this.service.list(identity, purchaseOrderId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.goodsReceiptsCreate)
  @ApiOperation({ summary: 'Request an exception for the PO creator to receive against their order' })
  request(@CurrentUser() identity: RequestIdentity, @Body() dto: RequestReceiptExceptionDto) {
    return this.service.request(identity, dto.purchaseOrderId, dto.reason);
  }

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.goodsReceiptsCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Independent supervisor verifies receipt (must not be the receiver)' })
  @ApiResponse({ status: 403, description: 'The receiver cannot verify their own exception' })
  verify(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.verify(identity, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.goodsReceiptExceptionsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'CFO approves the documented exception (distinct from receiver + supervisor)' })
  @ApiResponse({ status: 403, description: 'Only the CFO can approve, and not the receiver or supervisor' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.approve(identity, id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.goodsReceiptExceptionsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reject a receipt exception' })
  reject(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: RejectReceiptExceptionDto,
  ) {
    return this.service.reject(identity, id, dto.reason);
  }
}
