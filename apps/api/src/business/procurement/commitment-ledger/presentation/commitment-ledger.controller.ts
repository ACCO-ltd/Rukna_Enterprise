import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { CommitmentLedgerService } from '../application/commitment-ledger.service.js';

@ApiTags('Procurement — Commitment Ledger')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('procurement/commitment-ledger')
export class CommitmentLedgerController {
  constructor(private readonly service: CommitmentLedgerService) {}

  @Get('projects/:projectId')
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'stage', required: false, enum: ['COMMITTED', 'ACCRUED', 'ACTUAL'] })
  @ApiQuery({ name: 'boqNodeId', required: false })
  @ApiOperation({ summary: 'Query commitment ledger entries for a project' })
  queryByProject(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('stage') stage?: string,
    @Query('boqNodeId') boqNodeId?: string,
  ) {
    return this.service.queryByProject(identity, projectId, { stage: stage as any, boqNodeId });
  }

  @Get('projects/:projectId/summary')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Summarized commitment totals (COMMITTED / ACCRUED / ACTUAL) for a project' })
  summarizeByProject(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.service.summarizeByProject(identity, projectId);
  }

  @Get('purchase-orders/:poId')
  @ApiParam({ name: 'poId' })
  @ApiOperation({ summary: 'Query commitment ledger entries for a purchase order' })
  queryByPo(@CurrentUser() identity: RequestIdentity, @Param('poId') poId: string) {
    return this.service.queryByPo(identity, poId);
  }
}
