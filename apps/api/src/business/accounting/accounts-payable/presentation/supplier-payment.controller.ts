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
import { SupplierPaymentService } from '../application/supplier-payment.service.js';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';
import { PostSupplierPaymentDto } from './dto/post-supplier-payment.dto.js';
import { AllocateAdvanceDto } from './dto/allocate-advance.dto.js';
import { ReverseSupplierPaymentDto } from './dto/reverse-supplier-payment.dto.js';
import { ReverseAdvanceAllocationDto } from './dto/reverse-advance-allocation.dto.js';

@ApiTags('Supplier Payments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('payments')
export class SupplierPaymentController {
  constructor(private readonly supplierPaymentService: SupplierPaymentService) {}

  @Get()
  @ApiOperation({ summary: 'List supplier payments' })
  @ApiQuery({ name: 'supplierId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.supplierPaymentService.findAll(identity, supplierId);
  }

  @Post()
  @ApiOperation({ summary: 'Record a supplier payment in DRAFT status' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateSupplierPaymentDto) {
    return this.supplierPaymentService.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get supplier payment with allocations' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierPaymentService.findById(identity, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Approve payment: DRAFT → APPROVED' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierPaymentService.approve(identity, id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Post approved payment to GL. ' +
      'If fully allocated to bills: Dr AP / Cr Bank. ' +
      'If advance (unallocated): Dr Supplier Advance / Cr Bank.',
  })
  @ApiResponse({ status: 400, description: 'Payment must be APPROVED before posting' })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: PostSupplierPaymentDto,
  ) {
    return this.supplierPaymentService.post(identity, { paymentId: id, ...dto });
  }

  @Post(':id/allocations')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Apply a posted advance payment against a supplier bill (Dr AP / Cr Supplier Advance)' })
  @ApiResponse({ status: 400, description: 'Amount exceeds unallocated balance' })
  allocateAdvance(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AllocateAdvanceDto,
  ) {
    return this.supplierPaymentService.allocateAdvance(identity, { paymentId: id, ...dto });
  }

  @Post(':id/allocations/:allocationId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiParam({ name: 'allocationId', description: 'SupplierPaymentAllocation ID' })
  @ApiOperation({ summary: 'Reverse a specific advance allocation' })
  reverseAdvanceAllocation(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') _paymentId: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: ReverseAdvanceAllocationDto,
  ) {
    return this.supplierPaymentService.reverseAdvanceAllocation(identity, allocationId, dto);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted payment (no active allocations allowed)' })
  @ApiResponse({ status: 400, description: 'Payment has active advance allocations' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReverseSupplierPaymentDto,
  ) {
    return this.supplierPaymentService.reverse(identity, id, dto);
  }
}
