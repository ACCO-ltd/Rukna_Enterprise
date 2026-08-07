import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseSupplierBillDto {
  @ApiProperty({ example: '2025-02-01' })
  @IsDateString()
  reversalDate!: string;

  @ApiProperty({ example: 'Duplicate invoice — already posted under different reference' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
