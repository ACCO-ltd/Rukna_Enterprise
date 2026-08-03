import { IsString, IsOptional, MaxLength, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty({ example: 'MOF-001', maxLength: 30 })
  @IsString()
  @Length(1, 30)
  code!: string;

  @ApiProperty({ example: 'Ministry of Finance' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'وزارة المالية' })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiPropertyOptional({ example: 'SO123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;
}
