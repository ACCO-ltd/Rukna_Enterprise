import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { SpendCategoryService } from '../application/spend-category.service.js';
import { CreateSpendCategoryDto } from './dto/create-spend-category.dto.js';

@ApiTags('Procurement — Spend Categories')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementConfigManage)
@Controller('procurement/spend-categories')
export class SpendCategoryController {
  constructor(private readonly service: SpendCategoryService) {}

  @Get()
  @ApiOperation({ summary: 'List spend categories (root + children tree)' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.service.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a spend category' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateSpendCategoryDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get spend category with children' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a spend category' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.deactivate(identity, id);
  }
}
