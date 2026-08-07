import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { FiscalYearService } from '../application/fiscal-year.service.js';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto.js';

@ApiTags('Fiscal Years')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('fiscal-years')
export class FiscalYearController {
  constructor(private readonly fiscalYearService: FiscalYearService) {}

  @Get()
  @ApiOperation({ summary: 'List all fiscal years and their accounting periods' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.fiscalYearService.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a fiscal year with 12 monthly periods (OPEN status)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateFiscalYearDto) {
    return this.fiscalYearService.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get fiscal year with all periods' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.fiscalYearService.findById(identity, id);
  }

  @Get('period/covering')
  @ApiQuery({ name: 'date', description: 'ISO date string e.g. 2025-03-15' })
  @ApiOperation({ summary: 'Find the accounting period that covers a given date' })
  findPeriodCovering(
    @CurrentUser() identity: RequestIdentity,
    @Query('date') date: string,
  ) {
    return this.fiscalYearService.findPeriodCovering(identity, new Date(date));
  }
}
