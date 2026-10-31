import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { InvoiceNumberingService } from '../application/invoice-numbering.service.js';
import { UpdateInvoiceNumberingDto } from './dto/invoice-numbering.dto.js';

/** CI-8 — how client invoices are numbered. Read by accounting viewers; maintained by Finance. */
@ApiTags('Invoice Numbering')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('invoice-numbering')
export class InvoiceNumberingController {
  constructor(private readonly numbering: InvoiceNumberingService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'The invoice number format and the next number' })
  get(@CurrentUser() identity: RequestIdentity) {
    return this.numbering.get(identity);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Change the invoice number format or next number (400 INVOICE_NUMBERING_INVALID)' })
  update(@CurrentUser() identity: RequestIdentity, @Body() dto: UpdateInvoiceNumberingDto) {
    return this.numbering.update(identity, dto);
  }
}
