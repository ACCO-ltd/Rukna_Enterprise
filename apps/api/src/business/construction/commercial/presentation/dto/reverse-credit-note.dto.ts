import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Phase 0 H2 — reverse a posted credit note issued in error (EVT-AR-008). */
export class ReverseCreditNoteDto {
  @ApiProperty({ example: '2026-10-27' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Credited the wrong invoice' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
