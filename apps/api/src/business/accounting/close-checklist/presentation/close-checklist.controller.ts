import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { CloseChecklistService } from '../application/close-checklist.service.js';

export class CloseChecklistPolicyDto {
  @IsBoolean() requireBankReconciliation!: boolean;
}

/** Step 6 — the month-end close checklist. Reading is for whoever reads the accounts. */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('finance/close-checklist')
export class CloseChecklistController {
  constructor(private readonly service: CloseChecklistService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage, PERMISSIONS.periodsManage)
  @ApiOperation({ summary: 'Every check before a month closes, read live from the ledger' })
  checklist(@CurrentUser() identity: RequestIdentity, @Query('periodId') periodId?: string) {
    return this.service.checklist(identity, periodId || undefined);
  }

  @Put('policy')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Whether closing a month waits for every bank account to be reconciled' })
  setPolicy(@CurrentUser() identity: RequestIdentity, @Body() dto: CloseChecklistPolicyDto) {
    return this.service.setRequireBankReconciliation(identity, dto.requireBankReconciliation);
  }
}
