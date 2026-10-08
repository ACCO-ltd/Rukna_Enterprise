import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class PostSupplierBillDto {
  @ApiPropertyOptional({ example: 'AP-001', description: 'AP GL control account code' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode?: string;
}
