import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { ClientStatementService } from '../application/client-statement.service.js';

@ApiTags('Client Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.receivablesManage)
@Controller('finance/clients')
export class ClientStatementController {
  constructor(private readonly statements: ClientStatementService) {}

  @Get(':clientId/statement')
  @ApiOperation({ summary: "AR-3: a client's statement of account for a period (all projects and sales)" })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD; default 1 January of the `to` year' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD; default today' })
  statement(
    @CurrentUser() identity: RequestIdentity,
    @Param('clientId') clientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.statements.statement(identity, clientId, from, to);
  }
}
