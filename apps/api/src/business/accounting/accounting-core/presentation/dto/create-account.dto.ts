import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';
import type { AccountClass, AccountSubtype, NormalBalance, ControlPostingPolicy, SubledgerType } from '@prisma/client';

export class CreateAccountDto {
  @ApiProperty({ example: '1100' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Accounts Receivable' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'المدينون' })
  @IsString() @IsOptional() @MaxLength(255)
  nameAr?: string;

  @ApiProperty({ enum: ['ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','COST_OF_SALES'] })
  @IsString() @IsNotEmpty()
  accountClass!: AccountClass;

  @ApiProperty({ example: 'ACCOUNTS_RECEIVABLE' })
  @IsString() @IsNotEmpty()
  accountSubtype!: AccountSubtype;

  @ApiProperty({ enum: ['DEBIT','CREDIT'] })
  @IsEnum(['DEBIT','CREDIT'])
  normalBalance!: NormalBalance;

  @ApiProperty()
  @IsBoolean()
  isPostingAllowed!: boolean;

  @ApiProperty()
  @IsBoolean()
  isControlAccount!: boolean;

  @ApiPropertyOptional({ example: 'ACCOUNTS_RECEIVABLE' })
  @IsString() @IsOptional()
  controlledSubledgerType?: SubledgerType;

  @ApiProperty({ enum: ['UNRESTRICTED','SYSTEM_ONLY'] })
  @IsEnum(['UNRESTRICTED','SYSTEM_ONLY'])
  controlPostingPolicy!: ControlPostingPolicy;

  @ApiPropertyOptional({ description: 'Parent account code for hierarchical COA' })
  @IsString() @IsOptional() @MaxLength(30)
  parentAccountCode?: string;

  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  effectiveFrom!: string;
}
