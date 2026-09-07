import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectDocumentService } from '../application/project-document.service.js';
import { LinkedAttachmentService } from '../application/linked-attachment.service.js';
import {
  CreateDocumentRevisionDto,
  CreateProjectDocumentDto,
  IssueRevisionDto,
  ListLinkedAttachmentsQueryDto,
  ListProjectDocumentsQueryDto,
  ReplaceRevisionFileDto,
  SupersedeDocumentDto,
  UpdateProjectDocumentDto,
  WithdrawDocumentDto,
} from './dto/project-document.dto.js';

/**
 * The controlled project document register.
 *
 * Two permission tiers, and the split is the point. `manage:project-document` drafts — registers a
 * document, starts a revision, swaps a draft file. `issue:project-document` performs the acts that
 * make a document a control: issuing a revision the site will build from, withdrawing one it must
 * stop using, superseding, archiving. Drafting a drawing and telling a site to build from it are
 * not the same authority, and one permission covering both would say they were.
 *
 * Reading reuses `view:project` on purpose. The register is project data behind project
 * membership, and inventing a third view permission would take a tab away from every role that can
 * open it today until someone remembered to re-seed. Membership is asserted per call in the
 * service — the class-level permission is the coarse gate, never the whole check.
 */
@ApiTags('Project Documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.projectsView)
@Controller('projects/:projectId/documents')
export class ProjectDocumentController {
  constructor(
    private readonly service: ProjectDocumentService,
    private readonly linked: LinkedAttachmentService,
  ) {}

  @Get()
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'The register: a filtered page of controlled documents, plus the attention summary',
    description:
      'Validity (NO_EXPIRY / NOT_YET_VALID / VALID / EXPIRING_SOON / EXPIRED) is derived on ' +
      'every read from validFrom and expiresAt — it is never stored. The summary counts cover ' +
      'the whole project rather than the filtered page.',
  })
  list(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query() query: ListProjectDocumentsQueryDto,
  ) {
    return this.service.list(identity, projectId, query);
  }

  /**
   * Placed before `:documentId` deliberately: Nest matches routes in declaration order, and
   * `/attachments` would otherwise be swallowed as a document id.
   */
  @Get('attachments')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'Linked Attachments — read-only evidence owned by other records on this project',
    description:
      'An aggregation, not an owner. Nothing here can be attached, replaced or deleted: each ' +
      'file belongs to a DPR, contract, guarantee, IPA or IPC, and changes go through that ' +
      'record so its own rules run.',
  })
  listAttachments(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query() query: ListLinkedAttachmentsQueryDto,
  ) {
    return this.linked.list(identity, projectId, query);
  }

  @Get('capabilities')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'What this caller may do — the same rules the write routes enforce' })
  capabilities(@CurrentUser() identity: RequestIdentity) {
    return this.service.capabilities(identity);
  }

  @Get(':documentId')
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({ summary: 'One document with its full revision history and audited activity' })
  findOne(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.service.findOne(identity, projectId, documentId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.projectDocumentsManage)
  @ApiParam({ name: 'projectId' })
  @ApiOperation({
    summary: 'Register a controlled document with its first revision',
    description:
      'Upload the bytes through the Files API first, then register the READY file here. The ' +
      'document and its revision are both DRAFT: uploading a file is not issuance.',
  })
  create(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectDocumentDto,
  ) {
    return this.service.create(identity, projectId, dto);
  }

  @Patch(':documentId')
  @RequirePermissions(PERMISSIONS.projectDocumentsManage)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Edit metadata',
    description:
      'A DRAFT admits every field. An ISSUED document admits only the facts that describe the ' +
      'world rather than the issued file — title, responsible person, issuer, and the validity ' +
      'dates. Its number and category are how it is cited and cannot change.',
  })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateProjectDocumentDto,
  ) {
    return this.service.update(identity, projectId, documentId, dto);
  }

  @Post(':documentId/revisions')
  @RequirePermissions(PERMISSIONS.projectDocumentsManage)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Start a new draft revision',
    description: 'The current issued revision keeps its file and stays readable as history.',
  })
  createRevision(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: CreateDocumentRevisionDto,
  ) {
    return this.service.createRevision(identity, projectId, documentId, dto);
  }

  @Patch(':documentId/revisions/:revisionId/file')
  @RequirePermissions(PERMISSIONS.projectDocumentsManage)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiParam({ name: 'revisionId' })
  @ApiOperation({
    summary: 'Replace the file behind a DRAFT revision',
    description:
      'Refused on an issued revision — its file is immutable, and new content is a new revision. ' +
      'The replaced draft file is discarded rather than orphaned.',
  })
  replaceRevisionFile(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: ReplaceRevisionFileDto,
  ) {
    return this.service.replaceRevisionFile(identity, projectId, documentId, revisionId, dto);
  }

  @Post(':documentId/revisions/:revisionId/issue')
  @RequirePermissions(PERMISSIONS.projectDocumentsIssue)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiParam({ name: 'revisionId' })
  @ApiOperation({
    summary: 'Issue a revision — it becomes current, its file freezes, the previous one supersedes',
    description:
      'The controlled act of the register. One transaction: supersede the outgoing revision, ' +
      'promote this one, repoint the document, and issue the document itself if this is its ' +
      'first. The file becomes IMMUTABLE and can never be replaced.',
  })
  issueRevision(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: IssueRevisionDto,
  ) {
    return this.service.issueRevision(identity, projectId, documentId, revisionId, dto);
  }

  @Post(':documentId/withdraw')
  @RequirePermissions(PERMISSIONS.projectDocumentsIssue)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({ summary: 'Withdraw an issued document — it is no longer to be relied on' })
  withdraw(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: WithdrawDocumentDto,
  ) {
    return this.service.withdraw(identity, projectId, documentId, dto);
  }

  @Post(':documentId/supersede')
  @RequirePermissions(PERMISSIONS.projectDocumentsIssue)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Replace this document with another issued document in the project',
    description:
      'Document-level supersession — a renewed permit replacing the lapsed one. Different from ' +
      'revision supersession, which replaces an issue of the same document.',
  })
  supersede(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: SupersedeDocumentDto,
  ) {
    return this.service.supersede(identity, projectId, documentId, dto);
  }

  @Post(':documentId/archive')
  @RequirePermissions(PERMISSIONS.projectDocumentsIssue)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({ summary: 'Take a document out of daily use, keeping it readable' })
  archive(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.service.archive(identity, projectId, documentId);
  }

  @Delete(':documentId')
  @RequirePermissions(PERMISSIONS.projectDocumentsManage)
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'documentId' })
  @ApiOperation({
    summary: 'Discard a draft that was never issued',
    description:
      'The register has exactly one destructive operation and this is it. Anything with an ' +
      'issued revision in its history is withdrawn or archived instead — a controlled record ' +
      'keeps its history.',
  })
  remove(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.service.remove(identity, projectId, documentId);
  }
}
