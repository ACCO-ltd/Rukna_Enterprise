import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { SupplierBillService } from '../application/supplier-bill.service.js';
import { CreateSupplierBillDto } from './dto/create-supplier-bill.dto.js';
import { PostSupplierBillDto } from './dto/post-supplier-bill.dto.js';
import { ReverseSupplierBillDto } from './dto/reverse-supplier-bill.dto.js';

@ApiTags('Supplier Bills')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('bills')
export class SupplierBillController {
  constructor(private readonly supplierBillService: SupplierBillService) {}

  @Get()
  @ApiOperation({ summary: 'List supplier bills' })
  @ApiQuery({ name: 'supplierId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.supplierBillService.findAll(identity, supplierId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a supplier bill in DRAFT status' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateSupplierBillDto) {
    return this.supplierBillService.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get supplier bill with lines' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierBillService.findById(identity, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Submit bill for approval: DRAFT → PENDING_APPROVAL' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierBillService.submit(identity, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Approve bill: PENDING_APPROVAL → APPROVED' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierBillService.approve(identity, id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Post approved bill to GL (Dr Expense / Cr AP)' })
  @ApiResponse({ status: 400, description: 'Bill must be APPROVED before posting' })
  post(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: PostSupplierBillDto,
  ) {
    return this.supplierBillService.post(identity, { billId: id, ...dto });
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reverse a posted bill (no active payment allocations allowed)' })
  @ApiResponse({ status: 400, description: 'Bill has active payment allocations' })
  reverse(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReverseSupplierBillDto,
  ) {
    return this.supplierBillService.reverse(identity, id, dto);
  }
}
