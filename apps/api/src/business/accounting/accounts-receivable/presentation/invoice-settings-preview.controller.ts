import { Body, Controller, HttpCode, HttpStatus, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { NoAudit } from '../../../../common/decorators/no-audit.decorator.js';
import { UpdateInvoiceDocumentSettingsDto } from '../../accounting-core/presentation/dto/invoice-document-settings.dto.js';
import { InvoiceSettingsPreviewService } from '../application/invoice-settings-preview.service.js';

/**
 * Lives with the invoice PDF (accounts receivable) rather than with the settings controller:
 * rendering needs the invoice document and the stored logo, which the accounting core does not own.
 */
@ApiTags('Invoice Document Settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('invoice-document-settings')
export class InvoiceSettingsPreviewController {
  constructor(private readonly preview: InvoiceSettingsPreviewService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @NoAudit()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
  @ApiOperation({
    summary: 'Render a sample invoice PDF with these (unsaved) settings — nothing is stored',
  })
  async render(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: UpdateInvoiceDocumentSettingsDto,
  ): Promise<StreamableFile> {
    const pdf = await this.preview.render(identity, dto);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="invoice-preview.pdf"',
      length: pdf.length,
    });
  }
}
