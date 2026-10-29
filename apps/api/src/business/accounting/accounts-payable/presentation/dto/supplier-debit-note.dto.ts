import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of POST /bills/:billId/debit-notes (AP-4). Amount and date are checked by the service. */
export class RecordDebitNoteDto {
  @ApiProperty({ example: '150.00', description: 'Gross credit, at most what is left to pay on the bill' })
  @IsString()
  amount!: string;

  @ApiProperty({ example: '2026-10-29' })
  @IsString()
  accountingDate!: string;

  @ApiProperty({ description: 'What the credit is for: goods returned, overcharge, discount' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: "The supplier's own credit note number" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierReference?: string;
}

export class ReverseDebitNoteDto {
  @ApiProperty({ example: '2026-10-29' })
  @IsString()
  reversalDate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
