import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CREDIT_NOTE_REASONS = [
  'OMISSION',
  'PRICE_ERROR',
  'CORRECTION',
  'NEGATIVE_VARIATION',
] as const;

export class CreateCreditNoteDto {
  @ApiProperty({ enum: CREDIT_NOTE_REASONS, description: 'Reason for the credit note' })
  @IsIn(CREDIT_NOTE_REASONS)
  reason!: 'OMISSION' | 'PRICE_ERROR' | 'CORRECTION' | 'NEGATIVE_VARIATION';

  @ApiProperty({ description: 'Ex-VAT net amount to credit (decimal string)' })
  @IsString()
  netAmount!: string;

  @ApiProperty({ description: 'YYYY-MM-DD accounting date' })
  @IsDateString()
  accountingDate!: string;

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Source variation ID for NEGATIVE_VARIATION credit notes' })
  @IsOptional()
  @IsString()
  sourceVariationId?: string;
}
