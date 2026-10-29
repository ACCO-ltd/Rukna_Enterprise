import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { ClientRefundService } from '../application/client-refund.service.js';
import { RejectWriteOffDto, RequestRefundDto, ReverseCreditNoteRequestDto } from './dto/credit-note.dto.js';

/** AR-5 — refunds of client cash held on account: requested on a receipt, decided and reversed by id. */
@ApiTags('Customer Receipts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller()
export class ClientRefundController {
  constructor(private readonly refunds: ClientRefundService) {}

  @Get('customer-receipts/:receiptId/refunds')
  @ApiOperation({ summary: 'AR-5: the refunds paid from a receipt, oldest first' })
  list(@CurrentUser() identity: RequestIdentity, @Param('receiptId') receiptId: string) {
    return this.refunds.listForReceipt(identity, receiptId);
  }

  @Post('customer-receipts/:receiptId/refunds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AR-5: pay back cash held on account — posts at once up to the payment limit, else waits for approval' })
  request(@CurrentUser() identity: RequestIdentity, @Param('receiptId') receiptId: string, @Body() dto: RequestRefundDto) {
    return this.refunds.request(identity, { receiptId, ...dto });
  }

  @Post('client-refunds/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-5: approve a refund above the payment limit (not the requester); it posts' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.refunds.approve(identity, id);
  }

  @Post('client-refunds/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RejectWriteOffDto) {
    return this.refunds.reject(identity, id, dto.reason);
  }

  @Post('client-refunds/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AR-5: reverse a posted refund; the cash is on account again' })
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseCreditNoteRequestDto) {
    return this.refunds.reverse(identity, id, dto);
  }
}
