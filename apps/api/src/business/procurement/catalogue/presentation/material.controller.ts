import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ParseEnumPipe } from '@nestjs/common';
import type { CatalogueStatusFilter } from '../application/catalogue-status.js';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { MaterialService } from '../application/material.service.js';
import { CreateMaterialDto } from './dto/create-material.dto.js';

@ApiTags('Procurement — Materials')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
// Reads feed the buyer's order and request forms (view:procurement); every write stays with
// the catalogue maintainer (manage:procurement-config). Each handler carries its own gate.
@Controller('procurement/materials')
export class MaterialController {
  constructor(private readonly service: MaterialService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.procurementView, PERMISSIONS.procurementConfigManage)
  @ApiOperation({ summary: 'List materials' })
  @ApiQuery({ name: 'materialCategoryId', required: false })
  @ApiQuery({ name: 'spendCategoryId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'], description: 'INACTIVE includes DISCONTINUED. Default ACTIVE.' })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('materialCategoryId') materialCategoryId?: string,
    @Query('spendCategoryId') spendCategoryId?: string,
    @Query('status', new ParseEnumPipe({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ALL: 'ALL' }, { optional: true }))
    status?: CatalogueStatusFilter,
  ) {
    return this.service.findAll(identity, { materialCategoryId, spendCategoryId, status });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @ApiOperation({ summary: 'Create a material in the catalogue' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateMaterialDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.procurementView, PERMISSIONS.procurementConfigManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get material by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/discontinue')
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Mark material as discontinued' })
  discontinue(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.discontinue(identity, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.procurementConfigManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reactivate a discontinued or inactive material (audited; 409 if already ACTIVE)' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.reactivate(identity, id);
  }
}
