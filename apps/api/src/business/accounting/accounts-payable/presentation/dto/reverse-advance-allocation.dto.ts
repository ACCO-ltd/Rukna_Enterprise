import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReverseAdvanceAllocationDto {
  @ApiProperty({ example: 'AP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  apAccountCode!: string;

  @ApiProperty({ example: 'ADV-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  supplierAdvanceCode!: string;
}
