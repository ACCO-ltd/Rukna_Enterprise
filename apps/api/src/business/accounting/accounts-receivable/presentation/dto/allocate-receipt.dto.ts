import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, MaxLength } from 'class-validator';

export class AllocateReceiptDto {
  @ApiProperty({ description: 'Client invoice ID to allocate against' })
  @IsString() @IsNotEmpty()
  clientInvoiceId!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'AR-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  arAccountCode!: string;

  @ApiProperty({ example: 'UNP-001' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  unappliedAccountCode!: string;
}
