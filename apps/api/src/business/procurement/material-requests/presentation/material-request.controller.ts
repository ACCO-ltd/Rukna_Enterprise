import {
  Controller, Get, Post, Body, Param, Query,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { MaterialRequestService } from '../application/material-request.service.js';
import { CreateMaterialRequestDto } from './dto/create-material-request.dto.js';

@ApiTags('Procurement — Material Requests')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.procurementView)
@Controller('procurement/material-requests')
export class MaterialRequestController {
  constructor(private readonly service: MaterialRequestService) {}

  @Get()
  @ApiOperation({ summary: 'List material requests' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'scope', required: false, enum: ['PROJECT', 'ORGANIZATION'] })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('scope') scope?: string,
  ) {
    return this.service.findAll(identity, {
      status: status as any,
      projectId,
      scope: scope as any,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.materialRequestsCreate)
  @ApiOperation({ summary: 'Create a material request in DRAFT status' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateMaterialRequestDto) {
    return this.service.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get material request with lines' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.findById(identity, id);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.materialRequestsSubmit)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Submit MR for approval: DRAFT → SUBMITTED' })
  submit(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.submit(identity, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.materialRequestsApprove)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Approve MR: SUBMITTED → APPROVED' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.approve(identity, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.materialRequestsCreate)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Cancel a material request' })
  cancel(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.cancel(identity, id);
  }
}
