import { IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUomDto {
  @ApiProperty({ example: 'M3' })
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'Cubic Meter' })
  @IsString()
  name: string;


  @ApiProperty({ example: 'm³' })
  @IsString()
  @MaxLength(10)
  symbol: string;
}
