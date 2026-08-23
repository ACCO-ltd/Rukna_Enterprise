import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength, IsNumberString } from 'class-validator';
import { MeasurementMethod, PricingBasis } from '@prisma/client';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { BoqItemLibraryService } from '../application/boq-item-library.service.js';

class CreateBoqItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  defaultUnit?: string;

  @ApiPropertyOptional({ enum: MeasurementMethod })
  @IsOptional()
  @IsEnum(MeasurementMethod)
  measurementMethod?: MeasurementMethod;

  @ApiPropertyOptional({ enum: PricingBasis })
  @IsOptional()
  @IsEnum(PricingBasis)
  pricingBasis?: PricingBasis;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}

class RecordItemUsageDto {
  @ApiProperty({ description: 'The rate the item was used at (decimal string)' })
  @IsNumberString()
  rate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;
}

/**
 * ADR-020 CONST-BOQ-020 — the reusable BOQ work-item library. Search is a read; creating an item and
 * recording a used rate are edits (boqManage).
 */
@ApiTags('BOQ Item Library')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.boqView)
@Controller('boq-item-library')
export class BoqItemLibraryController {
  constructor(private readonly service: BoqItemLibraryService) {}

  @Get()
  @ApiQuery({ name: 'q', required: false, description: 'Search code or description' })
  @ApiOperation({ summary: 'Search the reusable BOQ work-item library' })
  search(@CurrentUser() identity: RequestIdentity, @Query('q') q?: string) {
    return this.service.search(identity, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.boqManage)
  @ApiOperation({ summary: 'Save a work item to the library ("save to library & add")' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateBoqItemDto) {
    return this.service.create(identity, dto);
  }

  @Post(':id/record-usage')
  @RequirePermissions(PERMISSIONS.boqManage)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Record the rate a library item was just used at (assistance only)' })
  recordUsage(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: RecordItemUsageDto,
  ) {
    return this.service.recordUsage(identity, id, dto);
  }
}
