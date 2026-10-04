import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { InvoiceDocumentSettingsService } from '../application/invoice-document-settings.service.js';
import { UpdateInvoiceDocumentSettingsDto } from './dto/invoice-document-settings.dto.js';

/**
 * What the client invoice PDF prints beyond the invoice: the bank account for payment, the notes
 * and the authorised signatory. Read by accounting viewers; maintained by Finance.
 */
@ApiTags('Invoice Document Settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('invoice-document-settings')
export class InvoiceDocumentSettingsController {
  constructor(private readonly settings: InvoiceDocumentSettingsService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'The invoice document settings (bank account, notes, signatory)' })
  get(@CurrentUser() identity: RequestIdentity) {
    return this.settings.get(identity);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Update the invoice document settings (422 INVOICE_SETTINGS_INVALID)' })
  update(@CurrentUser() identity: RequestIdentity, @Body() dto: UpdateInvoiceDocumentSettingsDto) {
    return this.settings.update(identity, dto);
  }
}
