import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseManualJournalDto {
  @ApiProperty({ example: '2025-02-01' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Correcting entry — wrong account used' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
