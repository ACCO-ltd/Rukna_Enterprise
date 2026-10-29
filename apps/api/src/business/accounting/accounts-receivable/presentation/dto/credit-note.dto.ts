import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Finance raises a credit note for any posted invoice; a negative variation is raised from the project. */
const FINANCE_CREDIT_NOTE_REASONS = ['OMISSION', 'PRICE_ERROR', 'CORRECTION'] as const;

export class RaiseCreditNoteDto {
  @ApiProperty({ enum: FINANCE_CREDIT_NOTE_REASONS })
  @IsIn(FINANCE_CREDIT_NOTE_REASONS)
  reason!: (typeof FINANCE_CREDIT_NOTE_REASONS)[number];

  @ApiProperty({ description: 'Net amount to credit, before tax (decimal string, e.g. "100.00")' })
  @Matches(/^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/, { message: 'netAmount must be a positive amount with at most 2 decimals' })
  netAmount!: string;

  @ApiProperty({ description: 'YYYY-MM-DD accounting date' })
  @IsDateString()
  accountingDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReverseCreditNoteRequestDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** AR-4 — write off part or all of an invoice's open balance. */
export class RequestWriteOffDto {
  @ApiProperty({ description: 'Decimal string, e.g. "3.50"' })
  @Matches(/^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/, { message: 'amount must be a positive amount with at most 2 decimals' })
  amount!: string;

  @ApiProperty({ enum: ['BAD_DEBT', 'SMALL_BALANCE'] })
  @IsIn(['BAD_DEBT', 'SMALL_BALANCE'])
  reason!: 'BAD_DEBT' | 'SMALL_BALANCE';

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  accountingDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectWriteOffDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
