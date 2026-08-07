import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseInvoiceDto {
  @ApiProperty({ example: '2025-02-01' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Invoice cancelled — client dispute' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
