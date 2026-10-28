import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { AccountingConfigurationService } from '../application/accounting-configuration.service.js';
import { UpdateApprovalSettingsDto } from './dto/approval-settings.dto.js';

/**
 * ADR-046 §8 — the optional finance approvals (invoice / bill above an amount, tolerated PO
 * matches, the payment auto-approval limit). Read by anyone who raises or decides those documents;
 * changed by Finance (`manage:accounting`).
 */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounting/approval-settings')
export class ApprovalSettingsController {
  constructor(private readonly config: AccountingConfigurationService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage, PERMISSIONS.receivablesManage, PERMISSIONS.payablesManage)
  @ApiOperation({ summary: 'The finance approval settings in force (defaults when never saved)' })
  get(@CurrentUser() identity: RequestIdentity) {
    return this.config.getApprovalSettingsDto(identity);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Save the finance approval settings (audited)' })
  @ApiResponse({ status: 400, description: 'APPROVAL_SETTINGS_INVALID — details.problems lists every bad field' })
  update(@CurrentUser() identity: RequestIdentity, @Body() dto: UpdateApprovalSettingsDto) {
    return this.config.updateApprovalSettings(identity, dto);
  }
}
