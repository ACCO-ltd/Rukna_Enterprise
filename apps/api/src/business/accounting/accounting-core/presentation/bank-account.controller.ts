import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { BankAccountService } from '../application/bank-account.service.js';
import { BankAccountSignatoryService } from '../application/bank-account-signatory.service.js';
import { BankAccountStatusBody, ConfigureBankAccountDto, UpdateBankAccountBody } from './dto/configure-bank-account.dto.js';
import { AddSignatoryDto } from './dto/add-signatory.dto.js';

@ApiTags('Bank Accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingManage)
@Controller('bank-accounts')
export class BankAccountController {
  constructor(
    private readonly bankAccountService: BankAccountService,
    private readonly signatoryService: BankAccountSignatoryService,
  ) {}

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
    return this.bankAccountService.view(identity, id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'B-1: correct a bank account’s details or what it is used for (the GL account never changes)' })
  @ApiResponse({ status: 409, description: 'BANK_ACCOUNT_CLOSED · ACCOUNT_NUMBER_TAKEN' })
  update(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: UpdateBankAccountBody) {
    return this.bankAccountService.update(identity, id, dto);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'B-1: suspend, reactivate or close a bank account (close: zero ledger balance, nothing waiting to post; final)' })
  @ApiResponse({ status: 409, description: 'BANK_ACCOUNT_CLOSED · BANK_ACCOUNT_HAS_BALANCE · BANK_ACCOUNT_HAS_PENDING' })
  setStatus(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: BankAccountStatusBody) {
    return this.bankAccountService.setStatus(identity, id, dto.status);
  }

  // ─── Signatories (ADR-022 CONST-DOA-005) ───────────────────────────────────────

  @Get(':id/signatories')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'List active authorized signatories of a bank account' })
  listSignatories(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.signatoryService.list(identity, id);
  }

  @Post(':id/signatories')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Authorize a signatory. Payments from an account with signatories require ≥2 to release.',
  })
  addSignatory(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: AddSignatoryDto,
  ) {
    return this.signatoryService.add(identity, id, dto.userId);
  }

  @Delete(':id/signatories/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Remove (deactivate) a bank-account signatory' })
  removeSignatory(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.signatoryService.remove(identity, id, userId);
  }
}
