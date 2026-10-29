import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, MinLength } from 'class-validator';
import { PERMISSIONS, type DocumentReadingKind, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { DocumentReaderService } from '../application/document-reader.service.js';

export class ReadDocumentDto {
  @IsString() @MinLength(1) platformFileId!: string;
  @IsIn(['DELIVERY_NOTE', 'RECEIPT', 'QUOTE', 'MATERIAL_LIST']) kind!: DocumentReadingKind;
}

export class DocumentReaderSettingsDto {
  @IsBoolean() enabled!: boolean;
}

/**
 * Step 7 — the photo reader. The status is readable by anyone signed in (a form decides whether to
 * offer "Read the photo"); the switch is `manage:organization`; reading is gated per kind in the
 * service, on the permission that fills the form being pre-filled.
 */
@ApiTags('Platform')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('document-reader')
export class DocumentReaderController {
  constructor(private readonly service: DocumentReaderService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the photo reader is configured and turned on for this company' })
  status(@CurrentUser() identity: RequestIdentity) {
    return this.service.status(identity);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.organizationsManage)
  @ApiOperation({ summary: 'Turn the photo reader on or off for this company' })
  settings(@CurrentUser() identity: RequestIdentity, @Body() dto: DocumentReaderSettingsDto) {
    return this.service.setEnabled(identity, dto.enabled);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Read an uploaded photo to pre-fill a form; saves nothing but a log of the reading' })
  read(@CurrentUser() identity: RequestIdentity, @Body() dto: ReadDocumentDto) {
    return this.service.read(identity, dto.platformFileId, dto.kind);
  }
}
