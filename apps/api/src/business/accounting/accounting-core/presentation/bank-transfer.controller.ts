import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { BankTransferService } from '../application/bank-transfer.service.js';

class RequestTransferDto {
  @IsString() fromBankAccountId!: string;
  @IsString() toBankAccountId!: string;
  @IsString() @MaxLength(30) amount!: string;
  @IsString() @MaxLength(10) transferDate!: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
}

class RejectTransferDto {
  @IsString() @MaxLength(500) reason!: string;
}

class ReverseTransferDto {
  @IsString() @MaxLength(10) reversalDate!: string;
  @IsString() @MaxLength(500) reason!: string;
}

@ApiTags('Bank Accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingManage)
@Controller('bank-transfers')
export class BankTransferController {
  constructor(private readonly transfers: BankTransferService) {}

  @Get()
  @ApiOperation({ summary: 'B-2: transfers between the organisation’s own accounts (newest first)' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  list(@CurrentUser() identity: RequestIdentity, @Query('bankAccountId') bankAccountId?: string) {
    return this.transfers.list(identity, bankAccountId);
  }

  @Post()
  @ApiOperation({ summary: 'B-2: move money between two own accounts — posts at once up to the payment limit, else waits for approval' })
  @ApiResponse({ status: 400, description: 'TRANSFER_AMOUNT_INVALID · TRANSFER_DATE_INVALID · TRANSFER_SAME_ACCOUNT · BANK_ACCOUNT_NOT_PAYING · BANK_ACCOUNT_NOT_RECEIVING · CURRENCY_MISMATCH' })
  request(@CurrentUser() identity: RequestIdentity, @Body() dto: RequestTransferDto) {
    return this.transfers.request(identity, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 403, description: 'TRANSFER_SELF_APPROVAL' })
  approve(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.transfers.approve(identity, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: RejectTransferDto) {
    return this.transfers.reject(identity, id, dto.reason);
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  reverse(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: ReverseTransferDto) {
    return this.transfers.reverse(identity, id, dto);
  }
}
