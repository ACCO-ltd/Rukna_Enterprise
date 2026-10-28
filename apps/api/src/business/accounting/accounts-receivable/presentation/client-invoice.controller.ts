import {
  Controller, Get, Post, Put, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { ClientInvoiceService } from '../application/client-invoice.service.js';
import { IpcBillingCheckService } from '../application/ipc-billing-check.service.js';
import { GenerateInvoiceFromIpcDto } from './dto/generate-invoice-from-ipc.dto.js';
import { GenerateInvoiceFromInstallmentDto } from './dto/generate-invoice-from-installment.dto.js';
import { GenerateInvoiceFromSeparateChargeDto } from './dto/generate-invoice-from-separate-charge.dto.js';
import { GenerateInvoiceFromRetentionReleaseDto } from './dto/generate-invoice-from-retention-release.dto.js';
import { PostInvoiceDto } from './dto/post-invoice.dto.js';
import { ReverseInvoiceDto } from './dto/reverse-invoice.dto.js';
import { ManualInvoiceDto } from './dto/manual-invoice.dto.js';

@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('invoices')
export class ClientInvoiceController {
  constructor(
    private readonly clientInvoiceService: ClientInvoiceService,
    private readonly ipcBillingCheckService: IpcBillingCheckService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List client invoices' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'projectId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.clientInvoiceService.findAll(identity, { clientId, projectId });
  }

  @Post('manual')
  @ApiOperation({
    summary:
      'ADR-048: a hand-typed draft invoice for a non-contract sale (lines × income accounts; no project or contract)',
  })
  @ApiResponse({ status: 400, description: 'MANUAL_INVOICE_INVALID — details.problems lists every rule broken' })
  createManual(@CurrentUser() identity: RequestIdentity, @Body() dto: ManualInvoiceDto) {
    return this.clientInvoiceService.createManual(identity, dto);
  }

  @Put(':id/manual')
  @ApiOperation({ summary: 'ADR-048: rewrite a DRAFT hand-typed invoice (header and every line)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'INVOICE_NOT_DRAFT' })
  updateManual(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ManualInvoiceDto) {
    return this.clientInvoiceService.updateManual(identity, id, dto);
  }

  @Post('from-ipc')
  @ApiOperation({ summary: 'Generate a draft invoice from an effective IPC (one invoice per IPC)' })
  @ApiResponse({ status: 409, description: 'Invoice already exists for this IPC' })
  generateFromIpc(@CurrentUser() identity: RequestIdentity, @Body() dto: GenerateInvoiceFromIpcDto) {
    return this.clientInvoiceService.generateFromIpc(identity, dto);
  }

  @Post('from-retention-release')
  @ApiOperation({
    summary:
      'ADR-046 §5: invoice the retention a contract held back, after its retention was released (one per contract)',
  })
  @ApiResponse({ status: 400, description: 'Retention not released, nothing held, or certificate invoices unposted' })
  generateFromRetentionRelease(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: GenerateInvoiceFromRetentionReleaseDto,
  ) {
    return this.clientInvoiceService.generateFromRetentionRelease(identity, dto);
  }

  @Post('from-installment')
  @ApiOperation({
    summary: 'ADR-023: generate a draft invoice from a payment-schedule installment (one per installment)',
  })
  @ApiResponse({ status: 400, description: 'Contract is not MILESTONE billing, or not ACTIVE' })
  generateFromInstallment(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: GenerateInvoiceFromInstallmentDto,
  ) {
    return this.clientInvoiceService.generateFromInstallment(identity, dto);
  }

  @Post('from-separate-charge')
  @ApiOperation({
    summary:
      'ADR-029 R-4: generate a one-off invoice for a SEPARATE_CHARGE BOQ leaf (one per node, outside the milestone schedule)',
  })
  @ApiResponse({ status: 400, description: 'No active client contract, or the line has no amount' })
  @ApiResponse({ status: 404, description: 'BOQ line not found or not a billable SEPARATE_CHARGE leaf' })
  generateFromSeparateCharge(
    @CurrentUser() identity: RequestIdentity,
    @Body() dto: GenerateInvoiceFromSeparateChargeDto,
  ) {
    return this.clientInvoiceService.generateFromSeparateCharge(identity, dto);
  }

  // Declared before `:id` so the path is not read as an invoice id.
  @Get('ipc-billing-check')
  @ApiOperation({
    summary:
      'ADR-046 §5: contracts whose posted IPC invoices bill more (net, before tax) than their latest ' +
      'certificate certifies — read-only, for correction by credit note',
  })
  ipcBillingCheck(@CurrentUser() identity: RequestIdentity) {
    return this.ipcBillingCheckService.findOverBilledContracts(identity);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get client invoice details' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientInvoiceService.findById(identity, id);
  }

  @Get(':id/document')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary:
      'The branded invoice PDF: a short-lived signed download URL, rendering the document on first request',
  })
  getDocument(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientInvoiceService.getOrGenerateDocument(identity, id);
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
