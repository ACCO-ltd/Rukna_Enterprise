import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { ClientInvoiceService } from '../application/client-invoice.service.js';
import { GenerateInvoiceFromIpcDto } from './dto/generate-invoice-from-ipc.dto.js';
import { PostInvoiceDto } from './dto/post-invoice.dto.js';
import { ReverseInvoiceDto } from './dto/reverse-invoice.dto.js';

@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('invoices')
export class ClientInvoiceController {
  constructor(private readonly clientInvoiceService: ClientInvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'List client invoices' })
  @ApiQuery({ name: 'clientId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('clientId') clientId?: string,
  ) {
    return this.clientInvoiceService.findAll(identity, clientId);
  }

  @Post('from-ipc')
  @ApiOperation({ summary: 'Generate a draft invoice from an effective IPC (one invoice per IPC)' })
  @ApiResponse({ status: 409, description: 'Invoice already exists for this IPC' })
  generateFromIpc(@CurrentUser() identity: RequestIdentity, @Body() dto: GenerateInvoiceFromIpcDto) {
    return this.clientInvoiceService.generateFromIpc(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get client invoice details' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientInvoiceService.findById(identity, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Approve invoice: DRAFT → APPROVED' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientInvoiceService.approve(identity, id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Post approved invoice to the GL (Dr AR / Cr Revenue)' })
  @ApiResponse({ status: 400, description: 'Invoice must be APPROVED before posting' })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: PostInvoiceDto,
  ) {
    return this.clientInvoiceService.post(identity, { invoiceId: id, ...dto });
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted invoice (no active allocations allowed)' })
  @ApiResponse({ status: 400, description: 'Invoice has active receipt allocations' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReverseInvoiceDto,
  ) {
    return this.clientInvoiceService.reverse(identity, id, dto);
  }
}
