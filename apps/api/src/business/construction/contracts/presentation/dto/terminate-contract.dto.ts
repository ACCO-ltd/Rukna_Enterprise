import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class TerminateContractDto {
  @ApiProperty({ description: 'Reason for termination' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
