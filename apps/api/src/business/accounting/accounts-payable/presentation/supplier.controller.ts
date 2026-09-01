import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { SupplierService } from '../application/supplier.service.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';

class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-001' })
  @IsString()
  code: string;

  @ApiProperty({ example: 'Al-Rashid Trading' })
  @IsString()
  name: string;


  @ApiPropertyOptional({ example: '310122445500003' })
  @IsOptional()
  @IsString()
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'SAR' })
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  paymentTermsDays?: number;
}

@ApiTags('Suppliers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers for the organization' })
  @ApiQuery({ name: 'status', enum: ['ACTIVE', 'INACTIVE'], required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE',
  ) {
    return this.supplierService.findAll(identity, status);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get a supplier by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.supplierService.findById(identity, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a supplier' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateSupplierDto) {
    return this.supplierService.create(identity, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Correct supplier master data (A15, D8)',
    description:
      'Edits master-data fields (name, tax number, default currency, payment terms, address) for ' +
      'legitimate corrections. Audited. Does not change the supplier code/identity or status, and ' +
      'does not rewrite historical facts on issued POs/bills (which reference the supplier by FK).',
  })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(identity, id, dto);
  }
}
