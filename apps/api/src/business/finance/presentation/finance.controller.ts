import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { FinanceService } from '../application/finance.service.js';
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { AllocateReceiptDto } from './dto/allocate-receipt.dto.js';

@ApiTags('Finance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receiptsView)
@Controller('receipts')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ─── Payment Receipts ─────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List payment receipts for the organization' })
  @ApiQuery({ name: 'clientId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('clientId') clientId?: string,
  ) {
    return this.financeService.findAll(identity, clientId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.receiptsCreate)
  @ApiOperation({ summary: 'Record a new payment receipt from a client' })
  @ApiResponse({ status: 201, description: 'Receipt recorded' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateReceiptDto) {
    return this.financeService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment receipt with its allocations' })
  @ApiParam({ name: 'id' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.financeService.findOne(identity, id);
  }

  // ─── Receipt Allocations ──────────────────────────────────────────────────────

  @Post(':id/allocations')
  @RequirePermissions(PERMISSIONS.receiptsAllocate)
  @ApiOperation({
    summary:
      'Allocate part (or all) of a receipt against an IPC. ' +
      'Multiple allocations are allowed until the receipt amount is exhausted.',
  })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiResponse({ status: 400, description: 'Allocation would exceed receipt amount' })
  allocate(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AllocateReceiptDto,
  ) {
    return this.financeService.allocate(identity, id, dto);
  }

  @Delete(':id/allocations/:allocationId')
  @RequirePermissions(PERMISSIONS.receiptsAllocate)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a receipt allocation' })
  removeAllocation(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
  ) {
    return this.financeService.removeAllocation(identity, id, allocationId);
  }

  // ─── Certificate payment status ───────────────────────────────────────────────

  @Get('certificate/:certificateId/payment-status')
  @ApiOperation({
    summary:
      'Derive payment status (UNPAID / PARTIALLY_PAID / PAID) for a certificate from its allocations.',
  })
  @ApiParam({ name: 'certificateId' })
  getCertificatePaymentStatus(
    @CurrentUser() identity: RequestIdentity,
    @Param('certificateId') certificateId: string,
  ) {
    return this.financeService.getCertificatePaymentStatus(identity, certificateId);
  }
}
