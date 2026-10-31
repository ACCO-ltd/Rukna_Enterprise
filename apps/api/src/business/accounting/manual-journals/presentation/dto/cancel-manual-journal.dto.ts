import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CancelManualJournalDto {
  @ApiProperty({ example: 'Raised twice — the accrual is already in JE-000025' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
