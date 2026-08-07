import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseAllocationDto {
  @ApiProperty({ example: 'AR-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'UNP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  unappliedAccountCode!: string;
}
