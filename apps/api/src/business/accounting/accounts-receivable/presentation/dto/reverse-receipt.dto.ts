import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseReceiptDto {
  @ApiProperty({ example: '2025-02-01' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Returned cheque — bank returned' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
