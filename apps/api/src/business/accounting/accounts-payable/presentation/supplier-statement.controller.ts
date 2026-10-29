import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { SupplierStatementService } from '../application/supplier-statement.service.js';

@ApiTags('Supplier Bills')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.payablesManage)
@Controller('finance/suppliers')
export class SupplierStatementController {
  constructor(private readonly statements: SupplierStatementService) {}

  @Get(':supplierId/statement')
  @ApiOperation({ summary: "AP-3: a supplier's statement of account for a period (all bills, payments and buyer cash)" })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD; default 1 January of the `to` year' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD; default today' })
  statement(
    @CurrentUser() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.statements.statement(identity, supplierId, from, to);
  }
}
