import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateFiscalYearDto {
  @ApiProperty({ example: 2025, description: 'Calendar year (determines Jan 1 – Dec 31 date range)' })
  @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @ApiProperty({ example: 'RE-001', description: 'GL account code for retained earnings' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  retainedEarningsAccountCode!: string;
}
