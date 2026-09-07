import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { PlatformFileService } from '../application/platform-file.service.js';
import { InitiateUploadDto, ConfirmUploadDto } from './dto/file-upload.dto.js';

/**
 * ADR-014: shared file storage. Two-step upload (presign → confirm), signed-URL download.
 *
 * **Every route here authorizes against the record that owns the file**, in
 * `FileAuthorizationService`, not against the organisation. This controller declares no
 * `@RequirePermissions` and that is deliberate rather than an omission: a blanket permission
 * would be wrong in both directions — too weak, because holding it says nothing about the
 * specific project the file belongs to, and too strong, because the permission needed to read a
 * drawing is the one that governs its project, which differs by file. The check that matters
 * cannot be made before the file id is resolved, so it is made in the service, on every route.
 *
 * Do not add a route here that reaches a file without going through that service.
 */
@ApiTags('Files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly service: PlatformFileService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a file record and get a presigned upload URL',
    description:
      'Requires the SHA-256 of the bytes up front: the PUT is signed with it, so storage rejects ' +
      'a body that does not match. The file starts TEMPORARY — private to the uploader and ' +
      'reaped if nothing binds it — until a record attaches it.',
  })
  initiate(@CurrentUser() identity: RequestIdentity, @Body() dto: InitiateUploadDto) {
    return this.service.initiateUpload(identity, dto);
  }

  @Post(':id/confirm')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Confirm the upload — verifies the object exists and marks it READY',
    description: 'Authorized as a write: only the uploader, and only while nothing owns the file.',
  })
  confirm(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.service.confirmUpload(identity, id, dto);
  }

  @Get(':id/download')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get a short-lived signed URL to download the file',
    description:
      'Authorized against the owning record: project membership for a project document or DPR ' +
      'evidence, and the uploader alone for a file nothing has bound yet.',
  })
  download(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.getDownloadUrl(identity, id);
  }

  @Delete(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Discard an abandoned upload',
    description:
      'Only a TEMPORARY file, and only by its uploader. A file a record owns is removed by ' +
      'detaching it from that record, so the record’s own rules run; a file on a finalised ' +
      'record is never deleted.',
  })
  remove(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.service.delete(identity, id);
  }
}
