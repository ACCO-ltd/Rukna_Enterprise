import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type OutboundMessageView, type RequestIdentity, type WhatsAppSendPreview } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { ClientStatementService } from '../application/client-statement.service.js';
import { ClientStatementDocumentService } from '../application/client-statement-document.service.js';
import { ClientStatementWhatsAppService } from '../application/client-statement-whatsapp.service.js';
import { SendReceiptWhatsAppDto } from './dto/send-receipt-whatsapp.dto.js';

@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('finance/clients')
export class ClientStatementController {
  constructor(
    private readonly statements: ClientStatementService,
    private readonly documents: ClientStatementDocumentService,
    private readonly whatsapp: ClientStatementWhatsAppService,
  ) {}

  @Get(':clientId/statement')
  @ApiOperation({ summary: "AR-3: a client's statement of account for a period (all projects and sales)" })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD; default 1 January of the `to` year' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD; default today' })
  statement(
    @CurrentUser() identity: RequestIdentity,
    @Param('clientId') clientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.statements.statement(identity, clientId, from, to);
  }

  @Get(':clientId/statement/document')
  @ApiOperation({ summary: "ST-6: the client's statement for the period as a branded PDF (rendered on request, not stored)" })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async document(
    @CurrentUser() identity: RequestIdentity,
    @Param('clientId') clientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<StreamableFile> {
    const pdf = await this.documents.render(identity, clientId, from, to);
    return new StreamableFile(pdf.bytes, {
      type: pdf.mimeType,
      disposition: `attachment; filename="${pdf.filename}"`,
      length: pdf.bytes.length,
    });
  }

  @Get(':clientId/statement/whatsapp/preview')
  @ApiOperation({ summary: 'ST-6: send-by-WhatsApp preview for the statement — recipients, the exact message, and whether it can be sent' })
  previewWhatsApp(
    @CurrentUser() identity: RequestIdentity,
    @Param('clientId') clientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<WhatsAppSendPreview> {
    return this.whatsapp.preview(identity, clientId, from, to);
  }

  @Post(':clientId/statement/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ST-6: send the statement PDF to the client by WhatsApp (template rukna_statement). Idempotent per idempotencyKey.' })
  @ApiResponse({ status: 400, description: 'RECIPIENT_INVALID | NO_RECIPIENT | TEMPLATE_NOT_CONFIGURED | WHATSAPP_NOT_CONFIGURED' })
  sendWhatsApp(
    @CurrentUser() identity: RequestIdentity,
    @Param('clientId') clientId: string,
    @Body() dto: SendReceiptWhatsAppDto,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<OutboundMessageView> {
    return this.whatsapp.send(identity, clientId, dto, from, to);
  }
}
