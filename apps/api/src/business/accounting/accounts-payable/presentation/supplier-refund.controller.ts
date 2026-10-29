import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SupplierRefundService } from '../application/supplier-refund.service.js';
import { RecordSupplierRefundDto, ReverseSupplierRefundDto } from './dto/supplier-refund.dto.js';

@ApiTags('Supplier Payments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller()
export class SupplierRefundController {
  constructor(private readonly refunds: SupplierRefundService) {}

  @Get('payments/:paymentId/refunds')
  @ApiOperation({ summary: 'AP-5: refunds the supplier paid back from this payment’s unapplied balance' })
  list(@CurrentUser() identity: RequestIdentity, @Param('paymentId') paymentId: string) {
    return this.refunds.listForPayment(identity, paymentId);
  }

  @Post('payments/:paymentId/refunds')
  @ApiOperation({ summary: 'AP-5: record money the supplier paid back (posts at once: Dr bank / Cr Supplier advance)' })
  @ApiResponse({ status: 400, description: 'REFUND_AMOUNT_INVALID · REFUND_DATE_INVALID · REASON_REQUIRED · PAYMENT_NOT_POSTED · BANK_ACCOUNT_CANNOT_RECEIVE · CURRENCY_MISMATCH · REFUND_EXCEEDS_UNAPPLIED' })
  record(@CurrentUser() identity: RequestIdentity, @Param('paymentId') paymentId: string, @Body() dto: RecordSupplierRefundDto) {
    return this.refunds.record(identity, { paymentId, ...dto });
  }

  @Post('supplier-refunds/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AP-5: reverse a supplier refund (e.g. the transfer bounced); the money is unapplied on the payment again' })
  @ApiResponse({ status: 409, description: 'REFUND_NOT_POSTED' })
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseSupplierRefundDto) {
    return this.refunds.reverse(identity, id, dto);
  }
}
