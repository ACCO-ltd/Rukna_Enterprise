import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTaxCodeDto {
  @ApiProperty({ example: 'VAT5_OUT', description: '1–10 characters: A–Z, 0–9, "_" or "."' })
  @IsString() @Matches(/^[A-Za-z0-9_.]{1,10}$/)
  code!: string;

  @ApiProperty({ example: 'Sales tax 5%' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '5', description: 'Percent, 0–100, up to 4 decimals. "0" for no tax / exempt.' })
  @IsString() @Matches(/^\d{1,3}(\.\d{1,4})?$/)
  ratePercent!: string;

  @ApiProperty({ enum: ['OUTPUT', 'INPUT'], description: 'OUTPUT taxes client invoices; INPUT taxes purchases' })
  @IsIn(['OUTPUT', 'INPUT'])
  direction!: 'OUTPUT' | 'INPUT';

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Defaults to today' })
  @IsOptional() @IsISO8601()
  effectiveFrom?: string;
}

export class SetDefaultOutputTaxCodeDto {
  @ApiProperty({ description: 'An ACTIVE OUTPUT tax code' })
  @IsString() @IsNotEmpty()
  taxCodeId!: string;
}
