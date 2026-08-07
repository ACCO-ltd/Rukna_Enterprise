import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { MaterialService } from '../application/material.service.js';
import { CreateMaterialDto } from './dto/create-material.dto.js';

@ApiTags('Procurement — Materials')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/materials')
export class MaterialController {
  constructor(private readonly service: MaterialService) {}

  @Get()
  @ApiOperation({ summary: 'List materials' })
  @ApiQuery({ name: 'materialCategoryId', required: false })
  @ApiQuery({ name: 'spendCategoryId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('materialCategoryId') materialCategoryId?: string,
    @Query('spendCategoryId') spendCategoryId?: string,
  ) {
    return this.service.findAll(identity, { materialCategoryId, spendCategoryId });
  }

  @Post()
  @ApiOperation({ summary: 'Create a material in the catalogue' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateMaterialDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get material by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/discontinue')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Mark material as discontinued' })
  discontinue(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.discontinue(identity, id);
  }
}
