import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { AccountingSetupService } from '../application/accounting-setup.service.js';
import { InstallAccountingSetupDto, SetupTemplateQueryDto } from './dto/install-accounting-setup.dto.js';

/**
 * ADR-040 — accounting setup from a template.
 *
 * Reading the template and the status is `view:accounting` (the owner signing the chart off may
 * not administer it); installing is `manage:accounting`.
 */
@ApiTags('Accounting Configuration')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('accounting/setup')
export class AccountingSetupController {
  constructor(private readonly setup: AccountingSetupService) {}

  @Get('template')
  @RequirePermissions(PERMISSIONS.accountingView)
  @ApiOperation({
    summary: 'Preview the construction chart, posting profiles and conditional rows an install would create',
  })
  getTemplate(@Query() query: SetupTemplateQueryDto) {
    return this.setup.getTemplate(query);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.accountingView)
  @ApiOperation({ summary: 'Whether the one-step setup may still run (only while the chart is empty)' })
  getStatus(@CurrentUser() identity: RequestIdentity) {
    return this.setup.getStatus(identity);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({
    summary: 'Install policies, chart, tax codes, posting profiles, fiscal year, banks and sequences in one transaction',
    description: '409 ACCOUNTING_ALREADY_SET_UP when the organisation already has any account.',
  })
  install(@CurrentUser() identity: RequestIdentity, @Body() dto: InstallAccountingSetupDto) {
    return this.setup.install(identity, dto);
  }
}
