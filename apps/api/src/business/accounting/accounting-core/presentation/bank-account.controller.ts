import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { BankAccountService } from '../application/bank-account.service.js';
import { ConfigureBankAccountDto } from './dto/configure-bank-account.dto.js';

@ApiTags('Bank Accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingManage)
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get()
  @ApiOperation({ summary: 'List all bank accounts for the organization' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.bankAccountService.findAll(identity);
  }

  @Post()
  @ApiOperation({ summary: 'Configure a new bank account linked to a GL account' })
  configure(@CurrentUser() identity: RequestIdentity, @Body() dto: ConfigureBankAccountDto) {
    return this.bankAccountService.configure(identity, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get bank account details' })
  findById(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.bankAccountService.findById(identity, id);
  }
}
