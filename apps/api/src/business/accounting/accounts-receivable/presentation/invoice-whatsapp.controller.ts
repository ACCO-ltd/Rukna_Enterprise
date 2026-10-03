import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  type OutboundMessageView,
  type RequestIdentity,
  type WhatsAppSendPreview,
} from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { InvoiceWhatsAppService } from '../application/invoice-whatsapp.service.js';
import { SendInvoiceWhatsAppDto } from './dto/send-invoice-whatsapp.dto.js';

/** ADR-042 — WhatsApp V1 step 2: send an issued invoice to the client on WhatsApp. */
@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('invoices')
export class InvoiceWhatsAppController {
  constructor(private readonly service: InvoiceWhatsAppService) {}

  @Get(':id/whatsapp/preview')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'What a WhatsApp send of this invoice would send: recipients, message, attachment, blockers',
  })
  preview(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<WhatsAppSendPreview> {
    return this.service.preview(identity, id);
  }

  @Post(':id/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'Send the invoice PDF to the client on WhatsApp. A provider failure returns the message with status FAILED / UNKNOWN (200).',
  })
  @ApiResponse({
    status: 400,
    description:
      'RECIPIENT_INVALID, NO_RECIPIENT, TEMPLATE_NOT_CONFIGURED or WHATSAPP_NOT_CONFIGURED',
  })
  @ApiResponse({ status: 409, description: 'NOT_POSTED — the invoice is not issued' })
  send(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: SendInvoiceWhatsAppDto,
  ): Promise<OutboundMessageView> {
    return this.service.send(identity, id, {
      recipient: dto.recipient,
      idempotencyKey: dto.idempotencyKey,
    });
  }
}
