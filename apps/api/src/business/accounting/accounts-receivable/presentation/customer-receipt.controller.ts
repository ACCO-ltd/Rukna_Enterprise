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
import { CustomerReceiptService } from '../application/customer-receipt.service.js';
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { PostReceiptDto } from './dto/post-receipt.dto.js';
import { AllocateReceiptDto } from './dto/allocate-receipt.dto.js';
import { ReverseReceiptDto } from './dto/reverse-receipt.dto.js';
import { ReverseAllocationDto } from './dto/reverse-allocation.dto.js';

@ApiTags('Customer Receipts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('customer-receipts')
export class CustomerReceiptController {
  constructor(private readonly customerReceiptService: CustomerReceiptService) {}

  @Get()
  @ApiOperation({ summary: 'List payment receipts' })
  @ApiQuery({ name: 'clientId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('clientId') clientId?: string,
  ) {
    return this.customerReceiptService.findAll(identity, clientId);
  }

  // ACC-SET-001 BE-2: receipt creation moved here from the retired finance /receipts module.
  @Post()
  @RequirePermissions(PERMISSIONS.receiptsCreate)
  @ApiOperation({ summary: 'Record a new payment receipt (NOT_POSTED until posted to the GL)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateReceiptDto) {
    return this.customerReceiptService.create(identity, dto);
  }

  @Get('certificate/:certificateId/payment-status')
  @RequirePermissions(PERMISSIONS.receiptsView)
  @ApiParam({ name: 'certificateId' })
  @ApiOperation({ summary: "An IPC's settlement status, derived from the invoice raised off it" })
  getCertificatePaymentStatus(
    @CurrentUser() identity: RequestIdentity,
    @Param('certificateId') certificateId: string,
  ) {
    return this.customerReceiptService.getCertificatePaymentStatus(identity, certificateId);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get payment receipt with allocations' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.customerReceiptService.findById(identity, id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Post receipt to GL (Dr Bank / Cr AR or Cr Unapplied). ' +
      'Optional inline allocations reduce the Unapplied balance immediately.',
  })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: PostReceiptDto,
  ) {
    return this.customerReceiptService.post(identity, { receiptId: id, ...dto });
  }

  @Post(':id/allocations')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Allocate a portion of a posted receipt against an invoice (subsequent allocation)' })
  @ApiResponse({ status: 400, description: 'Amount exceeds unallocated balance or receipt not posted' })
  allocate(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AllocateReceiptDto,
  ) {
    return this.customerReceiptService.allocate(identity, { receiptId: id, ...dto });
  }

  @Post(':id/allocations/:allocationId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiParam({ name: 'allocationId', description: 'ClientReceiptAllocation ID' })
  @ApiOperation({ summary: 'Reverse a specific receipt allocation' })
  reverseAllocation(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') _receiptId: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: ReverseAllocationDto,
  ) {
    return this.customerReceiptService.reverseAllocation(identity, allocationId, dto);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted receipt (no subsequent allocations allowed)' })
  @ApiResponse({ status: 400, description: 'Receipt has subsequent allocations — reverse them first' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReverseReceiptDto,
  ) {
    return this.customerReceiptService.reverse(identity, id, dto);
  }
}
