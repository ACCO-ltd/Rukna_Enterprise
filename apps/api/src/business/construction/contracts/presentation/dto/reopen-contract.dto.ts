import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReopenContractDto {
  @ApiProperty({ description: 'Reason for reopening the contract back to draft' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
