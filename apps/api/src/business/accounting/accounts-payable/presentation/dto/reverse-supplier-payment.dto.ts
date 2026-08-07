import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseSupplierPaymentDto {
  @ApiProperty({ example: '2025-02-01' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Payment cancelled — wrong supplier' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
