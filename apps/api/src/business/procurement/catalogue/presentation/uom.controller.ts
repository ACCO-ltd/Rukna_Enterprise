import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { UomService } from '../application/uom.service.js';
import { CreateUomDto } from './dto/create-uom.dto.js';

@ApiTags('Procurement — Units of Measure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/uom')
export class UomController {
  constructor(private readonly service: UomService) {}

  @Get()
  @ApiOperation({ summary: 'List active units of measure' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.service.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a unit of measure' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateUomDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get unit of measure by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a unit of measure' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.deactivate(identity, id);
  }
}
