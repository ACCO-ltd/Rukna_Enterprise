import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDecimal, MaxLength } from 'class-validator';

export class AddIpaItemDto {
  @ApiProperty({ description: 'BOQ leaf node ID' })
  @IsString()
  @IsNotEmpty()
  boqNodeId!: string;

  @ApiProperty({ description: 'Unit rate from contractual BOQ version' })
  @IsDecimal()
  unitRateSnapshot!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currencySnapshot!: string;

  @ApiProperty({ description: 'Total cumulative quantity/percentage claimed to date, including this application' })
  @IsDecimal()
  cumulativeClaimed!: string;
}
