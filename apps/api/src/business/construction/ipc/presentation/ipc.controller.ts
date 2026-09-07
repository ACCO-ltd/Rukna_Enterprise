import {
  Controller,
  Get,
  Post,
  Delete,
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
import {
  RecordAttachmentService,
  type AttachEvidenceDto,
} from '../../../../platform/files/application/record-attachment.service.js';
import { AttachRecordEvidenceDto } from '../../contracts/presentation/dto/attach-record-evidence.dto.js';

@ApiTags('IPC')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.ipcView)
@Controller('ipc')
export class IpcController {
  constructor(
    private readonly ipcService: IpcService,
    private readonly attachments: RecordAttachmentService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List interim payment certificates' })
  @ApiQuery({
    name: 'applicationId',
    required: false,
    description: 'Filter by application. Mutually exclusive with projectId.',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filter by project. Mutually exclusive with applicationId.',
  })
  findAll(
    @CurrentUser() identity: RequestIdentity,
    @Query('applicationId') applicationId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.ipcService.findAll(identity, applicationId, projectId);
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

  // --- Evidence (Phase 7A) ------------------------------------------------------
  //
  // Two kinds of file, deliberately distinguished:
  //
  //   SUPPORTING          working evidence behind the certification. Replaceable while the
  //                       certificate stands; frozen when it is superseded, because its content
  //                       becomes history at that moment.
  //   ISSUED_CERTIFICATE  the signed certificate as issued to the client. Frozen on arrival —
  //                       `issue()` creates a certificate already effective, so there is no later
  //                       finalisation event to wait for.
  //
  // The platform is itself the authoritative certificate. An uploaded PDF is never required; it
  // is recorded when an external signed copy exists, which is a different fact.

  @Get(':id/attachments')
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiOperation({ summary: 'Evidence on this certificate' })
  listAttachments(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.attachments.list(identity, 'IPC', id);
  }

  @Post(':id/attachments')
  @RequirePermissions(PERMISSIONS.ipcIssue)
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiOperation({
    summary: 'Attach evidence to a certificate',
    description:
      'purpose=ISSUED_CERTIFICATE marks the signed certificate itself and freezes the file ' +
      'immediately. SUPPORTING evidence stays replaceable until the certificate is superseded.',
  })
  attach(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AttachRecordEvidenceDto,
  ) {
    return this.attachments.attach(identity, 'IPC', id, dto as AttachEvidenceDto);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions(PERMISSIONS.ipcIssue)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiParam({ name: 'attachmentId' })
  @ApiOperation({ summary: 'Detach supporting evidence that has not been frozen' })
  detach(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(identity, 'IPC', id, attachmentId);
  }
}
