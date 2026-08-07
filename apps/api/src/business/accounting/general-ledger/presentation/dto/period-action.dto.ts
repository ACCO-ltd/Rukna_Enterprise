import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReopenPeriodDto {
  @ApiProperty({ example: 'CFO-approved correction — AR allocation error' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
