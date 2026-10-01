import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { TaxCodeService } from '../application/tax-code.service.js';
import { CreateTaxCodeDto, SetDefaultOutputTaxCodeDto } from './dto/tax-code.dto.js';

/**
 * ADR-041 — tax codes. Reading is open to whoever raises invoices (they pick a code) and to
 * accounting viewers; maintaining codes and the default is Finance (`manage:accounting`).
 */
@ApiTags('Tax Codes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('tax-codes')
export class TaxCodeController {
  constructor(private readonly taxCodes: TaxCodeService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.receivablesManage, PERMISSIONS.accountingView)
  @ApiOperation({ summary: 'List tax codes and the default sales tax code' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.taxCodes.list(identity);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Create a tax code (409 TAX_CODE_TAKEN, 400 TAX_RATE_INVALID)' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateTaxCodeDto) {
    return this.taxCodes.create(identity, dto);
  }

  @Put('default-output')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiOperation({ summary: 'Set the default sales tax code (422 TAX_CODE_NOT_APPLICABLE)' })
  setDefaultOutput(@CurrentUser() identity: RequestIdentity, @Body() dto: SetDefaultOutputTaxCodeDto) {
    return this.taxCodes.setDefaultOutput(identity, dto.taxCodeId);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Deactivate a tax code (409 TAX_CODE_IS_DEFAULT for the default sales code)' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.taxCodes.setActive(identity, id, false);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.accountingManage)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reactivate a tax code' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.taxCodes.setActive(identity, id, true);
  }
}
