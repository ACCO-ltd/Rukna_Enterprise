import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type OutboundMessageView, type RequestIdentity, type WhatsAppSendPreview } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SendReceiptWhatsAppDto } from '../../accounts-receivable/presentation/dto/send-receipt-whatsapp.dto.js';
import { SupplierStatementService } from '../application/supplier-statement.service.js';
import { SupplierStatementDocumentService } from '../application/supplier-statement-document.service.js';
import { SupplierStatementWhatsAppService } from '../application/supplier-statement-whatsapp.service.js';

@ApiTags('Supplier Bills')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('finance/suppliers')
export class SupplierStatementController {
  constructor(
    private readonly statements: SupplierStatementService,
    private readonly documents: SupplierStatementDocumentService,
    private readonly whatsapp: SupplierStatementWhatsAppService,
  ) {}

  @Get(':supplierId/statement')
  @ApiOperation({ summary: "AP-3: a supplier's statement of account for a period (all bills, payments and buyer cash)" })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD; default 1 January of the `to` year' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD; default today' })
  statement(
    @CurrentUser() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.statements.statement(identity, supplierId, from, to);
  }

  @Get(':supplierId/statement/document')
  @ApiOperation({ summary: "SS-2: the supplier's statement for the period as a branded PDF (rendered on request, not stored)" })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async document(
    @CurrentUser() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<StreamableFile> {
    const pdf = await this.documents.render(identity, supplierId, from, to);
    return new StreamableFile(pdf.bytes, {
      type: pdf.mimeType,
      disposition: `attachment; filename="${pdf.filename}"`,
      length: pdf.bytes.length,
    });
  }

  @Get(':supplierId/statement/whatsapp/preview')
  @ApiOperation({ summary: 'SS-3: send-by-WhatsApp preview — recipients, the exact message, and whether it can be sent' })
  previewWhatsApp(
    @CurrentUser() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<WhatsAppSendPreview> {
    return this.whatsapp.preview(identity, supplierId, from, to);
  }

  @Post(':supplierId/statement/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SS-3: send the statement PDF to the supplier by WhatsApp (template rukna_supplier_statement). Idempotent per idempotencyKey.' })
  @ApiResponse({ status: 400, description: 'RECIPIENT_INVALID | NO_RECIPIENT | TEMPLATE_NOT_CONFIGURED | WHATSAPP_NOT_CONFIGURED' })
  sendWhatsApp(
    @CurrentUser() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Body() dto: SendReceiptWhatsAppDto,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<OutboundMessageView> {
    return this.whatsapp.send(identity, supplierId, dto, from, to);
  }
}
