import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class PostSupplierBillDto {
  @ApiProperty({ example: 'AP-001', description: 'AP GL control account code' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;
}
