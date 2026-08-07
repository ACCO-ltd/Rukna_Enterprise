import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, MaxLength } from 'class-validator';

export class AllocateAdvanceDto {
  @ApiProperty({ description: 'Supplier bill ID to apply the advance against' })
  @IsString() @IsNotEmpty()
  supplierBillId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'AP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;

  @ApiProperty({ example: 'ADV-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode!: string;
}
