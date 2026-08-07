import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { MaterialCategoryService } from '../application/material-category.service.js';
import { CreateMaterialCategoryDto } from './dto/create-material-category.dto.js';

@ApiTags('Procurement — Material Categories')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/material-categories')
export class MaterialCategoryController {
  constructor(private readonly service: MaterialCategoryService) {}

  @Get()
  @ApiOperation({ summary: 'List material categories (root + children tree)' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.service.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a material category' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateMaterialCategoryDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get material category with children' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a material category' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.deactivate(identity, id);
  }
}
