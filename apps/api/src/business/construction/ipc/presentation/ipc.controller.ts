import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { IpcService } from '../application/ipc.service.js';
import { CreateIpcDto } from './dto/create-ipc.dto.js';
import { SupersedeIpcDto } from './dto/supersede-ipc.dto.js';

@ApiTags('IPC')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.ipcView)
@Controller('ipc')
export class IpcController {
  constructor(private readonly ipcService: IpcService) {}

  @Get()
  @ApiOperation({ summary: 'List interim payment certificates' })
  @ApiQuery({ name: 'applicationId', required: false })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('applicationId') applicationId?: string,
  ) {
    return this.ipcService.findAll(identity, applicationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ipcIssue)
  @ApiOperation({
    summary:
      'Issue a new IPC. The first CERTIFIED or PARTIALLY_CERTIFIED certificate per application automatically becomes effective.',
  })
  @ApiResponse({ status: 201, description: 'Certificate issued' })
  @ApiResponse({
    status: 400,
    description: 'varianceReason required when certified ≠ claimed quantity',
  })
  issue(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateIpcDto) {
    return this.ipcService.issue(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get IPC details with items and deductions' })
  @ApiParam({ name: 'id' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.ipcService.findOne(identity, id);
  }

  @Post(':applicationId/supersede')
  @RequirePermissions(PERMISSIONS.ipcSupersede)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Atomic supersession: mark the current effective certificate as superseded and make the specified certificate effective. ' +
      'Both certificates belong to the same application.',
  })
  @ApiParam({ name: 'applicationId', description: 'IPA ID' })
  @ApiResponse({ status: 400, description: 'No effective certificate or invalid state' })
  @ApiResponse({ status: 409, description: 'Target certificate is already effective' })
  supersede(
    @CurrentUser() identity: RequestIdentity,
    @Param('applicationId') applicationId: string,
    @Body() dto: SupersedeIpcDto,
  ) {
    return this.ipcService.supersede(identity, applicationId, dto);
  }
}
