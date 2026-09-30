import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_BANKS } from '../../templates/construction.js';

export class SetupVatDto {
  @ApiProperty({ description: 'Whether the organisation charges VAT' })
  @IsBoolean()
  charged!: boolean;

  @ApiPropertyOptional({ example: 5, description: '0 < rate ≤ 100, at most two decimals. Required when charged.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  ratePercent?: number;
}

export class SetupBankDto {
  @ApiProperty({ example: 'Salaam Bank — operating', description: 'Becomes the GL account name' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  accountName!: string;

  @ApiProperty({ example: 'Salaam Somali Bank' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  bankName!: string;

  @ApiPropertyOptional({ example: '0012345678' })
  @IsOptional() @IsString() @MaxLength(50)
  accountNumber?: string;
}

export class SetupFiscalYearDto {
  @ApiProperty({ example: 2026 })
  @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Month the fiscal year starts (1–12)' })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  startMonth?: number;
}

export class InstallAccountingSetupDto {
  @ApiProperty({ enum: ['CONSTRUCTION'] })
  @IsIn(['CONSTRUCTION'])
  templateId!: 'CONSTRUCTION';

  @ApiProperty({ type: SetupVatDto })
  @ValidateNested() @Type(() => SetupVatDto)
  vat!: SetupVatDto;

  @ApiProperty({ type: [SetupBankDto], description: `0..${MAX_BANKS} banks; each gets its own GL account` })
  @IsArray() @ArrayMaxSize(MAX_BANKS)
  @ValidateNested({ each: true }) @Type(() => SetupBankDto)
  banks!: SetupBankDto[];

  @ApiProperty({ type: SetupFiscalYearDto })
  @ValidateNested() @Type(() => SetupFiscalYearDto)
  fiscalYear!: SetupFiscalYearDto;
}

export class SetupTemplateQueryDto {
  @ApiPropertyOptional({ description: 'VAT rate; omitted or 0 means VAT is not charged' })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  vatRate?: number;

  @ApiPropertyOptional({ description: `Number of banks to preview (0..${MAX_BANKS})` })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_BANKS)
  banks?: number;
}
