import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class PostSupplierPaymentDto {
  @ApiPropertyOptional({ example: 'AP-001', description: 'AP GL control account code' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode?: string;

  @ApiPropertyOptional({ example: 'BNK-001', description: 'Bank GL account code' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  bankGlCode?: string;

  @ApiPropertyOptional({ example: 'ADV-001', description: 'Supplier Advance GL account code' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode?: string;
}
