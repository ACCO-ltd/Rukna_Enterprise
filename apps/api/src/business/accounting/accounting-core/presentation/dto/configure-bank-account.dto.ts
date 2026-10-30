import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const KINDS = ['BANK', 'CASH', 'MOBILE_WALLET'] as const;
import { IsString, IsNotEmpty, IsBoolean, IsIn, IsOptional, MaxLength } from 'class-validator';

export class ConfigureBankAccountDto {
  @ApiProperty({ example: 'Main Operating Account' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  accountName!: string;


  @ApiProperty({ example: 'Bank of Arabia' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  bankName!: string;

  @ApiProperty({ example: '1234567890' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  accountNumber!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 'BNK-001', description: 'GL account code for this bank account' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  glAccountCode!: string;

  @ApiPropertyOptional({ enum: KINDS, description: 'PM-3: a bank account (default), a cash box or a mobile-money wallet' })
  @IsOptional() @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @ApiProperty()
  @IsBoolean()
  allowsReceipts!: boolean;

  @ApiProperty()
  @IsBoolean()
  allowsPayments!: boolean;
}

/** Body of PATCH /bank-accounts/:id (B-1) — every field optional; the GL account never changes. */
export class UpdateBankAccountBody {
  @IsOptional() @IsString() @MaxLength(255) accountName?: string;
  @IsOptional() @IsString() @MaxLength(255) bankName?: string;
  @IsOptional() @IsString() @MaxLength(50) accountNumber?: string;
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @IsOptional() @IsBoolean() allowsReceipts?: boolean;
  @IsOptional() @IsBoolean() allowsPayments?: boolean;
}

/** Body of POST /bank-accounts/:id/status (B-1). */
export class BankAccountStatusBody {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CLOSED']) status!: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}
