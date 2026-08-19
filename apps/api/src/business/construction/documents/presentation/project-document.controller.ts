import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { ProjectDocumentService } from '../application/project-document.service.js';
import { AttachDocumentDto } from './dto/attach-document.dto.js';

// Documents tab: the project document register (standalone permits/drawings/licences on PlatformFile).
// Upload the bytes via the Files API first, then attach the READY file here.
@ApiTags('Project Documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/documents')
export class ProjectDocumentController {
  constructor(private readonly service: ProjectDocumentService) {}

  @Post()
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Attach a confirmed file to the project as a document' })
  attach(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: AttachDocumentDto,
  ) {
    return this.service.attach(identity, projectId, dto);
  }

  @Get()
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'List the project documents' })
  list(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.service.list(identity, projectId);
  }

  @Delete(':docId')
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'docId' })
  @ApiOperation({ summary: 'Detach a project document' })
  remove(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('docId') docId: string,
  ) {
    return this.service.remove(identity, projectId, docId);
  }
}
