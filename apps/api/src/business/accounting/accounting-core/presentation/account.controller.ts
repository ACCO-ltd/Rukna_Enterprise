import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { AccountService } from '../application/account.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { ImportCoaDto } from './dto/import-coa.dto.js';

@ApiTags('Chart of Accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingManage)
@Controller('accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  @ApiOperation({ summary: 'List all GL accounts for the organization' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.accountService.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new GL account' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateAccountDto) {
    return this.accountService.create(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get GL account by ID' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.accountService.findById(identity, id);
  }

  @Get('by-code/:code')
  @ApiParam({ name: 'code', description: 'Account code e.g. AR-001' })
  @ApiOperation({ summary: 'Look up GL account by code' })
  findByCode(@CurrentUser() identity: RequestIdentity, @Param('code') code: string) {
    return this.accountService.findByCode(identity, code);
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk-import chart of accounts (upsert by code)' })
  importCoa(@CurrentUser() identity: RequestIdentity, @Body() dto: ImportCoaDto) {
    return this.accountService.importChartOfAccounts(identity, dto.accounts);
  }
}
