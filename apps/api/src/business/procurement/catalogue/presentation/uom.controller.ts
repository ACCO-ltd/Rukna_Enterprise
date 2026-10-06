import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { CatalogueStatusFilter } from '../application/catalogue-status.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { UomService } from '../application/uom.service.js';
import { CreateUomDto } from './dto/create-uom.dto.js';

class CatalogueStatusQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: CatalogueStatusFilter;
}

@ApiTags('Procurement — Units of Measure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
// Reads feed the buyer's order and request forms (view:procurement); every write stays with
// the catalogue maintainer (manage:procurement-config). Each handler carries its own gate.
@Controller('procurement/uom')
export class UomController {
  constructor(private readonly service: UomService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.procurementView, PERMISSIONS.procurementConfigManage)
  @ApiOperation({ summary: 'List active units of measure' })
  findAll(@CurrentUser() identity: RequestIdentity, @Query() query: CatalogueStatusQueryDto) {
    return this.service.findAll(identity, query.status ?? 'ACTIVE');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @ApiOperation({ summary: 'Create a unit of measure' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateUomDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.procurementView, PERMISSIONS.procurementConfigManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get unit of measure by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a unit of measure' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.deactivate(identity, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reactivate an inactive unit of measure (audited; 409 unless INACTIVE)' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.reactivate(identity, id);
  }
}
