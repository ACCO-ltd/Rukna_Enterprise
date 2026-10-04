import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { SupplierDirectoryService } from '../application/supplier-directory.service.js';

export class ListProcurementSuppliersQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'], default: 'ALL' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';

  @ApiPropertyOptional({ description: 'Matches supplier name or code (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

@ApiTags('Procurement — Suppliers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/suppliers')
export class SupplierDirectoryController {
  constructor(private readonly service: SupplierDirectoryService) {}

  @Get()
  @ApiOperation({
    summary:
      'Supplier directory for procurement: primary contact, payment terms, open PO count, payable balance (money only with view:commitment-ledger)',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @ApiQuery({ name: 'search', required: false })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: ListProcurementSuppliersQueryDto) {
    const status = query.status && query.status !== 'ALL' ? query.status : undefined;
    return this.service.list(identity, { status, search: query.search });
  }
}
