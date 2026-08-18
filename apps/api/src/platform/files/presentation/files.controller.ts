import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { PlatformFileService } from '../application/platform-file.service.js';
import { InitiateUploadDto, ConfirmUploadDto } from './dto/file-upload.dto.js';

// ADR-014: shared file storage. Two-step upload (presign -> confirm), signed-URL download.
// Auth via JWT; org-scoping is enforced in the service (findById filters the active organization).
@ApiTags('Files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly service: PlatformFileService) {}

  @Post()
  @ApiOperation({ summary: 'Create a file record and get a presigned upload URL' })
  initiate(@CurrentUser() identity: RequestIdentity, @Body() dto: InitiateUploadDto) {
    return this.service.initiateUpload(identity, dto);
  }

  @Post(':id/confirm')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Confirm the upload — verifies the object exists and marks it READY' })
  confirm(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.service.confirmUpload(identity, id, dto);
  }

  @Get(':id/download')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get a short-lived signed URL to download the file' })
  download(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.getDownloadUrl(identity, id);
  }

  @Delete(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Delete a file (rejected when immutable / audit-relevant)' })
  remove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.delete(identity, id);
  }
}
