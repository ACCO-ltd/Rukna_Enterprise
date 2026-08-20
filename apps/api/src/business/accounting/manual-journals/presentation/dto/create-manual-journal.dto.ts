import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsDateString, IsArray, IsOptional,
  IsNumber, ValidateNested, ArrayMinSize, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ManualJournalLineDto {
  @ApiProperty({ description: 'GL account ID' })
  @IsString() @IsNotEmpty()
  accountId!: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsNumber() @Min(0) @IsOptional()
  debitAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber() @Min(0) @IsOptional()
  creditAmount?: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional() @MaxLength(500)
  memo?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  costCenterId?: string;
}

export class CreateManualJournalDto {
  @ApiProperty({ example: '2025-01-15' })
  @IsDateString()
  accountingDate!: string;

  @ApiPropertyOptional({ example: '2025-01-15' })
  @IsDateString() @IsOptional()
  documentDate?: string;

  @ApiProperty({ example: 'Accrual adjustment — Q1 consulting fees' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  description!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ type: [ManualJournalLineDto] })
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => ManualJournalLineDto)
  lines!: ManualJournalLineDto[];
}
