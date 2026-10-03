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
  type WhatsAppReminderPreview,
} from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { InvoiceReminderWhatsAppService } from '../application/invoice-reminder-whatsapp.service.js';
import { SendInvoiceWhatsAppDto } from './dto/send-invoice-whatsapp.dto.js';

/** ADR-042 — WhatsApp V1 step 4: a manual payment / overdue reminder for one client invoice. */
@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('invoices')
export class InvoiceReminderWhatsAppController {
  constructor(private readonly service: InvoiceReminderWhatsAppService) {}

  @Get(':id/whatsapp-reminder/preview')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'What a WhatsApp reminder for this invoice would send: kind (payment / overdue), recipients, message, blockers',
  })
  preview(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<WhatsAppReminderPreview> {
    return this.service.preview(identity, id);
  }

  @Post(':id/whatsapp-reminder')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'Send a payment / overdue reminder to the client on WhatsApp (text only). A provider failure returns the message with status FAILED / UNKNOWN (200).',
  })
  @ApiResponse({
    status: 400,
    description:
      'RECIPIENT_INVALID, NO_RECIPIENT, TEMPLATE_NOT_CONFIGURED, WHATSAPP_NOT_CONFIGURED or COMPANY_NAME_MISSING',
  })
  @ApiResponse({
    status: 409,
    description: 'NOT_POSTED, REVERSED or NOTHING_OUTSTANDING',
  })
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
