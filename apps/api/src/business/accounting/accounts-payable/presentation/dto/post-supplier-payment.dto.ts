import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class PostSupplierPaymentDto {
  @ApiProperty({ example: 'AP-001', description: 'AP GL control account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;

  @ApiProperty({ example: 'BNK-001', description: 'Bank GL account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  bankGlCode!: string;

  @ApiProperty({ example: 'ADV-001', description: 'Supplier Advance GL account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode!: string;
}
