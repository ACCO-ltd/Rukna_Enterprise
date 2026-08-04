import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDecimal } from 'class-validator';

export class AddIpaItemDto {
  @ApiProperty({ description: 'BOQ leaf node ID' })
  @IsString()
  @IsNotEmpty()
  boqNodeId!: string;

  @ApiProperty({ description: 'Total cumulative quantity/percentage claimed to date, including this application' })
  @IsDecimal()
  cumulativeClaimed!: string;
}
