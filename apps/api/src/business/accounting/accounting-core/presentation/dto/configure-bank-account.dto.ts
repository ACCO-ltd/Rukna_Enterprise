import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class ConfigureBankAccountDto {
  @ApiProperty({ example: 'Main Operating Account' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  accountName!: string;


  @ApiProperty({ example: 'Bank of Arabia' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  bankName!: string;

  @ApiProperty({ example: '1234567890' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  accountNumber!: string;

  @ApiProperty({ example: 'USD' })
  @IsString() @IsNotEmpty() @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 'BNK-001', description: 'GL account code for this bank account' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  glAccountCode!: string;

  @ApiProperty()
  @IsBoolean()
  allowsReceipts!: boolean;

  @ApiProperty()
  @IsBoolean()
  allowsPayments!: boolean;
}
